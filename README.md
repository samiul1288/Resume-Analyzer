# Resume Analyzer

Upload or paste a resume, optionally paste the job description, and get a **0-100 score** with
per-category breakdown, missing keywords, strengths, prioritized fixes and before/after rewrites.

Scoring runs locally - no paid AI API is involved. The server does connect to two platform
services at boot (Firebase and MongoDB Atlas) and **refuses to start unless both are live**, so
a half-configured instance can never serve partial data.

---

## Quick start

```bash
cd "D:\hunter-web\3.2\resume-analyzer"
npm install                    # pdf-parse + mammoth (extractors) + dotenv, mongodb, firebase
copy .env.example .env         # then fill in your Firebase + MongoDB Atlas credentials
npm start                      # http://127.0.0.1:5173
```

Boot is strict: dotenv -> Firebase -> MongoDB Atlas -> HTTP listener. A missing variable or an
unreachable Atlas aborts startup with exit code 1 instead of opening the port:

```
  Resume Analyzer failed to start: missing required environment variables: MONGO_URI, FIREBASE_API_KEY, ...
    Copy .env.example to .env and fill in your Firebase + MongoDB Atlas credentials.
```

Then open **http://127.0.0.1:5173** and either:

1. drag a **PDF / DOCX / TXT / RTF** resume onto the drop zone, or
2. switch to **Paste** and paste the resume text,
3. optionally paste the **job description** (unlocks the keyword-match score),
4. press **Analyze Resume**.

Click **Try a sample** chip to load a bundled example (a weak frontend resume and a strong data-analyst resume) and see the difference in scoring immediately.

Useful scripts:

| Command                                                   | What it does                                                                                                                                     |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `npm start`                                               | run the web app (port 5173, override with `PORT=8080 npm start`)                                                                                 |
| `npm run dev`                                             | same, with `node --watch` auto-restart                                                                                                           |
| `npm run preview`                                         | start the server in the background, wait until it answers, print the URL (refuses to try while `.env` is incomplete)                             |
| `npm test`                                                | 38 unit tests (engine, extractors, UI contracts, service + env wiring)                                                                           |
| `npm run smoke`                                           | boots a server on port 5188 and exercises every API route; skips with instructions if `.env` is missing, or point `BASE_URL` at a running server |
| `npm run analyze:cli -- --sample frontend-junior`         | pretty console report, no browser                                                                                                                |
| `npm run analyze:cli -- resume.pdf job.txt`               | analyze real files from the terminal                                                                                                             |
| `npm run analyze:cli -- --json resume.docx > report.json` | machine-readable report                                                                                                                          |

---

## Project structure

```
resume-analyzer/
├── server.js                 # entry file: dotenv + Firebase + Atlas bootstrap, static files + JSON API
├── .env.example              # every variable the server reads (copy to .env; .env stays git-ignored)
├── package.json
├── bin/analyze.js            # CLI report generator
├── public/                   # frontend (no framework, no build step)
│   ├── index.html
│   ├── styles.css            # design tokens + responsive layout + print styles
│   ├── app.js                # UI state, fetch calls, report rendering
│   └── extractor.js          # browser fallback: pdf.js / mammoth from CDN
├── src/
│   ├── analyzer.js           # public API: analyze(resumeText, jobText, opts)
│   ├── parse.js              # resume parsing: sections, contact, bullets, stats
│   ├── score.js              # weighted scoring model (6 categories)
│   ├── suggest.js            # prioritized, actionable fixes
│   ├── strengths.js          # what is already working
│   ├── narrative.js          # job-description analysis, ATS checks, bullet rewrites
│   ├── dictionary.js         # alias-aware skill matching, role detection
│   ├── skills.js             # ~600 skill keywords in 12 groups
│   ├── roles.js              # 15 role profiles (match words, categories, must-haves)
│   ├── lexicon.js            # action verbs, weak phrases, buzzwords, headings
│   ├── text.js               # normalization, term regex, bullet/section helpers
│   ├── docx.js               # dependency-free DOCX reader (ZIP + word/document.xml)
│   ├── pdf.js                # dependency-free PDF text parser (Tj/TJ, Flate streams)
│   └── extract.js            # format dispatcher + optional pdf-parse/mammoth adapters
├── samples/                  # two sample resumes with matching job ads
├── scripts/api-smoke.js      # end-to-end API test
└── tests/                    # node:test unit tests (services.test.js covers the strict boot)
```

