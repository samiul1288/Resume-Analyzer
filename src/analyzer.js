'use strict';

/**
 * Resume Analyzer - public API.
 *
 *   const { analyze } = require('./src/analyzer');
 *   const report = analyze(resumeText, jobDescriptionText);
 *
 * The returned object is plain JSON-friendly data (no HTML), so the same
 * engine can back the web UI, a CLI or a PDF export.
 */

const { normalize, wordCount } = require('./text');
const { parseResume } = require('./parse');
const { buildCategories } = require('./score');
const { analyzeJob, atsChecks } = require('./narrative');
const { buildStrengths } = require('./strengths');
const { buildSuggestions } = require('./suggest');
const { mustHaveCoverage } = require('./dictionary');

/** Where a keyword should live, based on the skill group it belongs to. */
function suggestPlacement(group) {
  if (group === 'Soft Skills') {
    return 'Show it with evidence in a bullet (e.g. "Mentored 4 juniors..."), not as a bare label.';
  }
  if (group === 'Business, Marketing & Finance' || group === 'Product & Project') {
    return 'Add it to a recent experience bullet with a result attached.';
  }
  return 'Add it to the Skills line and mention it in one relevant project or role bullet.';
}

const IMPORTANCE = { 3: 'high', 2: 'medium', 1: 'low' };

/** Two-sentence verdict shown at the top of the report. */
function buildVerdict(total, jd, parsed, suggestions) {
  const parts = [];
  parts.push(`This resume scores ${total}/100.`);

  if (jd.provided && jd.matchPercent !== null) {
    parts.push(`It matches ${jd.matchPercent}% of the job description's priority keywords (${jd.matched.length}/${jd.keywords.length}).`);
  } else if (jd.role) {
    parts.push(`No job description was supplied, so scoring used a ${jd.role.role} benchmark derived from the resume.`);
  } else {
    parts.push('No job description was supplied, so keyword matching was skipped and the remaining criteria were re-weighted.');
  }

  if (parsed.stats.bullets > 0) {
    parts.push(`${parsed.stats.quantifiedBullets} of ${parsed.stats.bullets} bullets are quantified and ${parsed.stats.actionVerbBullets} lead with a strong action verb.`);
  }

  const top = suggestions.slice(0, 3).map((s) => s.title.toLowerCase());
  if (top.length) parts.push(`Highest-impact fixes: ${top.join('; ')}.`);

  return parts.join(' ');
}

/**
 * Analyze a resume (and optionally a job description).
 * Throws an Error with `code`/`status` for invalid input.
 */
function analyze(resumeText, jobText = '', options = {}) {
  const resume = normalize(resumeText);
  if (wordCount(resume) < 40) {
    const error = new Error(
      'The resume text is too short to analyze. Paste at least a few paragraphs, or upload a PDF/DOCX that contains real text (scanned image PDFs will not work).'
    );
    error.code = 'RESUME_TOO_SHORT';
    error.status = 400;
    throw error;
  }

  const parsed = parseResume(resume);
  const jd = analyzeJob(jobText, parsed);
  const { categories, total, grade } = buildCategories(parsed, jd);
  const strengths = buildStrengths(parsed, jd, categories);
  const suggestions = buildSuggestions(parsed, jd, categories);

  const rewriteMap = new Map();
  for (const suggestion of suggestions) {
    for (const example of suggestion.examples || []) {
      if (!rewriteMap.has(example.before)) rewriteMap.set(example.before, example);
    }
  }

  const atsChecksList = atsChecks(parsed, { fileName: options.fileName });

  const presentSkills = parsed.skills
    .slice()
    .sort((a, b) => (b.weight - a.weight) || (b.count - a.count) || a.label.localeCompare(b.label))
    .map((s) => ({ label: s.label, group: s.group, weight: s.weight, mentions: s.count }));

  const byGroup = {};
  for (const skill of presentSkills) {
    byGroup[skill.group] = byGroup[skill.group] || [];
    byGroup[skill.group].push(skill.label);
  }

  let missingKeywords = [];
  if (jd.provided && jd.missing.length) {
    missingKeywords = jd.missing.slice(0, 20).map((k) => ({
      label: k.label,
      group: k.group,
      mentions: k.mentions,
      importance: IMPORTANCE[k.weight] || 'medium',
      placement: suggestPlacement(k.group)
    }));
  } else if (!jd.provided && jd.role && jd.role.profile) {
    const coverage = mustHaveCoverage(resume, jd.role.profile.mustHave);
    missingKeywords = coverage.missing.map((label) => ({
      label,
      group: 'Role must-have',
      mentions: 0,
      importance: 'high',
      placement: 'Add it to the Skills line and prove it in one bullet.'
    }));
  }

  return {
    version: 1,
    analyzedAt: new Date().toISOString(),
    score: total,
    grade,
    verdict: buildVerdict(total, jd, parsed, suggestions),
    role: jd.role
      ? { name: jd.role.role, confidence: jd.role.confidence, source: jd.role.source }
      : null,
    jobDescription: {
      provided: jd.provided,
      words: jd.wordCount,
      matchPercent: jd.matchPercent,
      matchedCount: jd.matched.length,
      totalKeywords: jd.keywords.length
    },
    categories,
    strengths,
    suggestions,
    rewrites: [...rewriteMap.values()].slice(0, 4),
    missingKeywords,
    keywords: { present: presentSkills, byGroup, totalFound: presentSkills.length },
    ats: {
      checks: atsChecksList,
      passed: atsChecksList.filter((c) => c.pass).length,
      total: atsChecksList.length
    },
    stats: parsed.stats,
    detectedSections: parsed.sections,
    contact: parsed.contact,
    preview: resume.slice(0, 700),
    notes: [
      'Scores come from measurable signals in the text (structure, quantified bullets, verb strength, keyword coverage) - no AI guesswork, so results are reproducible.',
      jd.thin
        ? 'The job description contained few recognizable keywords, so the match score may understate your fit.'
        : null,
      jd.provided
        ? null
        : 'Add a job description to unlock the keyword-match category, which carries the most weight.'
    ].filter(Boolean)
  };
}

module.exports = { analyze, suggestPlacement };
