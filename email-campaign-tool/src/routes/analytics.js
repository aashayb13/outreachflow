const express = require('express');
const router = express.Router();
const { getDb } = require('../db/connection');
const { authenticate } = require('../middleware/auth');

router.use(authenticate);

router.get('/dashboard', async (req, res, next) => {
  try {
    const db = getDb();

    const totalContactsRow = await db.prepare("SELECT COUNT(*) as c FROM contacts WHERE status = 'active'").get();
    const totalCampaignsRow = await db.prepare('SELECT COUNT(*) as c FROM campaigns').get();
    const totalSentRow = await db.prepare('SELECT COALESCE(SUM(total_sent), 0) as c FROM campaigns').get();

    const avgOpenRateRow = await db.prepare(`
      SELECT CASE WHEN SUM(total_sent) > 0
        THEN ROUND(CAST(SUM(total_unique_opens) AS NUMERIC) / SUM(total_sent) * 100, 1)
        ELSE 0 END as rate
      FROM campaigns WHERE total_sent > 0
    `).get();

    const avgClickRateRow = await db.prepare(`
      SELECT CASE WHEN SUM(total_sent) > 0
        THEN ROUND(CAST(SUM(total_unique_clicks) AS NUMERIC) / SUM(total_sent) * 100, 1)
        ELSE 0 END as rate
      FROM campaigns WHERE total_sent > 0
    `).get();

    const recentCampaigns = await db.prepare(`
      SELECT id, name, status, total_sent, total_unique_opens, total_unique_clicks, created_at
      FROM campaigns ORDER BY created_at DESC LIMIT 5
    `).all();

    const contactGrowth = await db.prepare(`
      SELECT (created_at)::date as date, COUNT(*) as count
      FROM contacts
      WHERE created_at >= (NOW() - INTERVAL '30 days')::date
      GROUP BY (created_at)::date
      ORDER BY date ASC
    `).all();

    const sendVolumeDates = await db.prepare(`
      SELECT date FROM daily_stats
      WHERE date >= to_char((NOW() - INTERVAL '30 days')::date, 'YYYY-MM-DD')
      GROUP BY date
      ORDER BY date ASC
    `).all();

    const sendVolume = await Promise.all(sendVolumeDates.map(async row => {
      const stats = await db.prepare('SELECT SUM(sends) as sends, SUM(opens) as opens, SUM(clicks) as clicks FROM daily_stats WHERE date = ?').get(row.date);
      return { date: row.date, ...stats };
    }));

    const topPerformingCampaigns = await db.prepare(`
      SELECT id, name, total_sent, total_unique_opens, total_unique_clicks,
        CASE WHEN total_sent > 0 THEN ROUND(CAST(total_unique_opens AS NUMERIC) / total_sent * 100, 1) ELSE 0 END as open_rate,
        CASE WHEN total_sent > 0 THEN ROUND(CAST(total_unique_clicks AS NUMERIC) / total_sent * 100, 1) ELSE 0 END as click_rate
      FROM campaigns WHERE total_sent > 10
      ORDER BY open_rate DESC LIMIT 5
    `).all();

    const activeSequences = await db.prepare(`
      SELECT s.id, s.name, s.status, s.total_enrolled,
        (SELECT COUNT(*) FROM sequence_enrollments WHERE sequence_id = s.id AND status = 'active') as active_enrollments
      FROM sequences s WHERE s.status = 'active'
    `).all();

    res.json({
      overview: {
        total_contacts: parseInt(totalContactsRow.c, 10),
        total_campaigns: parseInt(totalCampaignsRow.c, 10),
        total_sent: parseInt(totalSentRow.c, 10),
        avg_open_rate: avgOpenRateRow.rate,
        avg_click_rate: avgClickRateRow.rate,
      },
      recent_campaigns: recentCampaigns,
      contact_growth: contactGrowth,
      send_volume: sendVolume,
      top_campaigns: topPerformingCampaigns,
      active_sequences: activeSequences,
    });
  } catch (err) { next(err); }
});

router.get('/events', async (req, res, next) => {
  try {
    const db = getDb();
    const { type, campaign_id, contact_id, from_date, to_date, page = 1, limit = 100 } = req.query;

    let where = '1=1';
    const params = [];

    if (type) { where += ' AND e.type = ?'; params.push(type); }
    if (campaign_id) { where += ' AND e.campaign_id = ?'; params.push(campaign_id); }
    if (contact_id) { where += ' AND e.contact_id = ?'; params.push(contact_id); }
    if (from_date) { where += ' AND e.created_at >= ?'; params.push(from_date); }
    if (to_date) { where += ' AND e.created_at <= ?'; params.push(to_date); }

    const totalRow = await db.prepare(`SELECT COUNT(*) as c FROM events e WHERE ${where}`).get(...params);
    const total = parseInt(totalRow.c, 10);
    const offset = (parseInt(page) - 1) * parseInt(limit);

    const events = await db.prepare(`
      SELECT e.*, c.email, c.first_name, c.last_name, ca.name as campaign_name
      FROM events e
      LEFT JOIN contacts c ON c.id = e.contact_id
      LEFT JOIN campaigns ca ON ca.id = e.campaign_id
      WHERE ${where}
      ORDER BY e.created_at DESC LIMIT ? OFFSET ?
    `).all(...params, parseInt(limit), offset);

    res.json({ events, pagination: { total, page: parseInt(page), limit: parseInt(limit) } });
  } catch (err) { next(err); }
});

router.get('/suppression', async (req, res, next) => {
  try {
    const db = getDb();
    const { page = 1, limit = 50, search } = req.query;
    let where = '1=1';
    const params = [];
    if (search) { where += ' AND email LIKE ?'; params.push(`%${search}%`); }

    const totalRow = await db.prepare(`SELECT COUNT(*) as c FROM suppression_list WHERE ${where}`).get(...params);
    const total = parseInt(totalRow.c, 10);
    const offset = (parseInt(page) - 1) * parseInt(limit);
    const entries = await db.prepare(`SELECT * FROM suppression_list WHERE ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`).all(...params, parseInt(limit), offset);

    res.json({ entries, pagination: { total, page: parseInt(page), limit: parseInt(limit) } });
  } catch (err) { next(err); }
});

router.post('/suppression', authenticate, async (req, res, next) => {
  try {
    const db = getDb();
    const { emails, reason = 'manual' } = req.body;
    if (!emails || !Array.isArray(emails)) return res.status(400).json({ error: 'emails array required' });

    let added = 0;
    await db.transaction(async () => {
      for (const email of emails) {
        const r = await db.prepare("INSERT OR IGNORE INTO suppression_list (email, reason, source) VALUES (?, ?, 'api')").run(email, reason);
        if (r.changes > 0) {
          added++;
          await db.prepare("UPDATE contacts SET status = 'suppressed', updated_at = NOW() WHERE email = ?").run(email);
        }
      }
    })();

    res.json({ added, total: emails.length });
  } catch (err) { next(err); }
});

router.delete('/suppression/:id', authenticate, async (req, res, next) => {
  try {
    const db = getDb();
    const entry = await db.prepare('SELECT * FROM suppression_list WHERE id = ?').get(req.params.id);
    if (entry) {
      await db.prepare('DELETE FROM suppression_list WHERE id = ?').run(req.params.id);
      await db.prepare("UPDATE contacts SET status = 'active', updated_at = NOW() WHERE email = ? AND status = 'suppressed'").run(entry.email);
    }
    res.json({ message: 'Removed from suppression list' });
  } catch (err) { next(err); }
});

module.exports = router;
