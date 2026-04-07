const express = require('express');
const router = express.Router();
const multer = require('multer');
const { parse } = require('csv-parse/sync');
const { stringify } = require('csv-stringify/sync');
const { getDb } = require('../db/connection');
const { authenticate, requirePermission } = require('../middleware/auth');
const { fireWebhooks } = require('../services/webhookService');
const { importLeads } = require('../services/integrations/_importer');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

router.use(authenticate);

// List contacts with pagination, search, filtering
router.get('/', async (req, res, next) => {
  try {
    const db = getDb();
    const {
      search, status, list_id, tag, source,
      page = 1, limit = 50, sort = 'created_at', order = 'desc',
    } = req.query;

    let where = '1=1';
    const params = [];

    if (search) {
      where += ' AND (c.email LIKE ? OR c.first_name LIKE ? OR c.last_name LIKE ? OR c.company LIKE ?)';
      params.push(`%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`);
    }
    if (status) { where += ' AND c.status = ?'; params.push(status); }
    if (source) { where += ' AND c.source = ?'; params.push(source); }
    if (list_id) {
      where += ' AND c.id IN (SELECT contact_id FROM list_contacts WHERE list_id = ?)';
      params.push(parseInt(list_id));
    }
    if (tag) {
      where += ' AND c.id IN (SELECT contact_id FROM contact_tags ct JOIN tags t ON t.id = ct.tag_id WHERE t.name = ?)';
      params.push(tag);
    }

    const allowedSort = ['created_at', 'email', 'first_name', 'last_name', 'company', 'lead_score'];
    const sortCol = allowedSort.includes(sort) ? sort : 'created_at';
    const sortOrder = order === 'asc' ? 'ASC' : 'DESC';

    const totalRow = await db.prepare(`SELECT COUNT(*) as count FROM contacts c WHERE ${where}`).get(...params);
    const total = parseInt(totalRow.count, 10);
    const offset = (parseInt(page) - 1) * parseInt(limit);

    const contacts = await db.prepare(`
      SELECT c.* FROM contacts c WHERE ${where} ORDER BY c.${sortCol} ${sortOrder} LIMIT ? OFFSET ?
    `).all(...params, parseInt(limit), offset);

    // Get tags for each contact
    const enriched = await Promise.all(contacts.map(async c => {
      const tags = await db.prepare(`
        SELECT t.name, t.color FROM tags t JOIN contact_tags ct ON ct.tag_id = t.id WHERE ct.contact_id = ?
      `).all(c.id);
      return { ...c, tags, custom_fields: JSON.parse(c.custom_fields || '{}') };
    }));

    res.json({
      contacts: enriched,
      pagination: { total, page: parseInt(page), limit: parseInt(limit), pages: Math.ceil(total / parseInt(limit)) },
    });
  } catch (err) { next(err); }
});

// Get single contact with full activity
router.get('/:id', async (req, res, next) => {
  try {
    const db = getDb();
    const contact = await db.prepare('SELECT * FROM contacts WHERE id = ?').get(req.params.id);
    if (!contact) return res.status(404).json({ error: 'Contact not found' });

    const tags = await db.prepare('SELECT t.* FROM tags t JOIN contact_tags ct ON ct.tag_id = t.id WHERE ct.contact_id = ?').all(contact.id);
    const lists = await db.prepare('SELECT l.* FROM lists l JOIN list_contacts lc ON lc.list_id = l.id WHERE lc.contact_id = ?').all(contact.id);
    const recentEvents = await db.prepare(`
      SELECT e.*, ca.name as campaign_name
      FROM events e
      LEFT JOIN campaigns ca ON ca.id = e.campaign_id
      WHERE e.contact_id = ?
      ORDER BY e.created_at DESC LIMIT 50
    `).all(contact.id);

    res.json({
      contact: { ...contact, custom_fields: JSON.parse(contact.custom_fields || '{}') },
      tags,
      lists,
      recent_events: recentEvents,
    });
  } catch (err) { next(err); }
});

