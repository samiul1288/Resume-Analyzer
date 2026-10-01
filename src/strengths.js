'use strict';

/**
 * Evidence-based strengths: a point is only listed when the underlying
 * signal is genuinely strong, so the list stays trustworthy.
 */

function buildStrengths(parsed, jd, categories) {
  const byKey = Object.fromEntries(categories.map((c) => [c.key, c]));
  const { stats } = parsed;
  const out = [];

  if (jd.provided && byKey.keywords.score >= 75) {
    out.push({
      title: `Strong job-description alignment (${jd.matchPercent}% of keywords)`,
      detail: `${jd.matched.length} of the ${jd.keywords.length} priority keywords from the job post appear in your resume, including ${jd.matched.slice(0, 5).map((k) => k.label).join(', ')}.`
    });
  }
  if (!jd.provided && byKey.keywords.score >= 75 && jd.role) {
    out.push({
      title: `Must-have keywords for a ${jd.role.role} are covered`,
      detail: `The resume reads like a ${jd.role.role} profile and matches ${byKey.keywords.score}% of the core keyword set for that role.`
    });
  }
  if (byKey.impact.score >= 70 && stats.bullets > 0) {
    const sample = parsed.quantified[0];
    out.push({
      title: `Achievements are quantified (${stats.quantifiedBullets}/${stats.bullets} bullets)`,
      detail: sample
        ? `Numbers, percentages or money amounts appear in most bullets, e.g. "${sample.slice(0, 140)}".`
        : 'Most bullets carry a measurable result.'
    });
  }
  if (byKey.actionVerbs.score >= 80 && stats.bullets > 0) {
    out.push({
      title: `Bullets lead with strong action verbs (${stats.actionVerbBullets}/${stats.bullets})`,
      detail: 'Recruiters can scan what you did in seconds, and parsers read leading verbs as achievements rather than duties.'
    });
  }
  if (byKey.structure.score >= 85) {
    out.push({
      title: 'Complete, ATS-friendly structure',
      detail: `Found ${parsed.sections.length} standard sections, complete contact details and dated roles.`
    });
  } else if (byKey.structure.score >= 70) {
    out.push({ title: 'Solid overall structure', detail: byKey.structure.evidence });
  }
  if (byKey.breadth.score >= 70) {
    const top = parsed.hardSkills.slice(0, 6).map((s) => s.label).join(', ');
    out.push({
      title: `Broad, relevant skill set (${parsed.hardSkills.length} skills)`,
      detail: `Highlights include ${top}.`
    });
  }
  if (byKey.readability.score >= 90) {
    out.push({ title: 'Clean, concise writing', detail: byKey.readability.evidence });
  }
  if (out.length === 0) {
    const skills = parsed.hardSkills.slice(0, 5).map((s) => s.label).join(', ');
    out.push({
      title: 'Real content to build on',
      detail: skills
        ? `The resume already mentions relevant skills (${skills}), so the fixes below are mostly about evidence and framing.`
        : 'The text was read successfully - the fixes below are about adding structure and evidence.'
    });
  }
  return out;
}

module.exports = { buildStrengths };
