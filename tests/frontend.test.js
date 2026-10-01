"use strict";

/**
 * The frontend has no build step, so these tests guard the contracts that a
 * bundler would normally enforce: every element id app.js reaches for must
 * exist in index.html, the browser extractor must expose what app.js calls, and
 * the page must load the scripts it depends on.
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const PUBLIC = path.join(__dirname, "..", "public");
const html = fs.readFileSync(path.join(PUBLIC, "index.html"), "utf8");
const app = fs.readFileSync(path.join(PUBLIC, "app.js"), "utf8");
const extractor = fs.readFileSync(path.join(PUBLIC, "extractor.js"), "utf8");
const auth = fs.readFileSync(path.join(PUBLIC, "auth.js"), "utf8");

function collect(pattern, source) {
  const found = new Set();
  let match = pattern.exec(source);
  while (match) {
    found.add(match[1]);
    match = pattern.exec(source);
  }
  return found;
}

test("every element id used by app.js exists in index.html or in markup app.js renders", () => {
  const declared = new Set([
    ...collect(/id="([^"]+)"/g, html),
    ...collect(/id="([^"]+)"/g, app),
  ]);
  const used = collect(/\bel\(["']([^"']+)["']\)/g, app);
  assert.ok(
    used.size >= 15,
    `expected app.js to reference many ids, found ${used.size}`,
  );
  const missing = [...used].filter((id) => !declared.has(id));
  assert.deepEqual(missing, [], `no element with id(s): ${missing.join(", ")}`);
});

test("index.html provides the ids needed before app.js runs", () => {
  const declared = collect(/id="([^"]+)"/g, html);
  // The hero/analysis controls are queried outside renderReport(), so they must be static.
  for (const id of [
    "resume-text",
    "job-text",
    "analyze-btn",
    "analyze-label",
    "alert",
    "results",
    "file-input",
  ]) {
    assert.ok(
      declared.has(id),
      `index.html must ship a static #${id} for app.js`,
    );
  }
});

test("index.html loads the stylesheets and scripts app.js needs", () => {
  assert.match(html, /<link rel="stylesheet" href="\/styles\.css"/);
  const scripts = [...collect(/<script src="\/([^"]+)"><\/script>/g, html)];
  assert.deepEqual(
    scripts,
    ["extractor.js", "app.js"],
    "extractor.js must load before app.js",
  );
});

test("browser extractor exposes the helpers app.js calls", () => {
  const exported = collect(/^\s{4}(\w+):\s/gm, extractor);
  const called = collect(/ResumeExtractor\.(\w+)\(/g, app);
  assert.ok(called.size > 0, "app.js should call the browser extractor");
  const missing = [...called].filter((name) => !exported.has(name));
  assert.deepEqual(
    missing,
    [],
    `extractor.js does not export: ${missing.join(", ")}`,
  );
});

test("the API paths the UI calls are implemented by the server", () => {
  const server = fs.readFileSync(
    path.join(__dirname, "..", "server.js"),
    "utf8",
  );
  const called = collect(/api\(["']\/([a-z/?-]+)["']/g, app);
  assert.ok(
    called.size >= 3,
    `expected several API calls, found ${called.size}`,
  );
  for (const route of called) {
    const base = route.split("?")[0].replace(/\/$/, "");
    if (!base) continue;
    assert.ok(
      server.includes(`'/${base}'`) ||
        server.includes(`"/${base}"`) ||
        server.includes(`/${base}`),
      `server.js has no route for /${base}`,
    );
  }
});

test("auth UI wires Firebase config, sign-in, registration, and sign-out states", () => {
  const server = fs.readFileSync(
    path.join(__dirname, "..", "server.js"),
    "utf8",
  );
  assert.match(html, /id="auth-shell"/);
  assert.match(html, /id="analyzer-app"[^>]*hidden/);
  assert.match(html, /type="module" src="\/auth\.js"/);
  assert.match(auth, /\/api\/firebase-config/);
  assert.match(auth, /createUserWithEmailAndPassword/);
  assert.match(auth, /signInWithEmailAndPassword/);
  assert.match(html, /id="auth-google"/);
  assert.match(html, /Sign in with Google/);
  assert.match(html, /id="auth-submit-label">Login</);
  assert.match(html, /Create Account/);
  assert.match(html, /class="google-logo"/);
  assert.match(auth, /GoogleAuthProvider/);
  assert.match(auth, /signInWithPopup/);
  assert.match(
    auth,
    /googleButton\.addEventListener\("click", signInWithGoogle\)/,
  );
  assert.match(auth, /authActions\.signOut/);
  assert.match(auth, /onAuthStateChanged/);
  assert.match(auth, /resume-analyzer:signout/);
  assert.match(server, /pathname === ["']\/api\/firebase-config["']/);
});

test("Firebase config API returns only public web app fields", async () => {
  const entry = require("../server.js");
  const envFields = {
    apiKey: "FIREBASE_API_KEY",
    authDomain: "FIREBASE_AUTH_DOMAIN",
    projectId: "FIREBASE_PROJECT_ID",
    storageBucket: "FIREBASE_STORAGE_BUCKET",
    messagingSenderId: "FIREBASE_MESSAGING_SENDER_ID",
    appId: "FIREBASE_APP_ID",
  };
  const original = Object.values(envFields).map((key) => [
    key,
    process.env[key],
  ]);
  for (const [field, key] of Object.entries(envFields)) {
    process.env[key] = "public-" + field;
  }

  try {
    const response = {
      statusCode: 0,
      body: "",
      writeHead(status) {
        this.statusCode = status;
      },
      end(body) {
        this.body = body;
      },
    };
    await entry.handleApi({ method: "GET" }, response, {
      pathname: "/api/firebase-config",
    });
    assert.equal(response.statusCode, 200);
    assert.deepEqual(
      JSON.parse(response.body),
      Object.fromEntries(
        Object.keys(envFields).map((field) => [field, "public-" + field]),
      ),
    );
  } finally {
    for (const [key, value] of original) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

/* ---------------------- glass design system + responsiveness ---------------- */

