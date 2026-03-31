const express = require('express');
const router = express.Router();
const { getDb } = require('../db/connection');
const { authenticate, requirePermission } = require('../middleware/auth');
const { populateRecipients, processCampaign, updateCampaignStats } = require('../services/sendQueue');
const { fireWebhooks } = require('../services/webhookService');
const logger = require('../utils/logger');

router.use(authenticate);

// List all campaigns with pagination & filtering
router.get('/', (req, res) => {
  const db = getDb();
  const { status, type, search, page = 1, limit = 25, sort = 'created_at', order = 'desc' } = req.query;

  let where = '1=1';
  const params = [];

  if (status) { where += ' AND status = ?'; params.push(status); }
  if (type) { where += ' AND type = ?'; params.push(type); }
  if (search) { where += ' AND (name LIKE ? OR subject LIKE ?)'; params.push(`%${search}%`, `%${search}%`); }

  const allowedSort = ['created_at', 'name', 'status', 'scheduled_at', 'total_sent', 'total_opens'];
  const sortCol = allowedSort.includes(sort) ? sort : 'created_at';
  const sortOrder = order === 'asc' ? 'ASC' : 'DESC';

  const total = db.prepare(`SELECT COUNT(*) as count FROM campaigns WHERE ${where}`).get(...params).count;
  const offset = (parseInt(page) - 1) * parseInt(limit);

  const campaigns = db.prepare(`
    SELECT * FROM campaigns WHERE ${where} ORDER BY ${sortCol} ${sortOrder} LIMIT ? OFFSET ?
  `).all(...params, parseInt(limit), offset);

  // Calculate rates
  const enriched = campaigns.map(c => ({
    ...c,
    open_rate: c.total_sent > 0 ? ((c.total_unique_opens / c.total_sent) * 100).toFixed(1) : '0.0',
    click_rate: c.total_sent > 0 ? ((c.total_unique_clicks / c.total_sent) * 100).toFixed(1) : '0.0',
    bounce_rate: c.total_sent > 0 ? ((c.total_bounces / c.total_sent) * 100).toFixed(1) : '0.0',
  }));

  res.json({
    campaigns: enriched,
    pagination: { total, page: parseInt(page), limit: parseInt(limit), pages: Math.ceil(total / parseInt(limit)) },
  });
});

// Get single campaign with full details
router.get('/:id', (req, res) => {
  const db = getDb();
  const campaign = db.prepare('SELECT * FROM campaigns WHERE id = ?').get(req.params.id);
  if (!campaign) return res.status(404).json({ error: 'Campaign not found' });

  // Get recipient status breakdown
  const recipientStats = db.prepare(`
    SELECT status, COUNT(*) as count FROM campaign_recipients WHERE campaign_id = ? GROUP BY status
  `).all(req.params.id);

  // Get recent events
  const recentEvents = db.prepare(`
    SELECT e.*, c.email, c.first_name, c.last_name
    FROM events e
    LEFT JOIN contacts c ON c.id = e.contact_id
    WHERE e.campaign_id = ?
    ORDER BY e.created_at DESC LIMIT 50
  `).all(req.params.id);

  res.json({
    campaign: {
      ...campaign,
      open_rate: campaign.total_sent > 0 ? ((campaign.total_unique_opens / campaign.total_sent) * 100).toFixed(1) : '0.0',
      click_rate: campaign.total_sent > 0 ? ((campaign.total_unique_clicks / campaign.total_sent) * 100).toFixed(1) : '0.0',
    },
    recipient_stats: recipientStats,
    recent_events: recentEvents,
  });
});

// Create campaign
router.post('/', requirePermission('write'), (req, res) => {
  const db = getDb();
  const {
    name, subject, from_name, from_email, reply_to,
    template_id, html_content, text_content,
    type = 'regular', list_ids = [], exclude_list_ids = [],
    scheduled_at, track_opens = 1, track_clicks = 1,
    utm_source, utm_medium, utm_campaign,
    // A/B test fields
    ab_test_field, ab_split_pct, ab_winner_metric, ab_auto_send_winner,
  } = req.body;

  if (!name) return res.status(400).json({ error: 'Campaign name is required' });

  const result = db.prepare(`
    INSERT INTO campaigns (
      name, subject, from_name, from_email, reply_to,
      template_id, html_content, text_content,
      type, list_ids, exclude_list_ids,
      scheduled_at, track_opens, track_clicks,
      utm_source, utm_medium, utm_campaign,
      ab_test_field, ab_split_pct, ab_winner_metric, ab_auto_send_winner,
      status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft')
  `).run(
    name, subject || '', from_name || '', from_email || '', reply_to || '',
    template_id || null, html_content || '', text_content || '',
    type, JSON.stringify(list_ids), JSON.stringify(exclude_list_ids),
    scheduled_at || null, track_opens ? 1 : 0, track_clicks ? 1 : 0,
    utm_source || '', utm_medium || 'email', utm_campaign || '',
    ab_test_field || null, ab_split_pct || 50, ab_winner_metric || 'open_rate',
    ab_auto_send_winner ? 1 : 0
  );

  const campaign = db.prepare('SELECT * FROM campaigns WHERE id = ?').get(result.lastInsertRowid);
  fireWebhooks('campaign.created', campaign);

  res.status(201).json({ campaign });
});

