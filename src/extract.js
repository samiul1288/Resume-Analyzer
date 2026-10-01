'use strict';

/**
 * Extraction dispatcher: turns an uploaded file into plain text.
 *
 * Strategy per format:
 *   PDF  -> optional `pdf-parse` (best quality) -> built-in stream parser -> client-side pdf.js
 *   DOCX -> optional `mammoth` -> built-in ZIP/XML reader
 *   TXT/MD/RTF -> direct decode (RTF control words stripped)
 *
 * Optional packages are loaded lazily, so the app runs fine with zero deps.
 */

const path = require('path');
const { extractDocxText } = require('./docx');
const { extractPdfText, textQuality } = require('./pdf');

const optionalCache = new Map();

function loadOptional(name) {
  if (optionalCache.has(name)) return optionalCache.get(name);
  let mod = null;
  try {
    // eslint-disable-next-line global-require, import/no-dynamic-require
    mod = require(name);
  } catch (error) {
    mod = null;
  }
  optionalCache.set(name, mod);
  return mod;
}

function detectKind(fileName = '', mimeType = '', buffer) {
  const ext = path.extname(fileName).toLowerCase();
  const mime = (mimeType || '').toLowerCase();
  if (ext === '.pdf' || mime.includes('pdf')) return 'pdf';
  if (ext === '.docx' || mime.includes('wordprocessingml')) return 'docx';
  if (ext === '.doc') return 'doc';
  if (['.txt', '.md', '.rtf', '.csv', '.json'].includes(ext) || mime.startsWith('text/')) return 'text';
  if (buffer && buffer.length >= 4) {
    const head = buffer.subarray(0, 4).toString('latin1');
    if (head.startsWith('%PDF')) return 'pdf';
    if (buffer[0] === 0x50 && buffer[1] === 0x4b) return 'docx';
  }
  return 'unknown';
}

function stripRtf(text) {
  return text
    .replace(/\\'([0-9a-f]{2})/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/\\par[d]?\b/g, '\n')
    .replace(/\\line\b/g, '\n')
    .replace(/\\tab\b/g, '\t')
    .replace(/\{\\\*[^{}]*\}/g, '')
    .replace(/\\[a-z]+-?\d* ?/gi, '')
    .replace(/[{}]/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Try the optional pdf-parse package; returns null when unavailable/failed. */
async function tryPdfParse(buffer) {
  const mod = loadOptional('pdf-parse');
  if (!mod) return null;

  // pdf-parse v2 API: new PDFParse({ data }) -> getText()
  if (typeof mod.PDFParse === 'function') {
    let parser = null;
    try {
      parser = new mod.PDFParse({ data: buffer });
      const result = await parser.getText();
      if (result && typeof result.text === 'string' && result.text.trim()) return result.text;
    } catch (error) {
      return null;
    } finally {
      if (parser && typeof parser.destroy === 'function') {
        try {
          await parser.destroy();
        } catch (error) {
          /* ignore cleanup errors */
        }
      }
    }
    return null;
  }

  // Older pdf-parse releases export a plain function instead.
  try {
    if (typeof mod === 'function') {
      const data = await mod(buffer);
      return (data && data.text) || null;
    }
    if (mod.default && typeof mod.default === 'function') {
      const data = await mod.default(buffer);
      return (data && data.text) || null;
    }
    if (typeof mod.pdf === 'function') {
      const data = await mod.pdf(buffer);
      return (data && data.text) || null;
    }
  } catch (error) {
    return null;
  }
  return null;
}

/** Try the optional mammoth package; returns null when unavailable/failed. */
async function tryMammoth(buffer) {
  const mod = loadOptional('mammoth');
  if (!mod || typeof mod.extractRawText !== 'function') return null;
  try {
    const result = await mod.extractRawText({ buffer });
    return (result && result.value) || null;
  } catch (error) {
    return null;
  }
}

/** Report which extraction engines are available in this installation. */
function extractorCapabilities() {
  return {
    pdfParse: Boolean(loadOptional('pdf-parse')),
    mammoth: Boolean(loadOptional('mammoth')),
    builtinPdf: true,
    builtinDocx: true
  };
}

/**
 * Extract plain text from an uploaded file.
 * @returns {Promise<{text:string, kind:string, method:string, quality:number, warnings:string[], needsClientExtraction:boolean}>}
 */
async function extractText({ buffer, fileName = '', mimeType = '' }) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    const error = new Error('The uploaded file was empty.');
    error.code = 'EMPTY_FILE';
    error.status = 400;
    throw error;
  }

  const kind = detectKind(fileName, mimeType, buffer);
  const warnings = [];
  let text = '';
  let method = 'none';

  if (kind === 'pdf') {
    const fromPdfParse = await tryPdfParse(buffer);
    const builtin = extractPdfText(buffer);
    if (fromPdfParse && fromPdfParse.trim().length >= builtin.text.trim().length) {
      text = fromPdfParse;
      method = 'pdf-parse';
    } else if (builtin.text.trim().length > 0) {
      text = builtin.text;
      method = 'built-in pdf parser';
    }
    if (builtin.quality < 0.5 && method === 'built-in pdf parser') {
      warnings.push('Automatic PDF text extraction was low quality, so the text may contain artifacts. Check the preview below.');
    }
  } else if (kind === 'docx') {
    const fromMammoth = await tryMammoth(buffer);
    if (fromMammoth && fromMammoth.trim().length > 0) {
      text = fromMammoth;
      method = 'mammoth';
    } else {
      text = extractDocxText(buffer);
      method = 'built-in docx parser';
    }
  } else if (kind === 'doc') {
    throw Object.assign(
      new Error('Legacy .doc files are not supported. Save the file as .docx or export it as PDF, then upload again.'),
      { code: 'UNSUPPORTED_DOC', status: 415 }
    );
  } else if (kind === 'text') {
    const raw = buffer.toString('utf8');
    text = /\.rtf$/i.test(fileName) || raw.trimStart().startsWith('{\\rtf') ? stripRtf(raw) : raw;
    method = 'plain text';
  } else {
    throw Object.assign(
      new Error('Unsupported file type. Upload a PDF, DOCX, TXT or RTF file - or paste the resume text.'),
      { code: 'UNSUPPORTED_TYPE', status: 415 }
    );
  }

  text = String(text || '').replace(/\u0000/g, '').trim();
  const quality = kind === 'pdf' ? textQuality(text) : text ? 1 : 0;
  const wordTotal = text ? text.split(/\s+/).length : 0;
  const needsClientExtraction = kind === 'pdf' && wordTotal < 120;

  if (needsClientExtraction) {
    warnings.push(
      'Very little text came out of this PDF. It is probably a scan or an image export, so try the browser-side reader or paste the text manually.'
    );
  }

  return { text, kind, method, quality, warnings, needsClientExtraction, words: wordTotal };
}

module.exports = {
  extractText,
  detectKind,
  extractorCapabilities,
  stripRtf,
  tryPdfParse,
  tryMammoth
};
