const express = require('express');
const router = express.Router();
const { getDb } = require('../db/connection');
const { authenticate, requirePermission } = require('../middleware/auth');
const { populateRecipients, processCampaign, updateCampaignStats } = require('../services/sendQueue');
const { fireWebhooks } = require('../services/webhookService');
const { plainTextToHtml } = require('../services/templateEngine');
const logger = require('../utils/logger');
const config = require('../config');
const { buildEmail } = require('../services/templateEngine');
const { sendEmail } = require('../services/mailer');

router.use(authenticate);

router.get('/', async (req, res, next) => {
  try {
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

    const totalRow = await db.prepare(`SELECT COUNT(*) as count FROM campaigns WHERE ${where}`).get(...params);
    const total = parseInt(totalRow.count, 10);
    const offset = (parseInt(page) - 1) * parseInt(limit);

    const campaigns = await db.prepare(`
      SELECT * FROM campaigns WHERE ${where} ORDER BY ${sortCol} ${sortOrder} LIMIT ? OFFSET ?
    `).all(...params, parseInt(limit), offset);

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
  } catch (err) { next(err); }
});

router.get('/:id', async (req, res, next) => {
  try {
    const db = getDb();
    const campaign = await db.prepare('SELECT * FROM campaigns WHERE id = ?').get(req.params.id);
    if (!campaign) return res.status(404).json({ error: 'Campaign not found' });

    const recipientStats = await db.prepare(`
      SELECT status, COUNT(*) as count FROM campaign_recipients WHERE campaign_id = ? GROUP BY status
    `).all(req.params.id);

    const recentEvents = await db.prepare(`
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
  } catch (err) { next(err); }
});

router.post('/', requirePermission('write'), async (req, res, next) => {
  try {
    const db = getDb();
    let {
      name, subject, from_name, from_email, reply_to,
      template_id, html_content, text_content,
      type = 'regular', list_ids = [], exclude_list_ids = [],
      scheduled_at, track_opens = 0, track_clicks = 0,
      utm_source, utm_medium, utm_campaign,
      ab_test_field, ab_split_pct, ab_winner_metric, ab_auto_send_winner,
    } = req.body;

    if (!name) return res.status(400).json({ error: 'Campaign name is required' });

    // Auto-convert plain text to HTML if text_content provided but html_content is empty
    if (text_content && (!html_content || !html_content.trim())) {
      html_content = plainTextToHtml(text_content);
    }

    const result = await db.prepare(`
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

    const campaign = await db.prepare('SELECT * FROM campaigns WHERE id = ?').get(result.lastInsertRowid);
    fireWebhooks('campaign.created', campaign);

    res.status(201).json({ campaign });
  } catch (err) { next(err); }
});

router.put('/:id', requirePermission('write'), async (req, res, next) => {
  try {
    const db = getDb();
    const existing = await db.prepare('SELECT * FROM campaigns WHERE id = ?').get(req.params.id);
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
        values.push(req.body[field]);
      }
    }

    for (const listField of ['list_ids', 'exclude_list_ids']) {
      if (req.body[listField] !== undefined) {
        updates.push(`${listField} = ?`);
        values.push(JSON.stringify(req.body[listField]));
      }
    }

    if (updates.length > 0) {
      updates.push('updated_at = NOW()');
      await db.prepare(`UPDATE campaigns SET ${updates.join(', ')} WHERE id = ?`).run(...values, req.params.id);
    }

    const campaign = await db.prepare('SELECT * FROM campaigns WHERE id = ?').get(req.params.id);
    res.json({ campaign });
  } catch (err) { next(err); }
});

router.post('/:id/schedule', requirePermission('write'), async (req, res, next) => {
  try {
    const db = getDb();
    const campaign = await db.prepare('SELECT * FROM campaigns WHERE id = ?').get(req.params.id);
    if (!campaign) return res.status(404).json({ error: 'Campaign not found' });
    if (campaign.status !== 'draft' && campaign.status !== 'paused') {
      return res.status(400).json({ error: `Cannot schedule campaign in '${campaign.status}' status` });
    }

    const { scheduled_at } = req.body;
    if (!scheduled_at) return res.status(400).json({ error: 'scheduled_at is required' });

    await db.prepare("UPDATE campaigns SET status = 'scheduled', scheduled_at = ?, updated_at = NOW() WHERE id = ?")
      .run(scheduled_at, req.params.id);

    fireWebhooks('campaign.scheduled', { campaign_id: campaign.id, scheduled_at });
    res.json({ message: 'Campaign scheduled', scheduled_at });
  } catch (err) { next(err); }
});

