/* ==========================================================================
   Browser-side extraction fallback.
   The server normally extracts text (pdf-parse / mammoth / built-in parsers).
   If a PDF yields almost no text (scans, exotic encoders), the app calls into
   this module, which loads pdf.js / mammoth from a CDN on demand and returns
   plain text that is then posted to /api/analyze.
   ========================================================================== */
(function () {
  'use strict';

  var CDN = {
    pdfjs: 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.min.js',
    pdfjsWorker: 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js',
    mammoth: 'https://cdn.jsdelivr.net/npm/mammoth@1.8.0/mammoth.browser.min.js'
  };

  var loaded = {};

  function loadScript(url) {
    if (loaded[url]) return loaded[url];
    loaded[url] = new Promise(function (resolve, reject) {
      var script = document.createElement('script');
      script.src = url;
      script.async = true;
      script.onload = function () { resolve(true); };
      script.onerror = function () { reject(new Error('Could not load ' + url + ' (are you offline?)')); };
      document.head.appendChild(script);
    });
    return loaded[url];
  }

  function readArrayBuffer(file) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () { resolve(reader.result); };
      reader.onerror = function () { reject(new Error('Could not read the file in the browser.')); };
      reader.readAsArrayBuffer(file);
    });
  }

  /** Extract text from a PDF with pdf.js, preserving line breaks via Y position. */
  async function pdfToText(file) {
    await loadScript(CDN.pdfjs);
    var pdfjsLib = window.pdfjsLib || window['pdfjs-dist/build/pdf'];
    if (!pdfjsLib) throw new Error('pdf.js did not initialise.');
    pdfjsLib.GlobalWorkerOptions.workerSrc = CDN.pdfjsWorker;

    var data = await readArrayBuffer(file);
    var pdf = await pdfjsLib.getDocument({ data: data }).promise;
    var pages = [];

    for (var pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      var page = await pdf.getPage(pageNumber);
      var content = await page.getTextContent();
      var lastY = null;
      var line = '';
      var lines = [];

      content.items.forEach(function (item) {
        var y = item.transform ? item.transform[5] : null;
        if (lastY !== null && y !== null && Math.abs(y - lastY) > 2) {
          if (line.trim()) lines.push(line.trim());
          line = '';
        }
        line += (item.str || '') + (item.hasEOL ? ' ' : ' ');
        lastY = y;
      });
      if (line.trim()) lines.push(line.trim());
      pages.push(lines.join('\n'));
    }

    await pdf.destroy();
    return pages.join('\n\n');
  }

  /** Extract raw text from a DOCX with mammoth (browser build). */
  async function docxToText(file) {
    await loadScript(CDN.mammoth);
    if (!window.mammoth) throw new Error('mammoth.js did not initialise.');
    var data = await readArrayBuffer(file);
    var result = await window.mammoth.extractRawText({ arrayBuffer: data });
    return result.value || '';
  }

  window.ResumeExtractor = {
    pdfToText: pdfToText,
    docxToText: docxToText
  };
})();
