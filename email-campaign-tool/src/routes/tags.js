const express = require('express');
const router = express.Router();
const { getDb } = require('../db/connection');
const { authenticate, requirePermission } = require('../middleware/auth');

router.use(authenticate);

router.get('/', async (req, res, next) => {
  try {
    const db = getDb();
    const tags = await db.prepare(`
      SELECT t.*, (SELECT COUNT(*) FROM contact_tags WHERE tag_id = t.id) as contact_count
      FROM tags t ORDER BY t.name ASC
    `).all();
    res.json({ tags });
  } catch (err) { next(err); }
});

router.post('/', requirePermission('write'), async (req, res, next) => {
  try {
    const db = getDb();
    const { name, color } = req.body;
    if (!name) return res.status(400).json({ error: 'Tag name is required' });

    let result;
    try {
      result = await db.prepare('INSERT INTO tags (name, color) VALUES (?, ?)').run(name, color || '#6B7280');
    } catch (error) {
      if (error.message.includes('UNIQUE')) return res.status(409).json({ error: 'Tag already exists' });
      throw error;
    }
    const tag = await db.prepare('SELECT * FROM tags WHERE id = ?').get(result.lastInsertRowid);
    res.status(201).json({ tag });
  } catch (err) { next(err); }
});

router.put('/:id', requirePermission('write'), async (req, res, next) => {
  try {
    const db = getDb();
    const { name, color } = req.body;
    const updates = [];
    const values = [];
    if (name !== undefined) { updates.push('name = ?'); values.push(name); }
    if (color !== undefined) { updates.push('color = ?'); values.push(color); }

    if (updates.length > 0) {
      await db.prepare(`UPDATE tags SET ${updates.join(', ')} WHERE id = ?`).run(...values, req.params.id);
    }

    const tag = await db.prepare('SELECT * FROM tags WHERE id = ?').get(req.params.id);
    res.json({ tag });
  } catch (err) { next(err); }
});

router.delete('/:id', requirePermission('admin'), async (req, res, next) => {
  try {
    const db = getDb();
    await db.prepare('DELETE FROM tags WHERE id = ?').run(req.params.id);
    res.json({ message: 'Tag deleted' });
  } catch (err) { next(err); }
});

router.post('/:id/contacts', requirePermission('write'), async (req, res, next) => {
  try {
    const db = getDb();
    const { contact_ids } = req.body;
    if (!contact_ids || !Array.isArray(contact_ids)) return res.status(400).json({ error: 'contact_ids array required' });

    let added = 0;
    await db.transaction(async () => {
      for (const id of contact_ids) {
        const r = await db.prepare('INSERT OR IGNORE INTO contact_tags (contact_id, tag_id) VALUES (?, ?)').run(id, req.params.id);
        if (r.changes > 0) added++;
      }
    })();

    res.json({ added, total: contact_ids.length });
  } catch (err) { next(err); }
});

router.delete('/:id/contacts', requirePermission('write'), async (req, res, next) => {
  try {
    const db = getDb();
    const { contact_ids } = req.body;
    if (!contact_ids || !Array.isArray(contact_ids)) return res.status(400).json({ error: 'contact_ids array required' });

    await db.transaction(async () => {
      for (const id of contact_ids) {
        await db.prepare('DELETE FROM contact_tags WHERE contact_id = ? AND tag_id = ?').run(id, req.params.id);
      }
    })();

    res.json({ removed: contact_ids.length });
  } catch (err) { next(err); }
});

module.exports = router;
