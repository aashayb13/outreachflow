const express = require('express');
const router = express.Router();
const { getDb } = require('../db/connection');
const { authenticate, requirePermission } = require('../middleware/auth');
const { verifyWebhookSignature } = require('../services/webhookService');
const config = require('../config');
const logger = require('../utils/logger');

// ─── Outbound webhook management (authenticated) ─────────────────────
router.get('/', authenticate, async (req, res, next) => {
  try {
    const db = getDb();
    const webhooks = await db.prepare('SELECT * FROM webhooks ORDER BY created_at DESC').all();
    res.json({ webhooks: webhooks.map(w => ({ ...w, events: JSON.parse(w.events || '[]'), headers: JSON.parse(w.headers || '{}') })) });
  } catch (err) { next(err); }
});

router.get('/:id', authenticate, async (req, res, next) => {
  try {
    const db = getDb();
    const webhook = await db.prepare('SELECT * FROM webhooks WHERE id = ?').get(req.params.id);
    if (!webhook) return res.status(404).json({ error: 'Webhook not found' });

    const logs = await db.prepare('SELECT * FROM webhook_logs WHERE webhook_id = ? ORDER BY created_at DESC LIMIT 50').all(webhook.id);
    res.json({ webhook: { ...webhook, events: JSON.parse(webhook.events || '[]') }, logs });
  } catch (err) { next(err); }
});

router.post('/', authenticate, requirePermission('write'), async (req, res, next) => {
  try {
    const db = getDb();
    const { name, url, events, secret, headers } = req.body;
    if (!name || !url) return res.status(400).json({ error: 'Name and URL are required' });

    const result = await db.prepare(`
      INSERT INTO webhooks (name, url, events, secret, headers)
      VALUES (?, ?, ?, ?, ?)
    `).run(name, url, JSON.stringify(events || ['*']), secret || '', JSON.stringify(headers || {}));

    const webhook = await db.prepare('SELECT * FROM webhooks WHERE id = ?').get(result.lastInsertRowid);
    res.status(201).json({ webhook });
  } catch (err) { next(err); }
});

router.put('/:id', authenticate, requirePermission('write'), async (req, res, next) => {
  try {
    const db = getDb();
    const { name, url, events, secret, headers, is_active } = req.body;
    const updates = [];
    const values = [];

    if (name !== undefined) { updates.push('name = ?'); values.push(name); }
    if (url !== undefined) { updates.push('url = ?'); values.push(url); }
    if (events !== undefined) { updates.push('events = ?'); values.push(JSON.stringify(events)); }
    if (secret !== undefined) { updates.push('secret = ?'); values.push(secret); }
    if (headers !== undefined) { updates.push('headers = ?'); values.push(JSON.stringify(headers)); }
    if (is_active !== undefined) { updates.push('is_active = ?'); values.push(is_active ? 1 : 0); }

    if (updates.length > 0) {
      updates.push('failure_count = 0');
      updates.push('updated_at = NOW()');
      await db.prepare(`UPDATE webhooks SET ${updates.join(', ')} WHERE id = ?`).run(...values, req.params.id);
    }

    const webhook = await db.prepare('SELECT * FROM webhooks WHERE id = ?').get(req.params.id);
    res.json({ webhook });
  } catch (err) { next(err); }
});

router.delete('/:id', authenticate, requirePermission('admin'), async (req, res, next) => {
  try {
    const db = getDb();
    await db.prepare('DELETE FROM webhooks WHERE id = ?').run(req.params.id);
    res.json({ message: 'Webhook deleted' });
  } catch (err) { next(err); }
});

router.get('/:id/logs', authenticate, async (req, res, next) => {
  try {
    const db = getDb();
    const { page = 1, limit = 50 } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);
    const totalRow = await db.prepare('SELECT COUNT(*) as c FROM webhook_logs WHERE webhook_id = ?').get(req.params.id);
    const total = parseInt(totalRow.c, 10);
    const logs = await db.prepare('SELECT * FROM webhook_logs WHERE webhook_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?').all(req.params.id, parseInt(limit), offset);
    res.json({ logs, pagination: { total, page: parseInt(page), limit: parseInt(limit) } });
  } catch (err) { next(err); }
});

