'use strict';

/**
 * Text utilities: normalization, term matching with alias/flexible-separator
 * support, bullet + section parsing. No external dependencies.
 */

const { ACTION_VERBS } = require('./lexicon');

/** Characters that PDF/DOCX extractors emit for bullets. */
const BULLET_CHARS = /[\u2022\u25CF\u25AA\u25E6\u2043\u2219\u00B7\u25A0\u25AB\u2023\u00B0]/g;

/** A line that starts like a bullet ("- item", "1. item", "* item"). */
const BULLET_LINE = /^\s*(?:[-*+>]|\d{1,2}\s*[.)]|[a-z]\s*[.)])\s+\S/;

/** Two-character terms that must be matched case-sensitively ("C", "Go", "JS"). */
const STRICT_TERMS = new Set(['c', 'r', 'go', 'js', 'ts']);

const ALNUM = 'A-Za-z0-9';

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Collapse extractor noise (smart quotes, NBSP, tabs, run-on blank lines). */
function normalize(text) {
  return String(text == null ? '' : text)
    .replace(/\r\n?/g, '\n')
    .replace(BULLET_CHARS, '-')
    .replace(/[\u00A0\u2007\u202F]/g, ' ')
    .replace(/[\u2018\u2019\u201B\u2032]/g, "'")
    .replace(/[\u201C\u201D\u2033]/g, '"')
    .replace(/[\u2013\u2014\u2212]/g, '-')
    .replace(/\u2026/g, '...')
    .replace(/[^\S\n]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function lines(text) {
  return normalize(text).split('\n');
}

function nonEmptyLines(text) {
  return lines(text).filter((l) => l.trim().length > 0);
}

function words(text) {
  const matches = normalize(text).toLowerCase().match(/[a-z0-9][a-z0-9'+#./-]*/g);
  return matches || [];
}

function wordCount(text) {
  return words(text).length;
}

function isBulletLine(line) {
  return BULLET_LINE.test(line);
}

/** Sentence-ish split that still works on bullet lists without punctuation. */
function sentences(text) {
  const out = [];
  for (const part of normalize(text).split(/\n+/)) {
    const chunks = part.split(/([.!?])\s+/);
    let buffer = '';
    for (let i = 0; i < chunks.length; i += 1) {
      buffer += chunks[i];
      if (i % 2 === 1) {
        if (buffer.trim()) out.push(buffer.trim());
        buffer = '';
      }
    }
    if (buffer.trim()) out.push(buffer.trim());
  }
  return out;
}

/** Does an unmarked line read like a real achievement bullet? */
function looksLikeSentence(line) {
  const parts = line.split(/\s+/);
  if (parts.length < 6) return false;
  if (/^[A-Z\s&/]+$/.test(line)) return false; // headings
  if (/\b(cgpa|gpa|bsc|b\.?sc|msc|bachelor|master|university|college|polytechnic)\b/i.test(line)) return false;
  const firstWord = ((line.match(/^[A-Za-z'-]+/) || [''])[0] || '').toLowerCase();
  if (firstWord && ACTION_VERBS.includes(firstWord)) return true;
  if (/\b[a-z]{3,}(?:ed|ing)\b/.test(line)) return true;
  if (/\d/.test(line)) return true;
  return false;
}

/** Lines that behave like resume bullets (explicit marker or achievement sentence). */
function bullets(text) {
  const out = [];
  for (const raw of lines(text)) {
    const line = raw.trim();
    if (!line) continue;
    const stripped = line.replace(/^[-*+>]\s*|^\d{1,2}\s*[.)]\s*/, '').trim();
    if (isBulletLine(line)) {
      if (stripped.length > 2) out.push(stripped);
    } else if (looksLikeSentence(stripped)) {
      out.push(stripped);
    }
  }
  return out;
}

/**
 * Build a case-insensitive word-boundary regex for a dictionary term.
 * Spaces/hyphens/underscores inside a term match loosely so that
 * "node js", "node-js" and "nodejs" all hit the same entry.
 */
function termRegex(term) {
  const isStrict = STRICT_TERMS.has(term.toLowerCase()) && term.length <= 2;
  const body = escapeRegex(term).replace(/[\s\-_]+/g, '[\\s\\-_]*');
  const boundary = isStrict
    ? `[^${ALNUM}+#.\\-/]`
    : '[^a-z0-9]';
  const suffix = isStrict
    ? `(?![${ALNUM}+#.\\-/])`
    : '(?![a-z0-9])';
  return new RegExp(`(?:^|${boundary})${body}${suffix}`, isStrict ? 'g' : 'gi');
}

const regexCache = new Map();
function cachedTermRegex(term) {
  let rx = regexCache.get(term);
  if (!rx) {
    rx = termRegex(term);
    regexCache.set(term, rx);
  }
  return rx;
}

/** Count occurrences of a dictionary term (alias-aware caller passes each alias). */
function countTerm(text, term) {
  const rx = cachedTermRegex(term);
  rx.lastIndex = 0;
  let count = 0;
  while (rx.exec(text) !== null) {
    count += 1;
    if (rx.lastIndex === 0) break; // safety for zero-length matches
  }
  return count;
}

/** All hits of a phrase list, with the first matching snippet for evidence. */
function phraseHits(text, phrases) {
  const haystack = normalize(text);
  const hits = [];
  for (const phrase of phrases) {
    const rx = cachedTermRegex(phrase);
    rx.lastIndex = 0;
    const match = rx.exec(haystack);
    if (match) {
      const termLength = phrase.length;
      hits.push({
        phrase,
        index: match.index,
        snippet: snippetAround(haystack, match.index, termLength)
      });
    }
  }
  return hits;
}

function snippetAround(text, index, length, pad = 60) {
  const start = Math.max(0, index - pad);
  const end = Math.min(text.length, index + length + pad);
  const prefix = start > 0 ? '...' : '';
  const suffix = end < text.length ? '...' : '';
  return (prefix + text.slice(start, end).replace(/\n/g, ' ') + suffix).trim();
}

function countPhrase(text, phrase) {
  return countTerm(text, phrase);
}

module.exports = {
  BULLET_LINE,
  normalize,
  lines,
  nonEmptyLines,
  words,
  wordCount,
  isBulletLine,
  looksLikeSentence,
  sentences,
  bullets,
  termRegex,
  countTerm,
  countPhrase,
  phraseHits,
  snippetAround,
  escapeRegex
};
