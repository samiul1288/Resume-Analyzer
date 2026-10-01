'use strict';

/**
 * Narrative layer: turns raw signals into strengths, prioritized suggestions,
 * sample rewrites and ATS checks. Also analyzes the optional job description.
 */

const { normalize, wordCount, countTerm } = require('./text');
const { detectRole, rankJobKeywords, mustHaveCoverage } = require('./dictionary');
const { METRIC_RX } = require('./parse');

/** Parse the (optional) job description into comparable keywords. */
function analyzeJob(jobText, parsed) {
  const text = normalize(jobText || '');
  const provided = wordCount(text) >= 25;
  const roleFromJd = detectRole(text);
  const role = roleFromJd || detectRole(parsed.text);
  const keywords = provided ? rankJobKeywords(text, parsed.text).slice(0, 45) : [];
  const matched = keywords.filter((k) => k.inResume);
  const missing = keywords.filter((k) => !k.inResume);

  return {
    provided,
    wordCount: wordCount(text),
    role: role
      ? {
        role: role.role,
        confidence: role.confidence,
        profile: role.profile,
        source: roleFromJd ? 'job-description' : 'resume'
      }
      : null,
    keywords,
    matched,
    missing,
    matchPercent: keywords.length ? Math.round((matched.length / keywords.length) * 100) : null,
    priorityTotal: keywords.reduce((sum, k) => sum + k.priority, 0),
    roleMustHave: provided && roleFromJd ? mustHaveCoverage(text, roleFromJd.profile.mustHave) : null,
    thin: provided && keywords.length < 6
  };
}

/** Gerund -> past tense for the most common resume openings. */
const PAST_TENSE = {
  managing: 'Managed', leading: 'Led', building: 'Built', developing: 'Developed',
  creating: 'Created', designing: 'Designed', testing: 'Tested', maintaining: 'Maintained',
  monitoring: 'Monitored', handling: 'Handled', supporting: 'Supported', coordinating: 'Coordinated',
  implementing: 'Implemented', planning: 'Planned', writing: 'Wrote', teaching: 'Taught',
  training: 'Trained', analyzing: 'Analyzed', researching: 'Researched', organizing: 'Organized',
  updating: 'Updated', improving: 'Improved', optimizing: 'Optimized', automating: 'Automated',
  deploying: 'Deployed', migrating: 'Migrated', mentoring: 'Mentored', collaborating: 'Collaborated',
  presenting: 'Presented', reporting: 'Reported', troubleshooting: 'Troubleshot',
  reviewing: 'Reviewed', documenting: 'Documented', executing: 'Executed', delivering: 'Delivered',
  assisting: 'Assisted', ensuring: 'Ensured', coding: 'Coded', programming: 'Programmed',
  configuring: 'Configured', installing: 'Installed', scheduling: 'Scheduled', tracking: 'Tracked',
  recruiting: 'Recruited', onboarding: 'Onboarded', budgeting: 'Budgeted', forecasting: 'Forecasted',
  fixing: 'Fixed', resolving: 'Resolved', scaling: 'Scaled', shipping: 'Shipped', owning: 'Owned',
  supervising: 'Supervised', interviewing: 'Interviewed', tutoring: 'Tutored'
};

const WEAK_OPENERS = /^(?:responsible for|duties included(?: but not limited to)?|tasked with|worked on|worked with|worked as|worked to|helped (?:with|to)|helped (?:the |a |an )?[a-z]+ (?:with|to|in)|assisted (?:with|in)|assisted (?:the |a |an )?[a-z]+ (?:with|to|in)|involved in|participated in|in charge of|handled|part of a team that|responsible to)\s+/i;

/** Guess a strong verb for a bullet whose own opening is a gerund. */
function verbForContext(sentence) {
  const s = sentence.toLowerCase();
  if (/\b(team|junior|intern|mentor|code review|prs?)\b/.test(s)) return 'Mentored';
  if (/\b(test|bug|qa|quality|regression)\b/.test(s)) return 'Tested';
  if (/\b(data|report|dashboard|analytic|metric|insight)\b/.test(s)) return 'Analyzed';
  if (/\b(deploy|pipeline|server|cloud|infra|docker|kubernetes)\b/.test(s)) return 'Deployed';
  if (/\b(customer|client|user|stakeholder|support)\b/.test(s)) return 'Supported';
  if (/\b(design|ui|ux|wireframe|mockup|figma)\b/.test(s)) return 'Designed';
  if (/\b(process|workflow|efficien|cost|time|productivity)\b/.test(s)) return 'Improved';
  return 'Delivered';
}

