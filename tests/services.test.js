"use strict";

/**
 * Contract tests for the environment / Firebase / MongoDB Atlas integration.
 *
 * Nothing here talks to a real service: the static tests pin the wiring, the
 * two runtime tests prove the strict (fail fast) boot paths by spawning
 * server.js in a temp directory so dotenv cannot find a real .env file.
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const ROOT = path.join(__dirname, "..");
const SERVER_PATH = path.join(ROOT, "server.js");
const server = fs.readFileSync(SERVER_PATH, "utf8").replace(/\r\n/g, "\n");
const pkg = JSON.parse(
  fs.readFileSync(path.join(ROOT, "package.json"), "utf8"),
);
const gitignore = fs
  .readFileSync(path.join(ROOT, ".gitignore"), "utf8")
  .replace(/\r\n/g, "\n");
const envExample = fs
  .readFileSync(path.join(ROOT, ".env.example"), "utf8")
  .replace(/\r\n/g, "\n");

const FIREBASE_VARS = [
  "FIREBASE_API_KEY",
  "FIREBASE_AUTH_DOMAIN",
  "FIREBASE_PROJECT_ID",
  "FIREBASE_STORAGE_BUCKET",
  "FIREBASE_MESSAGING_SENDER_ID",
  "FIREBASE_APP_ID",
];

/** Minimal, Windows-safe env for a spawned server (never inherits the real .env). */
function spawnEnv(overrides) {
  return {
    SystemRoot: process.env.SystemRoot,
    PATH: process.env.PATH,
    PATHEXT: process.env.PATHEXT,
    TMP: process.env.TMP,
    TEMP: process.env.TEMP,
    USERPROFILE: process.env.USERPROFILE,
    HOST: "127.0.0.1",
    ...overrides,
  };
}

function bootFresh(overrides) {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "ra-boot-"));
  return spawnSync(process.execPath, [SERVER_PATH], {
    cwd,
    env: spawnEnv(overrides),
    encoding: "utf8",
    timeout: 60000,
  });
}

test("package.json stays CommonJS and carries the new SDK dependencies", () => {
  assert.equal(
    pkg.type,
    undefined,
    'no "type": "module" - the entry file uses require()',
  );
  for (const dep of ["dotenv", "mongodb", "firebase"]) {
    assert.ok(pkg.dependencies[dep], `${dep} must be listed in dependencies`);
  }
});

