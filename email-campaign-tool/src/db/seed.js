require('dotenv').config();
const { initDb, getDb, closeDb } = require('./connection');
const { initializeSchema } = require('./schema');

async function seed() {
await initDb();
initializeSchema();
const db = getDb();

// Seed some default templates
const insertTemplate = db.prepare(`
  INSERT OR IGNORE INTO templates (name, subject, html_content, text_content, category, variables)
  VALUES (?, ?, ?, ?, ?, ?)
`);

const templates = [
  {
    name: 'Welcome Email',
    subject: 'Welcome to {{company_name}}, {{first_name}}!',
    html: `<!DOCTYPE html><html><body style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px;">
<h1 style="color:#2563EB;">Welcome, {{first_name}}!</h1>
<p>We're excited to have you join {{company_name}}.</p>
<p>Here's what you can expect from us:</p>
<ul><li>Industry insights and tips</li><li>Exclusive offers</li><li>Product updates</li></ul>
<p>If you have any questions, just reply to this email.</p>
<p>Best regards,<br/>The {{company_name}} Team</p>
<hr style="border:none;border-top:1px solid #E5E7EB;margin:20px 0;"/>
<p style="font-size:12px;color:#9CA3AF;">{{unsubscribe_link}}</p>
</body></html>`,
    text: 'Welcome, {{first_name}}!\n\nWe\'re excited to have you join {{company_name}}.\n\n{{unsubscribe_link}}',
    category: 'onboarding',
    variables: '["first_name","company_name","unsubscribe_link"]',
  },
  {
    name: 'Newsletter',
    subject: '{{company_name}} Newsletter — {{month}} {{year}}',
    html: `<!DOCTYPE html><html><body style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px;">
<div style="background:#2563EB;color:white;padding:20px;border-radius:8px 8px 0 0;text-align:center;">
<h1>{{company_name}} Newsletter</h1><p>{{month}} {{year}}</p></div>
<div style="padding:20px;border:1px solid #E5E7EB;border-top:none;">
<h2>{{headline}}</h2>
<p>{{content_block_1}}</p>
<a href="{{cta_url}}" style="display:inline-block;background:#2563EB;color:white;padding:12px 24px;text-decoration:none;border-radius:6px;">{{cta_text}}</a>
</div>
<p style="font-size:12px;color:#9CA3AF;text-align:center;margin-top:20px;">{{unsubscribe_link}}</p>
</body></html>`,
    text: '{{company_name}} Newsletter - {{month}} {{year}}\n\n{{headline}}\n\n{{content_block_1}}\n\n{{cta_text}}: {{cta_url}}\n\n{{unsubscribe_link}}',
    category: 'newsletter',
    variables: '["company_name","month","year","headline","content_block_1","cta_url","cta_text","unsubscribe_link"]',
  },
  {
    name: 'Promotional Offer',
    subject: '{{first_name}}, {{offer_headline}}',
    html: `<!DOCTYPE html><html><body style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px;">
<div style="text-align:center;padding:30px;background:linear-gradient(135deg,#667EEA,#764BA2);color:white;border-radius:8px;">
<h1>{{offer_headline}}</h1><p style="font-size:24px;font-weight:bold;">{{offer_code}}</p></div>
<div style="padding:20px;text-align:center;">
<p>Hi {{first_name}},</p>
<p>{{offer_description}}</p>
<p style="font-size:14px;color:#6B7280;">Offer expires: {{expiry_date}}</p>
<a href="{{cta_url}}" style="display:inline-block;background:#7C3AED;color:white;padding:14px 32px;text-decoration:none;border-radius:6px;font-size:16px;">{{cta_text}}</a>
</div>
<p style="font-size:12px;color:#9CA3AF;text-align:center;margin-top:20px;">{{unsubscribe_link}}</p>
</body></html>`,
    text: '{{offer_headline}}\n\nHi {{first_name}},\n\n{{offer_description}}\n\nUse code: {{offer_code}}\nExpires: {{expiry_date}}\n\n{{cta_text}}: {{cta_url}}\n\n{{unsubscribe_link}}',
    category: 'promotional',
    variables: '["first_name","offer_headline","offer_code","offer_description","expiry_date","cta_url","cta_text","unsubscribe_link"]',
  },
  {
    name: 'Cold Outreach',
    subject: 'Quick question, {{first_name}}',
    html: `<!DOCTYPE html><html><body style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px;">
<p>Hi {{first_name}},</p>
<p>I came across {{company}} and was impressed by {{personalization_note}}.</p>
<p>{{value_proposition}}</p>
<p>Would you be open to a quick 15-minute call this week to explore this?</p>
<p>Best,<br/>{{sender_name}}<br/>{{sender_title}}<br/>{{sender_company}}</p>
<p style="font-size:12px;color:#9CA3AF;">{{unsubscribe_link}}</p>
</body></html>`,
    text: 'Hi {{first_name}},\n\nI came across {{company}} and was impressed by {{personalization_note}}.\n\n{{value_proposition}}\n\nWould you be open to a quick 15-minute call this week?\n\nBest,\n{{sender_name}}\n{{sender_title}}\n{{sender_company}}\n\n{{unsubscribe_link}}',
    category: 'outreach',
    variables: '["first_name","company","personalization_note","value_proposition","sender_name","sender_title","sender_company","unsubscribe_link"]',
  },
  {
    name: 'Follow-Up',
    subject: 'Re: {{previous_subject}}',
    html: `<!DOCTYPE html><html><body style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px;">
<p>Hi {{first_name}},</p>
<p>I wanted to follow up on my previous email about {{topic}}.</p>
<p>{{follow_up_content}}</p>
<p>{{cta_text}}</p>
<p>Best,<br/>{{sender_name}}</p>
<p style="font-size:12px;color:#9CA3AF;">{{unsubscribe_link}}</p>
</body></html>`,
    text: 'Hi {{first_name}},\n\nI wanted to follow up on my previous email about {{topic}}.\n\n{{follow_up_content}}\n\n{{cta_text}}\n\nBest,\n{{sender_name}}\n\n{{unsubscribe_link}}',
    category: 'outreach',
    variables: '["first_name","previous_subject","topic","follow_up_content","cta_text","sender_name","unsubscribe_link"]',
  },
];

const insertMany = db.transaction(() => {
  for (const t of templates) {
    insertTemplate.run(t.name, t.subject, t.html, t.text, t.category, t.variables);
  }
});

insertMany();
console.log(`Seeded ${templates.length} email templates`);

// Create a default list
db.prepare(`INSERT OR IGNORE INTO lists (id, name, description) VALUES (1, 'All Contacts', 'Default list containing all contacts')`).run();
console.log('Seeded default list');

closeDb();
console.log('Seed complete!');
}

seed().catch(err => { console.error('Seed failed:', err); process.exit(1); });
