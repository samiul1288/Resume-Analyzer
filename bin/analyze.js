'use strict';

/**
 * Tiny CLI: analyze a resume file (or stdin) without the browser.
 *
 *   node bin/analyze.js samples/../resume.txt [job.txt]
 *   node bin/analyze.js resume.pdf job.txt
 *   node bin/analyze.js --json resume.docx job.txt > report.json
 */

const fs = require('fs');
const path = require('path');
const { analyze } = require('../src/analyzer');
const { extractText } = require('../src/extract');

async function readText(file) {
  if (!file || file === '-') return fs.readFileSync(0, 'utf8');
  const buffer = fs.readFileSync(file);
  const result = await extractText({ buffer, fileName: path.basename(file) });
  return result.text;
}

async function main() {
  const args = process.argv.slice(2);
  const asJson = args.includes('--json');
  const sampleFlag = args.indexOf('--sample');
  const files = args.filter((a) => !a.startsWith('--') && a !== (args[sampleFlag + 1] || null));

  let resumeText = '';
  let jobText = '';
  let fileName = '';

  if (sampleFlag > -1 && args[sampleFlag + 1]) {
    const samplePath = path.join(__dirname, '..', 'samples', `${args[sampleFlag + 1]}.json`);
    if (!fs.existsSync(samplePath)) {
      console.error(`Unknown sample "${args[sampleFlag + 1]}". Available: ` +
        fs.readdirSync(path.join(__dirname, '..', 'samples')).map((f) => f.replace(/\.json$/, '')).join(', '));
      process.exit(1);
    }
    const sample = JSON.parse(fs.readFileSync(samplePath, 'utf8'));
    resumeText = sample.resume;
    jobText = sample.jobDescription || '';
    fileName = `${args[sampleFlag + 1]}.txt`;
  } else if (files.length) {
    resumeText = await readText(files[0]);
    jobText = files[1] ? await readText(files[1]) : '';
    fileName = path.basename(files[0]);
  } else {
    console.error('Usage: node bin/analyze.js [--json] <resume.(pdf|docx|txt)> [job-description.txt]');
    console.error('       node bin/analyze.js --sample frontend-junior');
    process.exit(1);
  }

  const report = analyze(resumeText, jobText, { fileName });

  if (asJson) {
    process.stdout.write(JSON.stringify(report, null, 2));
    return;
  }

  const line = (char, length) => char.repeat(length);
  console.log('\n' + line('=', 66));
  console.log(` RESUME SCORE: ${report.score}/100 - ${report.grade.label}`);
  console.log(line('=', 66));
  console.log(report.verdict + '\n');

  for (const category of report.categories) {
    const value = category.score === null ? 'n/a' : String(category.score).padStart(3);
    console.log(`  ${value}  (${String(category.weight).padStart(2)}%)  ${category.label}`);
    console.log(`         ${category.evidence}`);
  }

  if (report.missingKeywords.length) {
    console.log('\n MISSING KEYWORDS');
    console.log('  ' + report.missingKeywords.map((k) => k.label).join(', '));
  }

  console.log('\n STRENGTHS');
  for (const strength of report.strengths) console.log(`  + ${strength.title}: ${strength.detail}`);

  console.log('\n ACTION PLAN');
  for (const suggestion of report.suggestions) {
    console.log(`  ${suggestion.priority}. [${suggestion.severity}] ${suggestion.title}`);
    console.log(`     Why: ${suggestion.why}`);
    console.log(`     How: ${suggestion.how}`);
    for (const example of suggestion.examples || []) {
      console.log(`     Before: ${example.before}`);
      console.log(`     After : ${example.after}`);
    }
  }

  console.log('\n ATS CHECKS');
  for (const check of report.ats.checks) {
    console.log(`  ${check.pass ? '[pass]' : '[FAIL]'} ${check.label} - ${check.detail}`);
  }
  console.log('');
}

main().catch((error) => {
  console.error('Analysis failed:', error.message);
  process.exit(1);
});
