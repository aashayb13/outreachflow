const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { getDb } = require('../db/connection');
const config = require('../config');

/**
 * Authenticate requests via API key (header) or JWT (cookie/header).
 */
function authenticate(req, res, next) {
  // Check API key first
  const apiKey = req.headers['x-api-key'] || req.query.api_key;
  if (apiKey) {
    // Check against env API key (simple mode)
    if (config.apiKey && apiKey === config.apiKey) {
      req.authMethod = 'api_key';
      req.permissions = ['read', 'write', 'admin'];
      return next();
    }

    // Check against database API keys
    const keyHash = crypto.createHash('sha256').update(apiKey).digest('hex');
    const db = getDb();
    const keyRecord = db.prepare('SELECT * FROM api_keys WHERE key_hash = ? AND is_active = 1').get(keyHash);

    if (keyRecord) {
      if (keyRecord.expires_at && new Date(keyRecord.expires_at) < new Date()) {
        return res.status(401).json({ error: 'API key expired' });
      }
      db.prepare('UPDATE api_keys SET last_used_at = datetime("now") WHERE id = ?').run(keyRecord.id);
      req.authMethod = 'api_key';
      req.permissions = JSON.parse(keyRecord.permissions || '["read"]');
      return next();
    }

    return res.status(401).json({ error: 'Invalid API key' });
  }

  // Check JWT
  const token = req.cookies?.token || (req.headers.authorization?.startsWith('Bearer ')
    ? req.headers.authorization.slice(7)
    : null);

  if (token) {
    try {
      const decoded = jwt.verify(token, config.appSecret);
      req.user = decoded;
      req.authMethod = 'jwt';
      req.permissions = decoded.permissions || ['read', 'write', 'admin'];
      return next();
    } catch {
      return res.status(401).json({ error: 'Invalid or expired token' });
    }
  }

  // For dashboard routes, redirect to login
  if (req.accepts('html')) {
    return res.redirect('/login');
  }

  return res.status(401).json({ error: 'Authentication required' });
}

/**
 * Check if the authenticated user has a specific permission.
 */
function requirePermission(permission) {
  return (req, res, next) => {
    if (!req.permissions || !req.permissions.includes(permission)) {
      return res.status(403).json({ error: `Permission '${permission}' required` });
    }
    next();
  };
}

/**
 * Generate a JWT token.
 */
function generateToken(payload, expiresIn = '24h') {
  return jwt.sign(payload, config.appSecret, { expiresIn });
}

/**
 * Generate a new API key.
 */
function generateApiKey() {
  const prefix = 'ect_';
  const key = prefix + crypto.randomBytes(32).toString('hex');
  const hash = crypto.createHash('sha256').update(key).digest('hex');
  return { key, hash, prefix };
}

module.exports = { authenticate, requirePermission, generateToken, generateApiKey };
