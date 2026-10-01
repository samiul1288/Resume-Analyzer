'use strict';

/**
 * Scoring engine: turns parsed resume signals (+ optional job description
 * analysis) into weighted category scores that add up to 100 points.
 */

const { mustHaveCoverage } = require('./dictionary');
const { HARD_SKILL_GROUPS } = require('./parse');

const WEIGHTS = {
  keywords: 25,
  impact: 20,
  actionVerbs: 15,
  structure: 15,
  breadth: 15,
  readability: 10
};

const clamp = (n, min = 0, max = 100) => Math.max(min, Math.min(max, Math.round(n)));

/**
 * Keyword alignment.
 * - With a job description: weighted coverage of the JD's priority keywords.
 * - Without one: coverage of the target role's must-have keywords.
 */
function scoreKeywords(parsed, jd) {
  if (jd.provided && jd.keywords.length > 0) {
    const total = jd.keywords.reduce((sum, k) => sum + k.priority, 0) || 1;
    const matched = jd.keywords.filter((k) => k.inResume);
    const weightRatio = matched.reduce((sum, k) => sum + k.priority, 0) / total;
    const countRatio = matched.length / jd.keywords.length;
    const score = clamp(100 * (0.65 * weightRatio + 0.35 * countRatio));
    return {
      score,
      label: 'Job description keyword match',
      evidence: `${matched.length} of ${jd.keywords.length} job-description keywords found (${score}% weighted coverage).`
    };
  }

  const role = jd.role;
  if (role && role.profile) {
    const coverage = mustHaveCoverage(parsed.text, role.profile.mustHave);
    return {
      score: clamp(coverage.ratio * 100),
      label: `Role keyword coverage (${role.role})`,
      evidence: `${coverage.present.length} of ${role.profile.mustHave.length} must-have keywords for "${role.role}" found.`
    };
  }

  return {
    score: null,
    label: 'Keyword match (needs a job description)',
    evidence: 'No job description supplied, so keyword matching is skipped. Paste one for a precise match score.'
  };
}

/** Quantified impact: how many bullets carry a measurable result. */
function scoreImpact(parsed) {
  const { bullets: total, quantifiedBullets } = parsed.stats;
  if (total === 0) {
    return {
      score: 20,
      label: 'Quantified impact',
      evidence: 'No bullet points detected, so impact could not be measured. Use 3-5 achievement bullets per role.'
    };
  }
  const ratio = quantifiedBullets / total;
  const target = 0.5;
  const score = clamp((Math.min(ratio, target) / target) * 100);
  return {
    score,
    label: 'Quantified impact',
    evidence: `${quantifiedBullets} of ${total} bullets include a number, percentage or money amount (target: 50%).`
  };
}

/** Strong action verbs at the start of bullets, minus weak duty phrasing. */
function scoreActionVerbs(parsed) {
  const { bullets: total, actionVerbBullets } = parsed.stats;
  const weakCount = parsed.weakPhraseHits.length;
  if (total === 0) {
    return {
      score: 30,
      label: 'Action verbs',
      evidence: 'No bullet points detected, so verb strength could not be measured.'
    };
  }
  const ratio = actionVerbBullets / total;
  const target = 0.8;
  const base = (Math.min(ratio, target) / target) * 100;
  const penalty = Math.min(30, weakCount * 6);
  return {
    score: clamp(base - penalty),
    label: 'Action verbs',
    evidence: `${actionVerbBullets} of ${total} bullets start with a strong action verb` +
      (weakCount ? `; ${weakCount} weak phrase${weakCount === 1 ? '' : 's'} detected.` : '.')
  };
}

/** Structure: contact block, core sections, dates and a sensible length. */
function scoreStructure(parsed) {
  const { contact, stats, sections } = parsed;
  const items = [];
  const award = (points, ok, label) => {
    items.push({ label, points, ok: Boolean(ok) });
    return ok ? points : 0;
  };

  let raw = 0;
  raw += award(8, contact.name, 'Name at the top');
  raw += award(10, contact.email, 'Email address');
  raw += award(8, contact.phone, 'Phone number');
  raw += award(6, contact.linkedin || contact.portfolio, 'LinkedIn or portfolio link');
  raw += award(18, sections.includes('experience'), 'Experience section');
  raw += award(12, sections.includes('education'), 'Education section');
  raw += award(14, sections.includes('skills'), 'Skills section');
  raw += award(10, sections.includes('summary'), 'Summary / objective');
  raw += award(8, sections.includes('projects') || sections.includes('certifications'), 'Projects or certifications');
  raw += award(6, stats.dateRanges >= 2 || stats.yearsFound >= 2, 'Date ranges for each role');
  raw += award(6, stats.words >= 250 && stats.words <= 950, 'Length within 1-2 pages');

  const max = items.reduce((sum, i) => sum + i.points, 0) || 1;
  const missing = items.filter((i) => !i.ok).map((i) => i.label);
  return {
    score: clamp((raw / max) * 100),
    label: 'Structure & contact',
    evidence: missing.length
      ? `Missing or unclear: ${missing.join(', ')}.`
      : 'All core sections, contact details and date ranges are present.',
    items
  };
}

