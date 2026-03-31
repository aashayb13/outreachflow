const express = require('express');
const router = express.Router();
const multer = require('multer');
const { parse } = require('csv-parse/sync');
const { stringify } = require('csv-stringify/sync');
const { getDb } = require('../db/connection');
const { authenticate, requirePermission } = require('../middleware/auth');
const { fireWebhooks } = require('../services/webhookService');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

router.use(authenticate);

// List contacts with pagination, search, filtering
router.get('/', (req, res) => {
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

  const total = db.prepare(`SELECT COUNT(*) as count FROM contacts c WHERE ${where}`).get(...params).count;
  const offset = (parseInt(page) - 1) * parseInt(limit);

  const contacts = db.prepare(`
    SELECT c.* FROM contacts c WHERE ${where} ORDER BY c.${sortCol} ${sortOrder} LIMIT ? OFFSET ?
  `).all(...params, parseInt(limit), offset);

  // Get tags for each contact
  const enriched = contacts.map(c => {
    const tags = db.prepare(`
      SELECT t.name, t.color FROM tags t JOIN contact_tags ct ON ct.tag_id = t.id WHERE ct.contact_id = ?
    `).all(c.id);
    return { ...c, tags, custom_fields: JSON.parse(c.custom_fields || '{}') };
  });

  res.json({
    contacts: enriched,
    pagination: { total, page: parseInt(page), limit: parseInt(limit), pages: Math.ceil(total / parseInt(limit)) },
  });
});

// Get single contact with full activity
router.get('/:id', (req, res) => {
  const db = getDb();
  const contact = db.prepare('SELECT * FROM contacts WHERE id = ?').get(req.params.id);
  if (!contact) return res.status(404).json({ error: 'Contact not found' });

  const tags = db.prepare('SELECT t.* FROM tags t JOIN contact_tags ct ON ct.tag_id = t.id WHERE ct.contact_id = ?').all(contact.id);
  const lists = db.prepare('SELECT l.* FROM lists l JOIN list_contacts lc ON lc.list_id = l.id WHERE lc.contact_id = ?').all(contact.id);
  const recentEvents = db.prepare(`
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
});

// Create contact
router.post('/', requirePermission('write'), (req, res) => {
  const db = getDb();
  const { email, first_name, last_name, company, phone, title, industry, city, state, country, custom_fields, source, tags, list_ids } = req.body;

  if (!email) return res.status(400).json({ error: 'Email is required' });

  // Check suppression list
  const suppressed = db.prepare('SELECT id FROM suppression_list WHERE email = ? COLLATE NOCASE').get(email);
  if (suppressed) return res.status(400).json({ error: 'Email is on the suppression list' });

  try {
    const result = db.prepare(`
      INSERT INTO contacts (email, first_name, last_name, company, phone, title, industry, city, state, country, custom_fields, source)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      email, first_name || '', last_name || '', company || '', phone || '',
      title || '', industry || '', city || '', state || '', country || '',
      JSON.stringify(custom_fields || {}), source || 'api'
    );

    const contact = db.prepare('SELECT * FROM contacts WHERE id = ?').get(result.lastInsertRowid);

    // Add tags
    if (tags && Array.isArray(tags)) {
      for (const tagName of tags) {
        db.prepare('INSERT OR IGNORE INTO tags (name) VALUES (?)').run(tagName);
        const tag = db.prepare('SELECT id FROM tags WHERE name = ?').get(tagName);
        if (tag) db.prepare('INSERT OR IGNORE INTO contact_tags (contact_id, tag_id) VALUES (?, ?)').run(contact.id, tag.id);
      }
    }

    // Add to lists
    if (list_ids && Array.isArray(list_ids)) {
      for (const listId of list_ids) {
        db.prepare('INSERT OR IGNORE INTO list_contacts (list_id, contact_id) VALUES (?, ?)').run(listId, contact.id);
      }
    }

    fireWebhooks('contact.created', contact);
    res.status(201).json({ contact: { ...contact, custom_fields: JSON.parse(contact.custom_fields || '{}') } });
  } catch (error) {
    if (error.message.includes('UNIQUE constraint')) {
      return res.status(409).json({ error: 'Contact with this email already exists' });
    }
    throw error;
  }
});