---

## Environment & services

Configuration is read **only** from `process.env`, populated by `require('dotenv').config()` -
the first statement of `server.js`. Copy `.env.example` to `.env`; `.env` is git-ignored.

### Browser authentication

The login and registration screens use Firebase email/password authentication. In the Firebase
console, enable **Authentication -> Sign-in method -> Email/Password** for the same project used
by the `FIREBASE_*` settings. The browser loads the public Firebase web-app config from
`GET /api/firebase-config`; this endpoint never returns MongoDB credentials or other server
secrets. The analyzer UI is shown only while Firebase reports a signed-in user.

| Variable                       | Required                  | Purpose                            |
| ------------------------------ | ------------------------- | ---------------------------------- |
| `PORT` / `HOST`                | no (`5173` / `127.0.0.1`) | where the HTTP server listens      |
| `MONGO_URI`                    | **yes**                   | MongoDB Atlas connection string    |
| `MONGO_DB_NAME`                | no (`resume-maker-user`)  | database the app works in          |
| `MONGO_TIMEOUT_MS`             | no (`5000`)               | connect + server-selection timeout |
| `FIREBASE_API_KEY`             | **yes**                   | Firebase web app config            |
| `FIREBASE_AUTH_DOMAIN`         | **yes**                   | "                                  |
| `FIREBASE_PROJECT_ID`          | **yes**                   | "                                  |
| `FIREBASE_STORAGE_BUCKET`      | **yes**                   | "                                  |
| `FIREBASE_MESSAGING_SENDER_ID` | **yes**                   | "                                  |
| `FIREBASE_APP_ID`              | **yes**                   | "                                  |
| `FIREBASE_APP_NAME`            | no (`resume-analyzer`)    | named app instance                 |

### Boot order (fail fast)

1. `require('dotenv').config()` - before anything touches `process.env`.
2. `initFirebase()` - maps the six `FIREBASE_*` variables onto the Firebase web config, calls
   `initializeApp(config, FIREBASE_APP_NAME)` and logs `Firebase initialized successfully`.
3. `run()` - `new MongoClient(process.env.MONGO_URI)` -> `await client.connect()` -> logs
   `Connected successfully to MongoDB Atlas!` -> selects `client.db('resume-maker-user')` and
   proves it with `{ ping: 1 }`.
4. only then `startServer()` -> `server.listen(PORT, HOST)`.

Steps 2-4 run inside one `bootstrap().then(startServer).catch(...)` chain; any failure prints
the reason to stderr and exits `1`, so the port never opens without live services.
`SIGINT`/`SIGTERM` close the Atlas connection before exiting. Importing the file is always safe:
booting is guarded by `require.main === module`.

### Using the connections

`server.js` exports the live handles for the routes you add:

```js
const { services } = require("./server.js"); // bootstrapped by npm start

await services.db
  .collection("analyses")
  .insertOne({ score: 84, createdAt: new Date() });
services.firebase.name; // 'resume-analyzer'
```

`GET /api/health` reports what is live:
`"services": { "firebase": true, "mongodb": { "connected": true, "database": "resume-maker-user" } }`.

### Why this stack

- **No framework, no build step** - the whole UI is 3 static files, so a preview is instant and there is nothing to compile.
- **Node's built-in `http` server** - zero runtime dependencies for the app itself; works offline.
- **Deterministic, explainable scoring** - every point is traceable to a measurable signal in the text (sections found, bullets quantified, keywords matched), which is why each category can show its own evidence.
- **PDF/DOCX parsing layered by quality** - `pdf-parse` and `mammoth` when installed, built-in ZIP/PDF readers as fallbacks, and pdf.js/mammoth in the browser as a last resort. `npm install` is optional: without it the app still reads PDFs and DOCX files.