router.post('/:id/send', requirePermission('write'), async (req, res, next) => {
  try {
    const db = getDb();
    const campaign = await db.prepare('SELECT * FROM campaigns WHERE id = ?').get(req.params.id);
    if (!campaign) return res.status(404).json({ error: 'Campaign not found' });
    if (campaign.status !== 'draft' && campaign.status !== 'scheduled' && campaign.status !== 'paused') {
      return res.status(400).json({ error: `Cannot send campaign in '${campaign.status}' status` });
    }

    const listIds = JSON.parse(campaign.list_ids || '[]');
    if (listIds.length === 0) {
      return res.status(400).json({ error: 'Campaign has no target lists' });
    }

    try {
      const recipientCount = await populateRecipients(campaign.id);
      res.json({ message: `Sending to ${recipientCount} recipients`, campaign_id: campaign.id });

      processCampaign(campaign.id).catch(err => {
        logger.error(`Background send failed: ${err.message}`);
      });
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  } catch (err) { next(err); }
});

router.post('/:id/test-send', requirePermission('write'), async (req, res, next) => {
  try {
    const db = getDb();
    const campaign = await db.prepare('SELECT * FROM campaigns WHERE id = ?').get(req.params.id);
    if (!campaign) return res.status(404).json({ error: 'Campaign not found' });

    const to = (req.body && req.body.to) || config.appEmail;
    if (!to) return res.status(400).json({ error: 'No recipient — pass "to" or set APP_EMAIL.' });

    let template = { html_content: '', text_content: '', subject: '' };
    if (campaign.template_id) {
      template = (await db.prepare('SELECT * FROM templates WHERE id = ?').get(campaign.template_id)) || template;
    }

    const sampleContact = {
      id: 0, email: to, first_name: 'there', last_name: '',
      company: 'Acme', title: '', custom_fields: '{}',
    };
    const email = buildEmail(campaign, sampleContact, template);

    const result = await sendEmail({
      to,
      subject: `[TEST] ${email.subject}`,
      html: email.html,
      text: email.text,
      from: campaign.from_name
        ? `"${campaign.from_name}" <${campaign.from_email || config.smtp.fromEmail}>`
        : undefined,
      replyTo: campaign.reply_to || undefined,
    });

    if (!result.success) return res.status(400).json({ error: result.error });
    res.json({ message: `Test email sent to ${to}`, messageId: result.messageId });
  } catch (err) { next(err); }
});

router.post('/:id/pause', requirePermission('write'), async (req, res, next) => {
  try {
    const db = getDb();
    await db.prepare("UPDATE campaigns SET status = 'paused', updated_at = NOW() WHERE id = ?").run(req.params.id);
    fireWebhooks('campaign.paused', { campaign_id: req.params.id });
    res.json({ message: 'Campaign paused' });
  } catch (err) { next(err); }
});

router.post('/:id/resume', requirePermission('write'), async (req, res, next) => {
  try {
    const db = getDb();
    const campaign = await db.prepare('SELECT * FROM campaigns WHERE id = ?').get(req.params.id);
    if (!campaign || campaign.status !== 'paused') {
      return res.status(400).json({ error: 'Campaign is not paused' });
    }

    res.json({ message: 'Campaign resumed' });
    processCampaign(campaign.id).catch(err => logger.error(`Resume send failed: ${err.message}`));
  } catch (err) { next(err); }
});

router.post('/:id/cancel', requirePermission('write'), async (req, res, next) => {
  try {
    const db = getDb();
    await db.prepare("UPDATE campaigns SET status = 'cancelled', updated_at = NOW() WHERE id = ?").run(req.params.id);
    fireWebhooks('campaign.cancelled', { campaign_id: req.params.id });
    res.json({ message: 'Campaign cancelled' });
  } catch (err) { next(err); }
});

router.post('/:id/archive', requirePermission('write'), async (req, res, next) => {
  try {
    const db = getDb();
    await db.prepare("UPDATE campaigns SET status = 'archived', updated_at = NOW() WHERE id = ?").run(req.params.id);
    res.json({ message: 'Campaign archived' });
  } catch (err) { next(err); }
});

router.post('/:id/duplicate', requirePermission('write'), async (req, res, next) => {
  try {
    const db = getDb();
    const original = await db.prepare('SELECT * FROM campaigns WHERE id = ?').get(req.params.id);
    if (!original) return res.status(404).json({ error: 'Campaign not found' });

    const result = await db.prepare(`
      INSERT INTO campaigns (name, subject, from_name, from_email, reply_to, template_id, html_content, text_content, type, list_ids, exclude_list_ids, track_opens, track_clicks, utm_source, utm_medium, utm_campaign, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft')
    `).run(
      `${original.name} (Copy)`, original.subject, original.from_name, original.from_email, original.reply_to,
      original.template_id, original.html_content, original.text_content, original.type,
      original.list_ids, original.exclude_list_ids,
      original.track_opens, original.track_clicks,
      original.utm_source, original.utm_medium, original.utm_campaign
    );

    const campaign = await db.prepare('SELECT * FROM campaigns WHERE id = ?').get(result.lastInsertRowid);
    res.status(201).json({ campaign });
  } catch (err) { next(err); }
});

router.delete('/:id', requirePermission('admin'), async (req, res, next) => {
  try {
    const db = getDb();
    const campaign = await db.prepare('SELECT * FROM campaigns WHERE id = ?').get(req.params.id);
    if (!campaign) return res.status(404).json({ error: 'Campaign not found' });
    if (campaign.status === 'sending') return res.status(400).json({ error: 'Cannot delete a campaign that is currently sending' });

    await db.prepare('DELETE FROM campaigns WHERE id = ?').run(req.params.id);
    res.json({ message: 'Campaign deleted' });
  } catch (err) { next(err); }
});

router.get('/:id/analytics', async (req, res, next) => {
  try {
    const db = getDb();
    const campaign = await db.prepare('SELECT * FROM campaigns WHERE id = ?').get(req.params.id);
    if (!campaign) return res.status(404).json({ error: 'Campaign not found' });

    await updateCampaignStats(campaign.id);

    const dailyStats = await db.prepare('SELECT * FROM daily_stats WHERE campaign_id = ? ORDER BY date ASC').all(campaign.id);

    const topLinks = await db.prepare(`
      SELECT url, COUNT(*) as clicks, COUNT(DISTINCT contact_id) as unique_clicks
      FROM events WHERE campaign_id = ? AND type = 'click' AND url != ''
      GROUP BY url ORDER BY clicks DESC LIMIT 20
    `).all(campaign.id);

    const hourlyOpens = await db.prepare(`
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
  } catch (err) { next(err); }
});

module.exports = router;