// Update contact
router.put('/:id', requirePermission('write'), (req, res) => {
  const db = getDb();
  const existing = db.prepare('SELECT * FROM contacts WHERE id = ?').get(req.params.id);
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
    updates.push('updated_at = datetime("now")');
    db.prepare(`UPDATE contacts SET ${updates.join(', ')} WHERE id = ?`).run(...values, req.params.id);
  }

  const contact = db.prepare('SELECT * FROM contacts WHERE id = ?').get(req.params.id);
  fireWebhooks('contact.updated', contact);
  res.json({ contact: { ...contact, custom_fields: JSON.parse(contact.custom_fields || '{}') } });
});

// Delete contact
router.delete('/:id', requirePermission('admin'), (req, res) => {
  const db = getDb();
  db.prepare('DELETE FROM contacts WHERE id = ?').run(req.params.id);
  res.json({ message: 'Contact deleted' });
});

// Bulk import contacts via CSV
router.post('/import', requirePermission('write'), upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'CSV file is required' });

  const { list_id, tags: tagNames, source = 'csv_import' } = req.body;

  const records = parse(req.file.buffer.toString('utf8'), {
    columns: true,
    skip_empty_lines: true,
    trim: true,
  });

  const db = getDb();
  let imported = 0;
  let skipped = 0;
  let errors = [];

  const insertContact = db.prepare(`
    INSERT OR IGNORE INTO contacts (email, first_name, last_name, company, phone, title, industry, city, state, country, source)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const importTransaction = db.transaction(() => {
    for (const row of records) {
      const email = row.email || row.Email || row.EMAIL;
      if (!email || !email.includes('@')) {
        skipped++;
        errors.push(`Invalid email: ${email || 'empty'}`);
        continue;
      }

      // Check suppression
      const suppressed = db.prepare('SELECT id FROM suppression_list WHERE email = ? COLLATE NOCASE').get(email);
      if (suppressed) { skipped++; continue; }

      const result = insertContact.run(
        email,
        row.first_name || row.FirstName || row['First Name'] || '',
        row.last_name || row.LastName || row['Last Name'] || '',
        row.company || row.Company || '',
        row.phone || row.Phone || '',
        row.title || row.Title || '',
        row.industry || row.Industry || '',
        row.city || row.City || '',
        row.state || row.State || '',
        row.country || row.Country || '',
        source
      );

      if (result.changes > 0) {
        imported++;
        const contactId = result.lastInsertRowid;

        if (list_id) {
          db.prepare('INSERT OR IGNORE INTO list_contacts (list_id, contact_id) VALUES (?, ?)').run(parseInt(list_id), contactId);
        }

        if (tagNames) {
          const tagList = typeof tagNames === 'string' ? tagNames.split(',').map(t => t.trim()) : tagNames;
          for (const name of tagList) {
            db.prepare('INSERT OR IGNORE INTO tags (name) VALUES (?)').run(name);
            const tag = db.prepare('SELECT id FROM tags WHERE name = ?').get(name);
            if (tag) db.prepare('INSERT OR IGNORE INTO contact_tags (contact_id, tag_id) VALUES (?, ?)').run(contactId, tag.id);
          }
        }
      } else {
        skipped++;
      }
    }
  });

  importTransaction();

  // Update list count
  if (list_id) {
    const count = db.prepare('SELECT COUNT(*) as c FROM list_contacts WHERE list_id = ?').get(parseInt(list_id)).c;
    db.prepare('UPDATE lists SET contact_count = ?, updated_at = datetime("now") WHERE id = ?').run(count, parseInt(list_id));
  }

  fireWebhooks('contacts.imported', { imported, skipped, total: records.length });
  res.json({ imported, skipped, total: records.length, errors: errors.slice(0, 20) });
});

// Export contacts as CSV
router.get('/export/csv', (req, res) => {
  const db = getDb();
  const { list_id, status } = req.query;

  let where = '1=1';
  const params = [];
  if (list_id) { where += ' AND c.id IN (SELECT contact_id FROM list_contacts WHERE list_id = ?)'; params.push(parseInt(list_id)); }
  if (status) { where += ' AND c.status = ?'; params.push(status); }

  const contacts = db.prepare(`SELECT c.* FROM contacts c WHERE ${where} ORDER BY c.email`).all(...params);

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
});

module.exports = router;
