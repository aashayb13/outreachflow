require('dotenv').config();

const express = require('express');
const path = require('path');
const fs = require('fs');
const helmet = require('helmet');
const cors = require('cors');
const compression = require('compression');
const cookieParser = require('cookie-parser');
const rateLimit = require('express-rate-limit');

const config = require('./config');
const logger = require('./utils/logger');
const { initializeSchema } = require('./db/schema');
const { initDb, closeDb } = require('./db/connection');
const { closeTransporter } = require('./services/mailer');
const { startScheduler, stopScheduler } = require('./services/scheduler');
const { errorHandler, notFound } = require('./middleware/errorHandler');

// ─── Bootstrap ──────────────────────────────────────────────────────
const app = express();

// Trust the first proxy (Render, Heroku, Cloudflare, etc.).
// Required for: secure cookies (X-Forwarded-Proto), real client IPs in
// rate limiting, and accurate req.protocol.
app.set('trust proxy', 1);

// Ensure logs directory exists for local/dev file logging. In production
// the logger writes to stdout only, so this is best-effort.
try {
  const logDir = path.resolve('logs');
  if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });
} catch (_) { /* read-only FS in cloud — ignore */ }

// Database initialized in start() below

// ─── Middleware ──────────────────────────────────────────────────────
app.use(helmet({
  contentSecurityPolicy: false,  // Allow inline scripts for dashboard
  crossOriginEmbedderPolicy: false,
}));
app.use(cors());
app.use(compression());
app.use(cookieParser());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, '..', 'public')));

// Rate limiting for API
app.use('/api/', rateLimit({
  windowMs: config.rateLimit.windowMs,
  max: config.rateLimit.max,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later' },
}));

// ─── View Engine ────────────────────────────────────────────────────
const expressLayouts = require('express-ejs-layouts');
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, '..', 'views'));
app.use(expressLayouts);
app.set('layout', 'layout');
app.set('layout extractScripts', true);

// Expose auth mode to every view (hide the Logout control when auth is off).
app.locals.authDisabled = config.authDisabled;

// ─── Health Check (for Render / uptime monitors) ───────────────────
app.get('/health', async (req, res) => {
  try {
    const { getDb } = require('./db/connection');
    const db = getDb();
    const row = await db.prepare('SELECT COUNT(*) as count FROM contacts').get();
    res.json({ status: 'ok', timestamp: new Date().toISOString(), contacts: row.count });
  } catch (err) {
    res.status(503).json({ status: 'error', message: err.message });
  }
});

// ─── API Routes ─────────────────────────────────────────────────────
app.use('/api/auth', require('./routes/auth'));
app.use('/api/campaigns', require('./routes/campaigns'));
app.use('/api/contacts', require('./routes/contacts'));
app.use('/api/lists', require('./routes/lists'));
app.use('/api/templates', require('./routes/templates'));
app.use('/api/sequences', require('./routes/sequences'));
app.use('/api/webhooks', require('./routes/webhooks'));
app.use('/api/tags', require('./routes/tags'));
app.use('/api/analytics', require('./routes/analytics'));
app.use('/api/integrations', require('./routes/integrations'));
app.use('/api/assets', require('./routes/assets'));
app.use('/api/settings', require('./routes/settings'));

// ─── Tracking Routes (public, no auth) ─────────────────────────────
app.use('/t', require('./routes/tracking'));

// ─── Dashboard Routes ───────────────────────────────────────────────
const { authenticate } = require('./middleware/auth');

app.get('/login', (req, res) => {
  if (config.authDisabled) return res.redirect('/');
  res.render('login', { layout: false });
});

app.get('/', authenticate, (req, res) => {
  res.render('dashboard', { title: 'Dashboard', page: 'dashboard' });
});

app.get('/campaigns', authenticate, (req, res) => {
  res.render('campaigns', { title: 'Campaigns', page: 'campaigns' });
});

app.get('/campaigns/:id', authenticate, (req, res) => {
  res.render('campaign-detail', { title: 'Campaign Details', page: 'campaigns' });
});

app.get('/contacts', authenticate, (req, res) => {
  res.render('contacts', { title: 'Contacts', page: 'contacts' });
});

app.get('/lists', authenticate, (req, res) => {
  res.render('lists', { title: 'Lists', page: 'lists' });
});

app.get('/templates', authenticate, (req, res) => {
  res.render('templates', { title: 'Templates', page: 'templates' });
});

app.get('/sequences', authenticate, (req, res) => {
  res.render('sequences', { title: 'Sequences', page: 'sequences' });
});

app.get('/sequences/:id', authenticate, (req, res) => {
  res.render('sequence-detail', { title: 'Sequence Details', page: 'sequences' });
});

app.get('/webhooks', authenticate, (req, res) => {
  res.render('webhooks', { title: 'Webhooks', page: 'webhooks' });
});

app.get('/analytics', authenticate, (req, res) => {
  res.render('analytics', { title: 'Analytics', page: 'analytics' });
});

app.get('/integrations', authenticate, (req, res) => {
  res.render('integrations', { title: 'API Integrations', page: 'integrations' });
});

app.get('/settings', authenticate, (req, res) => {
  res.render('settings', {
    title: 'Settings',
    page: 'settings',
    send_rate: config.sendRate.perSecond,
    send_daily: config.sendRate.perDay,
    tracking_domain: config.tracking.domain,
  });
});

// ─── Error Handling ─────────────────────────────────────────────────
app.use(notFound);
app.use(errorHandler);

// ─── Start / Stop ───────────────────────────────────────────────────
let server = null;

async function start() {
  await initDb();
  await initializeSchema();

  await new Promise((resolve) => {
    server = app.listen(config.port, '127.0.0.1', () => {
      logger.info(`OutreachFlow running on http://127.0.0.1:${config.port} (env: ${config.env})`);
      // Background scheduler stays off by preference (send-now mode).
      // startScheduler();
      resolve();
    });
  });
  return server;
}

async function stop() {
  stopScheduler();
  closeTransporter();
  try { await closeDb(); } catch (_) { /* ignore */ }
  await new Promise((resolve) => {
    if (!server) return resolve();
    server.close(() => resolve());
  });
}

// Auto-start ONLY when launched directly (`node src/server.js`) — not when
// required by Electron (electron/main.js) or by tests.
if (require.main === module) {
  start().catch((err) => {
    logger.error(`Failed to start: ${err.message}`);
    process.exit(1);
  });

  const shutdown = async (signal) => {
    logger.info(`${signal} received. Shutting down...`);
    await stop();
    process.exit(0);
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

module.exports = { app, start, stop };