router.post('/:id/test', authenticate, requirePermission('write'), async (req, res, next) => {
  try {
    const db = getDb();
    const webhook = await db.prepare('SELECT * FROM webhooks WHERE id = ?').get(req.params.id);
    if (!webhook) return res.status(404).json({ error: 'Webhook not found' });

    const testPayload = JSON.stringify({
      event: 'webhook.test',
      timestamp: new Date().toISOString(),
      data: { message: 'This is a test webhook from your email campaign tool' },
    });

    try {
      const response = await fetch(webhook.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: testPayload,
        signal: AbortSignal.timeout(10000),
      });
      res.json({ success: response.ok, status: response.status });
    } catch (error) {
      res.json({ success: false, error: error.message });
    }
  } catch (err) { next(err); }
});

// ─── Inbound webhook endpoint ─────────────────────────────────
router.post('/inbound/:action', express.json(), async (req, res, next) => {
  try {
    const { action } = req.params;
    const db = getDb();

    if (config.webhookSecret) {
      const signature = req.headers['x-webhook-signature'] || req.headers['x-hub-signature-256'];
      if (!verifyWebhookSignature(JSON.stringify(req.body), signature, config.webhookSecret)) {
        return res.status(401).json({ error: 'Invalid webhook signature' });
      }
    }

    await db.prepare(`
      INSERT INTO webhook_logs (direction, event_type, request_url, request_method, request_headers, request_body, response_status, success)
      VALUES ('inbound', ?, ?, 'POST', ?, ?, 200, 1)
    `).run(action, req.originalUrl, JSON.stringify(req.headers), JSON.stringify(req.body));

    switch (action) {
      case 'contact': {
        const { email, first_name, last_name, company, tags, list_ids, custom_fields } = req.body;
        if (!email) return res.status(400).json({ error: 'Email required' });

        const existing = await db.prepare('SELECT id FROM contacts WHERE email = ?').get(email);
        if (existing) {
          const updates = [];
          const values = [];
          if (first_name) { updates.push('first_name = ?'); values.push(first_name); }
          if (last_name) { updates.push('last_name = ?'); values.push(last_name); }
          if (company) { updates.push('company = ?'); values.push(company); }
          if (custom_fields) {
            const prev = await db.prepare('SELECT custom_fields FROM contacts WHERE id = ?').get(existing.id);
            updates.push('custom_fields = ?');
            values.push(JSON.stringify({ ...JSON.parse(prev.custom_fields || '{}'), ...custom_fields }));
          }
          if (updates.length > 0) {
            updates.push('updated_at = NOW()');
            await db.prepare(`UPDATE contacts SET ${updates.join(', ')} WHERE id = ?`).run(...values, existing.id);
          }
          return res.json({ action: 'updated', contact_id: existing.id });
        }

        const result = await db.prepare(`
          INSERT INTO contacts (email, first_name, last_name, company, custom_fields, source)
          VALUES (?, ?, ?, ?, ?, 'webhook')
        `).run(email, first_name || '', last_name || '', company || '', JSON.stringify(custom_fields || {}));

        if (list_ids && Array.isArray(list_ids)) {
          for (const lid of list_ids) {
            await db.prepare('INSERT OR IGNORE INTO list_contacts (list_id, contact_id) VALUES (?, ?)').run(lid, result.lastInsertRowid);
          }
        }

        return res.status(201).json({ action: 'created', contact_id: result.lastInsertRowid });
      }

      case 'event': {
        const { contact_email, event_type, campaign_id, metadata } = req.body;
        const contact = contact_email
          ? await db.prepare('SELECT id FROM contacts WHERE email = ?').get(contact_email)
          : null;

        await db.prepare('INSERT INTO events (campaign_id, contact_id, type, metadata) VALUES (?, ?, ?, ?)')
          .run(campaign_id || null, contact?.id || null, event_type || 'conversion', JSON.stringify(metadata || {}));

        return res.json({ received: true });
      }

      case 'suppress': {
        const { email, reason } = req.body;
        if (!email) return res.status(400).json({ error: 'Email required' });
        await db.prepare("INSERT OR IGNORE INTO suppression_list (email, reason, source) VALUES (?, ?, 'webhook')").run(email, reason || 'manual');
        await db.prepare("UPDATE contacts SET status = 'suppressed', updated_at = NOW() WHERE email = ?").run(email);
        return res.json({ suppressed: true });
      }

      default:
        return res.status(400).json({ error: `Unknown action: ${action}` });
    }
  } catch (err) { next(err); }
});

module.exports = router;
