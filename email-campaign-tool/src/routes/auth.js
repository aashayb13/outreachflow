const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const { getDb } = require('../db/connection');
const { generateToken, generateApiKey, authenticate, requirePermission } = require('../middleware/auth');
const config = require('../config');

// Login (email + password for self-hosted single-user mode)
router.post('/login', (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required' });
  }

  // Compare against APP_EMAIL / APP_PASSWORD (falls back to APP_SECRET for password
  // so existing deployments without APP_PASSWORD set keep working).
  const expectedEmail = (config.appEmail || '').trim().toLowerCase();
  const expectedPassword = config.appPassword || config.appSecret;

  if (!expectedEmail) {
    return res.status(500).json({ error: 'APP_EMAIL is not configured on the server' });
  }

  if (email.trim().toLowerCase() !== expectedEmail || password !== expectedPassword) {
    return res.status(401).json({ error: 'Invalid email or password' });
  }

  const token = generateToken({ role: 'admin', permissions: ['read', 'write', 'admin'] });

  res.cookie('token', token, {
    httpOnly: true,
    secure: config.env === 'production',
    sameSite: 'lax',
    maxAge: 24 * 60 * 60 * 1000,
  });

  res.json({ token, message: 'Logged in' });
});

// Logout
router.post('/logout', (req, res) => {
  res.clearCookie('token');
  res.json({ message: 'Logged out' });
});

// Check auth status
router.get('/me', authenticate, (req, res) => {
  res.json({ authenticated: true, method: req.authMethod, permissions: req.permissions });
});

// ─── API Key management ───────────────────────────────────────────
router.get('/api-keys', authenticate, requirePermission('admin'), async (req, res, next) => {
  try {
    const db = getDb();
    const keys = await db.prepare('SELECT id, name, prefix, permissions, last_used_at, expires_at, is_active, created_at FROM api_keys ORDER BY created_at DESC').all();
    res.json({ api_keys: keys.map(k => ({ ...k, permissions: JSON.parse(k.permissions || '[]') })) });
  } catch (err) { next(err); }
});

router.post('/api-keys', authenticate, requirePermission('admin'), async (req, res, next) => {
  try {
    const db = getDb();
    const { name, permissions = ['read'], expires_in_days } = req.body;
    if (!name) return res.status(400).json({ error: 'Name is required' });

    const { key, hash, prefix } = generateApiKey();
    const expiresAt = expires_in_days
      ? new Date(Date.now() + expires_in_days * 86400000).toISOString()
      : null;

    await db.prepare('INSERT INTO api_keys (name, key_hash, prefix, permissions, expires_at) VALUES (?, ?, ?, ?, ?)')
      .run(name, hash, prefix, JSON.stringify(permissions), expiresAt);

    res.status(201).json({ api_key: key, name, permissions, expires_at: expiresAt, warning: 'Save this key now. It cannot be retrieved again.' });
  } catch (err) { next(err); }
});

router.delete('/api-keys/:id', authenticate, requirePermission('admin'), async (req, res, next) => {
  try {
    const db = getDb();
    await db.prepare('DELETE FROM api_keys WHERE id = ?').run(req.params.id);
    res.json({ message: 'API key deleted' });
  } catch (err) { next(err); }
});

// Verify SMTP connection
router.post('/verify-smtp', authenticate, requirePermission('admin'), async (req, res) => {
  const { verifyConnection } = require('../services/mailer');
  const result = await verifyConnection();
  res.json(result);
});

module.exports = router;
