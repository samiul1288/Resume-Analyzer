'use strict';

/**
 * Dependency-free PDF text extraction (fallback path).
 *
 * Handles the common case of Flate-compressed content streams with
 * standard text operators (Tj / TJ / ' / "). It cannot decode CID fonts
 * without a ToUnicode table, so `extract.js` prefers `pdf-parse` when it is
 * installed and falls back to the browser's pdf.js when text looks unusable.
 */

const zlib = require('zlib');

/** Decode a PDF string literal or hex string into text. */
function decodePdfString(token) {
  if (!token) return '';
  const trimmed = token.trim();
  if (trimmed.startsWith('<')) {
    const hex = trimmed.replace(/[<>\s]/g, '');
    let out = '';
    for (let i = 0; i + 1 < hex.length; i += 2) {
      out += String.fromCharCode(parseInt(hex.slice(i, i + 2), 16));
    }
    return out;
  }

  const body = trimmed.replace(/^\(/, '').replace(/\)$/, '');
  let out = '';
  for (let i = 0; i < body.length; i += 1) {
    const ch = body[i];
    if (ch !== '\\') {
      out += ch;
      continue;
    }
    const next = body[i + 1];
    i += 1;
    switch (next) {
      case 'n': out += '\n'; break;
      case 'r': out += '\r'; break;
      case 't': out += '\t'; break;
      case 'b': out += '\b'; break;
      case 'f': out += '\f'; break;
      case '(': out += '('; break;
      case ')': out += ')'; break;
      case '\\': out += '\\'; break;
      case '\n': break;
      case undefined: break;
      default:
        if (/[0-7]/.test(next)) {
          const octal = (next + (body.slice(i + 1, i + 3).match(/^[0-7]{0,2}/) || [''])[0]);
          out += String.fromCharCode(parseInt(octal, 8));
          i += octal.length - 1;
        } else {
          out += next;
        }
    }
  }
  return out;
}

/** Pull visible text out of a decoded PDF content stream. */
function textFromContent(content) {
  const operators = /(\[(?:[^[\]\\]|\\.)*\]\s*TJ)|(\((?:[^()\\]|\\.)*\)\s*(?:Tj|'|")*)|(<[0-9A-Fa-f\s]+>\s*Tj)|(\bT\*|\bTd\b|\bTD\b|\bET\b)/g;
  let out = '';
  let match;
  while ((match = operators.exec(content)) !== null) {
    if (match[1]) {
      const parts = match[1].match(/\((?:[^()\\]|\\.)*\)|<[0-9A-Fa-f\s]+>/g) || [];
      let line = '';
      for (const part of parts) line += decodePdfString(part);
      out += line;
    } else if (match[2]) {
      out += decodePdfString(match[2].replace(/\s*(?:Tj|'|")+\s*$/, ''));
      if (/'|"/.test(match[2].slice(-2))) out += '\n';
    } else if (match[3]) {
      out += decodePdfString(match[3].replace(/\s*Tj$/, ''));
    } else if (match[4]) {
      out += '\n';
    }
  }
  return out;
}

/** Yield decoded content streams found in a PDF buffer. */
function decodedStreams(buffer) {
  const latin = buffer.toString('latin1');
  const streams = [];
  const rx = /stream\r?\n/g;
  let match;
  while ((match = rx.exec(latin)) !== null) {
    const start = match.index + match[0].length;
    const end = latin.indexOf('endstream', start);
    if (end < 0) break;
    const raw = buffer.subarray(start, end);
    let decoded = null;
    for (const attempt of [
      () => zlib.inflateSync(raw),
      () => zlib.inflateRawSync(raw),
      () => zlib.unzipSync(raw)
    ]) {
      try {
        decoded = attempt();
        break;
      } catch (error) {
        decoded = null;
      }
    }
    const content = decoded ? decoded.toString('latin1') : raw.toString('latin1');
    if (/\bBT\b/.test(content) && /(?:Tj|TJ|T\*|Td|TD)/.test(content)) streams.push(content);
    rx.lastIndex = end;
  }
  return streams;
}

/** Heuristic quality score (0-1) for extracted PDF text. */
function textQuality(text) {
  if (!text) return 0;
  const printable = (text.match(/[A-Za-z0-9 .,;:'"()\-/%$@#&+*]/g) || []).length;
  const ratio = printable / Math.max(1, text.length);
  const hasWords = (text.match(/\b[a-zA-Z]{3,}\b/g) || []).length;
  const wordScore = Math.min(1, hasWords / 60);
  return Math.round((ratio * 0.6 + wordScore * 0.4) * 100) / 100;
}

/** Extract text from a PDF buffer using the built-in parser. */
function extractPdfText(buffer) {
  const streams = decodedStreams(buffer);
  const text = streams
    .map(textFromContent)
    .join('\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/ ?\n ?/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return { text, streams: streams.length, quality: textQuality(text) };
}

module.exports = { extractPdfText, textFromContent, decodePdfString, textQuality, decodedStreams };
