require('dotenv').config();

module.exports = {
  port: parseInt(process.env.PORT, 10) || 3000,
  env: process.env.NODE_ENV || 'development',
  baseUrl: process.env.BASE_URL || 'http://localhost:3000',
  appSecret: process.env.APP_SECRET || 'dev-secret-change-me',
  appEmail: process.env.APP_EMAIL || '',
  appPassword: process.env.APP_PASSWORD || '',

  db: {
    // Postgres connection string. On Render this is wired to the managed
    // Postgres service via render.yaml; locally set DATABASE_URL in .env.
    url: process.env.DATABASE_URL || '',
  },

  smtp: {
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port: parseInt(process.env.SMTP_PORT, 10) || 587,
    secure: process.env.SMTP_SECURE === 'true',
    user: process.env.SMTP_USER || '',
    pass: process.env.SMTP_PASS || '',
    fromName: process.env.SMTP_FROM_NAME || 'Email Campaigns',
    fromEmail: process.env.SMTP_FROM_EMAIL || '',
  },

  apiKey: process.env.API_KEY || '',

  rateLimit: {
    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS, 10) || 900000,
    max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS, 10) || 100,
  },

  sendRate: {
    perSecond: parseInt(process.env.SEND_RATE_PER_SECOND, 10) || 1,
    perDay: parseInt(process.env.SEND_RATE_PER_DAY, 10) || 40,
  },

  webhookSecret: process.env.WEBHOOK_SECRET || '',

  tracking: {
    domain: process.env.TRACKING_DOMAIN || 'http://localhost:3000',
  },
};