function readStyles() {
  return fs.readFileSync(path.join(PUBLIC, "styles.css"), "utf8");
}

test("the stylesheet ships the glass design system in both themes", () => {
  const css = readStyles();
  assert.match(css, /:root\s*\{/, "expected a light token block on :root");
  assert.match(
    css,
    /:root\[data-theme="dark"\]\s*\{/,
    "expected a dark token block",
  );
  assert.match(
    css,
    /backdrop-filter:\s*var\(--blur\)/,
    "glass surfaces must blur what sits behind them",
  );
  assert.match(css, /\.aurora\s*\{/, "expected the aurora gradient canvas");
  assert.ok(!/APPEND-\d/.test(css), "leftover assembly marker in styles.css");
  assert.equal(
    (css.match(/\{/g) || []).length,
    (css.match(/\}/g) || []).length,
    "unbalanced braces in styles.css",
  );
});

test("every class app.js renders is styled by the stylesheet", () => {
  const css = readStyles();
  const rendered = new Set([
    ...collect(/class="([\w-]+)/g, app),
    ...collect(/class="([\w-]+)/g, html),
  ]);
  // Dynamic classes are built as 'class="kw ' + importance, so check the stems too.
  const missing = [...rendered].filter((name) => !css.includes("." + name));
  assert.deepEqual(missing, [], `unstyled class(es): ${missing.join(", ")}`);
});

test("the layout is responsive from phone to desktop", () => {
  const css = readStyles();
  const widths = [
    ...css.matchAll(/@media[^{]*?(?:min-width|max-width):\s*(\d+)px/g),
  ].map((m) => Number(m[1]));
  for (const bp of [420, 759, 939, 940, 1200]) {
    assert.ok(
      widths.includes(bp),
      `expected a ${bp}px breakpoint, found ${widths.join(", ")}`,
    );
  }
  assert.match(
    css,
    /@media \(hover: none\)/,
    "touch devices must not rely on hover states",
  );
  assert.match(
    css,
    /prefers-reduced-motion/,
    "animations need a reduced-motion escape hatch",
  );
  assert.match(
    css,
    /@supports not \([\s\S]*?\(backdrop-filter/,
    "needs a fallback when backdrop blur is missing",
  );
  const printBlock = css.slice(css.indexOf("@media print"));
  assert.match(
    printBlock,
    /backdrop-filter:\s*none\s*!important/,
    "print must flatten the glass",
  );
  assert.match(
    printBlock,
    /\.site-header[^}]*display:\s*none/,
    "print must drop the app chrome",
  );
});

test("hidden elements stay hidden inside flex/grid containers", () => {
  // Author `display:flex` beats the UA [hidden] rule, so the sheet must reinforce it.
  assert.match(
    readStyles(),
    /\[hidden\]\s*\{\s*display:\s*none\s*!important/,
    "missing [hidden] override",
  );
});

test("index.html resolves the theme before app.js runs and exposes the toggle", () => {
  assert.match(html, /id="theme-toggle"/, "header needs a theme toggle");
  assert.match(
    html,
    /localStorage\.getItem\(["']ra-theme["']\)/,
    "the chosen theme must be read before first paint",
  );
  assert.ok(
    html.search(/localStorage\.getItem\(["']ra-theme["']\)/) <
      html.indexOf('<script src="/app.js">'),
    "the theme bootstrap must run before app.js loads",
  );
  assert.match(
    app,
    /localStorage\.setItem\(THEME_KEY/,
    "app.js must persist the chosen theme",
  );
});