// Create contact
router.post('/', requirePermission('write'), async (req, res, next) => {
  try {
    const db = getDb();
    const { email, first_name, last_name, company, phone, title, industry, city, state, country, custom_fields, source, tags, list_ids } = req.body;

    if (!email) return res.status(400).json({ error: 'Email is required' });

    const suppressed = await db.prepare('SELECT id FROM suppression_list WHERE email = ?').get(email);
    if (suppressed) return res.status(400).json({ error: 'Email is on the suppression list' });

    let result;
    try {
      result = await db.prepare(`
        INSERT INTO contacts (email, first_name, last_name, company, phone, title, industry, city, state, country, custom_fields, source)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        email, first_name || '', last_name || '', company || '', phone || '',
        title || '', industry || '', city || '', state || '', country || '',
        JSON.stringify(custom_fields || {}), source || 'api'
      );
    } catch (error) {
      if (error.message.includes('UNIQUE constraint')) {
        return res.status(409).json({ error: 'Contact with this email already exists' });
      }
      throw error;
    }

    const contact = await db.prepare('SELECT * FROM contacts WHERE id = ?').get(result.lastInsertRowid);

    // Add tags
    if (tags && Array.isArray(tags)) {
      for (const tagName of tags) {
        await db.prepare('INSERT OR IGNORE INTO tags (name) VALUES (?)').run(tagName);
        const tag = await db.prepare('SELECT id FROM tags WHERE name = ?').get(tagName);
        if (tag) await db.prepare('INSERT OR IGNORE INTO contact_tags (contact_id, tag_id) VALUES (?, ?)').run(contact.id, tag.id);
      }
    }

    // Add to lists
    if (list_ids && Array.isArray(list_ids)) {
      for (const listId of list_ids) {
        await db.prepare('INSERT OR IGNORE INTO list_contacts (list_id, contact_id) VALUES (?, ?)').run(listId, contact.id);
      }
    }

    fireWebhooks('contact.created', contact);
    res.status(201).json({ contact: { ...contact, custom_fields: JSON.parse(contact.custom_fields || '{}') } });
  } catch (err) { next(err); }
});

// Update contact
router.put('/:id', requirePermission('write'), async (req, res, next) => {
  try {
    const db = getDb();
    const existing = await db.prepare('SELECT * FROM contacts WHERE id = ?').get(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Contact not found' });

    const fields = ['email', 'first_name', 'last_name', 'company', 'phone', 'title', 'industry', 'city', 'state', 'country', 'status', 'lead_score', 'source'];
    const updates = [];
    const values = [];

    for (const field of fields) {
      if (req.body[field] !== undefined) {
        updates.push(`${field} = ?`);
        values.push(req.body[field]);
      }
    }

    if (req.body.custom_fields) {
      updates.push('custom_fields = ?');
      const merged = { ...JSON.parse(existing.custom_fields || '{}'), ...req.body.custom_fields };
      values.push(JSON.stringify(merged));
    }

    if (updates.length > 0) {
      updates.push('updated_at = NOW()');
      await db.prepare(`UPDATE contacts SET ${updates.join(', ')} WHERE id = ?`).run(...values, req.params.id);
    }

    const contact = await db.prepare('SELECT * FROM contacts WHERE id = ?').get(req.params.id);
    fireWebhooks('contact.updated', contact);
    res.json({ contact: { ...contact, custom_fields: JSON.parse(contact.custom_fields || '{}') } });
  } catch (err) { next(err); }
});

// Delete contact
router.delete('/:id', requirePermission('admin'), async (req, res, next) => {
  try {
    const db = getDb();
    await db.prepare('DELETE FROM contacts WHERE id = ?').run(req.params.id);
    res.json({ message: 'Contact deleted' });
  } catch (err) { next(err); }
});

// Bulk import contacts via CSV (Apollo, Hunter, Lead Magic, HubSpot, etc).
// Field mapping is delegated to importLeads() / normalizeLead() so column
// names from any major lead-gen tool are recognized, and any unknown columns
// get stashed into custom_fields automatically.
router.post('/import', requirePermission('write'), upload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'CSV file is required' });

    const { list_id, tags: rawTags, source = 'csv_import' } = req.body;

    // Strip a UTF-8 BOM if present (Apollo's exports occasionally include one).
    let csv = req.file.buffer.toString('utf8');
    if (csv.charCodeAt(0) === 0xFEFF) csv = csv.slice(1);

    const records = parse(csv, {
      columns: true,
      skip_empty_lines: true,
      trim: true,
      relax_column_count: true,  // tolerate ragged Apollo rows
      bom: true,
    });

    const tags = typeof rawTags === 'string'
      ? rawTags.split(',').map(t => t.trim()).filter(Boolean)
      : (Array.isArray(rawTags) ? rawTags : []);

    const result = await importLeads(records, {
      source,
      list_id: list_id ? parseInt(list_id, 10) : undefined,
      tags,
    });

    res.json({
      imported: result.imported,
      skipped: result.skipped,
      total: result.total,
      errors: result.errors,
    });
  } catch (err) { next(err); }
});

// Export contacts as CSV
router.get('/export/csv', async (req, res, next) => {
  try {
    const db = getDb();
    const { list_id, status } = req.query;

    let where = '1=1';
    const params = [];
    if (list_id) { where += ' AND c.id IN (SELECT contact_id FROM list_contacts WHERE list_id = ?)'; params.push(parseInt(list_id)); }
    if (status) { where += ' AND c.status = ?'; params.push(status); }

    const contacts = await db.prepare(`SELECT c.* FROM contacts c WHERE ${where} ORDER BY c.email`).all(...params);

    const csv = stringify(contacts.map(c => ({
      email: c.email,
      first_name: c.first_name,
      last_name: c.last_name,
      company: c.company,
      phone: c.phone,
      title: c.title,
      industry: c.industry,
      city: c.city,
      state: c.state,
      country: c.country,
      status: c.status,
      lead_score: c.lead_score,
      source: c.source,
    })), { header: true });

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename=contacts-export.csv');
    res.send(csv);
  } catch (err) { next(err); }
});

module.exports = router;