/** Technical breadth: relevant skill groups covered + depth in core skills. */
function scoreBreadth(parsed, role) {
  const skills = parsed.hardSkills;
  const relevantGroups = role && role.profile
    ? role.profile.categories.filter((g) => HARD_SKILL_GROUPS.has(g) || g === 'Soft Skills')
    : [...HARD_SKILL_GROUPS];
  const covered = relevantGroups.filter((g) => parsed.groups.has(g));
  const groupRatio = relevantGroups.length ? covered.length / relevantGroups.length : 0;
  const countRatio = Math.min(1, skills.length / 18);
  const coreRatio = Math.min(1, skills.filter((s) => s.weight === 3).length / 8);
  return {
    score: clamp((0.5 * groupRatio + 0.3 * countRatio + 0.2 * coreRatio) * 100),
    label: 'Skill breadth',
    evidence: `${skills.length} industry skills found across ${covered.length} of ${relevantGroups.length} relevant skill areas.`
  };
}

/** Readability and ATS-hygiene penalties. */
function scoreReadability(parsed) {
  const { stats } = parsed;
  let score = 100;
  const notes = [];
  const dock = (n, note) => {
    score -= n;
    if (note) notes.push(note);
  };

  if (stats.longBullets > 0) dock(Math.min(16, stats.longBullets * 4), `${stats.longBullets} bullet(s) over 30 words`);
  if (stats.avgBulletWords > 26) dock(8, `average bullet is ${stats.avgBulletWords} words (aim for 10-22)`);
  if (stats.avgBulletWords > 0 && stats.avgBulletWords < 8) dock(5, `average bullet is only ${stats.avgBulletWords} words - too terse`);
  if (stats.shortBullets > 3) dock(4, `${stats.shortBullets} fragment-style bullets`);
  if (stats.firstPersonHits > 0) dock(Math.min(12, stats.firstPersonHits * 2), `${stats.firstPersonHits} first-person word(s) ("I", "my")`);
  if (stats.passiveHits > 0) dock(Math.min(10, stats.passiveHits * 2), `${stats.passiveHits} passive-voice sentence(s)`);
  if (parsed.buzzwordHits.length > 0) dock(Math.min(8, parsed.buzzwordHits.length * 2), `${parsed.buzzwordHits.length} filler buzzword(s)`);
  if (stats.noiseChars > 0) dock(6, `${stats.noiseChars} unreadable character(s) from a bad PDF export`);
  if (stats.words < 250) dock(15, `only ${stats.words} words - too thin`);
  if (stats.words > 1100) dock(6, `${stats.words} words (~${stats.estimatedPages} pages) - trim to 2 pages`);

  return {
    score: clamp(score),
    label: 'Readability & ATS hygiene',
    evidence: notes.length ? `Penalties: ${notes.join('; ')}.` : 'Clean, concise phrasing with no ATS red flags detected.'
  };
}

function gradeFor(score) {
  if (score >= 85) return { label: 'Excellent - interview ready', tone: 'excellent' };
  if (score >= 70) return { label: 'Good - a few fixes needed', tone: 'good' };
  if (score >= 55) return { label: 'Fair - needs work', tone: 'fair' };
  return { label: 'Needs significant work', tone: 'weak' };
}

/** Combine every category into a weighted total plus a grade. */
function buildCategories(parsed, jd) {
  const raw = [
    { key: 'keywords', ...scoreKeywords(parsed, jd) },
    { key: 'impact', ...scoreImpact(parsed) },
    { key: 'actionVerbs', ...scoreActionVerbs(parsed) },
    { key: 'structure', ...scoreStructure(parsed) },
    { key: 'breadth', ...scoreBreadth(parsed, jd.role) },
    { key: 'readability', ...scoreReadability(parsed) }
  ];

  const active = raw.filter((c) => c.score !== null);
  const weightSum = active.reduce((sum, c) => sum + WEIGHTS[c.key], 0) || 1;

  const categories = raw.map((c) => ({
    key: c.key,
    label: c.label,
    score: c.score,
    weight: c.score === null ? 0 : Math.round((WEIGHTS[c.key] / weightSum) * 100),
    evidence: c.evidence,
    items: c.items || null
  }));

  const total = clamp(
    active.reduce((sum, c) => sum + c.score * (WEIGHTS[c.key] / weightSum), 0)
  );

  return { categories, total, grade: gradeFor(total) };
}

module.exports = {
  WEIGHTS,
  clamp,
  gradeFor,
  scoreKeywords,
  scoreImpact,
  scoreActionVerbs,
  scoreStructure,
  scoreBreadth,
  scoreReadability,
  buildCategories
};