// Update campaign
router.put('/:id', requirePermission('write'), (req, res) => {
  const db = getDb();
  const existing = db.prepare('SELECT * FROM campaigns WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Campaign not found' });
  if (!['draft', 'paused', 'scheduled'].includes(existing.status)) {
    return res.status(400).json({ error: `Cannot edit campaign in '${existing.status}' status` });
  }

  const fields = [
    'name', 'subject', 'from_name', 'from_email', 'reply_to',
    'template_id', 'html_content', 'text_content', 'type',
    'scheduled_at', 'track_opens', 'track_clicks',
    'utm_source', 'utm_medium', 'utm_campaign',
    'ab_test_field', 'ab_split_pct', 'ab_winner_metric', 'ab_auto_send_winner',
  ];

  const updates = [];
  const values = [];

  for (const field of fields) {
    if (req.body[field] !== undefined) {
      updates.push(`${field} = ?`);
      if (field === 'list_ids' || field === 'exclude_list_ids') {
        values.push(JSON.stringify(req.body[field]));
      } else {
        values.push(req.body[field]);
      }
    }
  }

  // Handle list_ids and exclude_list_ids separately
  for (const listField of ['list_ids', 'exclude_list_ids']) {
    if (req.body[listField] !== undefined) {
      updates.push(`${listField} = ?`);
      values.push(JSON.stringify(req.body[listField]));
    }
  }

  if (updates.length > 0) {
    updates.push('updated_at = datetime("now")');
    db.prepare(`UPDATE campaigns SET ${updates.join(', ')} WHERE id = ?`).run(...values, req.params.id);
  }

  const campaign = db.prepare('SELECT * FROM campaigns WHERE id = ?').get(req.params.id);
  res.json({ campaign });
});

// Schedule a campaign
router.post('/:id/schedule', requirePermission('write'), (req, res) => {
  const db = getDb();
  const campaign = db.prepare('SELECT * FROM campaigns WHERE id = ?').get(req.params.id);
  if (!campaign) return res.status(404).json({ error: 'Campaign not found' });
  if (campaign.status !== 'draft' && campaign.status !== 'paused') {
    return res.status(400).json({ error: `Cannot schedule campaign in '${campaign.status}' status` });
  }

  const { scheduled_at } = req.body;
  if (!scheduled_at) return res.status(400).json({ error: 'scheduled_at is required' });

  db.prepare('UPDATE campaigns SET status = "scheduled", scheduled_at = ?, updated_at = datetime("now") WHERE id = ?')
    .run(scheduled_at, req.params.id);

  fireWebhooks('campaign.scheduled', { campaign_id: campaign.id, scheduled_at });
  res.json({ message: 'Campaign scheduled', scheduled_at });
});

