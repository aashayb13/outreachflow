const express = require('express');
const router = express.Router();
const { getDb } = require('../db/connection');
const { authenticate, requirePermission } = require('../middleware/auth');

router.use(authenticate);

router.get('/', (req, res) => {
  const db = getDb();
  const tags = db.prepare(`
    SELECT t.*, (SELECT COUNT(*) FROM contact_tags WHERE tag_id = t.id) as contact_count
    FROM tags t ORDER BY t.name ASC
  `).all();
  res.json({ tags });
});

router.post('/', requirePermission('write'), (req, res) => {
  const db = getDb();
  const { name, color } = req.body;
  if (!name) return res.status(400).json({ error: 'Tag name is required' });

  try {
    const result = db.prepare('INSERT INTO tags (name, color) VALUES (?, ?)').run(name, color || '#6B7280');
    const tag = db.prepare('SELECT * FROM tags WHERE id = ?').get(result.lastInsertRowid);
    res.status(201).json({ tag });
  } catch (error) {
    if (error.message.includes('UNIQUE')) return res.status(409).json({ error: 'Tag already exists' });
    throw error;
  }
});

router.put('/:id', requirePermission('write'), (req, res) => {
  const db = getDb();
  const { name, color } = req.body;
  const updates = [];
  const values = [];
  if (name !== undefined) { updates.push('name = ?'); values.push(name); }
  if (color !== undefined) { updates.push('color = ?'); values.push(color); }

  if (updates.length > 0) {
    db.prepare(`UPDATE tags SET ${updates.join(', ')} WHERE id = ?`).run(...values, req.params.id);
  }

  const tag = db.prepare('SELECT * FROM tags WHERE id = ?').get(req.params.id);
  res.json({ tag });
});

router.delete('/:id', requirePermission('admin'), (req, res) => {
  const db = getDb();
  db.prepare('DELETE FROM tags WHERE id = ?').run(req.params.id);
  res.json({ message: 'Tag deleted' });
});

// Bulk tag contacts
router.post('/:id/contacts', requirePermission('write'), (req, res) => {
  const db = getDb();
  const { contact_ids } = req.body;
  if (!contact_ids || !Array.isArray(contact_ids)) return res.status(400).json({ error: 'contact_ids array required' });

  let added = 0;
  const insert = db.prepare('INSERT OR IGNORE INTO contact_tags (contact_id, tag_id) VALUES (?, ?)');
  const tx = db.transaction(() => {
    for (const id of contact_ids) {
      const r = insert.run(id, req.params.id);
      if (r.changes > 0) added++;
    }
  });
  tx();

  res.json({ added, total: contact_ids.length });
});

// Remove tag from contacts
router.delete('/:id/contacts', requirePermission('write'), (req, res) => {
  const db = getDb();
  const { contact_ids } = req.body;
  if (!contact_ids || !Array.isArray(contact_ids)) return res.status(400).json({ error: 'contact_ids array required' });

  const del = db.prepare('DELETE FROM contact_tags WHERE contact_id = ? AND tag_id = ?');
  const tx = db.transaction(() => { for (const id of contact_ids) del.run(id, req.params.id); });
  tx();

  res.json({ removed: contact_ids.length });
});

module.exports = router;
