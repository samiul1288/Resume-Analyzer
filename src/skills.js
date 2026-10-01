'use strict';

/**
 * Skill/technology dictionary used for keyword matching.
 *
 * Term syntax: "Primary|alias 1;alias 2" so the matcher accepts common spellings
 * ("Node.js" / "nodejs" / "node js").
 *
 * Each group has a `weight` (1-3). Core technical groups weigh more, because
 * recruiters and ATS filters treat them as hard requirements far more often
 * than they treat soft-skill or tooling keywords.
 */

const SKILL_GROUPS = {
  'Programming Languages': {
    weight: 3,
    terms: [
      'JavaScript|JS;ES6;ECMAScript', 'TypeScript|TS', 'Python', 'Java', 'C++|CPP', 'C#|CSharp;C Sharp',
      'C', 'Go|Golang', 'Rust', 'PHP', 'Ruby', 'Kotlin', 'Swift', 'Dart', 'Scala', 'R',
      'MATLAB', 'Perl', 'Lua', 'Objective-C|Objective C', 'VB.NET|Visual Basic', 'Solidity'
    ]
  },
  'Frontend': {
    weight: 3,
    terms: [
      'HTML|HTML5', 'CSS|CSS3', 'Sass|SCSS', 'Less', 'Tailwind CSS|Tailwind', 'Bootstrap',
      'Material UI|MUI', 'Chakra UI', 'React|React.js;ReactJS', 'Next.js|NextJS;Next js',
      'Redux|Redux Toolkit', 'Zustand', 'Vue|Vue.js;VueJS', 'Nuxt', 'Angular', 'Svelte|SvelteKit',
      'jQuery', 'Webpack', 'Vite', 'Babel', 'ESLint', 'Prettier', 'Responsive Design',
      'Accessibility|a11y;WCAG', 'Adobe XD', 'Wireframes|Wireframing;Wireframe',
      'Storybook', 'CSS Grid', 'Flexbox', 'DOM', 'PWA|Progressive Web App', 'SEO', 'AJAX|Ajax',
      'WebSockets|WebSocket', 'Framer Motion', 'Component Library', 'Design System',
      'Single Page Application|SPA', 'Cross-Browser Compatibility', 'Animation'
    ]
  },
  'Backend': {
    weight: 3,
    terms: [
      'Node.js|NodeJS;Node js;Node', 'Express|Express.js;ExpressJS', 'NestJS|Nest.js', 'Fastify',
      'Koa', 'Django', 'Flask', 'FastAPI', 'Spring Boot', 'Spring', 'Laravel', 'Ruby on Rails|Rails',
      '.NET|Dotnet', 'ASP.NET|ASP.NET Core', 'Entity Framework', 'Hibernate', 'JPA', 'Microservices',
      'REST API|RESTful;REST APIs;REST', 'GraphQL', 'gRPC', 'Message Queue', 'RabbitMQ', 'Kafka',
      'OAuth|OAuth2', 'JWT|JSON Web Token', 'Authentication', 'Authorization', 'API Design',
      'Middleware', 'MVC', 'Serverless', 'Event-Driven Architecture', 'Rate Limiting', 'Caching',
      'Background Jobs', 'Cron Jobs', 'Socket.IO', 'WebRTC', 'Stripe', 'Payment Gateway',
      'Third-Party API Integration|API Integration', 'System Design', 'Scalability', 'Concurrency'
    ]
  },
  'Databases': {
    weight: 2,
    terms: [
      'SQL', 'MySQL', 'PostgreSQL|Postgres', 'SQLite', 'Oracle', 'SQL Server|MSSQL', 'MongoDB',
      'Mongoose', 'DynamoDB', 'Cassandra', 'Redis', 'Neo4j', 'Firebase|Firestore', 'Supabase',
      'Prisma', 'Sequelize', 'TypeORM', 'Database Design', 'Normalization', 'Indexing',
      'Query Optimization', 'Stored Procedures', 'ETL', 'Data Warehouse', 'Snowflake', 'BigQuery',
      'Redshift', 'ORM'
    ]
  },
  'Data & Analytics': {
    weight: 3,
    terms: [
      'Pandas', 'NumPy', 'SciPy', 'Matplotlib', 'Seaborn', 'Plotly', 'Power BI', 'Tableau', 'Looker',
      'Excel|Microsoft Excel;MS Excel', 'Google Analytics', 'A/B Testing|AB Testing',
      'Statistical Analysis', 'Hypothesis Testing', 'Regression', 'Forecasting', 'Data Cleaning',
      'Data Visualization', 'Data Mining', 'Exploratory Data Analysis|EDA', 'KPI', 'Dashboard',
      'Cohort Analysis', 'Segmentation', 'Time Series Analysis', 'Classification', 'Clustering',
      'Decision Trees', 'Random Forest', 'XGBoost', 'Feature Engineering', 'Data Modeling',
      'Data Pipeline', 'Airflow', 'Spark|Apache Spark', 'Hadoop', 'dbt', 'Reporting'
    ]
  },
  'AI & Machine Learning': {
    weight: 3,
    terms: [
      'TensorFlow', 'PyTorch', 'Keras', 'Scikit-learn|sklearn', 'Hugging Face', 'Transformers',
      'LangChain', 'OpenAI API|OpenAI', 'LLM|Large Language Model', 'Prompt Engineering', 'RAG',
      'Vector Database', 'Pinecone', 'FAISS', 'NLP|Natural Language Processing', 'Computer Vision',
      'OpenCV', 'Deep Learning', 'Neural Networks', 'Reinforcement Learning', 'MLOps',
      'Model Deployment', 'Fine-Tuning', 'Embeddings', 'Generative AI|GenAI', 'Speech Recognition',
      'Recommendation System', 'MLflow', 'Amazon SageMaker|SageMaker'
    ]
  },
  'Cloud & DevOps': {
    weight: 3,
    terms: [
      'AWS|Amazon Web Services', 'EC2', 'S3', 'Lambda|AWS Lambda', 'Azure|Microsoft Azure',
      'GCP|Google Cloud;Google Cloud Platform', 'Docker', 'Kubernetes|k8s', 'Helm', 'Terraform',
      'Ansible', 'Jenkins', 'GitHub Actions', 'GitLab CI', 'CircleCI', 'CI/CD|CICD', 'Linux',
      'Shell Scripting|Bash Scripting;Bash', 'Nginx', 'Apache', 'Prometheus', 'Grafana', 'Datadog',
      'CloudWatch', 'ELK Stack|Elasticsearch', 'Logging', 'Monitoring', 'Infrastructure as Code|IaC',
      'Load Balancing', 'Auto Scaling', 'VPC', 'IAM', 'Vercel', 'Netlify', 'Heroku',
      'Virtualization', 'Containerization', 'Blue-Green Deployment', 'Git|GitHub;GitLab;Bitbucket'
    ]
  },
  'Mobile': {
    weight: 3,
    terms: [
      'Android', 'iOS', 'Flutter', 'React Native', 'SwiftUI', 'Jetpack Compose', 'Android Studio',
      'Xcode', 'Push Notifications', 'App Store', 'Google Play|Play Store', 'Mobile UI', 'Expo',
      'Xamarin', 'Mobile App Development'
    ]
  },
  'Testing & QA': {
    weight: 2,
    terms: [
      'Unit Testing', 'Integration Testing', 'End-to-End Testing|E2E Testing', 'Test Automation',
      'TDD|Test Driven Development', 'BDD', 'Jest', 'Mocha', 'Chai', 'PyTest', 'JUnit', 'Selenium',
      'Cypress', 'Playwright', 'Postman', 'Load Testing', 'JMeter', 'Manual Testing', 'Test Cases',
      'Bug Tracking', 'Jira', 'Regression Testing', 'Code Review', 'SonarQube', 'Debugging',
      'Test Coverage', 'Quality Assurance|QA'
    ]
  },
  'Product & Project': {
    weight: 2,
    terms: [
      'Agile|Agile Methodology', 'Scrum', 'Kanban', 'Confluence', 'Trello', 'Asana', 'Roadmap',
      'Product Strategy', 'User Stories', 'Backlog Grooming|Backlog Refinement',
      'Stakeholder Management', 'Cross-Functional Collaboration|Cross-functional',
      'Requirement Gathering|Requirements Gathering', 'PRD|Product Requirements Document',
      'Go-to-Market|GTM', 'OKR', 'Sprint Planning', 'Risk Management', 'MVP|Minimum Viable Product',
      'Product Analytics', 'Mixpanel', 'Amplitude', 'Project Management', 'Waterfall',
      'Budget Management', 'Vendor Management', 'Product Owner|Product Management'
    ]
  },
  'Design': {
    weight: 2,
    terms: [
      'Figma', 'Adobe Photoshop|Photoshop', 'Adobe Illustrator|Illustrator', 'InDesign', 'Canva',
      'Sketch', 'Prototyping|Prototype', 'User Research', 'Usability Testing', 'Typography',
      'Color Theory', 'Interaction Design', 'UX Writing', 'Information Architecture',
      'User Persona|Personas', 'User Journey|Customer Journey', 'Motion Design',
      'Branding|Brand Identity', 'Logo Design', 'High-Fidelity Mockups|Mockups', 'Usability'
    ]
  },
  'Business, Marketing & Finance': {
    weight: 2,
    terms: [
      'Digital Marketing', 'SEM', 'Google Ads|AdWords', 'Facebook Ads|Meta Ads', 'Content Marketing',
      'Email Marketing', 'Social Media Marketing|Social Media', 'Copywriting', 'Brand Strategy',
      'CRM', 'Salesforce', 'HubSpot', 'Lead Generation', 'Conversion Rate Optimization|CRO',
      'Market Research', 'Sales', 'Business Development', 'Account Management', 'Financial Analysis',
      'Budgeting', 'Accounting', 'QuickBooks', 'SAP', 'Financial Modeling', 'Valuation',
      'Risk Analysis', 'Audit', 'Taxation', 'Payroll', 'Recruiting|Talent Acquisition', 'Onboarding',
      'Employee Engagement', 'HRIS', 'Compensation', 'Performance Management', 'Labor Law',
      'Operations Management', 'Supply Chain', 'Inventory Management', 'Logistics',
      'Process Improvement', 'Lean', 'Six Sigma', 'Customer Success', 'Customer Support',
      'Technical Documentation|Documentation', 'Training', 'Compliance', 'Scheduling',
      'Business Analysis|Business Analyst', 'Data-Driven Decision Making'
    ]
  },
  'Soft Skills': {
    weight: 1,
    terms: [
      'Leadership', 'Mentoring|Mentorship', 'Teamwork', 'Communication', 'Problem Solving',
      'Critical Thinking', 'Time Management', 'Adaptability', 'Collaboration', 'Presentation',
      'Negotiation', 'Conflict Resolution', 'Ownership', 'Attention to Detail', 'Creativity',
      'Prioritization', 'Remote Collaboration', 'Public Speaking', 'Decision Making',
      'Analytical Thinking', 'Customer Service', 'Empathy', 'Fast-Paced Environment',
      'Multitasking', 'Work Ethic'
    ]
  }
};

module.exports = { SKILL_GROUPS };
