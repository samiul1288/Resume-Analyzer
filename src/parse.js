'use strict';

/**
 * Resume parsing layer: turns raw resume text (pasted or extracted from a
 * PDF/DOCX) into the measurable signals the scoring engine uses.
 */

const {
  normalize,
  nonEmptyLines,
  wordCount,
  bullets,
  sentences,
  phraseHits
} = require('./text');
const { ACTION_VERBS, WEAK_PHRASES, BUZZWORDS, SECTION_PATTERNS } = require('./lexicon');
const { findSkills } = require('./dictionary');

const EMAIL_RX = /\b[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}\b/i;
const PHONE_RX = /(?:\+\d{1,3}[\s.-]?)?(?:\(?\d{2,4}\)?[\s.-]?){2,4}\d{2,4}/;
const LINKEDIN_RX = /linkedin\.com\/[a-z0-9/_%-]+/i;
const LINK_RX = /(?:https?:\/\/|www\.)[a-z0-9./?=_%:#-]{3,}/i;
const DATE_RANGE_RX = /((?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s*\d{4}|\d{1,2}\/\d{4}|\d{4})\s*(?:-|to|present)/gi;
const YEAR_RX = /\b(19|20)\d{2}\b/g;
const METRIC_RX = /(\d+(?:\.\d+)?\s?%|\$\s?\d|\b\d{2,}\b|\b\d+(?:\.\d+)?\s?(?:x|k|m|bn|million|billion|hours?|days?|weeks?|months?|users?|clients?|customers?|students?|employees?|people|orders?|tickets?|requests?|projects?|accounts?|teams?|members?|leads?|sales|revenue|downloads?|installs?|visits?|followers?|records?|rows?|tests?|bugs?|apis?|endpoints?)\b)/i;
const PASSIVE_RX = /\b(?:was|were|been|being|is|are|has been|have been)\s+[a-z]+(?:ed|en)\b/i;
const FIRST_PERSON_RX = /\b(?:i|me|my|mine|myself)\b/gi;
const NOISE_RX = /[\uFFFD\u25A1\u25A0\uE000-\uF8FF]/g;

const HARD_SKILL_GROUPS = new Set([
  'Programming Languages', 'Frontend', 'Backend', 'Databases', 'Data & Analytics',
  'AI & Machine Learning', 'Cloud & DevOps', 'Mobile', 'Testing & QA', 'Design',
  'Business, Marketing & Finance'
]);

/** Strip a leading bullet marker and tidy spacing. */
function clean(line) {
  return line.replace(/^\s*(?:[-*+>]|\d{1,2}\s*[.)])\s*/, '').replace(/\s+/g, ' ').trim();
}

/** Canonical section key if this line looks like a resume heading, else null. */
function headingKey(line) {
  const raw = line.trim();
  if (!raw || raw.length > 48) return null;
  const cleaned = raw.replace(/^[#>*\-\s]+/, '').replace(/[:\s]+$/, '').trim();
  if (!cleaned || cleaned.split(/\s+/).length > 5) return null;
  if (!(cleaned === cleaned.toUpperCase() || /^[A-Z]/.test(cleaned))) return null;
  for (const { key, rx } of SECTION_PATTERNS) {
    if (rx.test(cleaned)) return key;
  }
  return null;
}

/** Split resume text into canonical sections (header + known headings). */
function splitSections(text) {
  const blocks = { header: '' };
  const order = [];
  let current = 'header';
  for (const line of nonEmptyLines(text)) {
    const key = headingKey(line);
    if (key && key !== current) {
      current = key;
      if (blocks[key] === undefined) blocks[key] = '';
      if (!order.includes(key)) order.push(key);
      continue;
    }
    blocks[current] = blocks[current] ? `${blocks[current]}\n${line}` : line;
  }
  return { blocks, order };
}

/** Split bullets into quantified vs. unquantified groups. */
function measureBullets(list) {
  const quantified = [];
  const plain = [];
  for (const bullet of list) {
    (METRIC_RX.test(bullet) ? quantified : plain).push(bullet);
  }
  return { quantified, plain };
}

/** Returns the leading action verb of a bullet, or null. */
function startsWithActionVerb(bullet) {
  const first = ((bullet.match(/^[A-Za-z-]+/) || [''])[0] || '').toLowerCase();
  if (ACTION_VERBS.includes(first)) return first;
  const second = (bullet.match(/^[A-Za-z-]+\s+([A-Za-z-]+)/) || [])[1];
  if (second && ACTION_VERBS.includes(second.toLowerCase())) return second.toLowerCase();
  return null;
}

/** Parse everything the scorer needs out of raw resume text. */
function parseResume(rawText) {
  const text = normalize(rawText);
  const linesList = nonEmptyLines(text);
  const { blocks, order } = splitSections(text);
  const email = (text.match(EMAIL_RX) || [])[0] || null;

  const phoneCandidates = text.match(new RegExp(PHONE_RX.source, 'g')) || [];
  const phoneRaw = phoneCandidates.find((c) => {
    const digits = c.replace(/\D/g, '');
    return digits.length >= 9 && digits.length <= 14 && /\d/.test(c);
  }) || null;
  const phone = phoneRaw ? phoneRaw.trim() : null;

  const linkedin = ((text.match(LINKEDIN_RX) || [])[0] || '').toLowerCase() || null;
  const links = (text.match(new RegExp(LINK_RX.source, 'gi')) || []).map((l) => l.toLowerCase());
  const portfolio = links.find((l) => !l.includes('linkedin.com') && !l.includes('@')) || null;

  const nameLine = linesList.slice(0, 4).find((l) => {
    const candidate = clean(l);
    const parts = candidate.split(/\s+/);
    return (
      parts.length >= 2 &&
      parts.length <= 5 &&
      candidate.length <= 40 &&
      /^[A-Za-z'.\- ]+$/.test(candidate) &&
      !EMAIL_RX.test(l)
    );
  }) || null;

  const allBullets = bullets(text);
  const experienceBullets = bullets(blocks.experience || '');
  const bulletList = experienceBullets.length >= 4 ? experienceBullets : allBullets;
  const { quantified, plain } = measureBullets(bulletList);

  const skills = findSkills(text);
  const hardSkills = skills.filter((s) => HARD_SKILL_GROUPS.has(s.group));
  const firstPersonHits = (text.match(FIRST_PERSON_RX) || []).length;
  const experienceSentences = sentences(blocks.experience || text);
  const passiveHits = experienceSentences.filter((s) => PASSIVE_RX.test(s)).length;
  const dateRanges = new Set((text.match(DATE_RANGE_RX) || []).map((m) => m.toLowerCase().replace(/\s+/g, ' ')));
  const years = new Set(text.match(YEAR_RX) || []);
  const longBullets = bulletList.filter((b) => b.split(/\s+/).length > 30);
  const shortBullets = bulletList.filter((b) => b.split(/\s+/).length < 5);
  const verbBullets = bulletList.filter((b) => startsWithActionVerb(b));
  const lowVerbs = bulletList.filter((b) => !startsWithActionVerb(b));
  const totalBulletWords = bulletList.reduce((sum, b) => sum + b.split(/\s+/).length, 0);
  const wordsTotal = wordCount(text);

  return {
    text,
    blocks,
    sections: order,
    contact: {
      name: nameLine ? clean(nameLine) : null,
      email,
      phone,
      linkedin,
      portfolio
    },
    stats: {
      words: wordsTotal,
      lines: linesList.length,
      bullets: bulletList.length,
      bulletsInExperience: experienceBullets.length,
      quantifiedBullets: quantified.length,
      actionVerbBullets: verbBullets.length,
      weakBullets: lowVerbs.length,
      avgBulletWords: bulletList.length ? Math.round(totalBulletWords / bulletList.length) : 0,
      longBullets: longBullets.length,
      shortBullets: shortBullets.length,
      dateRanges: dateRanges.size,
      yearsFound: years.size,
      firstPersonHits,
      passiveHits,
      noiseChars: (text.match(NOISE_RX) || []).length,
      estimatedPages: Math.max(0.4, Math.round((wordsTotal / 500) * 10) / 10)
    },
    quantified,
    plainBullets: plain,
    lowVerbs,
    weakPhraseHits: phraseHits(text, WEAK_PHRASES),
    buzzwordHits: phraseHits(text, BUZZWORDS),
    skills,
    hardSkills,
    groups: new Set(skills.map((s) => s.group)),
    bullets: bulletList
  };
}

module.exports = {
  clean,
  headingKey,
  splitSections,
  measureBullets,
  startsWithActionVerb,
  parseResume,
  HARD_SKILL_GROUPS,
  METRIC_RX,
  EMAIL_RX,
  PHONE_RX
};
