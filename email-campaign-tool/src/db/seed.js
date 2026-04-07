require('dotenv').config();
const { initDb, getDb, closeDb } = require('./connection');
const { initializeSchema } = require('./schema');

async function seed() {
  await initDb();
  await initializeSchema();
  const db = getDb();

  // ═══════════════════════════════════════════════════════════════════
  // TEMPLATES
  // ═══════════════════════════════════════════════════════════════════
  const templates = [
    {
      name: 'Welcome Email',
      subject: 'Welcome to {{company_name}}, {{first_name}}!',
      html: `<!DOCTYPE html><html><body style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px;">
<h1 style="color:#2563EB;">Welcome, {{first_name}}!</h1>
<p>We're excited to have you join {{company_name}}.</p>
<p>{{unsubscribe_link}}</p>
</body></html>`,
      text: 'Welcome, {{first_name}}!\n\n{{unsubscribe_link}}',
      category: 'onboarding',
      variables: '["first_name","company_name","unsubscribe_link"]',
    },
    {
      name: 'Newsletter',
      subject: '{{company_name}} Newsletter — {{month}} {{year}}',
      html: `<!DOCTYPE html><html><body><h1>{{company_name}} Newsletter</h1><p>{{headline}}</p>{{unsubscribe_link}}</body></html>`,
      text: '{{company_name}} Newsletter\n\n{{headline}}\n\n{{unsubscribe_link}}',
      category: 'newsletter',
      variables: '["company_name","month","year","headline","unsubscribe_link"]',
    },
    {
      name: 'Cold Outreach',
      subject: 'Quick question, {{first_name}}',
      html: `<p>Hi {{first_name}},</p><p>I came across {{company}} and was impressed.</p><p>{{unsubscribe_link}}</p>`,
      text: 'Hi {{first_name}},\n\n{{unsubscribe_link}}',
      category: 'outreach',
      variables: '["first_name","company","unsubscribe_link"]',
    },
  ];

  await db.transaction(async () => {
    for (const t of templates) {
      await db.prepare(`
        INSERT OR IGNORE INTO templates (name, subject, html_content, text_content, category, variables)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(t.name, t.subject, t.html, t.text, t.category, t.variables);
    }
  })();
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

  await db.transaction(async () => {
    for (const t of tags) {
      await db.prepare('INSERT OR IGNORE INTO tags (name, color) VALUES (?, ?)').run(t.name, t.color);
    }
  })();
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

  await db.transaction(async () => {
    for (const l of lists) {
      await db.prepare('INSERT INTO lists (name, description) VALUES (?, ?) ON CONFLICT DO NOTHING').run(l.name, l.description);
    }
  })();
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
  ];

  await db.transaction(async () => {
    for (const c of contacts) {
      const score = Math.floor(Math.random() * 80) + 10;
      const daysAgo = Math.floor(Math.random() * 30);
      const createdAt = new Date(Date.now() - daysAgo * 86400000).toISOString();
      await db.prepare(`
        INSERT OR IGNORE INTO contacts (email, first_name, last_name, company, title, industry, city, state, country, source, lead_score, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'US', ?, ?, ?)
      `).run(c.email, c.first_name, c.last_name, c.company, c.title, c.industry, c.city, c.state, c.source, score, createdAt);
    }
  })();
  console.log(`Seeded ${contacts.length} contacts`);

  // ═══════════════════════════════════════════════════════════════════
  // ASSIGN CONTACTS TO LISTS & TAGS
  // ═══════════════════════════════════════════════════════════════════
  const allContacts = await db.prepare('SELECT id, industry FROM contacts').all();
  const allLists = await db.prepare('SELECT id, name FROM lists').all();
  const allTags = await db.prepare('SELECT id, name FROM tags').all();

  const listMap = {};
  for (const l of allLists) listMap[l.name] = l.id;
  const tagMap = {};
  for (const t of allTags) tagMap[t.name] = t.id;

  await db.transaction(async () => {
    for (const c of allContacts) {
      if (listMap['All Contacts']) await db.prepare('INSERT OR IGNORE INTO list_contacts (list_id, contact_id) VALUES (?, ?)').run(listMap['All Contacts'], c.id);
      if (c.industry === 'HVAC' && listMap['HVAC Companies']) await db.prepare('INSERT OR IGNORE INTO list_contacts (list_id, contact_id) VALUES (?, ?)').run(listMap['HVAC Companies'], c.id);
      if (c.industry === 'Plumbing' && listMap['Plumbing Companies']) await db.prepare('INSERT OR IGNORE INTO list_contacts (list_id, contact_id) VALUES (?, ?)').run(listMap['Plumbing Companies'], c.id);
      if (Math.random() > 0.4 && listMap['Q2 Outreach']) await db.prepare('INSERT OR IGNORE INTO list_contacts (list_id, contact_id) VALUES (?, ?)').run(listMap['Q2 Outreach'], c.id);

      if (tagMap[c.industry]) await db.prepare('INSERT OR IGNORE INTO contact_tags (contact_id, tag_id) VALUES (?, ?)').run(c.id, tagMap[c.industry]);
      if (tagMap['Decision Maker']) await db.prepare('INSERT OR IGNORE INTO contact_tags (contact_id, tag_id) VALUES (?, ?)').run(c.id, tagMap['Decision Maker']);
      if (Math.random() > 0.7 && tagMap['Hot Lead']) await db.prepare('INSERT OR IGNORE INTO contact_tags (contact_id, tag_id) VALUES (?, ?)').run(c.id, tagMap['Hot Lead']);
    }
  })();

  for (const l of allLists) {
    const row = await db.prepare('SELECT COUNT(*) as c FROM list_contacts WHERE list_id = ?').get(l.id);
    await db.prepare('UPDATE lists SET contact_count = ? WHERE id = ?').run(parseInt(row.c, 10), l.id);
  }
  console.log('Assigned contacts to lists and tags');

  // ═══════════════════════════════════════════════════════════════════
  // CAMPAIGNS
  // ═══════════════════════════════════════════════════════════════════
  const campaigns = [
    {
      name: 'Q2 Field Services Outreach',
      subject: 'Quick question about {{company}}, {{first_name}}',
      status: 'sent', type: 'regular',
      list_ids: JSON.stringify([listMap['Q2 Outreach'] || 1]),
      total_recipients: 18, total_sent: 18, total_delivered: 17,
      total_opens: 12, total_unique_opens: 9, total_clicks: 5, total_unique_clicks: 4,
      total_bounces: 1, total_complaints: 0, total_unsubscribes: 0,
      days_ago: 14,
    },
    {
      name: 'HVAC Summer Prep Campaign',
      subject: '{{first_name}}, get ahead of summer demand',
      status: 'sent', type: 'regular',
      list_ids: JSON.stringify([listMap['HVAC Companies'] || 1]),
      total_recipients: 6, total_sent: 6, total_delivered: 6,
      total_opens: 5, total_unique_opens: 4, total_clicks: 3, total_unique_clicks: 2,
      total_bounces: 0, total_complaints: 0, total_unsubscribes: 0,
      days_ago: 7,
    },
    {
      name: 'May Newsletter Draft',
      subject: 'Field Services Monthly — May 2026',
      status: 'draft', type: 'regular',
      list_ids: JSON.stringify([listMap['All Contacts'] || 1]),
      total_recipients: 0, total_sent: 0, total_delivered: 0,
      total_opens: 0, total_unique_opens: 0, total_clicks: 0, total_unique_clicks: 0,
      total_bounces: 0, total_complaints: 0, total_unsubscribes: 0,
      days_ago: 0,
    },
  ];

  await db.transaction(async () => {
    for (const c of campaigns) {
      const createdAt = new Date(Date.now() - c.days_ago * 86400000).toISOString();
      const completedAt = c.status === 'sent' ? createdAt : null;
      await db.prepare(`
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
      `).run(
        c.name, c.subject, c.status, c.type, c.list_ids,
        c.total_recipients, c.total_sent, c.total_delivered,
        c.total_opens, c.total_unique_opens, c.total_clicks, c.total_unique_clicks,
        c.total_bounces, c.total_complaints, c.total_unsubscribes,
        c.status === 'sent' ? createdAt : null, completedAt, createdAt, createdAt
      );
    }
  })();
  console.log(`Seeded ${campaigns.length} campaigns`);

  // ═══════════════════════════════════════════════════════════════════
  // EVENTS (for sent campaigns — powers analytics)
  // ═══════════════════════════════════════════════════════════════════
  const sentCampaigns = await db.prepare("SELECT id FROM campaigns WHERE status = 'sent'").all();

  await db.transaction(async () => {
    for (const camp of sentCampaigns) {
      const recipients = await db.prepare(`
        SELECT c.id FROM contacts c
        JOIN list_contacts lc ON lc.contact_id = c.id
        WHERE c.status = 'active'
        ORDER BY RANDOM() LIMIT 10
      `).all();

      for (const r of recipients) {
        const daysAgo = Math.floor(Math.random() * 14);
        const ts = new Date(Date.now() - daysAgo * 86400000).toISOString();

        await db.prepare('INSERT INTO events (campaign_id, contact_id, type, url, created_at) VALUES (?, ?, ?, ?, ?)').run(camp.id, r.id, 'send', '', ts);

        if (Math.random() < 0.6) {
          const openTs = new Date(Date.now() - (daysAgo - 0.5) * 86400000).toISOString();
          await db.prepare('INSERT INTO events (campaign_id, contact_id, type, url, created_at) VALUES (?, ?, ?, ?, ?)').run(camp.id, r.id, 'open', '', openTs);

          if (Math.random() < 0.3) {
            const clickTs = new Date(Date.now() - (daysAgo - 0.3) * 86400000).toISOString();
            await db.prepare('INSERT INTO events (campaign_id, contact_id, type, url, created_at) VALUES (?, ?, ?, ?, ?)').run(camp.id, r.id, 'click', 'https://example.com/landing', clickTs);
          }
        }
      }
    }
  })();
  console.log('Seeded campaign events');

  // ═══════════════════════════════════════════════════════════════════
  // DAILY STATS
  // ═══════════════════════════════════════════════════════════════════
  await db.transaction(async () => {
    for (const camp of sentCampaigns) {
      for (let d = 14; d >= 0; d--) {
        const date = new Date(Date.now() - d * 86400000).toISOString().slice(0, 10);
        const sends = d > 10 ? Math.floor(Math.random() * 5) : Math.floor(Math.random() * 3);
        const opens = Math.floor(sends * 0.6);
        const clicks = Math.floor(sends * 0.2);
        if (sends > 0) {
          await db.prepare(`
            INSERT INTO daily_stats (date, campaign_id, sends, deliveries, opens, unique_opens, clicks, unique_clicks, bounces, complaints, unsubscribes)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT (date, campaign_id) DO UPDATE SET
              sends = excluded.sends, deliveries = excluded.deliveries,
              opens = excluded.opens, unique_opens = excluded.unique_opens,
              clicks = excluded.clicks, unique_clicks = excluded.unique_clicks
          `).run(date, camp.id, sends, sends, opens, opens, clicks, clicks, 0, 0, 0);
        }
      }
    }
  })();
  console.log('Seeded daily stats');

  // ═══════════════════════════════════════════════════════════════════
  // SEQUENCES
  // ═══════════════════════════════════════════════════════════════════
  const seqResult = await db.prepare(`
    INSERT INTO sequences (name, description, trigger_type, status, total_enrolled, total_completed, created_at)
    VALUES (?, ?, ?, ?, ?, ?, NOW())
  `).run(
    'New Lead Welcome Drip',
    'Automated welcome sequence for new field service leads from Cornersight',
    'manual', 'active', 8, 3
  );
  const seqId = seqResult.lastInsertRowid;

  const stepInsert = `
    INSERT INTO sequence_steps (sequence_id, step_order, type, subject, html_content, delay_amount, delay_unit, is_active)
    VALUES (?, ?, ?, ?, ?, ?, ?, 1)
  `;

  await db.prepare(stepInsert).run(seqId, 0, 'email', 'Welcome {{first_name}} — quick intro', '<p>Hi {{first_name}},</p><p>{{unsubscribe_link}}</p>', 0, 'days');
  await db.prepare(stepInsert).run(seqId, 1, 'delay', '', '', 3, 'days');
  await db.prepare(stepInsert).run(seqId, 2, 'email', 'Case study', '<p>Hi {{first_name}},</p><p>{{unsubscribe_link}}</p>', 0, 'days');
  await db.prepare(stepInsert).run(seqId, 3, 'delay', '', '', 5, 'days');
  await db.prepare(stepInsert).run(seqId, 4, 'email', 'Quick question, {{first_name}}', '<p>Hi {{first_name}},</p><p>{{unsubscribe_link}}</p>', 0, 'days');

  await db.prepare(`
    INSERT INTO sequences (name, description, trigger_type, status, total_enrolled, total_completed, created_at)
    VALUES (?, ?, ?, ?, ?, ?, NOW())
  `).run(
    'Re-engagement Campaign',
    'Re-engage contacts who have not opened in 30+ days',
    'manual', 'draft', 0, 0
  );

  console.log('Seeded sequences with steps');

  await closeDb();
  console.log('\nSeed complete! Start the app with: npm run dev');
}

seed().catch(err => { console.error('Seed failed:', err); process.exit(1); });
