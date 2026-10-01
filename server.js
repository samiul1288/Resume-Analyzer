"use strict";

/**
 * Resume Analyzer server.
 *
 *   GET  /                  -> static UI from /public
 *   GET  /api/health        -> server + extractor + service status
 *   GET  /api/samples       -> list of bundled sample resumes/job posts
 *   GET  /api/samples/:id   -> one sample (resume + job description text)
 *   POST /api/extract       -> { fileBase64, fileName, mimeType } -> { text, method, warnings }
 *   POST /api/analyze       -> { resumeText | fileBase64, jobText } -> full report
 *
 * Boot order (fail fast): dotenv -> Firebase -> MongoDB Atlas -> HTTP listen.
 * Every credential comes from the environment; .env.example lists them all.
 * If a service is unconfigured or unreachable, startup aborts - see bootstrap().
 */

/* -- 0. environment -------------------------------------------------------
   dotenv must be the FIRST require in the entry file: everything below this
   line (including the Firebase/MongoDB config) reads process.env and has to
   see the parsed .env file. CommonJS on purpose - package.json sets no
   "type": "module", so require() is the correct syntax here. */
require("dotenv").config({ quiet: true });

const http = require("http");
const fs = require("fs");
const path = require("path");

/* -- 1. external service SDKs --------------------------------------------- */
const { MongoClient } = require("mongodb");
const { initializeApp } = require("firebase/app");

const { analyze } = require("./src/analyzer");
const { extractText, extractorCapabilities } = require("./src/extract");

const PORT = Number(process.env.PORT || 5173);
const HOST = process.env.HOST || "127.0.0.1";
const PUBLIC_DIR = path.join(__dirname, "public");
const SAMPLES_DIR = path.join(__dirname, "samples");
const MAX_BODY_BYTES = 24 * 1024 * 1024; // base64 of a ~17 MB upload

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
};

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload, null, 2);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store",
  });
  res.end(body);
}

function sendError(res, status, message, code = "ERROR", extra = {}) {
  sendJson(res, status, { error: { message, code }, ...extra });
}

/** Read a JSON request body with a hard size cap. */
function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(
          Object.assign(new Error("Request body is too large (limit 24 MB)."), {
            status: 413,
            code: "BODY_TOO_LARGE",
          }),
        );
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8").trim();
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch (error) {
        reject(
          Object.assign(new Error("Request body must be valid JSON."), {
            status: 400,
            code: "BAD_JSON",
          }),
        );
      }
    });
    req.on("error", reject);
  });
}

function decodeBase64File(base64, fileName) {
  const cleaned = String(base64).replace(/^data:[^;]+;base64,/, "");
  const buffer = Buffer.from(cleaned, "base64");
  if (buffer.length === 0) {
    throw Object.assign(
      new Error(`Could not read "${fileName || "the uploaded file"}".`),
      { status: 400, code: "BAD_UPLOAD" },
    );
  }
  return buffer;
}

/** Serve a file from the public directory, refusing path traversal. */
function serveStatic(req, res, pathname) {
  const relative =
    pathname === "/"
      ? "index.html"
      : decodeURIComponent(pathname).replace(/^\/+/, "");
  const target = path.resolve(PUBLIC_DIR, relative);
  if (!target.startsWith(PUBLIC_DIR)) {
    sendError(res, 403, "Forbidden path.", "FORBIDDEN");
    return;
  }

  fs.stat(target, (statError, stats) => {
    if (statError || !stats.isFile()) {
      sendError(res, 404, `Not found: ${pathname}`, "NOT_FOUND");
      return;
    }
    const ext = path.extname(target).toLowerCase();
    res.writeHead(200, {
      "Content-Type": MIME_TYPES[ext] || "application/octet-stream",
      "Content-Length": stats.size,
      "Cache-Control": "no-cache",
    });
    fs.createReadStream(target).pipe(res);
  });
}

/** Bundled sample resumes + matching job descriptions for one-click testing. */
function listSamples() {
  if (!fs.existsSync(SAMPLES_DIR)) return [];
  return fs
    .readdirSync(SAMPLES_DIR)
    .filter((f) => f.endsWith(".json"))
    .map((file) => {
      try {
        const data = JSON.parse(
          fs.readFileSync(path.join(SAMPLES_DIR, file), "utf8"),
        );
        return {
          id: path.basename(file, ".json"),
          title: data.title,
          tagline: data.tagline,
        };
      } catch (error) {
        return null;
      }
    })
    .filter(Boolean);
}

