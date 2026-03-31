const cron = require('node-cron');
const { getDb } = require('../db/connection');
const { populateRecipients, processCampaign } = require('./sendQueue');
const { processSequences } = require('./sequenceEngine');
const logger = require('../utils/logger');

let scheduledJobs = [];

/**
 * Start all scheduled cron jobs.
 */
function startScheduler() {
  // Check for scheduled campaigns every minute
  const campaignCheck = cron.schedule('* * * * *', async () => {
    try {
      const db = getDb();
      const dueCampaigns = db.prepare(`
        SELECT id, name FROM campaigns
        WHERE status = 'scheduled'
          AND scheduled_at <= datetime('now')
      `).all();

      for (const campaign of dueCampaigns) {
        logger.info(`Launching scheduled campaign: ${campaign.name} (${campaign.id})`);
        try {
          populateRecipients(campaign.id);
          await processCampaign(campaign.id);
        } catch (error) {
          logger.error(`Failed to launch campaign ${campaign.id}: ${error.message}`);
        }
      }
    } catch (error) {
      logger.error(`Scheduler campaign check error: ${error.message}`);
    }
  });
  scheduledJobs.push(campaignCheck);

  // Process drip sequences every 2 minutes
  const sequenceCheck = cron.schedule('*/2 * * * *', async () => {
    try {
      await processSequences();
    } catch (error) {
      logger.error(`Scheduler sequence check error: ${error.message}`);
    }
  });
  scheduledJobs.push(sequenceCheck);

  // Aggregate daily stats every hour
  const statsAgg = cron.schedule('0 * * * *', () => {
    try {
      aggregateDailyStats();
    } catch (error) {
      logger.error(`Stats aggregation error: ${error.message}`);
    }
  });
  scheduledJobs.push(statsAgg);

  logger.info('Scheduler started (campaign check: 1min, sequences: 2min, stats: hourly)');
}

function aggregateDailyStats() {
  const db = getDb();
  const today = new Date().toISOString().slice(0, 10);

  const campaigns = db.prepare('SELECT id FROM campaigns WHERE status IN ("sending","sent")').all();

  for (const { id } of campaigns) {
    const stats = db.prepare(`
      SELECT
        SUM(CASE WHEN type = 'send' THEN 1 ELSE 0 END) as sends,
        SUM(CASE WHEN type = 'delivered' THEN 1 ELSE 0 END) as deliveries,
        SUM(CASE WHEN type = 'open' THEN 1 ELSE 0 END) as opens,
        COUNT(DISTINCT CASE WHEN type = 'open' THEN contact_id END) as unique_opens,
        SUM(CASE WHEN type = 'click' THEN 1 ELSE 0 END) as clicks,
        COUNT(DISTINCT CASE WHEN type = 'click' THEN contact_id END) as unique_clicks,
        SUM(CASE WHEN type = 'bounce' THEN 1 ELSE 0 END) as bounces,
        SUM(CASE WHEN type = 'complaint' THEN 1 ELSE 0 END) as complaints,
        SUM(CASE WHEN type = 'unsubscribe' THEN 1 ELSE 0 END) as unsubscribes
      FROM events
      WHERE campaign_id = ? AND date(created_at) = ?
    `).get(id, today);

    db.prepare(`
      INSERT INTO daily_stats (date, campaign_id, sends, deliveries, opens, unique_opens, clicks, unique_clicks, bounces, complaints, unsubscribes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(date, campaign_id) DO UPDATE SET
        sends = excluded.sends, deliveries = excluded.deliveries,
        opens = excluded.opens, unique_opens = excluded.unique_opens,
        clicks = excluded.clicks, unique_clicks = excluded.unique_clicks,
        bounces = excluded.bounces, complaints = excluded.complaints,
        unsubscribes = excluded.unsubscribes
    `).run(
      today, id,
      stats.sends || 0, stats.deliveries || 0,
      stats.opens || 0, stats.unique_opens || 0,
      stats.clicks || 0, stats.unique_clicks || 0,
      stats.bounces || 0, stats.complaints || 0,
      stats.unsubscribes || 0
    );
  }
}

function stopScheduler() {
  for (const job of scheduledJobs) {
    job.stop();
  }
  scheduledJobs = [];
  logger.info('Scheduler stopped');
}

module.exports = { startScheduler, stopScheduler };
