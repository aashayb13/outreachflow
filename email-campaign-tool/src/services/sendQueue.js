const { getDb } = require('../db/connection');
const { sendEmail } = require('./mailer');
const { buildEmail } = require('./templateEngine');
const { fireWebhooks } = require('./webhookService');
const config = require('../config');
const logger = require('../utils/logger');

let isSending = false;
let dailySendCount = 0;
let dailyResetDate = new Date().toISOString().slice(0, 10);

function resetDailyCountIfNeeded() {
  const today = new Date().toISOString().slice(0, 10);
  if (today !== dailyResetDate) {
    dailySendCount = 0;
    dailyResetDate = today;
  }
}

/**
 * Populate the campaign_recipients table for a campaign.
 */
async function populateRecipients(campaignId) {
  const db = getDb();
  const campaign = await db.prepare('SELECT * FROM campaigns WHERE id = ?').get(campaignId);
  if (!campaign) throw new Error(`Campaign ${campaignId} not found`);

  const listIds = JSON.parse(campaign.list_ids || '[]');
  const excludeListIds = JSON.parse(campaign.exclude_list_ids || '[]');

  if (listIds.length === 0) {
    throw new Error('Campaign has no target lists');
  }

  // Get contacts from target lists
  const placeholders = listIds.map(() => '?').join(',');
  let contacts = await db.prepare(`
    SELECT DISTINCT c.id, c.email
    FROM contacts c
    JOIN list_contacts lc ON lc.contact_id = c.id
    WHERE lc.list_id IN (${placeholders})
      AND c.status = 'active'
      AND c.email NOT IN (SELECT email FROM suppression_list)
  `).all(...listIds);

  // Exclude contacts from exclude lists
  if (excludeListIds.length > 0) {
    const exPlaceholders = excludeListIds.map(() => '?').join(',');
    const excludeRows = await db.prepare(`
      SELECT DISTINCT contact_id FROM list_contacts WHERE list_id IN (${exPlaceholders})
    `).all(...excludeListIds);
    const excludeIds = new Set(excludeRows.map(r => r.contact_id));
    contacts = contacts.filter(c => !excludeIds.has(c.id));
  }

  // Remove duplicates and already-queued
  const existingRows = await db.prepare('SELECT contact_id FROM campaign_recipients WHERE campaign_id = ?').all(campaignId);
  const existingRecipients = new Set(existingRows.map(r => r.contact_id));

  const newRecipients = contacts.filter(c => !existingRecipients.has(c.id));

  await db.transaction(async () => {
    for (const contact of newRecipients) {
      await db.prepare(`
        INSERT INTO campaign_recipients (campaign_id, contact_id, email, status)
        VALUES (?, ?, ?, 'queued')
      `).run(campaignId, contact.id, contact.email);
    }
  })();

  // Update total recipients
  const totalRow = await db.prepare('SELECT COUNT(*) as count FROM campaign_recipients WHERE campaign_id = ?').get(campaignId);
  const total = parseInt(totalRow.count, 10);
  await db.prepare('UPDATE campaigns SET total_recipients = ?, updated_at = NOW() WHERE id = ?').run(total, campaignId);

  logger.info(`Populated ${newRecipients.length} recipients for campaign ${campaignId}`);
  return newRecipients.length;
}

/**
 * Process the send queue for a campaign.
 */
