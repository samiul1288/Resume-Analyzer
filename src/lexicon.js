'use strict';

/**
 * Language-level knowledge used by the analyzer:
 * strong action verbs, weak/passive phrases, filler buzzwords and
 * the heading patterns used to split a resume into sections.
 */

// Verbs that make a bullet sound like an achievement instead of a duty.
const ACTION_VERBS = [
  'accelerated', 'achieved', 'acquired', 'administered', 'advised', 'analyzed', 'architected',
  'assembled', 'assessed', 'audited', 'automated', 'benchmarked', 'boosted', 'budgeted',
  'built', 'captured', 'centralized', 'championed', 'coached', 'collaborated', 'compiled',
  'completed', 'composed', 'configured', 'consolidated', 'constructed', 'converted', 'coordinated',
  'created', 'cut', 'defined', 'delivered', 'deployed', 'designed', 'detected', 'developed',
  'devised', 'diagnosed', 'directed', 'documented', 'doubled', 'drove', 'earned', 'eliminated',
  'enabled', 'engineered', 'enhanced', 'ensured', 'established', 'evaluated', 'exceeded',
  'executed', 'expanded', 'expedited', 'facilitated', 'forecasted', 'formulated',
  'founded', 'generated', 'grew', 'guided', 'halved', 'headed', 'identified', 'implemented',
  'improved', 'increased', 'influenced', 'initiated', 'innovated', 'inspected', 'installed',
  'instituted', 'integrated', 'introduced', 'invented', 'investigated', 'launched', 'led',
  'leveraged', 'localized', 'maintained', 'managed', 'marketed', 'maximized', 'measured',
  'mentored', 'migrated', 'minimized', 'modernized', 'monitored', 'motivated',
  'negotiated', 'onboarded', 'operated', 'optimized', 'orchestrated', 'organized',
  'overhauled', 'oversaw', 'partnered', 'performed', 'pioneered', 'planned', 'presented',
  'prioritized', 'produced', 'programmed', 'promoted', 'prototyped', 'provided',
  'published', 'quantified', 'raised', 'rebuilt', 'recruited', 'redesigned', 'reduced',
  'refactored', 'refined', 'released', 'researched', 'resolved', 'restructured',
  'revamped', 'reviewed', 'saved', 'scaled', 'scheduled', 'scoped', 'secured',
  'segmented', 'shipped', 'simplified', 'solved', 'sourced', 'spearheaded', 'standardized',
  'steered', 'streamlined', 'strengthened', 'structured', 'supervised', 'supported', 'surpassed',
  'sustained', 'tested', 'tracked', 'trained', 'transformed', 'translated',
  'trimmed', 'troubleshot', 'unified', 'upgraded', 'validated', 'verified', 'visualized', 'won'
];

// Duty-shaped wording: fine in a job description, weak in a resume bullet.
const WEAK_PHRASES = [
  'responsible for', 'duties included', 'tasked with',
  'worked on', 'worked with', 'helped with', 'helped to', 'assisted with', 'assisted in',
  'involved in', 'participated in', 'was responsible', 'in charge of', 'handled',
  'exposure to', 'familiar with', 'knowledge of', 'various tasks',
  'other duties as assigned', 'part of a team that', 'excellent communication skills',
  'hard worker', 'hardworking', 'team player', 'self-starter', 'go-getter', 'people person',
  'think outside the box', 'results-driven', 'dynamic professional', 'guru', 'ninja', 'rockstar',
  'references available upon request', 'available upon request',
  'seeking a challenging position', 'career objective', 'proven track record',
  'detail oriented', 'detail-oriented', 'works well under pressure', 'multitasker'
];

// Filler that costs space without adding evidence.
const BUZZWORDS = [
  'synergy', 'synergies', 'cutting-edge', 'world-class', 'best-in-class',
  'state of the art', 'state-of-the-art', 'revolutionary', 'game changer', 'game-changer',
  'passionate about', 'highly motivated', 'goal-oriented', 'proactive', 'creative thinker',
  'excellent interpersonal skills', 'strong communication skills', 'excellent written and verbal',
  'ability to work independently', 'wear many hats', 'hit the ground running',
  'bleeding edge', 'mission-critical', 'next-generation', 'paradigm shift'
];

// Heading aliases -> canonical section keys. Used to split resume text into blocks.
const SECTION_PATTERNS = [
  { key: 'contact',     rx: /^(contact|contact info|contact information|contact details|personal details)\b/i },
  { key: 'summary',     rx: /^(summary|professional summary|career summary|profile|professional profile|about me|objective|career objective|overview)\b/i },
  { key: 'experience',  rx: /^(work experience|professional experience|experience|employment history|employment|work history|career history|relevant experience|professional background)\b/i },
  { key: 'education',   rx: /^(education|academic background|academic qualifications|qualifications|educational background|academics)\b/i },
  { key: 'skills',      rx: /^(skills|technical skills|core skills|core competencies|key skills|technologies|tech stack|technical proficiencies|areas of expertise|competencies)\b/i },
  { key: 'projects',    rx: /^(projects|project|personal projects|key projects|academic projects|selected projects|portfolio)\b/i },
  { key: 'certifications', rx: /^(certifications|certification|licenses and certifications|licenses|courses|training|professional development|achievements|awards|honors)\b/i },
  { key: 'volunteer',   rx: /^(volunteer experience|volunteer work|volunteer|community service|extracurricular activities|extracurricular|activities|leadership activities)\b/i },
  { key: 'publications',rx: /^(publications|publication|research|research experience|patents|conference papers|conference talks)\b/i },
  { key: 'languages',   rx: /^(languages|language proficiency)\b/i },
  { key: 'interests',   rx: /^(interests|hobbies|interests and hobbies|hobbies and interests)\b/i },
  { key: 'references',  rx: /^(references|referees)\b/i }
];

module.exports = {
  ACTION_VERBS,
  WEAK_PHRASES,
  BUZZWORDS,
  SECTION_PATTERNS
};