// Send campaign immediately
router.post('/:id/send', requirePermission('write'), async (req, res) => {
  const db = getDb();
  const campaign = db.prepare('SELECT * FROM campaigns WHERE id = ?').get(req.params.id);
  if (!campaign) return res.status(404).json({ error: 'Campaign not found' });
  if (campaign.status !== 'draft' && campaign.status !== 'scheduled' && campaign.status !== 'paused') {
    return res.status(400).json({ error: `Cannot send campaign in '${campaign.status}' status` });
  }

  const listIds = JSON.parse(campaign.list_ids || '[]');
  if (listIds.length === 0) {
    return res.status(400).json({ error: 'Campaign has no target lists' });
  }

  try {
    const recipientCount = populateRecipients(campaign.id);
    res.json({ message: `Sending to ${recipientCount} recipients`, campaign_id: campaign.id });

    // Process in background
    processCampaign(campaign.id).catch(err => {
      logger.error(`Background send failed: ${err.message}`);
    });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// Pause campaign
router.post('/:id/pause', requirePermission('write'), (req, res) => {
  const db = getDb();
  db.prepare('UPDATE campaigns SET status = "paused", updated_at = datetime("now") WHERE id = ?').run(req.params.id);
  fireWebhooks('campaign.paused', { campaign_id: req.params.id });
  res.json({ message: 'Campaign paused' });
});

// Resume campaign
router.post('/:id/resume', requirePermission('write'), async (req, res) => {
  const db = getDb();
  const campaign = db.prepare('SELECT * FROM campaigns WHERE id = ?').get(req.params.id);
  if (!campaign || campaign.status !== 'paused') {
    return res.status(400).json({ error: 'Campaign is not paused' });
  }

  res.json({ message: 'Campaign resumed' });
  processCampaign(campaign.id).catch(err => logger.error(`Resume send failed: ${err.message}`));
});

// Cancel campaign
router.post('/:id/cancel', requirePermission('write'), (req, res) => {
  const db = getDb();
  db.prepare('UPDATE campaigns SET status = "cancelled", updated_at = datetime("now") WHERE id = ?').run(req.params.id);
  fireWebhooks('campaign.cancelled', { campaign_id: req.params.id });
  res.json({ message: 'Campaign cancelled' });
});

// Archive campaign
router.post('/:id/archive', requirePermission('write'), (req, res) => {
  const db = getDb();
  db.prepare('UPDATE campaigns SET status = "archived", updated_at = datetime("now") WHERE id = ?').run(req.params.id);
  res.json({ message: 'Campaign archived' });
});

// Duplicate campaign
router.post('/:id/duplicate', requirePermission('write'), (req, res) => {
  const db = getDb();
  const original = db.prepare('SELECT * FROM campaigns WHERE id = ?').get(req.params.id);
  if (!original) return res.status(404).json({ error: 'Campaign not found' });

  const result = db.prepare(`
    INSERT INTO campaigns (name, subject, from_name, from_email, reply_to, template_id, html_content, text_content, type, list_ids, exclude_list_ids, track_opens, track_clicks, utm_source, utm_medium, utm_campaign, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft')
  `).run(
    `${original.name} (Copy)`, original.subject, original.from_name, original.from_email, original.reply_to,
    original.template_id, original.html_content, original.text_content, original.type,
    original.list_ids, original.exclude_list_ids,
    original.track_opens, original.track_clicks,
    original.utm_source, original.utm_medium, original.utm_campaign
  );

  const campaign = db.prepare('SELECT * FROM campaigns WHERE id = ?').get(result.lastInsertRowid);
  res.status(201).json({ campaign });
});

// Delete campaign
router.delete('/:id', requirePermission('admin'), (req, res) => {
  const db = getDb();
  const campaign = db.prepare('SELECT * FROM campaigns WHERE id = ?').get(req.params.id);
  if (!campaign) return res.status(404).json({ error: 'Campaign not found' });
  if (campaign.status === 'sending') return res.status(400).json({ error: 'Cannot delete a campaign that is currently sending' });

  db.prepare('DELETE FROM campaigns WHERE id = ?').run(req.params.id);
  res.json({ message: 'Campaign deleted' });
});

// Get campaign analytics
router.get('/:id/analytics', (req, res) => {
  const db = getDb();
  const campaign = db.prepare('SELECT * FROM campaigns WHERE id = ?').get(req.params.id);
  if (!campaign) return res.status(404).json({ error: 'Campaign not found' });

  updateCampaignStats(campaign.id);

  const dailyStats = db.prepare('SELECT * FROM daily_stats WHERE campaign_id = ? ORDER BY date ASC').all(campaign.id);

  const topLinks = db.prepare(`
    SELECT url, COUNT(*) as clicks, COUNT(DISTINCT contact_id) as unique_clicks
    FROM events WHERE campaign_id = ? AND type = 'click' AND url != ''
    GROUP BY url ORDER BY clicks DESC LIMIT 20
  `).all(campaign.id);

  const hourlyOpens = db.prepare(`
    SELECT strftime('%H', created_at) as hour, COUNT(*) as count
    FROM events WHERE campaign_id = ? AND type = 'open'
    GROUP BY hour ORDER BY hour
  `).all(campaign.id);

  res.json({
    campaign: {
      ...campaign,
      open_rate: campaign.total_sent > 0 ? ((campaign.total_unique_opens / campaign.total_sent) * 100).toFixed(1) : '0.0',
      click_rate: campaign.total_sent > 0 ? ((campaign.total_unique_clicks / campaign.total_sent) * 100).toFixed(1) : '0.0',
      bounce_rate: campaign.total_sent > 0 ? ((campaign.total_bounces / campaign.total_sent) * 100).toFixed(1) : '0.0',
      unsubscribe_rate: campaign.total_sent > 0 ? ((campaign.total_unsubscribes / campaign.total_sent) * 100).toFixed(1) : '0.0',
    },
    daily_stats: dailyStats,
    top_links: topLinks,
    hourly_opens: hourlyOpens,
  });
});

module.exports = router;