## How the score is calculated

Six weighted categories add up to 100 points. When no job description is supplied, the
keyword category is scored against the must-have keywords of the detected role instead
(and dropped with the other weights re-normalised if no role can be inferred).

| Category                      | Weight | What it measures                                                                                                                      |
| ----------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------- |
| Job-description keyword match | 25     | Weighted coverage of the posting's keywords (65% importance-weighted, 35% raw coverage)                                               |
| Quantified impact             | 20     | Share of bullets containing a number, %, money or unit ("12,000 users", "62%", "$1.2M") - 50% is the target for full marks            |
| Action verbs                  | 15     | Share of bullets opening with a strong verb (target 80%), minus 6 points per duty-style phrase such as "responsible for"              |
| Structure & contact           | 15     | Name, email, phone, LinkedIn/portfolio, Experience, Education, Skills, Summary, Projects/Certifications, date ranges, 1-2 page length |
| Skill breadth                 | 15     | Relevant skill groups covered + depth in core (weight-3) skills for the detected role                                                 |
| Readability & ATS hygiene     | 10     | Penalties for 30+ word bullets, first-person pronouns, passive voice, buzzwords, broken PDF characters, under-250 or over-1,100 words |

Grades: **85+** excellent, **70+** good, **55+** fair, below that "needs significant work".

The report also includes:

- **per-category evidence** - the exact numbers behind each score,
- **missing keywords** with an importance colour and where to place them,
- **prioritized action plan** (high/medium/low, max 10 items) with a _why_ and a _how_,
- **before/after rewrites** generated from your own weakest bullets,
- **ATS checks** (contact parsing, standard headings, machine-readable text, dates, pronouns, length, "references available" filler, file naming),
- **skills detected** grouped by category.

---

## API reference

| Route                  | Description                                                                                                |
| ---------------------- | ---------------------------------------------------------------------------------------------------------- |
| `GET /api/health`      | service status + which extraction engines are active                                                       |
| `GET /api/samples`     | list of bundled samples                                                                                    |
| `GET /api/samples/:id` | one sample: `{ title, tagline, resume, jobDescription }`                                                   |
| `POST /api/extract`    | `{ fileBase64, fileName, mimeType }` -> `{ text, kind, method, quality, warnings, needsClientExtraction }` |
| `POST /api/analyze`    | `{ resumeText \| fileBase64, jobText?, fileName? }` -> full report                                         |

Example:

```bash
curl -s -X POST http://127.0.0.1:5173/api/analyze \
  -H "Content-Type: application/json" \
  -d "{\"resumeText\":\"$(cat resume.txt)\",\"jobText\":\"$(cat job.txt)\"}" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const r=JSON.parse(d);console.log(r.score, r.grade.label, r.missingKeywords.map(k=>k.label).join(', '))})"
```

Programmatic use:

```js
const { analyze } = require("./src/analyzer");
const report = analyze(resumeText, jobDescriptionText, {
  fileName: "resume.pdf",
});
console.log(report.score, report.grade.label); // 84 'Good - a few fixes needed'
console.log(report.categories.map((c) => `${c.label}: ${c.score}`));
console.log(report.suggestions.map((s) => `${s.priority}. ${s.title}`));
```

`analyze()` throws an error with `status: 400` and `code: 'RESUME_TOO_SHORT'` when the text is
under 40 words, and `/api/extract` returns `415` for unsupported formats (for example legacy `.doc`).

---

## Testing

```bash
npm test        # 38 unit tests: engine, extractors, UI contracts, service + env wiring
npm run smoke   # spawns the server on :5188 and checks every API route (needs .env or BASE_URL)
```

