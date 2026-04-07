const crypto = require('crypto');
const { getDb } = require('../db/connection');
const config = require('../config');
const logger = require('../utils/logger');

/**
 * Fire outbound webhooks for a given event type.
 *
 * Note: this is fire-and-forget from most callers — they don't await it.
 * We catch internal errors so a webhook delivery failure never bubbles up
 * into the request handler.
 */
async function fireWebhooks(eventType, payload) {
  try {
    const db = getDb();

    const webhooks = await db.prepare('SELECT * FROM webhooks WHERE is_active = 1').all();

    for (const webhook of webhooks) {
      const events = JSON.parse(webhook.events || '["*"]');
      if (!events.includes('*') && !events.includes(eventType)) continue;

      const body = JSON.stringify({
        event: eventType,
        timestamp: new Date().toISOString(),
        data: payload,
      });

      const headers = {
        'Content-Type': 'application/json',
        ...JSON.parse(webhook.headers || '{}'),
      };

      if (webhook.secret) {
        const signature = crypto
          .createHmac('sha256', webhook.secret)
          .update(body)
          .digest('hex');
        headers['X-Webhook-Signature'] = `sha256=${signature}`;
      }

      const startTime = Date.now();
      let responseStatus = null;
      let responseBody = '';
      let success = false;
      let errorMessage = '';

      try {
        const response = await fetch(webhook.url, {
          method: 'POST',
          headers,
          body,
          signal: AbortSignal.timeout(10000),
        });

        responseStatus = response.status;
        responseBody = await response.text().catch(() => '');
        success = response.ok;

        if (!response.ok) {
          errorMessage = `HTTP ${response.status}`;
        }
      } catch (error) {
        errorMessage = error.message;
        logger.error(`Webhook ${webhook.id} failed: ${error.message}`);
      }

      const durationMs = Date.now() - startTime;

      await db.prepare(`
        INSERT INTO webhook_logs (webhook_id, direction, event_type, request_url, request_method, request_headers, request_body, response_status, response_body, success, error_message, duration_ms)
        VALUES (?, 'outbound', ?, ?, 'POST', ?, ?, ?, ?, ?, ?, ?)
      `).run(
        webhook.id, eventType, webhook.url,
        JSON.stringify(headers), body,
        responseStatus, responseBody.slice(0, 2000),
        success ? 1 : 0, errorMessage, durationMs
      );

      await db.prepare(`
        UPDATE webhooks SET
          last_triggered = NOW(),
          last_status = ?,
          failure_count = CASE WHEN ? = 1 THEN 0 ELSE failure_count + 1 END,
          updated_at = NOW()
        WHERE id = ?
      `).run(responseStatus, success ? 1 : 0, webhook.id);

      if (!success) {
        const wh = await db.prepare('SELECT failure_count FROM webhooks WHERE id = ?').get(webhook.id);
        if (wh && wh.failure_count >= 10) {
          await db.prepare("UPDATE webhooks SET is_active = 0, updated_at = NOW() WHERE id = ?").run(webhook.id);
          logger.warn(`Webhook ${webhook.id} disabled after 10 consecutive failures`);
        }
      }
    }
  } catch (err) {
    logger.error(`fireWebhooks failed: ${err.message}`);
  }
}

/**
 * Verify an inbound webhook signature.
 */
function verifyWebhookSignature(payload, signature, secret) {
  if (!secret || !signature) return false;
  const expected = `sha256=${crypto.createHmac('sha256', secret).update(payload).digest('hex')}`;
  return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
}

module.exports = { fireWebhooks, verifyWebhookSignature };
