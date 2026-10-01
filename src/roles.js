'use strict';

/**
 * Role profiles: used when no job description is supplied (and to sanity-check
 * one). Each profile names the skill groups that matter most, plus a short list
 * of "must-have" keywords recruiters usually scan for first.
 */

const ROLE_PROFILES = {
  'Frontend Developer': {
    match: ['frontend', 'front-end', 'react', 'vue', 'angular', 'ui developer', 'web developer', 'next.js', 'javascript developer', 'web ui'],
    categories: ['Programming Languages', 'Frontend', 'Testing & QA', 'Cloud & DevOps', 'Soft Skills'],
    mustHave: ['JavaScript', 'React', 'TypeScript', 'HTML', 'CSS', 'REST API', 'Git', 'Responsive Design']
  },
  'Backend Developer': {
    match: ['backend', 'back-end', 'api developer', 'node developer', 'django', 'spring boot', 'server side', 'microservice'],
    categories: ['Programming Languages', 'Backend', 'Databases', 'Cloud & DevOps', 'Testing & QA'],
    mustHave: ['Node.js', 'SQL', 'MongoDB', 'Docker', 'REST API', 'Microservices', 'Redis', 'AWS', 'Git']
  },
  'Full Stack Developer': {
    match: ['full stack', 'fullstack', 'full-stack', 'mern', 'mean stack', 'web application developer'],
    categories: ['Programming Languages', 'Frontend', 'Backend', 'Databases', 'Cloud & DevOps'],
    mustHave: ['JavaScript', 'React', 'Node.js', 'MongoDB', 'SQL', 'REST API', 'Docker', 'Git', 'AWS']
  },
  'Mobile Developer': {
    match: ['android', 'ios', 'flutter', 'react native', 'mobile developer', 'mobile engineer', 'kotlin developer'],
    categories: ['Programming Languages', 'Mobile', 'Backend', 'Testing & QA', 'Cloud & DevOps'],
    mustHave: ['Flutter', 'React Native', 'Android', 'iOS', 'Kotlin', 'Swift', 'Firebase', 'REST API']
  },
  'Data Analyst': {
    match: ['data analyst', 'bi analyst', 'reporting analyst', 'analytics', 'business intelligence'],
    categories: ['Data & Analytics', 'Databases', 'Programming Languages', 'Business, Marketing & Finance'],
    mustHave: ['SQL', 'Excel', 'Power BI', 'Tableau', 'Python', 'Dashboard', 'Data Visualization', 'KPI']
  },
  'Data Scientist / ML': {
    match: ['data scientist', 'machine learning', 'ml engineer', 'ai engineer', 'deep learning', 'nlp engineer', 'generative ai'],
    categories: ['AI & Machine Learning', 'Data & Analytics', 'Programming Languages', 'Cloud & DevOps'],
    mustHave: ['Python', 'Pandas', 'Scikit-learn', 'TensorFlow', 'PyTorch', 'SQL', 'Statistical Analysis', 'Deep Learning']
  },
  'DevOps Engineer': {
    match: ['devops', 'sre', 'site reliability', 'platform engineer', 'cloud engineer', 'infrastructure engineer'],
    categories: ['Cloud & DevOps', 'Programming Languages', 'Databases', 'Testing & QA'],
    mustHave: ['Docker', 'Kubernetes', 'AWS', 'Terraform', 'CI/CD', 'Linux', 'Jenkins', 'Monitoring', 'Git']
  },
  'QA Engineer': {
    match: ['qa engineer', 'quality assurance', 'test engineer', 'sdet', 'automation tester', 'manual tester', 'software tester'],
    categories: ['Testing & QA', 'Programming Languages', 'Frontend', 'Backend'],
    mustHave: ['Selenium', 'Test Automation', 'Manual Testing', 'Jira', 'Test Cases', 'Cypress', 'REST API', 'SQL']
  },
  'Product Manager': {
    match: ['product manager', 'product owner', 'program manager', 'product lead', 'associate product'],
    categories: ['Product & Project', 'Data & Analytics', 'Business, Marketing & Finance', 'Soft Skills'],
    mustHave: ['Agile', 'Roadmap', 'User Stories', 'Stakeholder Management', 'A/B Testing', 'Jira', 'Product Analytics', 'OKR']
  },
  'UI/UX Designer': {
    match: ['ui designer', 'ux designer', 'ui/ux', 'ui ', 'ux ', 'product designer', 'graphic designer', 'visual designer'],
    categories: ['Design', 'Frontend', 'Soft Skills', 'Product & Project'],
    mustHave: ['Figma', 'Wireframes', 'Prototyping', 'User Research', 'Design System', 'Usability Testing', 'Accessibility']
  },
  'Digital Marketer': {
    match: ['marketing', 'seo', 'content writer', 'social media manager', 'growth', 'digital marketing'],
    categories: ['Business, Marketing & Finance', 'Data & Analytics', 'Design', 'Soft Skills'],
    mustHave: ['SEO', 'Content Marketing', 'Google Analytics', 'Google Ads', 'Email Marketing', 'Social Media Marketing', 'CRM']
  },
  'Business Analyst': {
    match: ['business analyst', 'systems analyst', 'functional analyst', 'process analyst', 'business analysis'],
    categories: ['Product & Project', 'Data & Analytics', 'Business, Marketing & Finance', 'Soft Skills'],
    mustHave: ['Requirement Gathering', 'SQL', 'Agile', 'Stakeholder Management', 'Documentation', 'Process Improvement', 'Excel']
  },
  'HR / Recruiter': {
    match: ['human resources', 'recruiter', 'talent acquisition', 'hr generalist', 'hr manager', 'people operations'],
    categories: ['Business, Marketing & Finance', 'Soft Skills', 'Product & Project'],
    mustHave: ['Recruiting', 'Onboarding', 'HRIS', 'Employee Engagement', 'Performance Management', 'Labor Law', 'Payroll']
  },
  'Finance / Accounting': {
    match: ['accountant', 'finance', 'audit', 'tax', 'financial analyst', 'bookkeeper', 'accounting'],
    categories: ['Business, Marketing & Finance', 'Data & Analytics', 'Soft Skills'],
    mustHave: ['Accounting', 'Financial Analysis', 'Excel', 'Budgeting', 'Audit', 'Taxation', 'Forecasting', 'QuickBooks']
  },
  'Student / Entry Level': {
    match: ['intern', 'internship', 'entry level', 'junior', 'graduate', 'fresh graduate', 'trainee', 'no experience'],
    categories: ['Programming Languages', 'Frontend', 'Backend', 'Soft Skills', 'Product & Project'],
    mustHave: ['Projects', 'Git', 'Teamwork', 'Problem Solving', 'Communication', 'Portfolio', 'Training']
  }
};

module.exports = { ROLE_PROFILES };
