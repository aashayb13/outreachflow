const express = require('express');
const router = express.Router();
const { getDb } = require('../db/connection');
const { authenticate, requirePermission } = require('../middleware/auth');
const { renderTemplate } = require('../services/templateEngine');

router.use(authenticate);

// List templates
router.get('/', (req, res) => {
  const db = getDb();
  const { category, search, active_only } = req.query;

  let where = '1=1';
  const params = [];
  if (category) { where += ' AND category = ?'; params.push(category); }
  if (search) { where += ' AND (name LIKE ? OR subject LIKE ?)'; params.push(`%${search}%`, `%${search}%`); }
  if (active_only === 'true') { where += ' AND is_active = 1'; }

  const templates = db.prepare(`SELECT id, name, subject, category, is_active, created_at, updated_at FROM templates WHERE ${where} ORDER BY updated_at DESC`).all(...params);
  res.json({ templates });
});

// Get single template
router.get('/:id', (req, res) => {
  const db = getDb();
  const template = db.prepare('SELECT * FROM templates WHERE id = ?').get(req.params.id);
  if (!template) return res.status(404).json({ error: 'Template not found' });
  res.json({ template: { ...template, variables: JSON.parse(template.variables || '[]') } });
});

// Preview template with variables
router.post('/:id/preview', (req, res) => {
  const db = getDb();
  const template = db.prepare('SELECT * FROM templates WHERE id = ?').get(req.params.id);
  if (!template) return res.status(404).json({ error: 'Template not found' });

  const variables = req.body.variables || {};
  const html = renderTemplate(template.html_content, variables);
  const text = renderTemplate(template.text_content, variables);
  const subject = renderTemplate(template.subject, variables);

  res.json({ subject, html, text });
});

// Create template
router.post('/', requirePermission('write'), (req, res) => {
  const db = getDb();
  const { name, subject, html_content, text_content, category, variables } = req.body;
  if (!name) return res.status(400).json({ error: 'Template name is required' });

  const result = db.prepare(`
    INSERT INTO templates (name, subject, html_content, text_content, category, variables)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(name, subject || '', html_content || '', text_content || '', category || 'general', JSON.stringify(variables || []));

  const template = db.prepare('SELECT * FROM templates WHERE id = ?').get(result.lastInsertRowid);
  res.status(201).json({ template });
});

// Update template
router.put('/:id', requirePermission('write'), (req, res) => {
  const db = getDb();
  const fields = ['name', 'subject', 'html_content', 'text_content', 'category', 'is_active'];
  const updates = [];
  const values = [];

  for (const field of fields) {
    if (req.body[field] !== undefined) {
      updates.push(`${field} = ?`);
      values.push(req.body[field]);
    }
  }
  if (req.body.variables !== undefined) {
    updates.push('variables = ?');
    values.push(JSON.stringify(req.body.variables));
  }

  if (updates.length > 0) {
    updates.push('updated_at = datetime("now")');
    db.prepare(`UPDATE templates SET ${updates.join(', ')} WHERE id = ?`).run(...values, req.params.id);
  }

  const template = db.prepare('SELECT * FROM templates WHERE id = ?').get(req.params.id);
  res.json({ template });
});

// Delete template
router.delete('/:id', requirePermission('admin'), (req, res) => {
  const db = getDb();
  db.prepare('DELETE FROM templates WHERE id = ?').run(req.params.id);
  res.json({ message: 'Template deleted' });
});

// Duplicate template
router.post('/:id/duplicate', requirePermission('write'), (req, res) => {
  const db = getDb();
  const original = db.prepare('SELECT * FROM templates WHERE id = ?').get(req.params.id);
  if (!original) return res.status(404).json({ error: 'Template not found' });

  const result = db.prepare(`
    INSERT INTO templates (name, subject, html_content, text_content, category, variables)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(`${original.name} (Copy)`, original.subject, original.html_content, original.text_content, original.category, original.variables);

  const template = db.prepare('SELECT * FROM templates WHERE id = ?').get(result.lastInsertRowid);
  res.status(201).json({ template });
});

module.exports = router;
