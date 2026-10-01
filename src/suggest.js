'use strict';

/**
 * Prioritized, actionable suggestions. Every item says what to change,
 * why it matters and how to do it - with sample rewrites where useful.
 */

const { improveBullet } = require('./narrative');

const severityRank = (s) => (s === 'high' ? 0 : s === 'medium' ? 1 : 2);

function buildSuggestions(parsed, jd, categories) {
  const byKey = Object.fromEntries(categories.map((c) => [c.key, c]));
  const { stats } = parsed;
  const items = [];
  const add = (severity, title, why, how, extra = {}) => {
    items.push({ severity, title, why, how, ...extra });
  };

  // 1. Missing job-description keywords
  if (jd.provided && jd.missing.length > 0 && byKey.keywords.score < 85) {
    const high = jd.missing.filter((k) => k.weight === 3).map((k) => k.label);
    const rest = jd.missing.filter((k) => k.weight !== 3).map((k) => k.label);
    add(
      jd.missing.length > 6 ? 'high' : 'medium',
      `Add ${Math.min(jd.missing.length, 12)} missing keywords from the job description`,
      `Your resume covers ${jd.matched.length}/${jd.keywords.length} of the posting's keywords. ATS filters and recruiters both rank on these exact terms.`,
      [
        high.length ? `Priority terms: ${high.slice(0, 8).join(', ')}.` : null,
        rest.length ? `Also valuable: ${rest.slice(0, 8).join(', ')}.` : null,
        'Mirror the posting\'s wording (e.g. "REST API", not "web services") and place each term where it is genuinely true.'
      ].filter(Boolean).join(' '),
      { keywords: [...high, ...rest].slice(0, 12) }
    );
  }

  // 2. Thin job description
  if (jd.thin) {
    add('low', 'The job description contained few recognizable keywords',
      'Only a handful of standard industry terms were found, so the match score is less reliable.',
      'Paste the full posting, including the requirements section, for a more accurate score.');
  }

  // 3. Role mismatch
  if (jd.provided && jd.role && jd.role.source === 'job-description' && stats.bullets > 0) {
    const mustHave = jd.roleMustHave;
    if (mustHave && mustHave.ratio < 0.5) {
      const total = mustHave.present.length + mustHave.missing.length;
      add('high', `Reposition the resume for the "${jd.role.role}" role`,
        `The posting targets ${jd.role.role}, but only ${mustHave.present.length} of ${total} core keywords for that role are present.`,
        `Name the target role in your headline and summary, then work these in: ${mustHave.missing.slice(0, 8).join(', ')}.`);
    }
  }

  // 4. Quantification
  if (byKey.impact.score < 75) {
    const state = stats.bullets > 0
      ? `${stats.quantifiedBullets} of ${stats.bullets} bullets`
      : 'no recognizable bullet points';
    add(byKey.impact.score < 50 ? 'high' : 'medium', 'Quantify your achievements with numbers',
      `${state} include a measurable result. Metrics are the fastest way to move from "duties" to "achievements".`,
      'For each bullet ask: how many, how much, how often, or how much faster? Add team size, user counts, revenue, percentages, hours saved or error rates.',
      { examples: parsed.plainBullets.slice(0, 3).map(improveBullet).filter(Boolean) });
  }

  // 5. Weak / duty-style phrasing
  if (parsed.weakPhraseHits.length > 0) {
    add('medium', `Replace ${parsed.weakPhraseHits.length} duty-style phrase(s)`,
      `Phrases such as "${parsed.weakPhraseHits[0].phrase}" describe what you were told to do, not what you achieved.`,
      'Open every bullet with a strong past-tense verb (Led, Built, Reduced, Automated, Negotiated) and keep the outcome first.',
      {
        examples: parsed.bullets
          .filter((b) => parsed.weakPhraseHits.some((h) => b.toLowerCase().includes(h.phrase)))
          .slice(0, 3)
          .map(improveBullet)
          .filter(Boolean)
      });
  }

  // 6. Missing sections / contact fields
  if (byKey.structure.items) {
    const missing = byKey.structure.items.filter((i) => !i.ok).map((i) => i.label);
    const contactMissing = missing.filter((m) => /Name|Email|Phone|LinkedIn/.test(m));
    const sectionMissing = missing.filter((m) => /section|Summary|Projects|certifications/i.test(m));
    const otherMissing = missing.filter((m) => !contactMissing.includes(m) && !sectionMissing.includes(m));

    if (contactMissing.length) {
      add('high', `Complete the contact block (${contactMissing.join(', ')})`,
        'ATS parsers and recruiters both need to reach you from the top of page one.',
        'Put name, target job title, phone, email and LinkedIn (plus portfolio/GitHub if relevant) in one header line.');
    }
    if (sectionMissing.length) {
      add(sectionMissing.length > 2 ? 'high' : 'medium', `Add the missing section(s): ${sectionMissing.join(', ')}`,
        'Standard headings let ATS parsers and human scanners find your information quickly.',
        'Use plain headings on their own lines, ordered: Summary, Skills, Experience, Projects, Education, Certifications.');
    }
    if (otherMissing.length) {
      add('medium', `Fix the resume basics: ${otherMissing.join(', ')}`,
        'These are the checks recruiters make in the first five seconds.',
        'Add a date range (e.g. "Jan 2024 - Present") to every role and keep the resume to 1-2 pages of relevant content.');
    }
  }

  // 7. Readability and length
  if (byKey.readability.score < 85) {
    const fixes = [];
    if (stats.longBullets > 0) fixes.push(`split or trim the ${stats.longBullets} bullet(s) over 30 words`);
    if (stats.avgBulletWords > 26) fixes.push('bring the average bullet down to 10-22 words');
    if (stats.firstPersonHits > 0) fixes.push('remove first-person pronouns ("I led" becomes "Led")');
    if (stats.passiveHits > 0) fixes.push('rewrite passive sentences in active voice');
    if (stats.words < 250) fixes.push(`expand from ${stats.words} words - add more evidence`);
    if (stats.words > 1100) fixes.push(`trim from ${stats.words} words (~${stats.estimatedPages} pages) to 2 pages`);
    if (fixes.length) {
      add(byKey.readability.score < 65 ? 'medium' : 'low', 'Tighten phrasing and length',
        byKey.readability.evidence,
        `Action: ${fixes.join('; ')}.`);
    }
  }

  // 8. Buzzwords
  if (parsed.buzzwordHits.length >= 2) {
    add('low', `Cut ${parsed.buzzwordHits.length} empty buzzwords`,
      `Clichés such as "${parsed.buzzwordHits[0].phrase}" use space without proving anything.`,
      'Delete each one or replace it with a concrete fact: what you built, for whom, and with what result.');
  }

  // 9. Not enough bullets
  if (stats.bullets < 5) {
    add('high', 'Use 3-5 achievement bullets per role',
      `Only ${stats.bullets} bullet point(s) were detected, so most of your experience is unexplained.`,
      'For every role write 3-5 bullets shaped as: strong verb + what you did + how + measurable result, each under 25 words.');
  }

  return items
    .sort((a, b) => severityRank(a.severity) - severityRank(b.severity))
    .slice(0, 10)
    .map((item, index) => ({ ...item, priority: index + 1 }));
}

module.exports = { buildSuggestions };