async function processCampaign(campaignId) {
  if (isSending) {
    logger.warn('Send queue already processing');
    return;
  }

  isSending = true;
  const db = getDb();

  try {
    const campaign = await db.prepare('SELECT * FROM campaigns WHERE id = ?').get(campaignId);
    if (!campaign) throw new Error(`Campaign ${campaignId} not found`);

    let template = { html_content: '', text_content: '', subject: '' };
    if (campaign.template_id) {
      template = (await db.prepare('SELECT * FROM templates WHERE id = ?').get(campaign.template_id)) || template;
    }

    await db.prepare("UPDATE campaigns SET status = 'sending', send_started_at = NOW(), updated_at = NOW() WHERE id = ?").run(campaignId);

    const batchSize = 50;
    let processed = 0;

    while (true) {
      const currentStatus = await db.prepare('SELECT status FROM campaigns WHERE id = ?').get(campaignId);
      if (currentStatus.status === 'paused' || currentStatus.status === 'cancelled') {
        logger.info(`Campaign ${campaignId} ${currentStatus.status} — stopping send`);
        break;
      }

      resetDailyCountIfNeeded();
      if (dailySendCount >= config.sendRate.perDay) {
        logger.warn(`Daily send limit reached (${config.sendRate.perDay}). Pausing campaign ${campaignId}.`);
        await db.prepare("UPDATE campaigns SET status = 'paused', updated_at = NOW() WHERE id = ?").run(campaignId);
        break;
      }

      const recipients = await db.prepare(`
        SELECT cr.*, c.first_name, c.last_name, c.company, c.title, c.custom_fields
        FROM campaign_recipients cr
        JOIN contacts c ON c.id = cr.contact_id
        WHERE cr.campaign_id = ? AND cr.status = 'queued'
        LIMIT ?
      `).all(campaignId, batchSize);

      if (recipients.length === 0) break;

      for (const recipient of recipients) {
        resetDailyCountIfNeeded();
        if (dailySendCount >= config.sendRate.perDay) break;

        const contact = {
          id: recipient.contact_id,
          email: recipient.email,
          first_name: recipient.first_name,
          last_name: recipient.last_name,
          company: recipient.company,
          title: recipient.title,
          custom_fields: recipient.custom_fields,
        };

        const email = buildEmail(campaign, contact, template);

        await db.prepare("UPDATE campaign_recipients SET status = 'sending' WHERE id = ?").run(recipient.id);

        const unsubUrl = `${config.tracking.domain || config.baseUrl}/t/unsubscribe/${campaignId}/${contact.id}`;
        const result = await sendEmail({
          to: recipient.email,
          subject: email.subject,
          html: email.html,
          text: email.text,
          from: campaign.from_name
            ? `"${campaign.from_name}" <${campaign.from_email || config.smtp.fromEmail}>`
            : undefined,
          replyTo: campaign.reply_to || undefined,
          headers: {
            'X-Campaign-ID': String(campaignId),
            'List-Unsubscribe': `<${unsubUrl}>`,
          },
        });

        if (result.success) {
          await db.prepare(`
            UPDATE campaign_recipients SET status = 'sent', sent_at = NOW(), message_id = ? WHERE id = ?
          `).run(result.messageId || '', recipient.id);

          await db.prepare(`
            INSERT INTO events (campaign_id, contact_id, recipient_id, type, metadata)
            VALUES (?, ?, ?, 'send', '{}')
          `).run(campaignId, contact.id, recipient.id);

          dailySendCount++;
          processed++;
        } else {
          await db.prepare(`
            UPDATE campaign_recipients SET status = 'failed', error_message = ? WHERE id = ?
          `).run(result.error || 'Unknown error', recipient.id);
        }

        await sleep(1000 / config.sendRate.perSecond);
      }
    }

    await updateCampaignStats(campaignId);

    const remainingRow = await db.prepare("SELECT COUNT(*) as count FROM campaign_recipients WHERE campaign_id = ? AND status = 'queued'").get(campaignId);
    const remaining = parseInt(remainingRow.count, 10);

    if (remaining === 0) {
      const currentStatus = await db.prepare('SELECT status FROM campaigns WHERE id = ?').get(campaignId);
      if (currentStatus.status === 'sending') {
        await db.prepare("UPDATE campaigns SET status = 'sent', send_completed_at = NOW(), updated_at = NOW() WHERE id = ?").run(campaignId);
      }
    }

    fireWebhooks('campaign.sent', { campaign_id: campaignId, total_sent: processed });

    logger.info(`Campaign ${campaignId}: sent ${processed} emails`);
    return processed;
  } catch (error) {
    logger.error(`Error processing campaign ${campaignId}: ${error.message}`);
    throw error;
  } finally {
    isSending = false;
  }
}

/**
 * Update denormalized campaign stats from events/recipients tables.
 */
async function updateCampaignStats(campaignId) {
  const db = getDb();

  const stats = await db.prepare(`
    SELECT
      COUNT(*) as total_sent,
      SUM(CASE WHEN status = 'delivered' THEN 1 ELSE 0 END) as total_delivered,
      SUM(CASE WHEN status = 'bounced' THEN 1 ELSE 0 END) as total_bounces
    FROM campaign_recipients WHERE campaign_id = ? AND status != 'queued'
  `).get(campaignId);

  const eventStats = await db.prepare(`
    SELECT
      SUM(CASE WHEN type = 'open' THEN 1 ELSE 0 END) as total_opens,
      COUNT(DISTINCT CASE WHEN type = 'open' THEN contact_id END) as total_unique_opens,
      SUM(CASE WHEN type = 'click' THEN 1 ELSE 0 END) as total_clicks,
      COUNT(DISTINCT CASE WHEN type = 'click' THEN contact_id END) as total_unique_clicks,
      SUM(CASE WHEN type = 'complaint' THEN 1 ELSE 0 END) as total_complaints,
      SUM(CASE WHEN type = 'unsubscribe' THEN 1 ELSE 0 END) as total_unsubscribes
    FROM events WHERE campaign_id = ?
  `).get(campaignId);

  await db.prepare(`
    UPDATE campaigns SET
      total_sent = ?, total_delivered = ?, total_bounces = ?,
      total_opens = ?, total_unique_opens = ?,
      total_clicks = ?, total_unique_clicks = ?,
      total_complaints = ?, total_unsubscribes = ?,
      updated_at = NOW()
    WHERE id = ?
  `).run(
    stats.total_sent || 0, stats.total_delivered || 0, stats.total_bounces || 0,
    eventStats.total_opens || 0, eventStats.total_unique_opens || 0,
    eventStats.total_clicks || 0, eventStats.total_unique_clicks || 0,
    eventStats.total_complaints || 0, eventStats.total_unsubscribes || 0,
    campaignId
  );
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

module.exports = { populateRecipients, processCampaign, updateCampaignStats };
