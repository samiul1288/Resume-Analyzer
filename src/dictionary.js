'use strict';

/**
 * Builds the flat, alias-aware dictionary from skills.js and exposes
 * role detection + keyword lookup helpers used by analyzer.js.
 */

const { SKILL_GROUPS } = require('./skills');
const { ROLE_PROFILES } = require('./roles');
const { countTerm } = require('./text');

/** Flat dictionary entries: { label, aliases, group, weight }. */
const DICTIONARY = (() => {
  const entries = [];
  for (const [group, cfg] of Object.entries(SKILL_GROUPS)) {
    for (const raw of cfg.terms) {
      const [primary, aliasBlob] = raw.split('|');
      const label = (primary || '').trim();
      if (!label) continue;
      const aliases = aliasBlob
        ? aliasBlob.split(';').map((a) => a.trim()).filter(Boolean)
        : [];
      entries.push({ label, aliases, group, weight: cfg.weight });
    }
  }
  return entries;
})();

/** How many times any spelling of a dictionary entry appears in `text`. */
function matchEntry(text, entry) {
  let count = countTerm(text, entry.label);
  let matchedOn = count > 0 ? entry.label : null;
  for (const alias of entry.aliases) {
    const aliasCount = countTerm(text, alias);
    if (aliasCount > 0) {
      count += aliasCount;
      if (!matchedOn) matchedOn = alias;
    }
  }
  return { count, matchedOn };
}

/** Every dictionary entry present in `text`, with counts. */
function findSkills(text) {
  const found = [];
  for (const entry of DICTIONARY) {
    const { count, matchedOn } = matchEntry(text, entry);
    if (count > 0) {
      found.push({
        label: entry.label,
        matchedOn,
        group: entry.group,
        weight: entry.weight,
        count
      });
    }
  }
  return found;
}

/** Resolve a must-have phrase (may be a plain word like "Communication"). */
function resolveMustHave(phrase) {
  const needle = phrase.toLowerCase();
  const entry = DICTIONARY.find(
    (e) => e.label.toLowerCase() === needle || e.aliases.some((a) => a.toLowerCase() === needle)
  );
  if (entry) return { label: entry.label, group: entry.group, weight: entry.weight, terms: [entry.label, ...entry.aliases] };
  return { label: phrase, group: 'General', weight: 2, terms: [phrase] };
}

/** Fraction of a must-have list that appears in `text`. */
function mustHaveCoverage(text, mustHave) {
  const present = [];
  const missing = [];
  for (const phrase of mustHave) {
    const resolved = resolveMustHave(phrase);
    const hit = resolved.terms.some((term) => countTerm(text, term) > 0);
    (hit ? present : missing).push(resolved.label);
  }
  return { present, missing, ratio: mustHave.length ? present.length / mustHave.length : 0 };
}

/**
 * Detect the most likely target role from free text.
 * Uses explicit role-name hits plus job-title keywords defined per profile.
 */
function detectRole(text) {
  const haystack = String(text || '').toLowerCase();
  if (!haystack.trim()) return null;
  let best = null;
  for (const [role, profile] of Object.entries(ROLE_PROFILES)) {
    let score = 0;
    for (const keyword of profile.match) {
      const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const rx = new RegExp(`(?:^|[^a-z0-9])${escaped}(?![a-z0-9])`, 'g');
      const found = haystack.match(rx);
      if (found) score += 6 + Math.min(found.length, 3);
    }
    if (haystack.includes(role.toLowerCase())) score += 15;
    if (score > 0 && (!best || score > best.score)) best = { role, score, profile };
  }
  if (!best) return null;
  return {
    role: best.role,
    confidence: Math.max(35, Math.min(95, 40 + best.score * 2)),
    profile: best.profile
  };
}

/**
 * Keywords the job description emphasises, ranked by how often they appear.
 * Only dictionary terms are returned, so results stay meaningful.
 */
function rankJobKeywords(jdText, resumeText) {
  const jdSkills = findSkills(jdText);
  const resumeLabelSet = new Set(findSkills(resumeText).map((s) => s.label));
  return jdSkills
    .map((skill) => ({
      label: skill.label,
      group: skill.group,
      weight: skill.weight,
      mentions: skill.count,
      inResume: resumeLabelSet.has(skill.label),
      priority: skill.weight * 10 + Math.min(skill.count, 5) * 3
    }))
    .sort((a, b) => b.priority - a.priority);
}

module.exports = {
  DICTIONARY,
  SKILL_GROUPS,
  ROLE_PROFILES,
  findSkills,
  matchEntry,
  resolveMustHave,
  mustHaveCoverage,
  detectRole,
  rankJobKeywords
};
