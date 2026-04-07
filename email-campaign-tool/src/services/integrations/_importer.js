/**
 * Shared importer for lead-gen integrations.
 *
 * Takes the normalized lead objects returned by a provider adapter and
 * upserts them into the contacts table. Honors the global suppression list,
 * skips invalid/duplicate emails, and (optionally) adds them to a list and
 * applies tags.
 *
 * Returns { imported, skipped, errors } so the route layer can surface a
 * preview/dry-run or persist a sync log.
 */

const { getDb } = require('../../db/connection');
const { fireWebhooks } = require('../webhookService');
const logger = require('../../utils/logger');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Normalize a provider lead into the contact-table shape.
 * Adapters should already do most of this, but this is a safety net.
 */
function normalizeLead(lead) {
  return {
    email: (lead.email || '').trim().toLowerCase(),
    first_name: lead.first_name || lead.firstName || '',
    last_name: lead.last_name || lead.lastName || '',
    company: lead.company || lead.organization || lead.organization_name || '',
    phone: lead.phone || lead.phone_number || '',
    title: lead.title || lead.job_title || '',
    industry: lead.industry || '',
    city: lead.city || '',
    state: lead.state || '',
    country: lead.country || '',
    custom_fields: lead.custom_fields || {},
  };
}

/**
 * Import an array of normalized leads.
 *
 * options: { source, list_id, tags, dry_run }
 */
function importLeads(leads, options = {}) {
  const { source = 'integration', list_id, tags = [], dry_run = false } = options;
  const db = getDb();

  let imported = 0;
  let skipped = 0;
  const errors = [];
  const previewSamples = [];
  const importedContacts = [];

  const insertContact = db.prepare(`
    INSERT OR IGNORE INTO contacts
      (email, first_name, last_name, company, phone, title, industry, city, state, country, custom_fields, source)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const tx = db.transaction(() => {
    for (const raw of leads) {
      const c = normalizeLead(raw);

      if (!c.email || !EMAIL_RE.test(c.email)) {
        skipped++;
        errors.push(`Invalid email: ${c.email || '(empty)'}`);
        continue;
      }

      // Honor suppression list — never import suppressed addresses.
      const suppressed = db.prepare(
        'SELECT id FROM suppression_list WHERE email = ? COLLATE NOCASE'
      ).get(c.email);
      if (suppressed) { skipped++; continue; }

      if (dry_run) {
        if (previewSamples.length < 25) previewSamples.push(c);
        imported++;
        continue;
      }

      const result = insertContact.run(
        c.email, c.first_name, c.last_name, c.company, c.phone,
        c.title, c.industry, c.city, c.state, c.country,
        JSON.stringify(c.custom_fields || {}), source
      );

      if (result.changes > 0) {
        imported++;
        const contactId = result.lastInsertRowid;
        importedContacts.push({ id: contactId, email: c.email });

        if (list_id) {
          db.prepare(
            'INSERT OR IGNORE INTO list_contacts (list_id, contact_id) VALUES (?, ?)'
          ).run(parseInt(list_id, 10), contactId);
        }

        if (Array.isArray(tags) && tags.length) {
          for (const name of tags) {
            const tagName = String(name).trim();
            if (!tagName) continue;
            db.prepare('INSERT OR IGNORE INTO tags (name) VALUES (?)').run(tagName);
            const tag = db.prepare('SELECT id FROM tags WHERE name = ?').get(tagName);
            if (tag) {
              db.prepare(
                'INSERT OR IGNORE INTO contact_tags (contact_id, tag_id) VALUES (?, ?)'
              ).run(contactId, tag.id);
            }
          }
        }
      } else {
        // Already existed — count as skipped (duplicate).
        skipped++;
      }
    }
  });

  try {
    tx();
  } catch (err) {
    logger.error(`Integration import failed: ${err.message}`);
    throw err;
  }

  // Refresh list count if we touched a list.
  if (!dry_run && list_id) {
    const c = db.prepare('SELECT COUNT(*) as c FROM list_contacts WHERE list_id = ?')
      .get(parseInt(list_id, 10)).c;
    db.prepare('UPDATE lists SET contact_count = ?, updated_at = datetime("now") WHERE id = ?')
      .run(c, parseInt(list_id, 10));
  }

  if (!dry_run && imported > 0) {
    fireWebhooks('contacts.imported', { source, imported, skipped, total: leads.length });
  }

  return {
    imported,
    skipped,
    total: leads.length,
    errors: errors.slice(0, 20),
    preview: dry_run ? previewSamples : undefined,
    contacts: dry_run ? undefined : importedContacts.slice(0, 100),
  };
}

module.exports = { importLeads, normalizeLead };
