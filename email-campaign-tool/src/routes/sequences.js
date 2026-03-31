const express = require('express');
const router = express.Router();
const { getDb } = require('../db/connection');
const { authenticate, requirePermission } = require('../middleware/auth');
const { enrollContact } = require('../services/sequenceEngine');
const { fireWebhooks } = require('../services/webhookService');

router.use(authenticate);

// List sequences
router.get('/', (req, res) => {
  const db = getDb();
  const sequences = db.prepare('SELECT * FROM sequences ORDER BY created_at DESC').all();
  const enriched = sequences.map(s => {
    const stepCount = db.prepare('SELECT COUNT(*) as c FROM sequence_steps WHERE sequence_id = ?').get(s.id).c;
    const activeEnrollments = db.prepare('SELECT COUNT(*) as c FROM sequence_enrollments WHERE sequence_id = ? AND status = "active"').get(s.id).c;
    return { ...s, step_count: stepCount, active_enrollments: activeEnrollments };
  });
  res.json({ sequences: enriched });
});

// Get sequence with steps and stats
router.get('/:id', (req, res) => {
  const db = getDb();
  const sequence = db.prepare('SELECT * FROM sequences WHERE id = ?').get(req.params.id);
  if (!sequence) return res.status(404).json({ error: 'Sequence not found' });

  const steps = db.prepare('SELECT * FROM sequence_steps WHERE sequence_id = ? ORDER BY step_order ASC').all(sequence.id);
  const enrollments = db.prepare(`
    SELECT se.*, c.email, c.first_name, c.last_name
    FROM sequence_enrollments se
    JOIN contacts c ON c.id = se.contact_id
    WHERE se.sequence_id = ?
    ORDER BY se.enrolled_at DESC LIMIT 100
  `).all(sequence.id);

  const stats = {
    total_enrolled: sequence.total_enrolled,
    total_completed: sequence.total_completed,
    active: db.prepare('SELECT COUNT(*) as c FROM sequence_enrollments WHERE sequence_id = ? AND status = "active"').get(sequence.id).c,
    paused: db.prepare('SELECT COUNT(*) as c FROM sequence_enrollments WHERE sequence_id = ? AND status = "paused"').get(sequence.id).c,
    exited: db.prepare('SELECT COUNT(*) as c FROM sequence_enrollments WHERE sequence_id = ? AND status = "exited"').get(sequence.id).c,
  };

  res.json({ sequence, steps, enrollments, stats });
});

// Create sequence
router.post('/', requirePermission('write'), (req, res) => {
  const db = getDb();
  const { name, description, trigger_type, trigger_config, list_ids } = req.body;
  if (!name) return res.status(400).json({ error: 'Sequence name is required' });

  const result = db.prepare(`
    INSERT INTO sequences (name, description, trigger_type, trigger_config, list_ids)
    VALUES (?, ?, ?, ?, ?)
  `).run(name, description || '', trigger_type || 'manual', JSON.stringify(trigger_config || {}), JSON.stringify(list_ids || []));

  const sequence = db.prepare('SELECT * FROM sequences WHERE id = ?').get(result.lastInsertRowid);
  res.status(201).json({ sequence });
});

// Update sequence
router.put('/:id', requirePermission('write'), (req, res) => {
  const db = getDb();
  const { name, description, trigger_type, trigger_config, status, list_ids } = req.body;
  const updates = [];
  const values = [];

  if (name !== undefined) { updates.push('name = ?'); values.push(name); }
  if (description !== undefined) { updates.push('description = ?'); values.push(description); }
  if (trigger_type !== undefined) { updates.push('trigger_type = ?'); values.push(trigger_type); }
  if (trigger_config !== undefined) { updates.push('trigger_config = ?'); values.push(JSON.stringify(trigger_config)); }
  if (status !== undefined) { updates.push('status = ?'); values.push(status); }
  if (list_ids !== undefined) { updates.push('list_ids = ?'); values.push(JSON.stringify(list_ids)); }

  if (updates.length > 0) {
    updates.push('updated_at = datetime("now")');
    db.prepare(`UPDATE sequences SET ${updates.join(', ')} WHERE id = ?`).run(...values, req.params.id);
  }

  const sequence = db.prepare('SELECT * FROM sequences WHERE id = ?').get(req.params.id);
  res.json({ sequence });
});

// Delete sequence
router.delete('/:id', requirePermission('admin'), (req, res) => {
  const db = getDb();
  db.prepare('DELETE FROM sequences WHERE id = ?').run(req.params.id);
  res.json({ message: 'Sequence deleted' });
});

// Add/update steps
router.put('/:id/steps', requirePermission('write'), (req, res) => {
  const db = getDb();
  const { steps } = req.body;
  if (!steps || !Array.isArray(steps)) return res.status(400).json({ error: 'Steps array required' });

  // Delete existing steps and re-insert
  const tx = db.transaction(() => {
    db.prepare('DELETE FROM sequence_steps WHERE sequence_id = ?').run(req.params.id);

    const insert = db.prepare(`
      INSERT INTO sequence_steps (sequence_id, step_order, type, subject, html_content, text_content, template_id, delay_amount, delay_unit, condition_rules, webhook_url, webhook_method, webhook_headers, webhook_body, action_type, action_target, is_active)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    for (let i = 0; i < steps.length; i++) {
      const s = steps[i];
      insert.run(
        req.params.id, i, s.type || 'email',
        s.subject || '', s.html_content || '', s.text_content || '', s.template_id || null,
        s.delay_amount || 1, s.delay_unit || 'days',
        JSON.stringify(s.condition_rules || {}),
        s.webhook_url || '', s.webhook_method || 'POST',
        JSON.stringify(s.webhook_headers || {}), s.webhook_body || '',
        s.action_type || '', s.action_target || '',
        s.is_active !== undefined ? (s.is_active ? 1 : 0) : 1
      );
    }
  });
  tx();

  const updatedSteps = db.prepare('SELECT * FROM sequence_steps WHERE sequence_id = ? ORDER BY step_order').all(req.params.id);
  res.json({ steps: updatedSteps });
});

// Enroll contacts
router.post('/:id/enroll', requirePermission('write'), (req, res) => {
  const db = getDb();
  const { contact_ids } = req.body;
  if (!contact_ids || !Array.isArray(contact_ids)) return res.status(400).json({ error: 'contact_ids array required' });

  const sequence = db.prepare('SELECT * FROM sequences WHERE id = ?').get(req.params.id);
  if (!sequence) return res.status(404).json({ error: 'Sequence not found' });
  if (sequence.status !== 'active') return res.status(400).json({ error: 'Sequence is not active' });

  let enrolled = 0;
  let skipped = 0;
  for (const contactId of contact_ids) {
    const result = enrollContact(sequence.id, contactId);
    if (result.enrolled) enrolled++;
    else skipped++;
  }

  res.json({ enrolled, skipped, total: contact_ids.length });
});

// Remove enrollment
router.delete('/:id/enrollments/:enrollmentId', requirePermission('write'), (req, res) => {
  const db = getDb();
  db.prepare('UPDATE sequence_enrollments SET status = "exited", updated_at = datetime("now") WHERE id = ? AND sequence_id = ?')
    .run(req.params.enrollmentId, req.params.id);
  res.json({ message: 'Enrollment removed' });
});

module.exports = router;