function readSample(id) {
  const safe = String(id).replace(/[^a-z0-9_-]/gi, "");
  const file = path.join(SAMPLES_DIR, `${safe}.json`);
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

async function handleApi(req, res, url) {
  const { pathname } = url;

  if (req.method === "GET" && pathname === "/api/firebase-config") {
    const config = {};
    for (const [field, envKey] of Object.entries(FIREBASE_ENV_KEYS)) {
      config[field] = process.env[envKey] || "";
    }
    sendJson(res, 200, config);
    return;
  }

  if (req.method === "GET" && pathname === "/api/health") {
    sendJson(res, 200, {
      ok: true,
      service: "resume-analyzer",
      version: "1.0.0",
      node: process.version,
      extractors: extractorCapabilities(),
      services: {
        firebase: Boolean(services.firebase),
        mongodb:
          services.mongo && services.db
            ? { connected: true, database: services.db.databaseName }
            : { connected: false, database: MONGO_DB_NAME },
      },
    });
    return;
  }

  if (req.method === "GET" && pathname === "/api/samples") {
    sendJson(res, 200, { samples: listSamples() });
    return;
  }

  if (req.method === "GET" && pathname.startsWith("/api/samples/")) {
    const sample = readSample(pathname.slice("/api/samples/".length));
    if (!sample) {
      sendError(res, 404, "Sample not found.", "NOT_FOUND");
      return;
    }
    sendJson(res, 200, sample);
    return;
  }

  if (req.method === "POST" && pathname === "/api/extract") {
    const body = await readJsonBody(req);
    if (!body.fileBase64) {
      sendError(
        res,
        400,
        "Provide fileBase64 (the uploaded file, base64 encoded).",
        "NO_FILE",
      );
      return;
    }
    const buffer = decodeBase64File(body.fileBase64, body.fileName);
    const result = await extractText({
      buffer,
      fileName: body.fileName || "",
      mimeType: body.mimeType || "",
    });
    sendJson(res, 200, result);
    return;
  }

  if (req.method === "POST" && pathname === "/api/analyze") {
    const body = await readJsonBody(req);
    let resumeText = typeof body.resumeText === "string" ? body.resumeText : "";
    let extraction = {
      method: "pasted text",
      kind: "text",
      warnings: [],
      quality: 1,
      words: resumeText.split(/\s+/).filter(Boolean).length,
    };

    if (!resumeText.trim() && body.fileBase64) {
      const buffer = decodeBase64File(body.fileBase64, body.fileName);
      const result = await extractText({
        buffer,
        fileName: body.fileName || "",
        mimeType: body.mimeType || "",
      });
      resumeText = result.text;
      extraction = {
        method: result.method,
        kind: result.kind,
        warnings: result.warnings,
        quality: result.quality,
        words: result.words,
        needsClientExtraction: result.needsClientExtraction,
      };
    }

    if (!resumeText.trim()) {
      sendError(
        res,
        400,
        "No resume text found. Paste the resume or upload a text-based PDF/DOCX.",
        "NO_RESUME",
      );
      return;
    }

    const report = analyze(
      resumeText,
      typeof body.jobText === "string" ? body.jobText : "",
      {
        fileName: body.fileName || "",
      },
    );

    sendJson(res, 200, { ...report, extraction });
    return;
  }

  sendError(
    res,
    404,
    `Unknown API route: ${req.method} ${pathname}`,
    "NOT_FOUND",
  );
}

/* ========================= EXTERNAL SERVICES ============================
 * Firebase and MongoDB Atlas are both required at boot. Configuration is read
 * strictly from process.env (populated by dotenv above) - no credential ever
 * lives in this file.
 * ========================================================================== */

/** Firebase web config fields -> the .env variable that supplies each one. */
const FIREBASE_ENV_KEYS = {
  apiKey: "FIREBASE_API_KEY",
  authDomain: "FIREBASE_AUTH_DOMAIN",
  projectId: "FIREBASE_PROJECT_ID",
  storageBucket: "FIREBASE_STORAGE_BUCKET",
  messagingSenderId: "FIREBASE_MESSAGING_SENDER_ID",
  appId: "FIREBASE_APP_ID",
};

const MONGO_DB_NAME = process.env.MONGO_DB_NAME || "resume-maker-user";
const MONGO_TIMEOUT_MS = Number(process.env.MONGO_TIMEOUT_MS || 5000);

/** Live service handles. Filled in by bootstrap() before the port is opened. */
const services = {
  firebase: null,
  mongo: null,
  db: null,
  databaseName: MONGO_DB_NAME,
};

/** Every service variable that must be present before the app may start. */
function requiredServiceEnv() {
  return ["MONGO_URI", ...Object.values(FIREBASE_ENV_KEYS)];
}

/** The subset of required variables that is absent from the environment. */
function missingServiceEnv() {
  return requiredServiceEnv().filter((key) => !process.env[key]);
}

/**
 * Initialize the Firebase app with the credentials from .env.
 * Runs synchronously: initializeApp() itself opens no connection, so a bad
 * key surfaces as a thrown error rather than a hung boot.
 * @returns {object} the initialized FirebaseApp
 */
function initFirebase() {
  const config = {};
  const missing = [];

  for (const [field, envKey] of Object.entries(FIREBASE_ENV_KEYS)) {
    const value = process.env[envKey];
    if (!value) missing.push(envKey);
    else config[field] = value;
  }
  if (missing.length) {
    throw new Error(
      `Firebase is not configured - add ${missing.join(", ")} to .env (see .env.example).`,
    );
  }

  const app = initializeApp(
    config,
    process.env.FIREBASE_APP_NAME || "resume-analyzer",
  );
  console.log("Firebase initialized successfully");
  return app;
}

/**
 * Connect to MongoDB Atlas, prove the connection with a ping, then select the
 * application database (`resume-maker-user` unless MONGO_DB_NAME overrides).
 * @returns {Promise<{client: MongoClient, db: object}>}
 */
async function run() {
  const uri = process.env.MONGO_URI;
  if (!uri)
    throw new Error(
      "MongoDB is not configured - add MONGO_URI to .env (see .env.example).",
    );

  const client = new MongoClient(uri, {
    connectTimeoutMS: MONGO_TIMEOUT_MS,
    serverSelectionTimeoutMS: MONGO_TIMEOUT_MS,
  });

  await client.connect();
  console.log("Connected successfully to MongoDB Atlas!");

  const db = client.db(MONGO_DB_NAME);
  const ping = await db.command({ ping: 1 });
  console.log(
    `Database "${db.databaseName}" ready (ping ${ping && ping.ok === 1 ? "ok" : "unexpected"})`,
  );
  return { client, db };
}

/** Firebase -> MongoDB -> handles. Throws (and the caller exits) on any failure. */
async function bootstrap() {
  const missing = missingServiceEnv();
  if (missing.length) {
    throw new Error(
      `missing required environment variables: ${missing.join(", ")}.\n` +
        "    Copy .env.example to .env and fill in your Firebase + MongoDB Atlas credentials.",
    );
  }
  services.firebase = initFirebase();
  const { client, db } = await run();
  services.mongo = client;
  services.db = db;
  return services;
}

/** Release the Atlas connection (and the port) before the process goes away. */
async function shutdownServices(signal) {
  console.log(`\n  ${signal} received - closing service connections...`);
  try {
    if (services.mongo) await services.mongo.close();
  } catch (error) {
    console.error(`  MongoDB close failed: ${error.message}`);
  }
  try {
    server.close();
  } catch (error) {
    /* already closed */
  }
  process.exit(0);
}

const server = http.createServer(async (req, res) => {
  const started = Date.now();
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);

  res.on("finish", () => {
    const ms = Date.now() - started;
    console.log(
      `${req.method} ${url.pathname} -> ${res.statusCode} (${ms} ms)`,
    );
  });

  try {
    if (url.pathname.startsWith("/api/")) {
      await handleApi(req, res, url);
    } else if (req.method === "GET" || req.method === "HEAD") {
      serveStatic(req, res, url.pathname);
    } else {
      sendError(res, 405, "Method not allowed.", "METHOD_NOT_ALLOWED");
    }
  } catch (error) {
    const status = error.status || 500;
    const code = error.code || "INTERNAL_ERROR";
    if (status >= 500) console.error(error);
    sendError(res, status, error.message || "Unexpected server error.", code);
  }
});

