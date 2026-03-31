const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const { getDb } = require('../db/connection');
const { generateToken, generateApiKey, authenticate, requirePermission } = require('../middleware/auth');
const config = require('../config');

// Login (simple password-based for self-hosted)
router.post('/login', (req, res) => {
  const { password } = req.body;

  // In single-user mode, compare against APP_SECRET
  if (!password || password !== config.appSecret) {
    return res.status(401).json({ error: 'Invalid password' });
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
router.get('/api-keys', authenticate, requirePermission('admin'), (req, res) => {
  const db = getDb();
  const keys = db.prepare('SELECT id, name, prefix, permissions, last_used_at, expires_at, is_active, created_at FROM api_keys ORDER BY created_at DESC').all();
  res.json({ api_keys: keys.map(k => ({ ...k, permissions: JSON.parse(k.permissions || '[]') })) });
});

router.post('/api-keys', authenticate, requirePermission('admin'), (req, res) => {
  const db = getDb();
  const { name, permissions = ['read'], expires_in_days } = req.body;
  if (!name) return res.status(400).json({ error: 'Name is required' });

  const { key, hash, prefix } = generateApiKey();
  const expiresAt = expires_in_days
    ? new Date(Date.now() + expires_in_days * 86400000).toISOString()
    : null;

  db.prepare('INSERT INTO api_keys (name, key_hash, prefix, permissions, expires_at) VALUES (?, ?, ?, ?, ?)')
    .run(name, hash, prefix, JSON.stringify(permissions), expiresAt);

  // Return the key only once — it cannot be retrieved later
  res.status(201).json({ api_key: key, name, permissions, expires_at: expiresAt, warning: 'Save this key now. It cannot be retrieved again.' });
});

router.delete('/api-keys/:id', authenticate, requirePermission('admin'), (req, res) => {
  const db = getDb();
  db.prepare('DELETE FROM api_keys WHERE id = ?').run(req.params.id);
  res.json({ message: 'API key deleted' });
});

// Verify SMTP connection
router.post('/verify-smtp', authenticate, requirePermission('admin'), async (req, res) => {
  const { verifyConnection } = require('../services/mailer');
  const result = await verifyConnection();
  res.json(result);
});

module.exports = router;
