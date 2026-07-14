/**
 * App-level settings stored in the app_settings key/value table.
 * SMTP credentials are AES-256-GCM encrypted with APP_SECRET (same scheme as
 * lead-gen integrations). DB settings layer over env; env is the fallback.
 */
const { getDb } = require('../db/connection');
const config = require('../config');
const { encryptJSON, decryptJSON } = require('./integrations/_crypto');
const logger = require('../utils/logger');

const SMTP_KEY = 'smtp';

/** Read stored SMTP settings, or {} if unset OR the DB is unavailable. */
async function getSmtpSettings() {
  try {
    const db = getDb();
    const row = await db.prepare('SELECT value FROM app_settings WHERE key = ?').get(SMTP_KEY);
    if (!row || !row.value) return {};
    return decryptJSON(row.value);
  } catch (err) {
    logger.warn(`getSmtpSettings fell back to env: ${err.message}`);
    return {};
  }
}

/** Merge + persist SMTP settings. Blank fields keep the prior value. */
async function saveSmtpSettings(input) {
  const db = getDb();
  const existing = await getSmtpSettings();
  const merged = { ...existing };
  for (const [k, v] of Object.entries(input || {})) {
    if (v !== '' && v !== null && v !== undefined) merged[k] = v;
  }
  const value = encryptJSON(merged);
  await db.prepare(`
    INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, NOW())
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()
  `).run(SMTP_KEY, value);
  return merged;
}

/** Pure merge (DB over env). Exported for testing. */
function mergeSmtp(envSmtp, dbSmtp) {
  const out = { ...envSmtp };
  for (const [k, v] of Object.entries(dbSmtp || {})) {
    if (v !== '' && v !== null && v !== undefined) out[k] = v;
  }
  if (out.port !== undefined) out.port = parseInt(out.port, 10) || 587;
  out.secure = out.secure === true || out.secure === 'true';
  return out;
}

/** Effective SMTP config used by the mailer, plus a `source` flag. */
async function getEffectiveSmtp() {
  const dbSmtp = await getSmtpSettings();
  const envSmtp = {
    host: config.smtp.host,
    port: config.smtp.port,
    secure: config.smtp.secure,
    user: config.smtp.user,
    pass: config.smtp.pass,
    fromName: config.smtp.fromName,
    fromEmail: config.smtp.fromEmail,
  };
  return { ...mergeSmtp(envSmtp, dbSmtp), source: Object.keys(dbSmtp).length ? 'db' : 'env' };
}

module.exports = { getSmtpSettings, saveSmtpSettings, getEffectiveSmtp, mergeSmtp, SMTP_KEY };
