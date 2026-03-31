const { getDb } = require('../db/connection');
const { sendEmail } = require('./mailer');
const { renderTemplate } = require('./templateEngine');
const { fireWebhooks } = require('./webhookService');
const config = require('../config');
const logger = require('../utils/logger');

/**
 * Enroll a contact into a drip sequence.
 */
function enrollContact(sequenceId, contactId) {
  const db = getDb();

  // Check if already enrolled and active
  const existing = db.prepare(`
    SELECT id FROM sequence_enrollments
    WHERE sequence_id = ? AND contact_id = ? AND status = 'active'
  `).get(sequenceId, contactId);

  if (existing) return { enrolled: false, reason: 'Already enrolled' };

  // Get first step
  const firstStep = db.prepare(`
    SELECT * FROM sequence_steps WHERE sequence_id = ? AND is_active = 1 ORDER BY step_order ASC LIMIT 1
  `).get(sequenceId);

  let nextActionAt = new Date().toISOString();
  if (firstStep && firstStep.type === 'delay') {
    nextActionAt = calculateDelayDate(firstStep.delay_amount, firstStep.delay_unit);
  }

  db.prepare(`
    INSERT INTO sequence_enrollments (sequence_id, contact_id, current_step, status, next_action_at)
    VALUES (?, ?, 0, 'active', ?)
  `).run(sequenceId, contactId, nextActionAt);

  db.prepare('UPDATE sequences SET total_enrolled = total_enrolled + 1, updated_at = datetime("now") WHERE id = ?')
    .run(sequenceId);

  fireWebhooks('sequence.enrolled', { sequence_id: sequenceId, contact_id: contactId });

  return { enrolled: true };
}

/**
 * Process all pending sequence actions (run on a cron).
 */
async function processSequences() {
  const db = getDb();

  const dueEnrollments = db.prepare(`
    SELECT se.*, s.name as sequence_name
    FROM sequence_enrollments se
    JOIN sequences s ON s.id = se.sequence_id
    WHERE se.status = 'active'
      AND se.next_action_at <= datetime('now')
      AND s.status = 'active'
    ORDER BY se.next_action_at ASC
    LIMIT 100
  `).all();

  logger.info(`Processing ${dueEnrollments.length} sequence enrollments`);

  for (const enrollment of dueEnrollments) {
    try {
      await processEnrollmentStep(enrollment);
    } catch (error) {
      logger.error(`Error processing enrollment ${enrollment.id}: ${error.message}`);
      db.prepare('UPDATE sequence_enrollments SET status = "failed", updated_at = datetime("now") WHERE id = ?')
        .run(enrollment.id);
    }
  }
}

