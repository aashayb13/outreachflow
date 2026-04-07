const crypto = require('crypto');
const config = require('../../config');

// Derive a stable 32-byte key from APP_SECRET so the same install can decrypt
// previously stored credentials across restarts.
const KEY = crypto.createHash('sha256').update(config.appSecret || 'dev-secret-change-me').digest();
const ALGO = 'aes-256-gcm';

function encryptJSON(obj) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGO, KEY, iv);
  const plaintext = Buffer.from(JSON.stringify(obj || {}), 'utf8');
  const enc = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]).toString('base64');
}

function decryptJSON(blob) {
  if (!blob) return {};
  // Backwards-compat: if it parses as JSON already (legacy/plain), return it.
  try { return JSON.parse(blob); } catch (_) { /* fallthrough — encrypted */ }
  try {
    const buf = Buffer.from(blob, 'base64');
    const iv = buf.subarray(0, 12);
    const tag = buf.subarray(12, 28);
    const enc = buf.subarray(28);
    const decipher = crypto.createDecipheriv(ALGO, KEY, iv);
    decipher.setAuthTag(tag);
    const dec = Buffer.concat([decipher.update(enc), decipher.final()]);
    return JSON.parse(dec.toString('utf8'));
  } catch (err) {
    return {};
  }
}

function maskSecret(value) {
  if (!value || typeof value !== 'string') return '';
  if (value.length <= 8) return '••••';
  return value.slice(0, 4) + '••••' + value.slice(-4);
}

function maskCredentials(creds) {
  const out = {};
  for (const [k, v] of Object.entries(creds || {})) {
    out[k] = typeof v === 'string' ? maskSecret(v) : v;
  }
  return out;
}

module.exports = { encryptJSON, decryptJSON, maskSecret, maskCredentials };
