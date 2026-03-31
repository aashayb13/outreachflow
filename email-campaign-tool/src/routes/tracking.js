const express = require('express');
const router = express.Router();
const { getDb } = require('../db/connection');
const { fireWebhooks } = require('../services/webhookService');
const logger = require('../utils/logger');

// 1x1 transparent GIF pixel
const PIXEL = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');

// Open tracking pixel
router.get('/open/:campaignId/:contactId', (req, res) => {
  const { campaignId, contactId } = req.params;
  const db = getDb();

  try {
    db.prepare(`
      INSERT INTO events (campaign_id, contact_id, type, ip_address, user_agent, metadata)
      VALUES (?, ?, 'open', ?, ?, '{}')
    `).run(campaignId, contactId, req.ip, req.get('user-agent') || '');

    // Update campaign stats
    db.prepare('UPDATE campaigns SET total_opens = total_opens + 1, updated_at = datetime("now") WHERE id = ?').run(campaignId);

    // Check if first open from this contact
    const openCount = db.prepare('SELECT COUNT(*) as c FROM events WHERE campaign_id = ? AND contact_id = ? AND type = "open"').get(campaignId, contactId).c;
    if (openCount === 1) {
      db.prepare('UPDATE campaigns SET total_unique_opens = total_unique_opens + 1 WHERE id = ?').run(campaignId);
    }

    fireWebhooks('email.opened', { campaign_id: campaignId, contact_id: contactId });
  } catch (err) {
    logger.error(`Open tracking error: ${err.message}`);
  }

  res.set({ 'Content-Type': 'image/gif', 'Cache-Control': 'no-store, no-cache, must-revalidate', 'Pragma': 'no-cache' });
  res.send(PIXEL);
});

// Click tracking redirect
router.get('/click/:campaignId/:contactId', (req, res) => {
  const { campaignId, contactId } = req.params;
  const { url } = req.query;

  if (!url) return res.status(400).send('Missing URL');

  const db = getDb();
  try {
    db.prepare(`
      INSERT INTO events (campaign_id, contact_id, type, url, ip_address, user_agent, metadata)
      VALUES (?, ?, 'click', ?, ?, ?, '{}')
    `).run(campaignId, contactId, url, req.ip, req.get('user-agent') || '');

    db.prepare('UPDATE campaigns SET total_clicks = total_clicks + 1, updated_at = datetime("now") WHERE id = ?').run(campaignId);

    const clickCount = db.prepare('SELECT COUNT(*) as c FROM events WHERE campaign_id = ? AND contact_id = ? AND type = "click"').get(campaignId, contactId).c;
    if (clickCount === 1) {
      db.prepare('UPDATE campaigns SET total_unique_clicks = total_unique_clicks + 1 WHERE id = ?').run(campaignId);
    }

    fireWebhooks('email.clicked', { campaign_id: campaignId, contact_id: contactId, url });
  } catch (err) {
    logger.error(`Click tracking error: ${err.message}`);
  }

  res.redirect(302, url);
});

// Unsubscribe handler
router.get('/unsubscribe/:campaignId/:contactId', (req, res) => {
  const { campaignId, contactId } = req.params;
  const db = getDb();

  try {
    const contact = db.prepare('SELECT * FROM contacts WHERE id = ?').get(contactId);
    if (contact) {
      // Update contact status
      db.prepare('UPDATE contacts SET status = "unsubscribed", updated_at = datetime("now") WHERE id = ?').run(contactId);

      // Add to suppression list
      db.prepare('INSERT OR IGNORE INTO suppression_list (email, reason, source) VALUES (?, "unsubscribe", ?)').run(contact.email, `campaign_${campaignId}`);

      // Log event
      db.prepare('INSERT INTO events (campaign_id, contact_id, type, metadata) VALUES (?, ?, "unsubscribe", "{}")').run(campaignId, contactId);

      db.prepare('UPDATE campaigns SET total_unsubscribes = total_unsubscribes + 1, updated_at = datetime("now") WHERE id = ?').run(campaignId);

      // Exit any active sequences
      db.prepare('UPDATE sequence_enrollments SET status = "exited", updated_at = datetime("now") WHERE contact_id = ? AND status = "active"').run(contactId);

      fireWebhooks('contact.unsubscribed', { campaign_id: campaignId, contact_id: contactId, email: contact.email });
    }
  } catch (err) {
    logger.error(`Unsubscribe error: ${err.message}`);
  }

  // Show unsubscribe confirmation page
  res.send(`<!DOCTYPE html><html><head><title>Unsubscribed</title>
<style>body{font-family:Arial,sans-serif;display:flex;justify-content:center;align-items:center;min-height:100vh;margin:0;background:#F9FAFB;}
.card{background:white;padding:40px;border-radius:12px;box-shadow:0 1px 3px rgba(0,0,0,0.1);text-align:center;max-width:400px;}
h1{color:#111827;font-size:24px;} p{color:#6B7280;}</style></head>
<body><div class="card"><h1>You've been unsubscribed</h1>
<p>You will no longer receive emails from us. If this was a mistake, please contact us.</p></div></body></html>`);
});

// Bounce webhook handler (for external services to report bounces)
router.post('/bounce', express.json(), (req, res) => {
  const db = getDb();
  const { email, type = 'hard', campaign_id, message_id } = req.body;

  if (!email) return res.status(400).json({ error: 'Email required' });

  const contact = db.prepare('SELECT * FROM contacts WHERE email = ? COLLATE NOCASE').get(email);
  if (contact) {
    if (type === 'hard') {
      db.prepare('UPDATE contacts SET status = "bounced", updated_at = datetime("now") WHERE id = ?').run(contact.id);
      db.prepare('INSERT OR IGNORE INTO suppression_list (email, reason) VALUES (?, "bounce")').run(email);
    }

    if (campaign_id) {
      db.prepare('INSERT INTO events (campaign_id, contact_id, type, metadata) VALUES (?, ?, "bounce", ?)').run(
        campaign_id, contact.id, JSON.stringify({ bounce_type: type, message_id })
      );
      db.prepare('UPDATE campaigns SET total_bounces = total_bounces + 1, updated_at = datetime("now") WHERE id = ?').run(campaign_id);
      db.prepare('UPDATE campaign_recipients SET status = "bounced" WHERE campaign_id = ? AND contact_id = ?').run(campaign_id, contact.id);
    }

    fireWebhooks('email.bounced', { email, contact_id: contact.id, type, campaign_id });
  }

  res.json({ received: true });
});

// Complaint webhook handler
router.post('/complaint', express.json(), (req, res) => {
  const db = getDb();
  const { email, campaign_id } = req.body;

  if (!email) return res.status(400).json({ error: 'Email required' });

  const contact = db.prepare('SELECT * FROM contacts WHERE email = ? COLLATE NOCASE').get(email);
  if (contact) {
    db.prepare('UPDATE contacts SET status = "complained", updated_at = datetime("now") WHERE id = ?').run(contact.id);
    db.prepare('INSERT OR IGNORE INTO suppression_list (email, reason) VALUES (?, "complaint")').run(email);

    if (campaign_id) {
      db.prepare('INSERT INTO events (campaign_id, contact_id, type, metadata) VALUES (?, ?, "complaint", "{}")').run(campaign_id, contact.id);
      db.prepare('UPDATE campaigns SET total_complaints = total_complaints + 1, updated_at = datetime("now") WHERE id = ?').run(campaign_id);
    }

    fireWebhooks('email.complained', { email, contact_id: contact.id, campaign_id });
  }

  res.json({ received: true });
});

module.exports = router;