async function processEnrollmentStep(enrollment) {
  const db = getDb();

  const steps = db.prepare(`
    SELECT * FROM sequence_steps WHERE sequence_id = ? AND is_active = 1 ORDER BY step_order ASC
  `).all(enrollment.sequence_id);

  if (enrollment.current_step >= steps.length) {
    // Sequence complete
    db.prepare(`
      UPDATE sequence_enrollments SET status = 'completed', completed_at = datetime('now'), updated_at = datetime('now') WHERE id = ?
    `).run(enrollment.id);
    db.prepare('UPDATE sequences SET total_completed = total_completed + 1, updated_at = datetime("now") WHERE id = ?')
      .run(enrollment.sequence_id);
    fireWebhooks('sequence.completed', {
      sequence_id: enrollment.sequence_id,
      contact_id: enrollment.contact_id,
    });
    return;
  }

  const step = steps[enrollment.current_step];
  const contact = db.prepare('SELECT * FROM contacts WHERE id = ?').get(enrollment.contact_id);

  if (!contact || contact.status !== 'active') {
    db.prepare('UPDATE sequence_enrollments SET status = "exited", updated_at = datetime("now") WHERE id = ?')
      .run(enrollment.id);
    return;
  }

  switch (step.type) {
    case 'email': {
      let html = step.html_content;
      let text = step.text_content;
      let subject = step.subject;

      if (step.template_id) {
        const template = db.prepare('SELECT * FROM templates WHERE id = ?').get(step.template_id);
        if (template) {
          html = html || template.html_content;
          text = text || template.text_content;
          subject = subject || template.subject;
        }
      }

      const vars = {
        ...JSON.parse(contact.custom_fields || '{}'),
        first_name: contact.first_name,
        last_name: contact.last_name,
        email: contact.email,
        company: contact.company,
      };

      const result = await sendEmail({
        to: contact.email,
        subject: renderTemplate(subject, vars),
        html: renderTemplate(html, vars),
        text: renderTemplate(text, vars),
      });

      if (!result.success) {
        logger.error(`Sequence email failed for contact ${contact.id}: ${result.error}`);
      }
      break;
    }

    case 'delay':
      // Delay is handled by setting next_action_at
      break;

    case 'webhook': {
      try {
        await fetch(step.webhook_url, {
          method: step.webhook_method || 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...JSON.parse(step.webhook_headers || '{}'),
          },
          body: renderTemplate(step.webhook_body || '{}', {
            contact_id: contact.id,
            email: contact.email,
            first_name: contact.first_name,
            last_name: contact.last_name,
          }),
          signal: AbortSignal.timeout(10000),
        });
      } catch (error) {
        logger.error(`Sequence webhook step failed: ${error.message}`);
      }
      break;
    }

    case 'tag': {
      if (step.action_type === 'add') {
        const tag = db.prepare('SELECT id FROM tags WHERE name = ?').get(step.action_target);
        if (tag) {
          db.prepare('INSERT OR IGNORE INTO contact_tags (contact_id, tag_id) VALUES (?, ?)')
            .run(contact.id, tag.id);
        }
      } else if (step.action_type === 'remove') {
        const tag = db.prepare('SELECT id FROM tags WHERE name = ?').get(step.action_target);
        if (tag) {
          db.prepare('DELETE FROM contact_tags WHERE contact_id = ? AND tag_id = ?')
            .run(contact.id, tag.id);
        }
      }
      break;
    }

    case 'list_action': {
      const list = db.prepare('SELECT id FROM lists WHERE name = ?').get(step.action_target);
      if (list) {
        if (step.action_type === 'add') {
          db.prepare('INSERT OR IGNORE INTO list_contacts (list_id, contact_id) VALUES (?, ?)')
            .run(list.id, contact.id);
        } else if (step.action_type === 'remove') {
          db.prepare('DELETE FROM list_contacts WHERE list_id = ? AND contact_id = ?')
            .run(list.id, contact.id);
        }
      }
      break;
    }
  }

  // Advance to next step
  const nextStepIdx = enrollment.current_step + 1;
  let nextActionAt;

  if (nextStepIdx < steps.length) {
    const nextStep = steps[nextStepIdx];
    if (nextStep.type === 'delay') {
      nextActionAt = calculateDelayDate(nextStep.delay_amount, nextStep.delay_unit);
    } else {
      nextActionAt = new Date().toISOString();
    }
  } else {
    nextActionAt = new Date().toISOString();
  }

  db.prepare(`
    UPDATE sequence_enrollments SET current_step = ?, next_action_at = ?, updated_at = datetime('now') WHERE id = ?
  `).run(nextStepIdx, nextActionAt, enrollment.id);
}

function calculateDelayDate(amount, unit) {
  const now = new Date();
  switch (unit) {
    case 'minutes': now.setMinutes(now.getMinutes() + amount); break;
    case 'hours': now.setHours(now.getHours() + amount); break;
    case 'days': now.setDate(now.getDate() + amount); break;
    case 'weeks': now.setDate(now.getDate() + amount * 7); break;
  }
  return now.toISOString();
}

module.exports = { enrollContact, processSequences };
