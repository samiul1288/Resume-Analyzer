/* ==========================================================================
   Resume Analyzer - UI logic
   Talks to the local API (/api/health, /api/samples, /api/extract, /api/analyze).
   ========================================================================== */
(function () {
  "use strict";

  var el = function (id) {
    return document.getElementById(id);
  };
  var state = {
    mode: "upload",
    file: null,
    fileText: "",
    fileInfo: null,
    busy: false,
    report: null,
  };

  /* -------------------------------- helpers -------------------------------- */

  function escapeHtml(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function countWords(text) {
    var matches = String(text || "")
      .trim()
      .match(/\S+/g);
    return matches ? matches.length : 0;
  }

  function formatBytes(bytes) {
    if (!bytes) return "0 B";
    var units = ["B", "KB", "MB", "GB"];
    var i = Math.floor(Math.log(bytes) / Math.log(1024));
    return (
      (bytes / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1) + " " + units[i]
    );
  }

  function showAlert(message, kind) {
    var box = el("alert");
    box.className = "alert" + (kind === "warn" ? " warn" : "");
    box.textContent = message;
    box.hidden = false;
  }

  function clearAlert() {
    var box = el("alert");
    box.hidden = true;
    box.textContent = "";
  }

  function setBusy(busy, label) {
    state.busy = busy;
    el("analyze-btn").disabled = busy;
    el("analyze-label").textContent = busy
      ? label || "Analyzing..."
      : "Analyze Resume";
    el("analyze-btn").querySelector(".spinner").hidden = !busy;
  }

  async function api(path, options) {
    var response = await fetch(path, options);
    var payload = null;
    try {
      payload = await response.json();
    } catch (error) {
      payload = null;
    }
    if (!response.ok) {
      var message =
        payload && payload.error && payload.error.message
          ? payload.error.message
          : "Request failed with status " + response.status + ".";
      var err = new Error(message);
      err.code =
        payload && payload.error
          ? payload.error.code
          : "HTTP_" + response.status;
      err.status = response.status;
      throw err;
    }
    return payload;
  }

  function fileToBase64(file) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () {
        var result = String(reader.result || "");
        resolve(result.indexOf(",") > -1 ? result.split(",")[1] : result);
      };
      reader.onerror = function () {
        reject(new Error("Could not read the selected file."));
      };
      reader.readAsDataURL(file);
    });
  }

  function readAsText(file) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () {
        resolve(String(reader.result || ""));
      };
      reader.onerror = function () {
        reject(new Error("Could not read the selected file."));
      };
      reader.readAsText(file);
    });
  }

  function updateCounts() {
    el("resume-count").textContent =
      countWords(el("resume-text").value) + " words";
    el("job-count").textContent = countWords(el("job-text").value) + " words";
  }

  function setMode(mode) {
    state.mode = mode;
    var uploadActive = mode === "upload";
    el("tab-upload").classList.toggle("is-active", uploadActive);
    el("tab-paste").classList.toggle("is-active", !uploadActive);
    el("tab-upload").setAttribute("aria-selected", String(uploadActive));
    el("tab-paste").setAttribute("aria-selected", String(!uploadActive));
    el("pane-upload").hidden = !uploadActive;
    el("pane-paste").hidden = uploadActive;
  }

  /* ------------------------------ engine status ---------------------------- */

  async function loadEngineStatus() {
    var node = el("engine-status");
    try {
      var health = await api("/api/health");
      var pdf = health.extractors.pdfParse
        ? "pdf-parse"
        : "built-in PDF parser";
      var docx = health.extractors.mammoth ? "mammoth" : "built-in DOCX reader";
      node.className = "engine-status ok";
      node.innerHTML =
        '<span class="dot"></span> analyzer ready &middot; ' +
        escapeHtml(pdf) +
        " &middot; " +
        escapeHtml(docx);
    } catch (error) {
      node.className = "engine-status bad";
      node.innerHTML =
        '<span class="dot"></span> analyzer unreachable - is the server running?';
    }
  }

  async function loadSamples() {
    var holder = el("sample-chips");
    try {
      var data = await api("/api/samples");
      if (!data.samples || !data.samples.length) {
        holder.innerHTML = '<span class="hint">No samples bundled.</span>';
        return;
      }
      holder.innerHTML = data.samples
        .map(function (sample) {
          return (
            '<button type="button" class="chip" data-sample="' +
            escapeHtml(sample.id) +
            '">' +
            escapeHtml(sample.title) +
            "</button>"
          );
        })
        .join("");
      holder.addEventListener("click", async function (event) {
        var target = event.target;
        var id =
          target && target.getAttribute
            ? target.getAttribute("data-sample")
            : null;
        if (!id) return;
        var sample = await api("/api/samples/" + encodeURIComponent(id));
        el("resume-text").value = sample.resume || "";
        el("job-text").value = sample.jobDescription || "";
        setMode("paste");
        updateCounts();
        showAlert(
          'Loaded sample "' + sample.title + '". Press Analyze Resume.',
          "warn",
        );
      });
    } catch (error) {
      holder.innerHTML = '<span class="hint">Samples unavailable.</span>';
    }
  }

  /* ------------------------------ file handling ---------------------------- */

  var ALLOWED_EXT = /\.(pdf|docx|txt|md|rtf)$/i;
  var ALLOWED_MIME = /(pdf|wordprocessingml|text\/|rtf|json|csv)/i;
  var MAX_BYTES = 15 * 1024 * 1024;

  function setFileChip(file, info) {
    state.fileInfo = info || null;
    var chip = el("file-chip");
    if (!file) {
      chip.hidden = true;
      el("file-name").textContent = "";
      el("file-info").textContent = "";
      return;
    }
    chip.hidden = false;
    el("file-name").textContent = file.name;
    var words = state.fileText ? countWords(state.fileText) : 0;
    el("file-info").textContent = [
      formatBytes(file.size),
      info && info.method ? "read with " + info.method : null,
      words ? words + " words" : null,
    ]
      .filter(Boolean)
      .join(" - ");
  }

  function showPreview(text) {
    var wrap = el("preview-wrap");
    if (!text) {
      wrap.hidden = true;
      return;
    }
    wrap.hidden = false;
    el("text-preview").textContent =
      text.slice(0, 4000) + (text.length > 4000 ? "\n..." : "");
  }

  function setExtractNote(message, kind) {
    var note = el("extract-note");
    if (!message) {
      note.hidden = true;
      return;
    }
    note.hidden = false;
    note.className = "callout" + (kind === "warn" ? " warn" : "");
    note.textContent = message;
  }

  function clearFile() {
    state.file = null;
    state.fileText = "";
    state.fileInfo = null;
    el("file-input").value = "";
    setFileChip(null);
    setExtractNote("");
    showPreview("");
    clearAlert();
  }

  async function handleFile(file) {
    clearAlert();
    setExtractNote("");
    if (!file) return;

    if (
      !ALLOWED_EXT.test(file.name) &&
      !(file.type && ALLOWED_MIME.test(file.type))
    ) {
      showAlert(
        "Unsupported file type. Upload a PDF, DOCX, TXT or RTF file (or paste the text instead).",
      );
      return;
    }
    if (file.size > MAX_BYTES) {
      showAlert(
        "That file is " +
          formatBytes(file.size) +
          ". The limit is 15 MB - upload the text version instead.",
      );
      return;
    }

    state.file = file;
    state.fileText = "";
    setFileChip(file);
    setBusy(true, "Reading file...");

    try {
      var base64 = await fileToBase64(file);
      var result = await api("/api/extract", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fileBase64: base64,
          fileName: file.name,
          mimeType: file.type || "",
        }),
      });

      var text = result.text || "";
      var method = result.method;

      // Weak server-side result: retry with the in-browser reader (pdf.js / mammoth).
      if (
        (result.needsClientExtraction || countWords(text) < 120) &&
        window.ResumeExtractor
      ) {
        try {
          if (/\.pdf$/i.test(file.name)) {
            setExtractNote("Reading the PDF in your browser (pdf.js)...");
            var pdfText = await window.ResumeExtractor.pdfToText(file);
            if (countWords(pdfText) > countWords(text)) {
              text = pdfText;
              method = "browser pdf.js";
            }
          } else if (/\.docx$/i.test(file.name)) {
            setExtractNote("Reading the DOCX in your browser (mammoth)...");
            var docxText = await window.ResumeExtractor.docxToText(file);
            if (countWords(docxText) > countWords(text)) {
              text = docxText;
              method = "browser mammoth";
            }
          }
        } catch (clientError) {
          setExtractNote(
            "Browser-side reading was not available: " + clientError.message,
            "warn",
          );
        }
      }

      state.fileText = text;
      setFileChip(file, { method: method });
      showPreview(text);

      if (result.warnings && result.warnings.length) {
        setExtractNote(result.warnings.join(" "), "warn");
      } else if (countWords(text) < 120) {
        setExtractNote(
          "Only " +
            countWords(text) +
            " words were found in this file. If it is a scanned PDF, paste the text manually.",
          "warn",
        );
      } else {
        setExtractNote(
          "Read " +
            countWords(text) +
            " words using " +
            method +
            ". Press Analyze Resume.",
        );
      }
    } catch (error) {
      showAlert(
        error.message +
          " You can still switch to the Paste tab and paste the resume text.",
      );
    } finally {
      setBusy(false);
    }
  }

  /* -------------------------------- rendering ------------------------------ */

  var RING_RADIUS = 64;
  var RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

  function fillClass(score) {
    if (score >= 80) return "high";
    if (score >= 60) return "mid";
    if (score >= 40) return "low";
    return "critical";
  }

  function heroHtml(report) {
    var score = report.score;
    var tone = report.grade.tone;
    var offset = RING_CIRCUMFERENCE * (1 - score / 100);
    var meta = [];

    if (report.role) {
      meta.push(
        '<span class="meta-pill">Target role: <strong>' +
          escapeHtml(report.role.name) +
          "</strong> (" +
          escapeHtml(
            report.role.source === "job-description"
              ? "from job post"
              : "inferred",
          ) +
          ")</span>",
      );
    }
    if (report.jobDescription.provided) {
      meta.push(
        '<span class="meta-pill">Job match: <strong>' +
          report.jobDescription.matchPercent +
          "%</strong> (" +
          report.jobDescription.matchedCount +
          "/" +
          report.jobDescription.totalKeywords +
          " keywords)</span>",
      );
    } else {
      meta.push('<span class="meta-pill">No job description supplied</span>');
    }
    meta.push(
      '<span class="meta-pill">Skills found: <strong>' +
        report.keywords.totalFound +
        "</strong></span>",
    );
    meta.push(
      '<span class="meta-pill">ATS checks passed: <strong>' +
        report.ats.passed +
        "/" +
        report.ats.total +
        "</strong></span>",
    );
    meta.push(
      '<span class="meta-pill">Words: <strong>' +
        report.stats.words +
        "</strong> (~" +
        report.stats.estimatedPages +
        " pages)</span>",
    );
    if (report.extraction && report.extraction.method) {
      meta.push(
        '<span class="meta-pill">Text source: <strong>' +
          escapeHtml(report.extraction.method) +
          "</strong></span>",
      );
    }

    return (
      "" +
      '<div class="score-hero">' +
      '<div class="score-ring" role="img" aria-label="Resume score ' +
      score +
      ' out of 100">' +
      '<svg width="148" height="148" viewBox="0 0 160 160">' +
      '<circle class="ring-bg" cx="80" cy="80" r="' +
      RING_RADIUS +
      '" fill="none" stroke-width="12"></circle>' +
      '<circle class="ring-value ring-' +
      tone +
      '" cx="80" cy="80" r="' +
      RING_RADIUS +
      '" fill="none" stroke-width="12" ' +
      'stroke-dasharray="' +
      RING_CIRCUMFERENCE.toFixed(1) +
      '" stroke-dashoffset="' +
      offset.toFixed(1) +
      '"></circle>' +
      "</svg>" +
      '<div class="ring-label">' +
      '<span class="ring-score">' +
      score +
      "</span>" +
      '<span class="ring-out">out of 100</span>' +
      "</div>" +
      "</div>" +
      "<div>" +
      '<span class="grade-badge tone-' +
      tone +
      '">' +
      escapeHtml(report.grade.label) +
      "</span>" +
      '<p class="verdict">' +
      escapeHtml(report.verdict) +
      "</p>" +
      '<div class="hero-meta">' +
      meta.join("") +
      "</div>" +
      '<div class="report-actions" style="margin-top:0.9rem">' +
      '<button type="button" class="btn ghost small" id="print-btn">Print / Save as PDF</button>' +
      '<button type="button" class="btn ghost small" id="json-btn">Download report (JSON)</button>' +
      "</div>" +
      "</div>" +
      "</div>"
    );
  }

  function categoriesHtml(report) {
    var rows = report.categories
      .map(function (category) {
        if (category.score === null) {
          return (
            '<div class="bar-row">' +
            '<div class="bar-head"><span>' +
            escapeHtml(category.label) +
            '</span><span class="bar-score">n/a</span></div>' +
            '<div class="bar-track"></div>' +
            '<div class="bar-evidence">' +
            escapeHtml(category.evidence) +
            "</div>" +
            "</div>"
          );
        }
        return (
          '<div class="bar-row">' +
          '<div class="bar-head">' +
          "<span>" +
          escapeHtml(category.label) +
          ' <span class="bar-weight">weight ' +
          category.weight +
          "%</span></span>" +
          '<span class="bar-score">' +
          category.score +
          "/100</span>" +
          "</div>" +
          '<div class="bar-track"><div class="bar-fill ' +
          fillClass(category.score) +
          '" style="width:' +
          category.score +
          '%"></div></div>' +
          '<div class="bar-evidence">' +
          escapeHtml(category.evidence) +
          "</div>" +
          "</div>"
        );
      })
      .join("");

    return (
      '<div class="card">' +
      '<div class="section-title"><span class="num">1</span><h2>Score breakdown</h2></div>' +
      '<div class="bars">' +
      rows +
      "</div>" +
      "</div>"
    );
  }

  function statsHtml(report) {
    var stats = report.stats;
    var items = [
      ["Words", stats.words],
      ["Bullets", stats.bullets],
      ["Quantified bullets", stats.quantifiedBullets],
      ["Bullets with action verbs", stats.actionVerbBullets],
      ["Skills detected", report.keywords.totalFound],
      ["Sections detected", report.detectedSections.length],
    ];
    return (
      '<div class="card">' +
      '<div class="section-title"><span class="num">2</span><h2>Resume signals</h2></div>' +
      '<div class="stat-strip">' +
      items
        .map(function (item) {
          return (
            '<div class="stat"><div class="v">' +
            item[1] +
            '</div><div class="k">' +
            escapeHtml(item[0]) +
            "</div></div>"
          );
        })
        .join("") +
      "</div>" +
      "</div>"
    );
  }

  function rewriteBlock(example) {
    return (
      '<div class="rewrite">' +
      '<span class="label">Before</span><span class="before">' +
      escapeHtml(example.before) +
      "</span>" +
      '<span class="label" style="margin-top:0.4rem">After</span><span class="after">' +
      escapeHtml(example.after) +
      "</span>" +
      (example.reason
        ? '<div class="reason">' + escapeHtml(example.reason) + "</div>"
        : "") +
      "</div>"
    );
  }

  function missingKeywordsHtml(report) {
    if (!report.missingKeywords.length) {
      var message = report.jobDescription.provided
        ? "No important job-description keywords are missing - excellent coverage."
        : "Paste a job description to get a targeted list of missing keywords.";
      return (
        '<div class="card">' +
        '<div class="section-title"><span class="num">3</span><h2>Missing keywords</h2></div>' +
        '<p class="hint">' +
        escapeHtml(message) +
        "</p>" +
        "</div>"
      );
    }

    var chips = report.missingKeywords
      .map(function (keyword) {
        return (
          '<span class="kw ' +
          escapeHtml(keyword.importance) +
          '" title="' +
          escapeHtml(keyword.placement) +
          '">' +
          escapeHtml(keyword.label) +
          "</span>"
        );
      })
      .join("");

    var highPriority = report.missingKeywords.filter(function (k) {
      return k.importance === "high";
    });

    return (
      '<div class="card">' +
      '<div class="section-title"><span class="num">3</span><h2>Missing keywords (' +
      report.missingKeywords.length +
      ")</h2></div>" +
      '<p class="hint">Red = high priority (weighted core skills in the job post), amber = medium, grey = nice to have. Hover a chip for placement advice.</p>' +
      '<div class="chips">' +
      chips +
      "</div>" +
      (highPriority.length
        ? '<p class="hint" style="margin-top:0.4rem"><strong>Start with:</strong> ' +
          escapeHtml(
            highPriority
              .slice(0, 8)
              .map(function (k) {
                return k.label;
              })
              .join(", "),
          ) +
          "</p>"
        : "") +
      "</div>"
    );
  }

  function strengthsHtml(report) {
    var items = report.strengths
      .map(function (strength) {
        return (
          '<div class="list-item strength">' +
          '<div class="list-head"><h4>' +
          escapeHtml(strength.title) +
          "</h4></div>" +
          '<div class="list-body">' +
          escapeHtml(strength.detail) +
          "</div>" +
          "</div>"
        );
      })
      .join("");
    return (
      '<div class="card">' +
      '<div class="section-title"><span class="num">4</span><h2>What is already working</h2></div>' +
      '<div class="list">' +
      items +
      "</div>" +
      "</div>"
    );
  }

  function suggestionsHtml(report) {
    var items = report.suggestions
      .map(function (suggestion) {
        var examples = (suggestion.examples || []).map(rewriteBlock).join("");
        var keywords = (suggestion.keywords || []).length
          ? '<div class="chips" style="margin-top:0.4rem">' +
            suggestion.keywords
              .map(function (keyword) {
                return (
                  '<span class="kw medium">' + escapeHtml(keyword) + "</span>"
                );
              })
              .join("") +
            "</div>"
          : "";
        return (
          '<div class="list-item sev-' +
          escapeHtml(suggestion.severity) +
          '">' +
          '<div class="list-head">' +
          '<span class="pri">' +
          suggestion.priority +
          "</span>" +
          "<h4>" +
          escapeHtml(suggestion.title) +
          "</h4>" +
          '<span class="sev-tag ' +
          escapeHtml(suggestion.severity) +
          '">' +
          escapeHtml(suggestion.severity) +
          "</span>" +
          "</div>" +
          '<div class="list-body"><strong>Why:</strong> ' +
          escapeHtml(suggestion.why) +
          "</div>" +
          '<div class="list-how"><strong>How:</strong> ' +
          escapeHtml(suggestion.how) +
          "</div>" +
          keywords +
          examples +
          "</div>"
        );
      })
      .join("");

    return (
      '<div class="card">' +
      '<div class="section-title"><span class="num">5</span><h2>Action plan (' +
      report.suggestions.length +
      " fixes)</h2></div>" +
      '<div class="list">' +
      items +
      "</div>" +
      "</div>"
    );
  }

  function rewritesHtml(report) {
    if (!report.rewrites.length) return "";
    return (
      '<div class="card">' +
      '<div class="section-title"><span class="num">6</span><h2>Sample rewrites from your own bullets</h2></div>' +
      '<p class="hint">Replace the bracketed placeholder with your real number before using a line.</p>' +
      report.rewrites.map(rewriteBlock).join("") +
      "</div>"
    );
  }

  function atsHtml(report) {
    var items = report.ats.checks
      .map(function (check) {
        return (
          '<div class="ats-item">' +
          '<span class="ats-mark ' +
          (check.pass ? "pass" : "fail") +
          '">' +
          (check.pass ? "&#10003;" : "&#10007;") +
          "</span>" +
          "<div>" +
          "<div>" +
          escapeHtml(check.label) +
          "</div>" +
          '<div class="ats-detail">' +
          escapeHtml(check.detail) +
          "</div>" +
          "</div>" +
          "</div>"
        );
      })
      .join("");
    return (
      '<div class="card">' +
      '<div class="section-title"><span class="num">7</span><h2>ATS &amp; screening checks (' +
      report.ats.passed +
      "/" +
      report.ats.total +
      " passed)</h2></div>" +
      '<div class="ats-list">' +
      items +
      "</div>" +
      "</div>"
    );
  }

  function keywordsHtml(report) {
    var groups = report.keywords.byGroup || {};
    var names = Object.keys(groups).sort(function (a, b) {
      return groups[b].length - groups[a].length;
    });
    if (!names.length) return "";

    var blocks = names
      .map(function (name) {
        return (
          "<div>" +
          '<div class="kw-group-name">' +
          escapeHtml(name) +
          " (" +
          groups[name].length +
          ")</div>" +
          '<div class="chips">' +
          groups[name]
            .map(function (label) {
              return (
                '<span class="kw present">' + escapeHtml(label) + "</span>"
              );
            })
            .join("") +
          "</div>" +
          "</div>"
        );
      })
      .join("");

    return (
      '<div class="card">' +
      '<div class="section-title"><span class="num">8</span><h2>Skills &amp; keywords detected</h2></div>' +
      '<div class="kw-groups">' +
      blocks +
      "</div>" +
      "</div>"
    );
  }

  function extractionHtml(report) {
    var extraction = report.extraction || {};
    var warnings = extraction.warnings || [];
    var parts = [];
    if (warnings.length) {
      parts.push(
        '<div class="alert warn">' + escapeHtml(warnings.join(" ")) + "</div>",
      );
    }
    if (report.preview) {
      parts.push(
        '<details class="card"><summary style="cursor:pointer;font-weight:650">Text the analyzer read (first 700 characters)</summary>' +
          '<pre class="preview">' +
          escapeHtml(report.preview) +
          "</pre></details>",
      );
    }
    return parts.join("");
  }

  function notesHtml(report) {
    return (
      '<div class="card">' +
      '<div class="section-title"><span class="num">9</span><h2>How this score is calculated</h2></div>' +
      '<ul class="notes">' +
      report.notes
        .map(function (note) {
          return "<li>" + escapeHtml(note) + "</li>";
        })
        .join("") +
      "</ul>" +
      "</div>"
    );
  }

  function renderReport(report) {
    var wrap = el("results");
    var left =
      categoriesHtml(report) +
      statsHtml(report) +
      missingKeywordsHtml(report) +
      keywordsHtml(report);
    var right =
      strengthsHtml(report) +
      suggestionsHtml(report) +
      rewritesHtml(report) +
      atsHtml(report);

    wrap.hidden = false;
    wrap.innerHTML =
      heroHtml(report) +
      '<div class="report-grid">' +
      '<div style="display:flex;flex-direction:column;gap:1.25rem">' +
      left +
      "</div>" +
      '<div style="display:flex;flex-direction:column;gap:1.25rem">' +
      right +
      "</div>" +
      "</div>" +
      extractionHtml(report) +
      notesHtml(report);

    var printBtn = el("print-btn");
    if (printBtn)
      printBtn.addEventListener("click", function () {
        window.print();
      });

    var jsonBtn = el("json-btn");
    if (jsonBtn) {
      jsonBtn.addEventListener("click", function () {
        var blob = new Blob([JSON.stringify(report, null, 2)], {
          type: "application/json",
        });
        var url = URL.createObjectURL(blob);
        var link = document.createElement("a");
        link.href = url;
        link.download = "resume-analysis-report.json";
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
      });
    }
  }

  /* --------------------------------- theme --------------------------------- */

  var THEME_KEY = "ra-theme";

  function storedTheme() {
    try {
      return localStorage.getItem(THEME_KEY);
    } catch (error) {
      return null;
    }
  }

  function systemTheme() {
    return "dark";
  }

  function currentTheme() {
    var attr = document.documentElement.getAttribute("data-theme");
    return attr === "dark" || attr === "light" ? attr : systemTheme();
  }

  function applyTheme(theme, persist) {
    document.documentElement.setAttribute("data-theme", theme);
    if (persist) {
      try {
        localStorage.setItem(THEME_KEY, theme);
      } catch (error) {
        /* private mode: session only */
      }
    }
    var toggle = el("theme-toggle");
    if (toggle) {
      toggle.setAttribute("aria-pressed", theme === "dark" ? "true" : "false");
      toggle.title =
        theme === "dark" ? "Switch to light theme" : "Switch to dark theme";
    }
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta)
      meta.setAttribute("content", theme === "dark" ? "#070a16" : "#e9edf8");
  }

  function initTheme() {
    applyTheme(currentTheme(), false);
    var toggle = el("theme-toggle");
    if (toggle) {
      toggle.addEventListener("click", function () {
        applyTheme(currentTheme() === "dark" ? "light" : "dark", true);
      });
    }
  }

  /* --------------------------------- events -------------------------------- */

  function resetAll() {
    el("resume-text").value = "";
    el("job-text").value = "";
    clearFile();
    updateCounts();
    el("results").hidden = true;
    el("results").innerHTML = "";
    state.report = null;
    setMode("upload");
    showAlert("Cleared. Upload or paste a resume to start again.", "warn");
  }

  function wireDropzone() {
    var zone = el("dropzone");
    var input = el("file-input");

    ["dragenter", "dragover"].forEach(function (type) {
      zone.addEventListener(type, function (event) {
        event.preventDefault();
        zone.classList.add("is-dragover");
      });
    });
    ["dragleave", "dragend", "drop"].forEach(function (type) {
      zone.addEventListener(type, function (event) {
        event.preventDefault();
        zone.classList.remove("is-dragover");
      });
    });
    zone.addEventListener("drop", function (event) {
      var files = event.dataTransfer && event.dataTransfer.files;
      if (files && files.length) handleFile(files[0]);
    });
    zone.addEventListener("keydown", function (event) {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        input.click();
      }
    });
    input.addEventListener("change", function (event) {
      var files = event.target.files;
      if (files && files.length) handleFile(files[0]);
    });
  }

  function init() {
    el("tab-upload").addEventListener("click", function () {
      setMode("upload");
    });
    el("tab-paste").addEventListener("click", function () {
      setMode("paste");
    });
    el("file-clear").addEventListener("click", function (event) {
      event.preventDefault();
      clearFile();
    });
    el("resume-clear").addEventListener("click", function () {
      el("resume-text").value = "";
      updateCounts();
    });
    el("job-clear").addEventListener("click", function () {
      el("job-text").value = "";
      updateCounts();
    });
    el("resume-text").addEventListener("input", updateCounts);
    el("job-text").addEventListener("input", updateCounts);
    el("analyze-btn").addEventListener("click", analyzeResume);
    el("reset-btn").addEventListener("click", resetAll);
    el("job-text").addEventListener("keydown", function (event) {
      if ((event.ctrlKey || event.metaKey) && event.key === "Enter")
        analyzeResume();
    });

    wireDropzone();
    initTheme();
    window.addEventListener("resume-analyzer:signout", resetAll);
    setMode("upload");
    updateCounts();
    loadEngineStatus();
    loadSamples();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }

  function buildPayload() {
    var jobText = el("job-text").value;
    if (state.mode === "paste") {
      var pasted = el("resume-text").value;
      if (countWords(pasted) < 40) {
        throw new Error(
          "Paste at least a few paragraphs of the resume (or upload a file) before analyzing.",
        );
      }
      return { resumeText: pasted, jobText: jobText, fileName: null };
    }
    if (!state.file && countWords(el("resume-text").value) >= 40) {
      return {
        resumeText: el("resume-text").value,
        jobText: jobText,
        fileName: null,
      };
    }
    if (!state.file) {
      throw new Error(
        "Upload a resume file, or switch to the Paste tab and paste the resume text.",
      );
    }
    return {
      resumeText: state.fileText || undefined,
      jobText: jobText,
      fileName: state.file.name,
    };
  }

  async function analyzeResume() {
    if (state.busy) return;
    clearAlert();

    var payload;
    try {
      payload = buildPayload();
    } catch (error) {
      showAlert(error.message);
      return;
    }

    setBusy(
      true,
      payload.resumeText ? "Analyzing..." : "Extracting & analyzing...",
    );
    try {
      var body = { jobText: payload.jobText, fileName: payload.fileName || "" };
      if (payload.resumeText) {
        body.resumeText = payload.resumeText;
      } else {
        body.fileBase64 = await fileToBase64(state.file);
        body.mimeType = state.file.type || "";
      }

      var report = await api("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      state.report = report;
      renderReport(report);
      el("results").scrollIntoView({ behavior: "smooth", block: "start" });
    } catch (error) {
      showAlert(error.message);
    } finally {
      setBusy(false);
    }
  }
})();