Both suites currently pass (38 unit tests, 12 smoke checks). `tests/services.test.js` covers the
integration without touching real services: it pins the dotenv-before-`process.env` ordering, the
`FIREBASE_*` -> `initializeApp` mapping and the `resume-maker-user` database selection, then
spawns `server.js` in a temp directory twice - once with no credentials (must exit 1 naming every
missing variable) and once with a Firebase config plus an unreachable Atlas URI (must log the
Firebase success line, fail the connect, and still never open the port).

The frontend tests are worth a note:
because there is no bundler, they assert that every `document.getElementById()` in `app.js`
resolves to markup shipped in `index.html` (or rendered by `app.js` itself), that
`extractor.js` exports the helpers `app.js` calls, and that each API path the UI fetches is
implemented by `server.js`.

---

## Moving the project into the read-only workspace folder

`D:\hunter-web\3.2\develop with ai` is owned by `BUILTIN\Administrators` and grants the `Users`
group **read-only** access (`icacls "D:\hunter-web\3.2\develop with ai"` shows
`BUILTIN\Users:(I)(OI)(CI)(RX)`), so no process running as `samiul\rufsa` can create files there.
That is why the app currently lives one level up, in `D:\hunter-web\3.2\resume-analyzer`.

To move it into the workspace, open an **elevated** Command Prompt (Run as administrator) and run:

```cmd
icacls "D:\hunter-web\3.2\develop with ai" /grant "rufsa:(OI)(CI)F"
robocopy "D:\hunter-web\3.2\resume-analyzer" "D:\hunter-web\3.2\develop with ai" /E /MOVE /XD node_modules
cd /d "D:\hunter-web\3.2\develop with ai" && npm install
```

- `/XD node_modules` skips installed packages - reinstall them after the move, as shown.
- Drop `/MOVE` to copy instead of move.
- Or simply keep the app where it is and open `D:\hunter-web\3.2\resume-analyzer` as the VS Code folder - nothing else changes.

---

## Troubleshooting

| Symptom                                                   | Fix                                                                                                                               |
| --------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| "Very little text came out of this PDF"                   | The PDF is a scan or image export. The app retries with pdf.js in the browser; if that also fails, paste the text.                |
| "Legacy .doc files are not supported"                     | Save as `.docx` or export to PDF, then upload again.                                                                              |
| Port already in use                                       | `set PORT=8080 && npm start` (or `$env:PORT=8080; npm start` in PowerShell).                                                      |
| "failed to start: missing required environment variables" | `copy .env.example .env` and fill in exactly the variables it names - the server will not boot on a partial `.env`.               |
| `MongoDB server selection timed out` / `ECONNREFUSED`     | Wrong `MONGO_URI`, expired password, or your IP is not on the Atlas **Network Access** allowlist (add `0.0.0.0/0` while testing). |
| `Firebase is not configured`                              | One or more `FIREBASE_*` variables are empty; copy them from Firebase console -> Project settings -> Your apps.                   |
| Header says "analyzer unreachable"                        | The server is not running, or you opened `index.html` directly. Use `npm start` and the `http://127.0.0.1:5173` URL.              |
| Browser-side fallback fails                               | It needs internet access for the pdf.js / mammoth CDN. Run `npm install` to use the server-side parsers instead.                  |
| Keyword match shows "n/a"                                 | No job description was provided and no role could be inferred - paste the job posting to activate that category.                  |

---

## Limitations (by design)

- Scoring is heuristic and offline - it measures **how** a resume is written and how well it
  matches a posting's vocabulary, not whether the claims are true.
- Keyword extraction covers English industry vocabulary (about 600 terms in 12 groups). Very
  niche domains fall back to the general structured checks (structure, verbs, metrics).
- The built-in PDF parser cannot decode CID-encoded fonts that lack a ToUnicode table; the
  `pdf-parse` dependency handles those, which is why it is installed by default.
- No endpoint persists anything - a resume stays in memory only for the duration of its own
  request. Firebase and Atlas are connected at boot so the auth/persistence code you add has
  live handles (see "Using the connections"); nothing is written until you write it.