/** Generic gerund -> past-tense conversion, used when the verb map has no entry. */
function gerundToPast(word) {
  const lower = word.toLowerCase();
  if (PAST_TENSE[lower]) return PAST_TENSE[lower];
  if (!/ing$/.test(lower) || lower.length < 5) return null;

  let stem = lower.slice(0, -3);
  if (/([bdgklmnprtz])\1$/.test(stem)) stem = stem.slice(0, -1); // plan|n -> plan
  if (/[^aeiou]$/.test(stem) && !/[aeiou]/.test(stem.slice(-3, -1))) stem += stem.slice(-1); // run -> runn
  const past = `${stem}ed`;
  return past.charAt(0).toUpperCase() + past.slice(1);
}

/** Produce an improved version of a weak bullet, with a reason. */
function improveBullet(bullet) {
  const original = bullet.trim();
  let body = original.replace(WEAK_OPENERS, '').trim().replace(/[.;]+$/, '');
  if (!body) return null;

  const firstWord = (body.match(/^[A-Za-z-]+/) || [''])[0];
  const lowerFirst = firstWord.toLowerCase();
  const startsWithPastVerb = /^[a-z-]+(ed|ted|led|built|made|won|ran|wrote|grew|cut|set|shipped|sold|spoke|taught|oversaw)\b/i.test(body);
  const needsVerb = !startsWithPastVerb || /ing$/i.test(lowerFirst);

  if (needsVerb) {
    const converted = PAST_TENSE[lowerFirst] || gerundToPast(lowerFirst);
    body = converted
      ? `${converted}${body.slice(firstWord.length)}`
      : `${verbForContext(body)} ${body}`;
  }

  // Keep the rest of the list consistent: "and fixing" -> "and fixed".
  body = body.replace(/\b(and|then)\s+([a-z]+ing)\b/g, (match, joiner, gerund) => {
    const converted = PAST_TENSE[gerund] || gerundToPast(gerund);
    return converted ? `${joiner} ${converted.toLowerCase()}` : match;
  });

  let improved = body.charAt(0).toUpperCase() + body.slice(1);
  const hasNumber = METRIC_RX.test(improved);
  if (!hasNumber) {
    improved += ' [add the real number: how many, how much, or how much faster - e.g. "cutting release time 40%"]';
  }

  return {
    before: original,
    after: improved,
    reason: needsVerb
      ? 'Replaced the duty/passive opening with a strong verb so the achievement leads.'
      : 'Tightened the opening so the achievement leads.'
  };
}

/** ATS / screening checks: the pass-fail list shown in the report. */
function atsChecks(parsed, options = {}) {
  const checks = [];
  const add = (label, pass, detail) => checks.push({ label, pass: Boolean(pass), detail });
  const { contact, stats, text, sections } = parsed;

  add('Email address readable by ATS', Boolean(contact.email),
    contact.email ? `Found ${contact.email}.` : 'No email address detected - parsers count this as a miss.');
  add('Phone number present', Boolean(contact.phone),
    contact.phone ? `Found ${contact.phone}.` : 'Add a phone number in the header.');
  add('LinkedIn / portfolio link', Boolean(contact.linkedin || contact.portfolio),
    contact.linkedin || contact.portfolio || 'Add a LinkedIn URL or portfolio link.');
  add('Standard section headings', sections.length >= 3,
    sections.length ? `Detected: ${sections.join(', ')}.` : 'Use standard headings such as EXPERIENCE, EDUCATION, SKILLS.');
  add('Machine-readable text (no images or columns)', stats.noiseChars === 0 && !/\|{2,}/.test(text),
    stats.noiseChars ? `${stats.noiseChars} unreadable character(s) - export a text-based PDF.` : 'Text extracts cleanly.');
  add('Dates on roles', stats.dateRanges >= 2 || stats.yearsFound >= 2,
    `${stats.dateRanges} date range(s) and ${stats.yearsFound} year reference(s) detected.`);
  add('No first-person pronouns', stats.firstPersonHits === 0,
    stats.firstPersonHits ? `${stats.firstPersonHits} first-person word(s) such as "I" or "my".` : 'Written in implied third person.');
  add('Length fits 1-2 pages', stats.words <= 1100 && stats.words >= 250,
    `${stats.words} words (~${stats.estimatedPages} page(s)).`);
  add('No "references available" filler', countTerm(text, 'references available') === 0,
    'Recruiters assume references are available - drop that line to save space.');
  if (options.fileName) {
    add('File name looks professional',
      /(resume|cv)/i.test(options.fileName) && !/(final|draft|copy|v\d|updated)/i.test(options.fileName),
      `"${options.fileName}" - prefer Firstname_Lastname_Resume.pdf.`);
  }
  return checks;
}

module.exports = { analyzeJob, improveBullet, atsChecks, verbForContext, PAST_TENSE, WEAK_OPENERS };
