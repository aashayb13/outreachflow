require('dotenv').config();
const { initDb, getDb, closeDb } = require('./connection');
const { initializeSchema } = require('./schema');

async function seed() {
  await initDb();
  initializeSchema();
  const db = getDb();

  // ═══════════════════════════════════════════════════════════════════
  // TEMPLATES
  // ═══════════════════════════════════════════════════════════════════
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

  const seedTemplates = db.transaction(() => {
    for (const t of templates) {
      insertTemplate.run(t.name, t.subject, t.html, t.text, t.category, t.variables);
    }
  });
  seedTemplates();
  console.log(`Seeded ${templates.length} email templates`);

  // ═══════════════════════════════════════════════════════════════════
  // TAGS
  // ═══════════════════════════════════════════════════════════════════
  const tags = [
    { name: 'HVAC', color: '#EF4444' },
    { name: 'Plumbing', color: '#3B82F6' },
    { name: 'Electrical', color: '#F59E0B' },
    { name: 'Roofing', color: '#8B5CF6' },
    { name: 'Pest Control', color: '#10B981' },
    { name: 'Landscaping', color: '#06B6D4' },
    { name: 'Decision Maker', color: '#EC4899' },
    { name: 'Hot Lead', color: '#EF4444' },
    { name: 'Cold Outreach', color: '#6B7280' },
    { name: 'Replied', color: '#22C55E' },
  ];

  const insertTag = db.prepare('INSERT OR IGNORE INTO tags (name, color) VALUES (?, ?)');
  const seedTags = db.transaction(() => {
    for (const t of tags) insertTag.run(t.name, t.color);
  });
  seedTags();
  console.log(`Seeded ${tags.length} tags`);

  // ═══════════════════════════════════════════════════════════════════
  // LISTS
  // ═══════════════════════════════════════════════════════════════════
  const lists = [
    { name: 'All Contacts', description: 'Master list of all contacts' },
    { name: 'HVAC Companies', description: 'HVAC service providers in target markets' },
    { name: 'Plumbing Companies', description: 'Plumbing contractors and service providers' },
    { name: 'Q2 Outreach', description: 'Q2 2026 outreach campaign target list' },
    { name: 'Warm Leads', description: 'Contacts who have engaged with previous campaigns' },
    { name: 'Newsletter Subscribers', description: 'Opted-in newsletter recipients' },
  ];

  const insertList = db.prepare('INSERT OR IGNORE INTO lists (name, description) VALUES (?, ?)');
  const seedLists = db.transaction(() => {
    for (const l of lists) insertList.run(l.name, l.description);
  });
  seedLists();
  console.log(`Seeded ${lists.length} lists`);

  // ═══════════════════════════════════════════════════════════════════
  // CONTACTS
  // ═══════════════════════════════════════════════════════════════════
  const contacts = [
    { email: 'mike.johnson@comfortairhvac.com', first_name: 'Mike', last_name: 'Johnson', company: 'ComfortAir HVAC', title: 'Owner', industry: 'HVAC', city: 'Austin', state: 'TX', source: 'cornersight' },
    { email: 'sarah.williams@quickflowplumbing.com', first_name: 'Sarah', last_name: 'Williams', company: 'QuickFlow Plumbing', title: 'CEO', industry: 'Plumbing', city: 'Dallas', state: 'TX', source: 'cornersight' },
    { email: 'james.rodriguez@sparkelec.com', first_name: 'James', last_name: 'Rodriguez', company: 'Spark Electric Co', title: 'President', industry: 'Electrical', city: 'Houston', state: 'TX', source: 'lead_magic' },
    { email: 'linda.chen@topnotchroofing.com', first_name: 'Linda', last_name: 'Chen', company: 'TopNotch Roofing', title: 'Owner', industry: 'Roofing', city: 'Phoenix', state: 'AZ', source: 'cornersight' },
    { email: 'robert.davis@greenguardpest.com', first_name: 'Robert', last_name: 'Davis', company: 'GreenGuard Pest Control', title: 'CEO', industry: 'Pest Control', city: 'Tampa', state: 'FL', source: 'csv_import' },
    { email: 'jennifer.martinez@allseasonshvac.com', first_name: 'Jennifer', last_name: 'Martinez', company: 'All Seasons HVAC', title: 'VP Operations', industry: 'HVAC', city: 'Denver', state: 'CO', source: 'cornersight' },
    { email: 'david.thompson@reliableplumb.com', first_name: 'David', last_name: 'Thompson', company: 'Reliable Plumbing', title: 'Owner', industry: 'Plumbing', city: 'Atlanta', state: 'GA', source: 'cornersight' },
    { email: 'amanda.wilson@brightsparkelectric.com', first_name: 'Amanda', last_name: 'Wilson', company: 'BrightSpark Electric', title: 'President', industry: 'Electrical', city: 'Nashville', state: 'TN', source: 'lead_magic' },
    { email: 'chris.brown@premiumroofs.com', first_name: 'Chris', last_name: 'Brown', company: 'Premium Roofs LLC', title: 'CEO', industry: 'Roofing', city: 'Charlotte', state: 'NC', source: 'cornersight' },
    { email: 'patricia.garcia@ecoservices.com', first_name: 'Patricia', last_name: 'Garcia', company: 'Eco Services Group', title: 'Director', industry: 'Landscaping', city: 'San Antonio', state: 'TX', source: 'csv_import' },
    { email: 'mark.anderson@comfortzone.com', first_name: 'Mark', last_name: 'Anderson', company: 'ComfortZone HVAC', title: 'Owner', industry: 'HVAC', city: 'Orlando', state: 'FL', source: 'cornersight' },
    { email: 'susan.lee@clearwater-plumbing.com', first_name: 'Susan', last_name: 'Lee', company: 'ClearWater Plumbing', title: 'CEO', industry: 'Plumbing', city: 'Chicago', state: 'IL', source: 'lead_magic' },
    { email: 'brian.taylor@safewire-electric.com', first_name: 'Brian', last_name: 'Taylor', company: 'SafeWire Electric', title: 'President', industry: 'Electrical', city: 'Seattle', state: 'WA', source: 'cornersight' },
    { email: 'karen.white@shieldroofing.com', first_name: 'Karen', last_name: 'White', company: 'Shield Roofing', title: 'Owner', industry: 'Roofing', city: 'Miami', state: 'FL', source: 'csv_import' },
    { email: 'steven.harris@greenscapepro.com', first_name: 'Steven', last_name: 'Harris', company: 'GreenScape Pro', title: 'CEO', industry: 'Landscaping', city: 'Portland', state: 'OR', source: 'cornersight' },
    { email: 'nancy.clark@arcticbreeze.com', first_name: 'Nancy', last_name: 'Clark', company: 'Arctic Breeze AC', title: 'VP Sales', industry: 'HVAC', city: 'Las Vegas', state: 'NV', source: 'lead_magic' },
    { email: 'kevin.lewis@drainpro.com', first_name: 'Kevin', last_name: 'Lewis', company: 'DrainPro Solutions', title: 'Owner', industry: 'Plumbing', city: 'Raleigh', state: 'NC', source: 'cornersight' },
    { email: 'laura.walker@voltageplus.com', first_name: 'Laura', last_name: 'Walker', company: 'Voltage Plus', title: 'Director', industry: 'Electrical', city: 'Minneapolis', state: 'MN', source: 'cornersight' },
    { email: 'daniel.hall@peakroofing.com', first_name: 'Daniel', last_name: 'Hall', company: 'Peak Roofing Co', title: 'CEO', industry: 'Roofing', city: 'Columbus', state: 'OH', source: 'csv_import' },
    { email: 'jessica.allen@bugshieldpest.com', first_name: 'Jessica', last_name: 'Allen', company: 'BugShield Pest', title: 'President', industry: 'Pest Control', city: 'San Diego', state: 'CA', source: 'lead_magic' },
    { email: 'tom.king@firstchoicehvac.com', first_name: 'Tom', last_name: 'King', company: 'First Choice HVAC', title: 'Owner', industry: 'HVAC', city: 'Jacksonville', state: 'FL', source: 'cornersight' },
    { email: 'emily.wright@flowmaster.com', first_name: 'Emily', last_name: 'Wright', company: 'FlowMaster Plumbing', title: 'CEO', industry: 'Plumbing', city: 'Indianapolis', state: 'IN', source: 'cornersight' },
    { email: 'jason.scott@powerline-elec.com', first_name: 'Jason', last_name: 'Scott', company: 'PowerLine Electric', title: 'Owner', industry: 'Electrical', city: 'Memphis', state: 'TN', source: 'lead_magic' },
    { email: 'melissa.green@trustroof.com', first_name: 'Melissa', last_name: 'Green', company: 'TrustRoof Inc', title: 'VP Operations', industry: 'Roofing', city: 'Kansas City', state: 'MO', source: 'cornersight' },
    { email: 'ryan.adams@totalcarelawn.com', first_name: 'Ryan', last_name: 'Adams', company: 'TotalCare Lawn', title: 'CEO', industry: 'Landscaping', city: 'Louisville', state: 'KY', source: 'csv_import' },
  ];

  const insertContact = db.prepare(`
    INSERT OR IGNORE INTO contacts (email, first_name, last_name, company, title, industry, city, state, country, source, lead_score, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'US', ?, ?, ?)
  `);

  const seedContacts = db.transaction(() => {
    for (let i = 0; i < contacts.length; i++) {
      const c = contacts[i];
      const score = Math.floor(Math.random() * 80) + 10;
      // Spread created_at dates over last 30 days for chart data
      const daysAgo = Math.floor(Math.random() * 30);
      const createdAt = new Date(Date.now() - daysAgo * 86400000).toISOString().replace('T', ' ').slice(0, 19);
      insertContact.run(c.email, c.first_name, c.last_name, c.company, c.title, c.industry, c.city, c.state, c.source, score, createdAt);
    }
  });
  seedContacts();
  console.log(`Seeded ${contacts.length} contacts`);

  // ═══════════════════════════════════════════════════════════════════
  // ASSIGN CONTACTS TO LISTS & TAGS
  // ═══════════════════════════════════════════════════════════════════
  const allContacts = db.prepare('SELECT id, industry FROM contacts').all();
  const allLists = db.prepare('SELECT id, name FROM lists').all();
  const allTags = db.prepare('SELECT id, name FROM tags').all();

  const listMap = {};
  for (const l of allLists) listMap[l.name] = l.id;
  const tagMap = {};
  for (const t of allTags) tagMap[t.name] = t.id;

  const insertListContact = db.prepare('INSERT OR IGNORE INTO list_contacts (list_id, contact_id) VALUES (?, ?)');
  const insertContactTag = db.prepare('INSERT OR IGNORE INTO contact_tags (contact_id, tag_id) VALUES (?, ?)');

  const seedAssignments = db.transaction(() => {
    for (const c of allContacts) {
      // All Contacts list
      if (listMap['All Contacts']) insertListContact.run(listMap['All Contacts'], c.id);

      // Industry-specific lists
      if (c.industry === 'HVAC' && listMap['HVAC Companies']) insertListContact.run(listMap['HVAC Companies'], c.id);
      if (c.industry === 'Plumbing' && listMap['Plumbing Companies']) insertListContact.run(listMap['Plumbing Companies'], c.id);

      // Random assignment to Q2 Outreach
      if (Math.random() > 0.4 && listMap['Q2 Outreach']) insertListContact.run(listMap['Q2 Outreach'], c.id);

      // Industry tag
      if (tagMap[c.industry]) insertContactTag.run(c.id, tagMap[c.industry]);

      // Decision Maker tag for owners/CEOs
      if (tagMap['Decision Maker']) insertContactTag.run(c.id, tagMap['Decision Maker']);

      // Random Hot Lead
      if (Math.random() > 0.7 && tagMap['Hot Lead']) insertContactTag.run(c.id, tagMap['Hot Lead']);
    }
  });
  seedAssignments();

  // Update list counts
  for (const l of allLists) {
    const count = db.prepare('SELECT COUNT(*) as c FROM list_contacts WHERE list_id = ?').get(l.id).c;
    db.prepare('UPDATE lists SET contact_count = ? WHERE id = ?').run(count, l.id);
  }
  console.log('Assigned contacts to lists and tags');

  // ═══════════════════════════════════════════════════════════════════
  // CAMPAIGNS (with realistic stats for the dashboard)
  // ═══════════════════════════════════════════════════════════════════
  const campaigns = [
    {
      name: 'Q2 Field Services Outreach',
      subject: 'Quick question about {{company}}, {{first_name}}',
      status: 'sent',
      type: 'regular',
      list_ids: JSON.stringify([listMap['Q2 Outreach'] || 1]),
      total_recipients: 18, total_sent: 18, total_delivered: 17,
      total_opens: 12, total_unique_opens: 9, total_clicks: 5, total_unique_clicks: 4,
      total_bounces: 1, total_complaints: 0, total_unsubscribes: 0,
      days_ago: 14,
    },
    {
      name: 'HVAC Summer Prep Campaign',
      subject: '{{first_name}}, get ahead of summer demand',
      status: 'sent',
      type: 'regular',
      list_ids: JSON.stringify([listMap['HVAC Companies'] || 1]),
      total_recipients: 6, total_sent: 6, total_delivered: 6,
      total_opens: 5, total_unique_opens: 4, total_clicks: 3, total_unique_clicks: 2,
      total_bounces: 0, total_complaints: 0, total_unsubscribes: 0,
      days_ago: 7,
    },
    {
      name: 'Plumbing Industry Newsletter',
      subject: 'Plumbing Industry Trends — April 2026',
      status: 'sent',
      type: 'regular',
      list_ids: JSON.stringify([listMap['Plumbing Companies'] || 1]),
      total_recipients: 4, total_sent: 4, total_delivered: 4,
      total_opens: 3, total_unique_opens: 3, total_clicks: 2, total_unique_clicks: 2,
      total_bounces: 0, total_complaints: 0, total_unsubscribes: 0,
      days_ago: 3,
    },
    {
      name: 'Follow-Up: Q2 No Replies',
      subject: 'Following up, {{first_name}}',
      status: 'draft',
      type: 'regular',
      list_ids: JSON.stringify([listMap['Q2 Outreach'] || 1]),
      total_recipients: 0, total_sent: 0, total_delivered: 0,
      total_opens: 0, total_unique_opens: 0, total_clicks: 0, total_unique_clicks: 0,
      total_bounces: 0, total_complaints: 0, total_unsubscribes: 0,
      days_ago: 1,
    },
    {
      name: 'May Newsletter Draft',
      subject: 'Field Services Monthly — May 2026',
      status: 'draft',
      type: 'regular',
      list_ids: JSON.stringify([listMap['All Contacts'] || 1]),
      total_recipients: 0, total_sent: 0, total_delivered: 0,
      total_opens: 0, total_unique_opens: 0, total_clicks: 0, total_unique_clicks: 0,
      total_bounces: 0, total_complaints: 0, total_unsubscribes: 0,
      days_ago: 0,
    },
  ];

  const insertCampaign = db.prepare(`
    INSERT INTO campaigns (name, subject, status, type, list_ids, template_id,
      total_recipients, total_sent, total_delivered, total_opens, total_unique_opens,
      total_clicks, total_unique_clicks, total_bounces, total_complaints, total_unsubscribes,
      track_opens, track_clicks, utm_source, utm_medium,
      send_started_at, send_completed_at, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, NULL,
      ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?,
      1, 1, 'email', 'email',
      ?, ?, ?, ?)
  `);

  const seedCampaigns = db.transaction(() => {
    for (const c of campaigns) {
      const createdAt = new Date(Date.now() - c.days_ago * 86400000).toISOString().replace('T', ' ').slice(0, 19);
      const completedAt = c.status === 'sent' ? createdAt : null;
      insertCampaign.run(
        c.name, c.subject, c.status, c.type, c.list_ids,
        c.total_recipients, c.total_sent, c.total_delivered,
        c.total_opens, c.total_unique_opens, c.total_clicks, c.total_unique_clicks,
        c.total_bounces, c.total_complaints, c.total_unsubscribes,
        c.status === 'sent' ? createdAt : null, completedAt, createdAt, createdAt
      );
    }
  });
  seedCampaigns();
  console.log(`Seeded ${campaigns.length} campaigns`);

  // ═══════════════════════════════════════════════════════════════════
  // EVENTS (for sent campaigns — powers analytics)
  // ═══════════════════════════════════════════════════════════════════
  const sentCampaigns = db.prepare("SELECT id FROM campaigns WHERE status = 'sent'").all();

  const insertEvent = db.prepare(`
    INSERT INTO events (campaign_id, contact_id, type, url, created_at) VALUES (?, ?, ?, ?, ?)
  `);

  const seedEvents = db.transaction(() => {
    for (const camp of sentCampaigns) {
      // Pick some contacts for send events
      const recipients = db.prepare(`
        SELECT c.id FROM contacts c
        JOIN list_contacts lc ON lc.contact_id = c.id
        WHERE c.status = 'active'
        ORDER BY RANDOM() LIMIT 10
      `).all();

      for (const r of recipients) {
        const daysAgo = Math.floor(Math.random() * 14);
        const ts = new Date(Date.now() - daysAgo * 86400000).toISOString().replace('T', ' ').slice(0, 19);

        insertEvent.run(camp.id, r.id, 'send', '', ts);

        // 60% open rate
        if (Math.random() < 0.6) {
          const openTs = new Date(Date.now() - (daysAgo - 0.5) * 86400000).toISOString().replace('T', ' ').slice(0, 19);
          insertEvent.run(camp.id, r.id, 'open', '', openTs);

          // 30% of openers click
          if (Math.random() < 0.3) {
            const clickTs = new Date(Date.now() - (daysAgo - 0.3) * 86400000).toISOString().replace('T', ' ').slice(0, 19);
            insertEvent.run(camp.id, r.id, 'click', 'https://example.com/landing', clickTs);
          }
        }
      }
    }
  });
  seedEvents();
  console.log('Seeded campaign events');

  // ═══════════════════════════════════════════════════════════════════
  // DAILY STATS (aggregated for charts)
  // ═══════════════════════════════════════════════════════════════════
  const insertDailyStat = db.prepare(`
    INSERT OR REPLACE INTO daily_stats (date, campaign_id, sends, deliveries, opens, unique_opens, clicks, unique_clicks, bounces, complaints, unsubscribes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const seedDailyStats = db.transaction(() => {
    for (const camp of sentCampaigns) {
      for (let d = 14; d >= 0; d--) {
        const date = new Date(Date.now() - d * 86400000).toISOString().slice(0, 10);
        const sends = d > 10 ? Math.floor(Math.random() * 5) : Math.floor(Math.random() * 3);
        const opens = Math.floor(sends * 0.6);
        const clicks = Math.floor(sends * 0.2);
        if (sends > 0) {
          insertDailyStat.run(date, camp.id, sends, sends, opens, opens, clicks, clicks, 0, 0, 0);
        }
      }
    }
  });
  seedDailyStats();
  console.log('Seeded daily stats');

  // ═══════════════════════════════════════════════════════════════════
  // SEQUENCES
  // ═══════════════════════════════════════════════════════════════════
  const insertSeq = db.prepare(`
    INSERT INTO sequences (name, description, trigger_type, status, total_enrolled, total_completed, created_at)
    VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
  `);

  const seqResult = insertSeq.run(
    'New Lead Welcome Drip',
    'Automated welcome sequence for new field service leads from Cornersight',
    'manual', 'active', 8, 3
  );
  const seqId = seqResult.lastInsertRowid;

  const insertStep = db.prepare(`
    INSERT INTO sequence_steps (sequence_id, step_order, type, subject, html_content, delay_amount, delay_unit, is_active)
    VALUES (?, ?, ?, ?, ?, ?, ?, 1)
  `);

  insertStep.run(seqId, 0, 'email', 'Welcome {{first_name}} — quick intro', '<p>Hi {{first_name}},</p><p>Thanks for connecting! We help field service companies like {{company}} streamline operations.</p><p>{{unsubscribe_link}}</p>', 0, 'days');
  insertStep.run(seqId, 1, 'delay', '', '', 3, 'days');
  insertStep.run(seqId, 2, 'email', 'Case study: How HVAC companies save 20+ hrs/week', '<p>Hi {{first_name}},</p><p>Here is a quick case study showing how companies like yours are saving time...</p><p>{{unsubscribe_link}}</p>', 0, 'days');
  insertStep.run(seqId, 3, 'delay', '', '', 5, 'days');
  insertStep.run(seqId, 4, 'email', 'Quick question, {{first_name}}', '<p>Hi {{first_name}},</p><p>Would you be open to a brief 15-minute call this week?</p><p>{{unsubscribe_link}}</p>', 0, 'days');

  const insertSeq2 = insertSeq.run(
    'Re-engagement Campaign',
    'Re-engage contacts who have not opened in 30+ days',
    'manual', 'draft', 0, 0
  );

  console.log('Seeded sequences with steps');

  // ═══════════════════════════════════════════════════════════════════
  // DONE
  // ═══════════════════════════════════════════════════════════════════
  closeDb();
  console.log('\nSeed complete! Start the app with: npm run dev');
}

seed().catch(err => { console.error('Seed failed:', err); process.exit(1); });
