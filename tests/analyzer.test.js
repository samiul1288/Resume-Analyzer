'use strict';

/**
 * Engine tests: scoring, parsing, keyword analysis and suggestions.
 * Run with: npm test
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { analyze } = require('../src/analyzer');
const { parseResume } = require('../src/parse');
const { detectRole, findSkills } = require('../src/dictionary');

const samplesDir = path.join(__dirname, '..', 'samples');
const weak = JSON.parse(fs.readFileSync(path.join(samplesDir, 'frontend-junior.json'), 'utf8'));
const strong = JSON.parse(fs.readFileSync(path.join(samplesDir, 'data-analyst.json'), 'utf8'));

test('analyze() returns a complete, JSON-safe report', () => {
  const report = analyze(strong.resume, strong.jobDescription);

  assert.equal(typeof report.score, 'number');
  assert.ok(report.score >= 0 && report.score <= 100, 'score must be within 0-100');
  assert.equal(report.categories.length, 6);
  assert.ok(report.grade.tone && report.grade.label);
  assert.ok(report.strengths.length >= 1);
  assert.ok(report.suggestions.length >= 1);
  assert.ok(report.verdict.length > 20);
  assert.equal(report.jobDescription.provided, true);
  assert.ok(report.ats.checks.length >= 9);
  assert.doesNotThrow(() => JSON.stringify(report), 'report must be JSON serialisable');
});

test('category weights add up to 100 when every category is scored', () => {
  const report = analyze(strong.resume, strong.jobDescription);
  const totalWeight = report.categories.reduce((sum, c) => sum + c.weight, 0);
  assert.equal(totalWeight, 100);
});

test('a quantified, keyword-matched resume outscores a duty-style resume', () => {
  const weakReport = analyze(weak.resume, weak.jobDescription);
  const strongReport = analyze(strong.resume, strong.jobDescription);
  assert.ok(
    strongReport.score > weakReport.score + 15,
    `expected strong (${strongReport.score}) to beat weak (${weakReport.score}) by a clear margin`
  );
});

test('job-description keywords drive the missing-keyword list', () => {
  const report = analyze(weak.resume, weak.jobDescription);
  assert.equal(report.jobDescription.provided, true);
  assert.ok(report.missingKeywords.length > 5, 'weak resume should miss several keywords');
  const labels = report.missingKeywords.map((k) => k.label.toLowerCase());
  assert.ok(
    labels.includes('typescript') || labels.includes('next.js'),
    `expected frontend keywords, received: ${labels.join(', ')}`
  );
  assert.ok(report.missingKeywords.every((k) => ['high', 'medium', 'low'].includes(k.importance)));
  assert.ok(report.missingKeywords.every((k) => k.placement.length > 10));
});

test('duty-style wording produces rewrite examples, keywords come first', () => {
  const report = analyze(weak.resume, weak.jobDescription);
  assert.ok(report.rewrites.length > 0, 'expected at least one before/after rewrite');
  const keywordSuggestion = report.suggestions.find((s) => s.title.toLowerCase().includes('keyword'));
  assert.ok(keywordSuggestion, 'expected a keyword suggestion');
  assert.equal(keywordSuggestion.priority, 1, 'keyword gaps should be the top priority');
});

test('analyze() without a job description falls back to a role benchmark', () => {
  const report = analyze(strong.resume, '');
  assert.equal(report.jobDescription.provided, false);
  assert.equal(report.jobDescription.matchPercent, null);
  const keywordCategory = report.categories.find((c) => c.key === 'keywords');
  assert.notEqual(keywordCategory.score, null, 'role benchmark should be used when a role can be inferred');
  assert.ok(report.role && report.role.name.length > 3);
});

test('analyze() rejects text that is too short', () => {
  assert.throws(() => analyze('Too short to analyze.', ''), (error) => {
    assert.equal(error.code, 'RESUME_TOO_SHORT');
    assert.equal(error.status, 400);
    return true;
  });
});

test('parseResume() finds sections, contact details and quantified bullets', () => {
  const parsed = parseResume(strong.resume);
  assert.ok(parsed.sections.includes('experience'));
  assert.ok(parsed.sections.includes('education'));
  assert.ok(parsed.sections.includes('skills'));
  assert.equal(parsed.contact.email, 'ayesha.siddiqua@outlook.com');
  assert.ok(parsed.contact.linkedin.includes('linkedin.com'));
  assert.ok(parsed.stats.bullets >= 8, `expected bullets, got ${parsed.stats.bullets}`);
  assert.ok(parsed.stats.quantifiedBullets >= 5, 'quantified bullets should be detected');
  assert.ok(parsed.stats.dateRanges >= 2, 'date ranges should be detected');
});

test('detectRole() and findSkills() recognise the sample domains', () => {
  const role = detectRole(strong.jobDescription);
  assert.ok(role, 'expected a detected role');
  assert.match(role.role, /Data/i);

  const labels = findSkills(strong.resume).map((s) => s.label);
  assert.ok(labels.includes('SQL'));
  assert.ok(labels.includes('Power BI'));
  assert.ok(labels.includes('Python'));
});

test('suggestions are severity-sorted, prioritized and capped', () => {
  const report = analyze(weak.resume, weak.jobDescription);
  assert.ok(report.suggestions.length <= 10);
  const rank = { high: 0, medium: 1, low: 2 };
  const ranks = report.suggestions.map((s) => rank[s.severity]);
  assert.deepEqual(ranks, [...ranks].sort((a, b) => a - b), 'suggestions must be sorted by severity');
  assert.deepEqual(report.suggestions.map((s) => s.priority), report.suggestions.map((_, i) => i + 1));
});

test('the weak sample is flagged for its duty language and missing sections', () => {
  const report = analyze(weak.resume, weak.jobDescription);
  const titles = report.suggestions.map((s) => s.title.toLowerCase()).join(' | ');
  assert.match(titles, /duty-style|quantif/);
  assert.ok(report.score < 72, `weak resume should not score highly, got ${report.score}`);
});
