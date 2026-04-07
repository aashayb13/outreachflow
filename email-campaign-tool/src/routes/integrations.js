/**
 * /api/integrations  —  CRUD + test/search/import for lead-gen providers.
 *
 * Security:
 *  - All routes require authentication (same middleware as the rest of the app).
 *  - Credentials are AES-256-GCM encrypted at rest using APP_SECRET.
 *  - Responses NEVER include raw credentials, only masked previews.
 *  - Write/admin operations gated by requirePermission().
 */

const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');

const { getDb } = require('../db/connection');
const { authenticate, requirePermission } = require('../middleware/auth');
const {
  listProviders,
  getProvider,
  testIntegration,
  searchIntegration,
  importFromIntegration,
} = require('../services/integrations');
const { encryptJSON, decryptJSON, maskCredentials } = require('../services/integrations/_crypto');
const logger = require('../utils/logger');

router.use(authenticate);

// Tighter rate limit on remote-call endpoints (test/search/import) to avoid
// burning third-party quota by accident.
const remoteCallLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many integration calls. Please slow down.' },
});

// ─── Helpers ──────────────────────────────────────────────────────

function rowToPublic(row) {
  if (!row) return null;
  let creds = {};
  try { creds = decryptJSON(row.credentials); } catch (_) {}
  let cfg = {};
  try { cfg = JSON.parse(row.config || '{}'); } catch (_) {}
  return {
    id: row.id,
    name: row.name,
    provider: row.provider,
    is_active: !!row.is_active,
    credentials_masked: maskCredentials(creds),
    has_credentials: Object.keys(creds).length > 0,
    config: cfg,
    last_tested_at: row.last_tested_at,
    last_test_ok: row.last_test_ok === null ? null : !!row.last_test_ok,
    last_test_error: row.last_test_error || '',
    total_imported: row.total_imported,
    total_calls: row.total_calls,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function getIntegrationOr404(req, res) {
  const db = getDb();
  const row = db.prepare('SELECT * FROM integrations WHERE id = ?').get(req.params.id);
  if (!row) {
    res.status(404).json({ error: 'Integration not found' });
    return null;
  }
  return row;
}

// ─── Provider catalog ─────────────────────────────────────────────

router.get('/providers', (req, res) => {
  res.json({ providers: listProviders() });
});

// ─── CRUD ─────────────────────────────────────────────────────────

router.get('/', (req, res) => {
  const db = getDb();
  const rows = db.prepare('SELECT * FROM integrations ORDER BY created_at DESC').all();
  res.json({ integrations: rows.map(rowToPublic) });
});

router.get('/:id', (req, res) => {
  const row = getIntegrationOr404(req, res);
  if (!row) return;
  res.json({ integration: rowToPublic(row) });
});

router.post('/', requirePermission('write'), (req, res) => {
  const { name, provider, credentials, config = {}, is_active = 1 } = req.body || {};
  if (!name || !provider) return res.status(400).json({ error: 'name and provider are required' });

  let providerMeta;
  try { providerMeta = getProvider(provider).meta; }
  catch (err) { return res.status(400).json({ error: err.message }); }

  // Validate required credential fields are present
  const required = (providerMeta.credential_fields || []).filter(f => f.required).map(f => f.key);
  for (const key of required) {
    if (!credentials || !credentials[key]) {
      return res.status(400).json({ error: `Credential field '${key}' is required for ${providerMeta.name}` });
    }
  }

  const db = getDb();
  const result = db.prepare(`
    INSERT INTO integrations (name, provider, credentials, config, is_active)
    VALUES (?, ?, ?, ?, ?)
  `).run(
    name,
    provider,
    encryptJSON(credentials || {}),
    JSON.stringify(config || {}),
    is_active ? 1 : 0
  );

  const row = db.prepare('SELECT * FROM integrations WHERE id = ?').get(result.lastInsertRowid);
  logger.info(`Integration created: ${name} (${provider})`);
  res.status(201).json({ integration: rowToPublic(row) });
});

router.put('/:id', requirePermission('write'), (req, res) => {
  const row = getIntegrationOr404(req, res);
  if (!row) return;

  const db = getDb();
  const updates = [];
  const values = [];

  if (req.body.name !== undefined) { updates.push('name = ?'); values.push(req.body.name); }
  if (req.body.is_active !== undefined) { updates.push('is_active = ?'); values.push(req.body.is_active ? 1 : 0); }

  if (req.body.credentials !== undefined) {
    // Merge new credentials over existing ones — empty fields don't wipe.
    const existing = decryptJSON(row.credentials);
    const merged = { ...existing };
    for (const [k, v] of Object.entries(req.body.credentials || {})) {
      if (v !== '' && v !== null && v !== undefined) merged[k] = v;
    }
    updates.push('credentials = ?');
    values.push(encryptJSON(merged));
  }

  if (req.body.config !== undefined) {
    updates.push('config = ?');
    values.push(JSON.stringify(req.body.config || {}));
  }

  if (updates.length === 0) return res.json({ integration: rowToPublic(row) });

  updates.push('updated_at = datetime("now")');
  db.prepare(`UPDATE integrations SET ${updates.join(', ')} WHERE id = ?`).run(...values, row.id);

  const updated = db.prepare('SELECT * FROM integrations WHERE id = ?').get(row.id);
  res.json({ integration: rowToPublic(updated) });
});

router.delete('/:id', requirePermission('admin'), (req, res) => {
  const row = getIntegrationOr404(req, res);
  if (!row) return;
  const db = getDb();
  db.prepare('DELETE FROM integrations WHERE id = ?').run(row.id);
  res.json({ message: 'Integration deleted' });
});

// ─── Remote calls (test / search / import) ───────────────────────

router.post('/:id/test', remoteCallLimiter, requirePermission('write'), async (req, res, next) => {
  const row = getIntegrationOr404(req, res);
  if (!row) return;
  try {
    const result = await testIntegration(row);
    res.json({ ok: true, ...result });
  } catch (err) {
    logger.warn(`Integration test failed (${row.provider}): ${err.message}`);
    res.status(400).json({ ok: false, error: err.message });
  }
});

router.post('/:id/search', remoteCallLimiter, requirePermission('write'), async (req, res) => {
  const row = getIntegrationOr404(req, res);
  if (!row) return;
  if (!row.is_active) return res.status(400).json({ error: 'Integration is disabled' });
  try {
    const result = await searchIntegration(row, req.body?.params || {});
    res.json(result);
  } catch (err) {
    logger.warn(`Integration search failed (${row.provider}): ${err.message}`);
    res.status(400).json({ error: err.message });
  }
});

router.post('/:id/import', remoteCallLimiter, requirePermission('write'), async (req, res) => {
  const row = getIntegrationOr404(req, res);
  if (!row) return;
  if (!row.is_active) return res.status(400).json({ error: 'Integration is disabled' });

  const { params = {}, list_id, tags = [], dry_run = false } = req.body || {};

  try {
    const result = await importFromIntegration(row, { params, list_id, tags, dry_run });
    res.json(result);
  } catch (err) {
    logger.warn(`Integration import failed (${row.provider}): ${err.message}`);
    res.status(400).json({ error: err.message });
  }
});

// ─── Sync history ────────────────────────────────────────────────

router.get('/:id/logs', (req, res) => {
  const row = getIntegrationOr404(req, res);
  if (!row) return;
  const db = getDb();
  const limit = Math.min(parseInt(req.query.limit, 10) || 50, 200);
  const logs = db.prepare(`
    SELECT * FROM integration_sync_logs WHERE integration_id = ?
    ORDER BY created_at DESC LIMIT ?
  `).all(row.id, limit);
  res.json({
    logs: logs.map(l => ({
      ...l,
      query: (() => { try { return JSON.parse(l.query); } catch { return {}; } })(),
    })),
  });
});

module.exports = router;
