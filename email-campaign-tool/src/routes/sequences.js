const express = require('express');
const router = express.Router();
const { getDb } = require('../db/connection');
const { authenticate, requirePermission } = require('../middleware/auth');
const { enrollContact } = require('../services/sequenceEngine');
const { fireWebhooks } = require('../services/webhookService');

router.use(authenticate);

router.get('/', async (req, res, next) => {
  try {
    const db = getDb();
    const sequences = await db.prepare('SELECT * FROM sequences ORDER BY created_at DESC').all();
    const enriched = await Promise.all(sequences.map(async s => {
      const stepRow = await db.prepare('SELECT COUNT(*) as c FROM sequence_steps WHERE sequence_id = ?').get(s.id);
      const activeRow = await db.prepare("SELECT COUNT(*) as c FROM sequence_enrollments WHERE sequence_id = ? AND status = 'active'").get(s.id);
      return { ...s, step_count: parseInt(stepRow.c, 10), active_enrollments: parseInt(activeRow.c, 10) };
    }));
    res.json({ sequences: enriched });
  } catch (err) { next(err); }
});

router.get('/:id', async (req, res, next) => {
  try {
    const db = getDb();
    const sequence = await db.prepare('SELECT * FROM sequences WHERE id = ?').get(req.params.id);
    if (!sequence) return res.status(404).json({ error: 'Sequence not found' });

    const steps = await db.prepare('SELECT * FROM sequence_steps WHERE sequence_id = ? ORDER BY step_order ASC').all(sequence.id);
    const enrollments = await db.prepare(`
      SELECT se.*, c.email, c.first_name, c.last_name
      FROM sequence_enrollments se
      JOIN contacts c ON c.id = se.contact_id
      WHERE se.sequence_id = ?
      ORDER BY se.enrolled_at DESC LIMIT 100
    `).all(sequence.id);

    const activeRow = await db.prepare("SELECT COUNT(*) as c FROM sequence_enrollments WHERE sequence_id = ? AND status = 'active'").get(sequence.id);
    const pausedRow = await db.prepare("SELECT COUNT(*) as c FROM sequence_enrollments WHERE sequence_id = ? AND status = 'paused'").get(sequence.id);
    const exitedRow = await db.prepare("SELECT COUNT(*) as c FROM sequence_enrollments WHERE sequence_id = ? AND status = 'exited'").get(sequence.id);

    const stats = {
      total_enrolled: sequence.total_enrolled,
      total_completed: sequence.total_completed,
      active: parseInt(activeRow.c, 10),
      paused: parseInt(pausedRow.c, 10),
      exited: parseInt(exitedRow.c, 10),
    };

    res.json({ sequence, steps, enrollments, stats });
  } catch (err) { next(err); }
});

router.post('/', requirePermission('write'), async (req, res, next) => {
  try {
    const db = getDb();
    const { name, description, trigger_type, trigger_config, list_ids } = req.body;
    if (!name) return res.status(400).json({ error: 'Sequence name is required' });

    const result = await db.prepare(`
      INSERT INTO sequences (name, description, trigger_type, trigger_config, list_ids)
      VALUES (?, ?, ?, ?, ?)
    `).run(name, description || '', trigger_type || 'manual', JSON.stringify(trigger_config || {}), JSON.stringify(list_ids || []));

    const sequence = await db.prepare('SELECT * FROM sequences WHERE id = ?').get(result.lastInsertRowid);
    res.status(201).json({ sequence });
  } catch (err) { next(err); }
});

router.put('/:id', requirePermission('write'), async (req, res, next) => {
  try {
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
      updates.push('updated_at = NOW()');
      await db.prepare(`UPDATE sequences SET ${updates.join(', ')} WHERE id = ?`).run(...values, req.params.id);
    }

    const sequence = await db.prepare('SELECT * FROM sequences WHERE id = ?').get(req.params.id);
    res.json({ sequence });
  } catch (err) { next(err); }
});

router.delete('/:id', requirePermission('admin'), async (req, res, next) => {
  try {
    const db = getDb();
    await db.prepare('DELETE FROM sequences WHERE id = ?').run(req.params.id);
    res.json({ message: 'Sequence deleted' });
  } catch (err) { next(err); }
});

router.put('/:id/steps', requirePermission('write'), async (req, res, next) => {
  try {
    const db = getDb();
    const { steps } = req.body;
    if (!steps || !Array.isArray(steps)) return res.status(400).json({ error: 'Steps array required' });

    await db.transaction(async () => {
      await db.prepare('DELETE FROM sequence_steps WHERE sequence_id = ?').run(req.params.id);

      for (let i = 0; i < steps.length; i++) {
        const s = steps[i];
        await db.prepare(`
          INSERT INTO sequence_steps (sequence_id, step_order, type, subject, html_content, text_content, template_id, delay_amount, delay_unit, condition_rules, webhook_url, webhook_method, webhook_headers, webhook_body, action_type, action_target, is_active)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
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
    })();

    const updatedSteps = await db.prepare('SELECT * FROM sequence_steps WHERE sequence_id = ? ORDER BY step_order').all(req.params.id);
    res.json({ steps: updatedSteps });
  } catch (err) { next(err); }
});

router.post('/:id/enroll', requirePermission('write'), async (req, res, next) => {
  try {
    const db = getDb();
    const { contact_ids } = req.body;
    if (!contact_ids || !Array.isArray(contact_ids)) return res.status(400).json({ error: 'contact_ids array required' });

    const sequence = await db.prepare('SELECT * FROM sequences WHERE id = ?').get(req.params.id);
    if (!sequence) return res.status(404).json({ error: 'Sequence not found' });
    if (sequence.status !== 'active') return res.status(400).json({ error: 'Sequence is not active' });

    let enrolled = 0;
    let skipped = 0;
    for (const contactId of contact_ids) {
      const result = await enrollContact(sequence.id, contactId);
      if (result.enrolled) enrolled++;
      else skipped++;
    }

    res.json({ enrolled, skipped, total: contact_ids.length });
  } catch (err) { next(err); }
});

router.delete('/:id/enrollments/:enrollmentId', requirePermission('write'), async (req, res, next) => {
  try {
    const db = getDb();
    await db.prepare("UPDATE sequence_enrollments SET status = 'exited', updated_at = NOW() WHERE id = ? AND sequence_id = ?")
      .run(req.params.enrollmentId, req.params.id);
    res.json({ message: 'Enrollment removed' });
  } catch (err) { next(err); }
});

module.exports = router;
