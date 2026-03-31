const express = require('express');
const router = express.Router();
const { getDb } = require('../db/connection');
const { authenticate, requirePermission } = require('../middleware/auth');

router.use(authenticate);

// List all lists
router.get('/', (req, res) => {
  const db = getDb();
  const lists = db.prepare(`
    SELECT l.*, (SELECT COUNT(*) FROM list_contacts WHERE list_id = l.id) as contact_count
    FROM lists l ORDER BY l.created_at DESC
  `).all();
  res.json({ lists });
});

// Get list with contacts
router.get('/:id', (req, res) => {
  const db = getDb();
  const list = db.prepare('SELECT * FROM lists WHERE id = ?').get(req.params.id);
  if (!list) return res.status(404).json({ error: 'List not found' });

  const { page = 1, limit = 50 } = req.query;
  const offset = (parseInt(page) - 1) * parseInt(limit);

  const total = db.prepare('SELECT COUNT(*) as count FROM list_contacts WHERE list_id = ?').get(list.id).count;
  const contacts = db.prepare(`
    SELECT c.* FROM contacts c
    JOIN list_contacts lc ON lc.contact_id = c.id
    WHERE lc.list_id = ?
    ORDER BY lc.added_at DESC LIMIT ? OFFSET ?
  `).all(list.id, parseInt(limit), offset);

  res.json({
    list: { ...list, contact_count: total },
    contacts,
    pagination: { total, page: parseInt(page), limit: parseInt(limit), pages: Math.ceil(total / parseInt(limit)) },
  });
});

// Create list
router.post('/', requirePermission('write'), (req, res) => {
  const db = getDb();
  const { name, description, type = 'static', segment_rules } = req.body;
  if (!name) return res.status(400).json({ error: 'List name is required' });

  const result = db.prepare('INSERT INTO lists (name, description, type, segment_rules) VALUES (?, ?, ?, ?)')
    .run(name, description || '', type, JSON.stringify(segment_rules || []));

  const list = db.prepare('SELECT * FROM lists WHERE id = ?').get(result.lastInsertRowid);
  res.status(201).json({ list });
});

// Update list
router.put('/:id', requirePermission('write'), (req, res) => {
  const db = getDb();
  const { name, description, type, segment_rules } = req.body;

  const updates = [];
  const values = [];
  if (name !== undefined) { updates.push('name = ?'); values.push(name); }
  if (description !== undefined) { updates.push('description = ?'); values.push(description); }
  if (type !== undefined) { updates.push('type = ?'); values.push(type); }
  if (segment_rules !== undefined) { updates.push('segment_rules = ?'); values.push(JSON.stringify(segment_rules)); }

  if (updates.length > 0) {
    updates.push('updated_at = datetime("now")');
    db.prepare(`UPDATE lists SET ${updates.join(', ')} WHERE id = ?`).run(...values, req.params.id);
  }

  const list = db.prepare('SELECT * FROM lists WHERE id = ?').get(req.params.id);
  res.json({ list });
});

// Delete list
router.delete('/:id', requirePermission('admin'), (req, res) => {
  const db = getDb();
  db.prepare('DELETE FROM lists WHERE id = ?').run(req.params.id);
  res.json({ message: 'List deleted' });
});

// Add contacts to list
router.post('/:id/contacts', requirePermission('write'), (req, res) => {
  const db = getDb();
  const { contact_ids } = req.body;
  if (!contact_ids || !Array.isArray(contact_ids)) return res.status(400).json({ error: 'contact_ids array required' });

  let added = 0;
  const insert = db.prepare('INSERT OR IGNORE INTO list_contacts (list_id, contact_id) VALUES (?, ?)');
  const tx = db.transaction(() => {
    for (const id of contact_ids) {
      const r = insert.run(req.params.id, id);
      if (r.changes > 0) added++;
    }
  });
  tx();

  const count = db.prepare('SELECT COUNT(*) as c FROM list_contacts WHERE list_id = ?').get(req.params.id).c;
  db.prepare('UPDATE lists SET contact_count = ?, updated_at = datetime("now") WHERE id = ?').run(count, req.params.id);

  res.json({ added, total: count });
});

// Remove contacts from list
router.delete('/:id/contacts', requirePermission('write'), (req, res) => {
  const db = getDb();
  const { contact_ids } = req.body;
  if (!contact_ids || !Array.isArray(contact_ids)) return res.status(400).json({ error: 'contact_ids array required' });

  const del = db.prepare('DELETE FROM list_contacts WHERE list_id = ? AND contact_id = ?');
  const tx = db.transaction(() => { for (const id of contact_ids) del.run(req.params.id, id); });
  tx();

  const count = db.prepare('SELECT COUNT(*) as c FROM list_contacts WHERE list_id = ?').get(req.params.id).c;
  db.prepare('UPDATE lists SET contact_count = ?, updated_at = datetime("now") WHERE id = ?').run(count, req.params.id);

  res.json({ removed: contact_ids.length, total: count });
});

module.exports = router;
