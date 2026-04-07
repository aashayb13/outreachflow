/**
 * Shared importer for lead-gen integrations.
 */

const { getDb } = require('../../db/connection');
const { fireWebhooks } = require('../webhookService');
const logger = require('../../utils/logger');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Map of canonical contact field → list of accepted aliases (case-sensitive,
// matched verbatim against the CSV header). Covers Apollo, Hunter, Lead Magic,
// HubSpot, Salesforce, plus snake_case / camelCase variants.
const FIELD_ALIASES = {
  email:      ['email', 'Email', 'EMAIL', 'Email Address', 'email_address', 'work_email', 'Work Email'],
  first_name: ['first_name', 'firstName', 'FirstName', 'First Name', 'first name'],
  last_name:  ['last_name', 'lastName', 'LastName', 'Last Name', 'last name'],
  company:    ['company', 'Company', 'organization', 'organization_name', 'Organization', 'Company Name', 'company_name', 'Account Name'],
  phone:      ['phone', 'Phone', 'phone_number', 'Phone Number', 'Work Direct Phone', 'Mobile Phone', 'Corporate Phone', 'Direct Phone'],
  title:      ['title', 'Title', 'job_title', 'Job Title', 'Position'],
  industry:   ['industry', 'Industry'],
  city:       ['city', 'City', 'Company City', 'Contact City'],
  state:      ['state', 'State', 'Company State', 'Contact State'],
  country:    ['country', 'Country', 'Company Country', 'Contact Country'],
};

// Build a reverse lookup: lowercased alias → canonical field name.
// We lowercase to make matching forgiving against weird Apollo variants.
const ALIAS_TO_FIELD = (() => {
  const map = {};
  for (const [field, aliases] of Object.entries(FIELD_ALIASES)) {
    for (const alias of aliases) map[alias.toLowerCase().trim()] = field;
  }
  return map;
})();

// Core fields that get their own column on contacts. Anything in the row
// that ISN'T one of these is stashed into custom_fields so Apollo extras
// like "Person Linkedin Url", "Annual Revenue", "Apollo Contact Id", etc.
// are preserved without losing data.
const CORE_FIELDS = new Set([
  'email', 'first_name', 'last_name', 'company', 'phone',
  'title', 'industry', 'city', 'state', 'country',
]);

/**
 * Normalize a raw lead row (from a CSV, API response, or webhook payload)
 * into the contact-table shape. Recognizes Apollo / Hunter / Lead Magic /
 * HubSpot column names, and stashes everything else into custom_fields.
 */
function normalizeLead(lead) {
  // First pass: pull out aliased fields into a normalized object.
  const out = {
    email: '', first_name: '', last_name: '', company: '', phone: '',
    title: '', industry: '', city: '', state: '', country: '',
    custom_fields: {},
  };

  // If the caller already passed a custom_fields object, preserve it.
  if (lead.custom_fields && typeof lead.custom_fields === 'object') {
    Object.assign(out.custom_fields, lead.custom_fields);
  }

  for (const [rawKey, rawVal] of Object.entries(lead)) {
    if (rawKey === 'custom_fields') continue;
    const val = rawVal == null ? '' : String(rawVal).trim();
    if (!val) continue;

    const canonical = ALIAS_TO_FIELD[rawKey.toLowerCase().trim()];
    if (canonical && !out[canonical]) {
      out[canonical] = val;
    } else if (!canonical) {
      // Unknown column → stash into custom_fields under a normalized key
      // (e.g. "Person Linkedin Url" → "person_linkedin_url"). Strip empty
      // values and obvious noise so the JSON blob stays useful.
      const key = rawKey.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
      if (key && !(key in out.custom_fields)) {
        out.custom_fields[key] = val;
      }
    }
  }

  out.email = out.email.toLowerCase();
  return out;
}

/**
 * Import an array of normalized leads.
 *
 * options: { source, list_id, tags, dry_run }
 */
async function importLeads(leads, options = {}) {
  const { source = 'integration', list_id, tags = [], dry_run = false } = options;
  const db = getDb();

  let imported = 0;
  let skipped = 0;
  const errors = [];
  const previewSamples = [];
  const importedContacts = [];

  try {
    await db.transaction(async () => {
      for (const raw of leads) {
        const c = normalizeLead(raw);

        if (!c.email || !EMAIL_RE.test(c.email)) {
          skipped++;
          errors.push(`Invalid email: ${c.email || '(empty)'}`);
          continue;
        }

        const suppressed = await db.prepare('SELECT id FROM suppression_list WHERE email = ?').get(c.email);
        if (suppressed) { skipped++; continue; }

        if (dry_run) {
          if (previewSamples.length < 25) previewSamples.push(c);
          imported++;
          continue;
        }

        const result = await db.prepare(`
          INSERT OR IGNORE INTO contacts
            (email, first_name, last_name, company, phone, title, industry, city, state, country, custom_fields, source)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          c.email, c.first_name, c.last_name, c.company, c.phone,
          c.title, c.industry, c.city, c.state, c.country,
          JSON.stringify(c.custom_fields || {}), source
        );

        if (result.changes > 0) {
          imported++;
          const contactId = result.lastInsertRowid;
          importedContacts.push({ id: contactId, email: c.email });

          if (list_id) {
            await db.prepare('INSERT OR IGNORE INTO list_contacts (list_id, contact_id) VALUES (?, ?)').run(parseInt(list_id, 10), contactId);
          }

          if (Array.isArray(tags) && tags.length) {
            for (const name of tags) {
              const tagName = String(name).trim();
              if (!tagName) continue;
              await db.prepare('INSERT OR IGNORE INTO tags (name) VALUES (?)').run(tagName);
              const tag = await db.prepare('SELECT id FROM tags WHERE name = ?').get(tagName);
              if (tag) {
                await db.prepare('INSERT OR IGNORE INTO contact_tags (contact_id, tag_id) VALUES (?, ?)').run(contactId, tag.id);
              }
            }
          }
        } else {
          skipped++;
        }
      }
    })();
  } catch (err) {
    logger.error(`Integration import failed: ${err.message}`);
    throw err;
  }

  if (!dry_run && list_id) {
    const row = await db.prepare('SELECT COUNT(*) as c FROM list_contacts WHERE list_id = ?').get(parseInt(list_id, 10));
    await db.prepare('UPDATE lists SET contact_count = ?, updated_at = NOW() WHERE id = ?').run(parseInt(row.c, 10), parseInt(list_id, 10));
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
