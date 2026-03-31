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

// Ensure data and log directories exist
for (const dir of ['data', 'logs']) {
  const p = path.resolve(dir);
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
}

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

// ─── Tracking Routes (public, no auth) ─────────────────────────────
app.use('/t', require('./routes/tracking'));

// ─── Dashboard Routes ───────────────────────────────────────────────
const { authenticate } = require('./middleware/auth');

app.get('/login', (req, res) => res.render('login', { layout: false }));

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

app.get('/settings', authenticate, (req, res) => {
  res.render('settings', {
    title: 'Settings',
    page: 'settings',
    smtp_host: config.smtp.host,
    smtp_port: config.smtp.port,
    smtp_user: config.smtp.user ? config.smtp.user.replace(/(.{3}).*(@.*)/, '$1***$2') : '',
    smtp_from: config.smtp.fromEmail,
    send_rate: config.sendRate.perSecond,
    send_daily: config.sendRate.perDay,
    tracking_domain: config.tracking.domain,
  });
});

// ─── Error Handling ─────────────────────────────────────────────────
app.use(notFound);
app.use(errorHandler);

// ─── Start Server ───────────────────────────────────────────────────
let server;

async function start() {
  // Initialize database (async for sql.js WASM loading)
  await initDb();
  initializeSchema();

  server = app.listen(config.port, () => {
    logger.info(`
╔══════════════════════════════════════════════╗
║     Email Campaign Tool — Running!           ║
║     http://localhost:${config.port}                  ║
║     Environment: ${config.env}                ║
╚══════════════════════════════════════════════╝
    `);

    // Start background scheduler
    startScheduler();
  });
}

start().catch(err => {
  logger.error(`Failed to start: ${err.message}`);
  process.exit(1);
});

// ─── Graceful Shutdown ──────────────────────────────────────────────
function shutdown(signal) {
  logger.info(`${signal} received. Shutting down...`);
  stopScheduler();
  closeTransporter();
  closeDb();
  server.close(() => {
    logger.info('Server closed');
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 5000);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

module.exports = app;