test("server.js configures dotenv before the first process.env read", () => {
  const dotenvAt = server.search(/require\(["']dotenv["']\)\.config\(/);
  assert.ok(dotenvAt > -1, "dotenv.config() must run in the entry file");
  assert.ok(
    server.slice(0, dotenvAt).split("\n").length < 35,
    "dotenv must be configured at the very top",
  );
  assert.ok(
    dotenvAt < server.indexOf("process.env.PORT"),
    "no env reads before dotenv.config()",
  );
});

test("Firebase is initialized from process.env and logs success", () => {
  const mapStart = server.indexOf("const FIREBASE_ENV_KEYS");
  const mapEnd = server.indexOf("const MONGO_DB_NAME");
  const map = server.slice(mapStart, mapEnd);

  assert.ok(
    mapStart > -1 && mapEnd > mapStart,
    "a Firebase env map must exist",
  );
  assert.match(
    server,
    /require\(["']firebase\/app["']\)/,
    "must use the firebase/app SDK",
  );
  for (const key of FIREBASE_VARS) {
    assert.ok(
      map.includes(`'${key}'`) || map.includes(`"${key}"`),
      `${key} must be mapped in FIREBASE_ENV_KEYS`,
    );
  }
  assert.match(
    server,
    /process\.env\[envKey\]/,
    "Firebase values must be read out of process.env",
  );
  assert.match(
    server,
    /initializeApp\(\s*config\s*,/,
    "the env-derived config must reach initializeApp",
  );
  assert.match(
    server,
    /console\.log\(["']Firebase initialized successfully["']\)/,
  );
  assert.doesNotMatch(
    server,
    /AIza[0-9A-Za-z_-]{20,}/,
    "no hardcoded Firebase key",
  );
});

test("MongoDB uses MongoClient, MONGO_URI and the resume-maker-user database", () => {
  assert.match(server, /const \{ MongoClient \} = require\(["']mongodb["']\)/);
  assert.match(
    server,
    /process\.env\.MONGO_URI/,
    "the URI must come from process.env",
  );
  assert.match(server, /new MongoClient\(uri,/);
  assert.match(server, /await client\.connect\(\)/);
  assert.match(
    server,
    /console\.log\(["']Connected successfully to MongoDB Atlas!["']\)/,
  );
  assert.match(server, /client\.db\(MONGO_DB_NAME\)/);
  assert.match(
    server,
    /process\.env\.MONGO_DB_NAME \|\| ["']resume-maker-user["']/,
  );
  assert.doesNotMatch(
    server,
    /mongodb\+srv:\/\/[^'<\s]/,
    "no hardcoded Atlas URI",
  );
});

test("every service failure aborts the boot instead of half-starting", () => {
  assert.match(
    server,
    /if \(require\.main === module\)/,
    "importing server.js must not boot services",
  );
  assert.match(
    server,
    /bootstrap\(\)[\s\S]*\.then\(startServer\)[\s\S]*\.catch\(/,
    "listen waits for services",
  );
  assert.match(server, /console\.error\(\s*`  Resume Analyzer failed to start/);
  assert.match(server, /process\.exit\(1\)/);
  assert.match(
    server,
    /server\.listen\(PORT, HOST/,
    "HTTP only opens inside startServer()",
  );
});

test(".env.example documents every variable the server reads, and .env is ignored", () => {
  const documented = new Set(
    [...envExample.matchAll(/^([A-Z][A-Z0-9_]*)=/gm)].map((m) => m[1]),
  );
  const direct = [...server.matchAll(/process\.env\.([A-Z][A-Z0-9_]*)/g)].map(
    (m) => m[1],
  );
  const mapped = [...server.matchAll(/:\s*["'](FIREBASE_[A-Z0-9_]+)["']/g)].map(
    (m) => m[1],
  );
  const used = new Set([...direct, ...mapped]);

  assert.ok(
    used.size >= 8,
    `expected the server to read its config from process.env, saw ${[...used]}`,
  );
  for (const key of used)
    assert.ok(documented.has(key), `.env.example must document ${key}`);
  for (const key of FIREBASE_VARS)
    assert.ok(documented.has(key), `${key} missing from .env.example`);

  assert.ok(gitignore.split("\n").includes(".env"), ".env must be git-ignored");
  assert.ok(
    !gitignore.split("\n").includes(".env.example"),
    ".env.example must stay committable",
  );
});

test("requiredServiceEnv is static and a fully configured environment passes", () => {
  // Imported, not executed: requiring server.js must never boot the services.
  const entry = require(SERVER_PATH);
  const expected = ["MONGO_URI", ...FIREBASE_VARS];

  assert.deepEqual(entry.requiredServiceEnv(), expected);

  const saved = {};
  for (const key of expected) {
    saved[key] = process.env[key];
    process.env[key] = "set-for-test";
  }
  try {
    assert.deepEqual(
      entry.missingServiceEnv(),
      [],
      "a configured environment must not report anything missing",
    );
    delete process.env.FIREBASE_APP_ID;
    assert.deepEqual(
      entry.missingServiceEnv(),
      ["FIREBASE_APP_ID"],
      "only the removed variable is reported",
    );
  } finally {
    for (const key of expected) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  }
});

test("GET /api/health reports service status when nothing is connected", async () => {
  const entry = require(SERVER_PATH);
  const res = {
    statusCode: 0,
    body: "",
    writeHead(status) {
      this.statusCode = status;
    },
    end(body) {
      this.body = body;
    },
  };

  await entry.handleApi({ method: "GET" }, res, { pathname: "/api/health" });

  assert.equal(res.statusCode, 200);
  const payload = JSON.parse(res.body);
  assert.equal(payload.ok, true);
  assert.ok(
    payload.extractors,
    "extractor capabilities must still be reported",
  );
  assert.equal(
    payload.services.firebase,
    false,
    "no Firebase app until bootstrap runs",
  );
  assert.equal(payload.services.mongodb.connected, false);
  assert.equal(payload.services.mongodb.database, entry.MONGO_DB_NAME);
});

test("boot fails fast, naming the variables, when nothing is configured", () => {
  const result = bootFresh({ PORT: "5199" });
  assert.equal(
    result.status,
    1,
    `expected a clean exit 1, got ${result.status}: ${result.stderr}`,
  );
  assert.match(result.stderr, /failed to start/i);
  assert.match(result.stderr, /MONGO_URI/);
  assert.match(result.stderr, /FIREBASE_APP_ID/);
  assert.match(result.stderr, /\.env\.example/);
  assert.doesNotMatch(
    result.stdout,
    /Resume Analyzer is running/,
    "must not open the port",
  );
});

test("an unreachable Atlas aborts boot after Firebase initializes", () => {
  const result = bootFresh({
    PORT: "5198",
    MONGO_URI: "mongodb://127.0.0.1:1/resume-maker-user?directConnection=true",
    MONGO_TIMEOUT_MS: "500",
    FIREBASE_API_KEY: "test-only-key",
    FIREBASE_AUTH_DOMAIN: "test-project.firebaseapp.com",
    FIREBASE_PROJECT_ID: "test-project",
    FIREBASE_STORAGE_BUCKET: "test-project.appspot.com",
    FIREBASE_MESSAGING_SENDER_ID: "000000000000",
    FIREBASE_APP_ID: "1:000000000000:web:0000000000000000",
  });

  assert.equal(
    result.status,
    1,
    `expected exit 1, got ${result.status}: ${result.stderr}`,
  );
  assert.match(
    result.stdout,
    /Firebase initialized successfully/,
    "Firebase init must still be exercised",
  );
  assert.match(result.stderr, /failed to start/i);
  assert.doesNotMatch(
    result.stdout,
    /Connected successfully to MongoDB Atlas!/,
    "a failed connect must not claim success",
  );
  assert.doesNotMatch(
    result.stdout,
    /Resume Analyzer is running/,
    "must not open the port",
  );
});