/* eslint-disable no-console */

/** Open the port. Only ever called once both services are confirmed live. */
function startServer() {
  return new Promise((resolve) => {
    server.listen(PORT, HOST, () => {
      const caps = extractorCapabilities();
      console.log("");
      console.log("  Resume Analyzer is running");
      console.log(`  -> http://${HOST}:${PORT}`);
      console.log(
        `  Firebase: initialized (${services.firebase ? services.firebase.name : "n/a"})`,
      );
      console.log(`  MongoDB:  ${services.db.databaseName}`);
      console.log(
        `  PDF  extraction: ${caps.pdfParse ? "pdf-parse (full quality)" : "built-in parser + browser pdf.js"}`,
      );
      console.log(
        `  DOCX extraction: ${caps.mammoth ? "mammoth (full quality)" : "built-in zip/xml reader"}`,
      );
      console.log(
        "  API: GET /api/health  GET /api/samples  POST /api/extract  POST /api/analyze",
      );
      console.log("");
      resolve(server);
    });
  });
}

/* -- 2. boot --------------------------------------------------------------
   Strict by design: no Firebase app and no Atlas connection means no server.
   Requiring this file (tests, tooling) never boots - only direct execution. */
if (require.main === module) {
  for (const signal of ["SIGINT", "SIGTERM"])
    process.on(signal, () => shutdownServices(signal));
  process.on("unhandledRejection", (reason) => {
    console.error(
      `  Unhandled rejection: ${reason && reason.message ? reason.message : reason}`,
    );
    process.exitCode = 1;
    process.exit(1);
  });

  bootstrap()
    .then(startServer)
    .catch((error) => {
      console.error("");
      console.error(`  Resume Analyzer failed to start: ${error.message}`);
      if (!/missing required environment variables/.test(error.message)) {
        console.error(
          "  Check the credentials in .env and that MongoDB Atlas allows this IP.",
        );
      }
      console.error("");
      process.exitCode = 1;
      process.exit(1);
    });
}

module.exports = {
  server,
  handleApi,
  bootstrap,
  initFirebase,
  run,
  shutdownServices,
  services,
  requiredServiceEnv,
  missingServiceEnv,
  FIREBASE_ENV_KEYS,
  MONGO_DB_NAME,
};
