const express = require('express');
const router = express.Router();
const { getDb } = require('../db/connection');
const { authenticate } = require('../middleware/auth');

router.use(authenticate);

// Dashboard overview stats
router.get('/dashboard', (req, res) => {
  const db = getDb();

  const totalContacts = db.prepare('SELECT COUNT(*) as c FROM contacts WHERE status = "active"').get().c;
  const totalCampaigns = db.prepare('SELECT COUNT(*) as c FROM campaigns').get().c;
  const totalSent = db.prepare('SELECT COALESCE(SUM(total_sent), 0) as c FROM campaigns').get().c;

  const avgOpenRate = db.prepare(`
    SELECT CASE WHEN SUM(total_sent) > 0
      THEN ROUND(CAST(SUM(total_unique_opens) AS FLOAT) / SUM(total_sent) * 100, 1)
      ELSE 0 END as rate
    FROM campaigns WHERE total_sent > 0
  `).get().rate;

  const avgClickRate = db.prepare(`
    SELECT CASE WHEN SUM(total_sent) > 0
      THEN ROUND(CAST(SUM(total_unique_clicks) AS FLOAT) / SUM(total_sent) * 100, 1)
      ELSE 0 END as rate
    FROM campaigns WHERE total_sent > 0
  `).get().rate;

  const recentCampaigns = db.prepare(`
    SELECT id, name, status, total_sent, total_unique_opens, total_unique_clicks, created_at
    FROM campaigns ORDER BY created_at DESC LIMIT 5
  `).all();

  const contactGrowth = db.prepare(`
    SELECT date(created_at) as date, COUNT(*) as count
    FROM contacts
    WHERE created_at >= date('now', '-30 days')
    GROUP BY date(created_at)
    ORDER BY date ASC
  `).all();

  const sendVolume = db.prepare(`
    SELECT date FROM daily_stats
    WHERE date >= date('now', '-30 days')
    GROUP BY date
    ORDER BY date ASC
  `).all().map(row => {
    const stats = db.prepare('SELECT SUM(sends) as sends, SUM(opens) as opens, SUM(clicks) as clicks FROM daily_stats WHERE date = ?').get(row.date);
    return { date: row.date, ...stats };
  });

  const topPerformingCampaigns = db.prepare(`
    SELECT id, name, total_sent, total_unique_opens, total_unique_clicks,
      CASE WHEN total_sent > 0 THEN ROUND(CAST(total_unique_opens AS FLOAT) / total_sent * 100, 1) ELSE 0 END as open_rate,
      CASE WHEN total_sent > 0 THEN ROUND(CAST(total_unique_clicks AS FLOAT) / total_sent * 100, 1) ELSE 0 END as click_rate
    FROM campaigns WHERE total_sent > 10
    ORDER BY open_rate DESC LIMIT 5
  `).all();

  const activeSequences = db.prepare(`
    SELECT s.id, s.name, s.status, s.total_enrolled,
      (SELECT COUNT(*) FROM sequence_enrollments WHERE sequence_id = s.id AND status = 'active') as active_enrollments
    FROM sequences s WHERE s.status = 'active'
  `).all();

  res.json({
    overview: { total_contacts: totalContacts, total_campaigns: totalCampaigns, total_sent: totalSent, avg_open_rate: avgOpenRate, avg_click_rate: avgClickRate },
    recent_campaigns: recentCampaigns,
    contact_growth: contactGrowth,
    send_volume: sendVolume,
    top_campaigns: topPerformingCampaigns,
    active_sequences: activeSequences,
  });
});

// Event log with filtering
router.get('/events', (req, res) => {
  const db = getDb();
  const { type, campaign_id, contact_id, from_date, to_date, page = 1, limit = 100 } = req.query;

  let where = '1=1';
  const params = [];

  if (type) { where += ' AND e.type = ?'; params.push(type); }
  if (campaign_id) { where += ' AND e.campaign_id = ?'; params.push(campaign_id); }
  if (contact_id) { where += ' AND e.contact_id = ?'; params.push(contact_id); }
  if (from_date) { where += ' AND e.created_at >= ?'; params.push(from_date); }
  if (to_date) { where += ' AND e.created_at <= ?'; params.push(to_date); }

  const total = db.prepare(`SELECT COUNT(*) as c FROM events e WHERE ${where}`).get(...params).c;
  const offset = (parseInt(page) - 1) * parseInt(limit);

  const events = db.prepare(`
    SELECT e.*, c.email, c.first_name, c.last_name, ca.name as campaign_name
    FROM events e
    LEFT JOIN contacts c ON c.id = e.contact_id
    LEFT JOIN campaigns ca ON ca.id = e.campaign_id
    WHERE ${where}
    ORDER BY e.created_at DESC LIMIT ? OFFSET ?
  `).all(...params, parseInt(limit), offset);

  res.json({ events, pagination: { total, page: parseInt(page), limit: parseInt(limit) } });
});

// Suppression list management
router.get('/suppression', (req, res) => {
  const db = getDb();
  const { page = 1, limit = 50, search } = req.query;
  let where = '1=1';
  const params = [];
  if (search) { where += ' AND email LIKE ?'; params.push(`%${search}%`); }

  const total = db.prepare(`SELECT COUNT(*) as c FROM suppression_list WHERE ${where}`).get(...params).c;
  const offset = (parseInt(page) - 1) * parseInt(limit);
  const entries = db.prepare(`SELECT * FROM suppression_list WHERE ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`).all(...params, parseInt(limit), offset);

  res.json({ entries, pagination: { total, page: parseInt(page), limit: parseInt(limit) } });
});

router.post('/suppression', authenticate, (req, res) => {
  const db = getDb();
  const { emails, reason = 'manual' } = req.body;
  if (!emails || !Array.isArray(emails)) return res.status(400).json({ error: 'emails array required' });

  let added = 0;
  const tx = db.transaction(() => {
    for (const email of emails) {
      const r = db.prepare('INSERT OR IGNORE INTO suppression_list (email, reason, source) VALUES (?, ?, "api")').run(email, reason);
      if (r.changes > 0) {
        added++;
        db.prepare('UPDATE contacts SET status = "suppressed", updated_at = datetime("now") WHERE email = ? COLLATE NOCASE').run(email);
      }
    }
  });
  tx();

  res.json({ added, total: emails.length });
});

router.delete('/suppression/:id', authenticate, (req, res) => {
  const db = getDb();
  const entry = db.prepare('SELECT * FROM suppression_list WHERE id = ?').get(req.params.id);
  if (entry) {
    db.prepare('DELETE FROM suppression_list WHERE id = ?').run(req.params.id);
    db.prepare('UPDATE contacts SET status = "active", updated_at = datetime("now") WHERE email = ? COLLATE NOCASE AND status = "suppressed"').run(entry.email);
  }
  res.json({ message: 'Removed from suppression list' });
});

module.exports = router;
