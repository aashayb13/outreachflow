const { getDb } = require('./connection');
const logger = require('../utils/logger');

/**
 * Initialize the Postgres schema. Idempotent — uses CREATE TABLE IF NOT EXISTS
 * and CREATE INDEX IF NOT EXISTS throughout. Safe to call on every boot.
 *
 * Notes on the SQLite → Postgres translation:
 *   - INTEGER PRIMARY KEY AUTOINCREMENT → BIGSERIAL PRIMARY KEY
 *   - DATETIME (TEXT) → TIMESTAMPTZ
 *   - Email columns use CITEXT for case-insensitive uniqueness (replaces COLLATE NOCASE)
 *   - Boolean flags stay as INTEGER (0/1) so the existing query strings work unchanged
 *   - JSON columns stay as TEXT (callers JSON.parse / JSON.stringify themselves)
 *   - CHECK constraints retained
 *   - Foreign key cascade behavior preserved
 */
async function initializeSchema() {
  const db = getDb();

  // Postgres extensions we rely on. CITEXT gives us case-insensitive text
  // uniqueness for email columns (replacing SQLite's COLLATE NOCASE).
  await db.exec(`CREATE EXTENSION IF NOT EXISTS citext;`);

  await db.exec(`
    -- ═══════════════════════════════════════════════════════════
    -- CONTACTS
    -- ═══════════════════════════════════════════════════════════
    CREATE TABLE IF NOT EXISTS contacts (
      id              BIGSERIAL PRIMARY KEY,
      email           CITEXT NOT NULL UNIQUE,
      first_name      TEXT DEFAULT '',
      last_name       TEXT DEFAULT '',
      company         TEXT DEFAULT '',
      phone           TEXT DEFAULT '',
      title           TEXT DEFAULT '',
      industry        TEXT DEFAULT '',
      city            TEXT DEFAULT '',
      state           TEXT DEFAULT '',
      country         TEXT DEFAULT '',
      custom_fields   TEXT DEFAULT '{}',
      status          TEXT DEFAULT 'active' CHECK (status IN ('active','unsubscribed','bounced','complained','suppressed')),
      lead_score      INTEGER DEFAULT 0,
      source          TEXT DEFAULT '',
      created_at      TIMESTAMPTZ DEFAULT NOW(),
      updated_at      TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_contacts_email ON contacts(email);
    CREATE INDEX IF NOT EXISTS idx_contacts_status ON contacts(status);

    -- ═══════════════════════════════════════════════════════════
    -- LISTS
    -- ═══════════════════════════════════════════════════════════
    CREATE TABLE IF NOT EXISTS lists (
      id              BIGSERIAL PRIMARY KEY,
      name            TEXT NOT NULL,
      description     TEXT DEFAULT '',
      type            TEXT DEFAULT 'static' CHECK (type IN ('static','dynamic')),
      segment_rules   TEXT DEFAULT '[]',
      contact_count   INTEGER DEFAULT 0,
      created_at      TIMESTAMPTZ DEFAULT NOW(),
      updated_at      TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS list_contacts (
      list_id         BIGINT NOT NULL REFERENCES lists(id) ON DELETE CASCADE,
      contact_id      BIGINT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
      added_at        TIMESTAMPTZ DEFAULT NOW(),
      PRIMARY KEY (list_id, contact_id)
    );
    CREATE INDEX IF NOT EXISTS idx_list_contacts_contact ON list_contacts(contact_id);

    -- ═══════════════════════════════════════════════════════════
    -- TAGS
    -- ═══════════════════════════════════════════════════════════
    CREATE TABLE IF NOT EXISTS tags (
      id              BIGSERIAL PRIMARY KEY,
      name            TEXT NOT NULL UNIQUE,
      color           TEXT DEFAULT '#6B7280',
      created_at      TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS contact_tags (
      contact_id      BIGINT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
      tag_id          BIGINT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
      PRIMARY KEY (contact_id, tag_id)
    );

    -- ═══════════════════════════════════════════════════════════
    -- EMAIL TEMPLATES
    -- ═══════════════════════════════════════════════════════════
    CREATE TABLE IF NOT EXISTS templates (
      id              BIGSERIAL PRIMARY KEY,
      name            TEXT NOT NULL,
      subject         TEXT NOT NULL DEFAULT '',
      html_content    TEXT NOT NULL DEFAULT '',
      text_content    TEXT DEFAULT '',
      category        TEXT DEFAULT 'general',
      thumbnail_url   TEXT DEFAULT '',
      variables       TEXT DEFAULT '[]',
      is_active       INTEGER DEFAULT 1,
      created_at      TIMESTAMPTZ DEFAULT NOW(),
      updated_at      TIMESTAMPTZ DEFAULT NOW()
    );

    -- ═══════════════════════════════════════════════════════════
    -- CAMPAIGNS
    -- ═══════════════════════════════════════════════════════════
    CREATE TABLE IF NOT EXISTS campaigns (
      id              BIGSERIAL PRIMARY KEY,
      name            TEXT NOT NULL,
      subject         TEXT NOT NULL DEFAULT '',
      from_name       TEXT DEFAULT '',
      from_email      TEXT DEFAULT '',
      reply_to        TEXT DEFAULT '',
      template_id     BIGINT REFERENCES templates(id),
      html_content    TEXT DEFAULT '',
      text_content    TEXT DEFAULT '',
      status          TEXT DEFAULT 'draft' CHECK (status IN ('draft','scheduled','sending','sent','paused','cancelled','archived')),
      type            TEXT DEFAULT 'regular' CHECK (type IN ('regular','ab_test','automated','rss')),
      ab_variant      TEXT DEFAULT NULL,
      ab_parent_id    BIGINT DEFAULT NULL REFERENCES campaigns(id),
      ab_test_field   TEXT DEFAULT NULL CHECK (ab_test_field IS NULL OR ab_test_field IN ('subject','content','from_name')),
      ab_split_pct    INTEGER DEFAULT 50,
      ab_winner_metric TEXT DEFAULT 'open_rate' CHECK (ab_winner_metric IS NULL OR ab_winner_metric IN ('open_rate','click_rate','conversion_rate')),
      ab_auto_send_winner INTEGER DEFAULT 0,
      scheduled_at    TIMESTAMPTZ DEFAULT NULL,
      send_started_at TIMESTAMPTZ DEFAULT NULL,
      send_completed_at TIMESTAMPTZ DEFAULT NULL,
      list_ids        TEXT DEFAULT '[]',
      segment_rules   TEXT DEFAULT '[]',
      exclude_list_ids TEXT DEFAULT '[]',
      track_opens     INTEGER DEFAULT 0,
      track_clicks    INTEGER DEFAULT 0,
      utm_source      TEXT DEFAULT '',
      utm_medium      TEXT DEFAULT 'email',
      utm_campaign    TEXT DEFAULT '',
      total_recipients INTEGER DEFAULT 0,
      total_sent      INTEGER DEFAULT 0,
      total_delivered  INTEGER DEFAULT 0,
      total_opens     INTEGER DEFAULT 0,
      total_unique_opens INTEGER DEFAULT 0,
      total_clicks    INTEGER DEFAULT 0,
      total_unique_clicks INTEGER DEFAULT 0,
      total_bounces   INTEGER DEFAULT 0,
      total_complaints INTEGER DEFAULT 0,
      total_unsubscribes INTEGER DEFAULT 0,
      created_at      TIMESTAMPTZ DEFAULT NOW(),
      updated_at      TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_campaigns_status ON campaigns(status);
    CREATE INDEX IF NOT EXISTS idx_campaigns_scheduled ON campaigns(scheduled_at);

    -- ═══════════════════════════════════════════════════════════
    -- CAMPAIGN RECIPIENTS (send queue)
    -- ═══════════════════════════════════════════════════════════
    CREATE TABLE IF NOT EXISTS campaign_recipients (
      id              BIGSERIAL PRIMARY KEY,
      campaign_id     BIGINT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
      contact_id      BIGINT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
      email           TEXT NOT NULL,
      status          TEXT DEFAULT 'queued' CHECK (status IN ('queued','sending','sent','delivered','bounced','failed','skipped')),
      sent_at         TIMESTAMPTZ DEFAULT NULL,
      delivered_at    TIMESTAMPTZ DEFAULT NULL,
      message_id      TEXT DEFAULT '',
      error_message   TEXT DEFAULT '',
      created_at      TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_cr_campaign ON campaign_recipients(campaign_id);
    CREATE INDEX IF NOT EXISTS idx_cr_contact ON campaign_recipients(contact_id);
    CREATE INDEX IF NOT EXISTS idx_cr_status ON campaign_recipients(status);

    -- ═══════════════════════════════════════════════════════════
    -- EVENTS (opens, clicks, bounces, unsubscribes, etc.)
    -- ═══════════════════════════════════════════════════════════
    CREATE TABLE IF NOT EXISTS events (
      id              BIGSERIAL PRIMARY KEY,
      campaign_id     BIGINT REFERENCES campaigns(id) ON DELETE SET NULL,
      contact_id      BIGINT REFERENCES contacts(id) ON DELETE SET NULL,
      recipient_id    BIGINT REFERENCES campaign_recipients(id) ON DELETE SET NULL,
      type            TEXT NOT NULL CHECK (type IN ('send','delivered','open','click','bounce','complaint','unsubscribe','conversion','forward')),
      url             TEXT DEFAULT '',
      ip_address      TEXT DEFAULT '',
      user_agent      TEXT DEFAULT '',
      metadata        TEXT DEFAULT '{}',
      created_at      TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_events_campaign ON events(campaign_id);
    CREATE INDEX IF NOT EXISTS idx_events_contact ON events(contact_id);
    CREATE INDEX IF NOT EXISTS idx_events_type ON events(type);
    CREATE INDEX IF NOT EXISTS idx_events_created ON events(created_at);

    -- ═══════════════════════════════════════════════════════════
    -- DRIP SEQUENCES / AUTOMATIONS
    -- ═══════════════════════════════════════════════════════════
    CREATE TABLE IF NOT EXISTS sequences (
      id              BIGSERIAL PRIMARY KEY,
      name            TEXT NOT NULL,
      description     TEXT DEFAULT '',
      trigger_type    TEXT DEFAULT 'manual' CHECK (trigger_type IN ('manual','list_join','tag_added','webhook','date_field','form_submit')),
      trigger_config  TEXT DEFAULT '{}',
      status          TEXT DEFAULT 'draft' CHECK (status IN ('draft','active','paused','archived')),
      list_ids        TEXT DEFAULT '[]',
      total_enrolled  INTEGER DEFAULT 0,
      total_completed INTEGER DEFAULT 0,
      created_at      TIMESTAMPTZ DEFAULT NOW(),
      updated_at      TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS sequence_steps (
      id              BIGSERIAL PRIMARY KEY,
      sequence_id     BIGINT NOT NULL REFERENCES sequences(id) ON DELETE CASCADE,
      step_order      INTEGER NOT NULL,
      type            TEXT DEFAULT 'email' CHECK (type IN ('email','delay','condition','webhook','tag','list_action')),
      subject         TEXT DEFAULT '',
      html_content    TEXT DEFAULT '',
      text_content    TEXT DEFAULT '',
      template_id     BIGINT REFERENCES templates(id),
      delay_amount    INTEGER DEFAULT 1,
      delay_unit      TEXT DEFAULT 'days' CHECK (delay_unit IN ('minutes','hours','days','weeks')),
      condition_rules TEXT DEFAULT '{}',
      webhook_url     TEXT DEFAULT '',
      webhook_method  TEXT DEFAULT 'POST',
      webhook_headers TEXT DEFAULT '{}',
      webhook_body    TEXT DEFAULT '',
      action_type     TEXT DEFAULT '',
      action_target   TEXT DEFAULT '',
      is_active       INTEGER DEFAULT 1,
      created_at      TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_seq_steps_seq ON sequence_steps(sequence_id, step_order);

    CREATE TABLE IF NOT EXISTS sequence_enrollments (
      id              BIGSERIAL PRIMARY KEY,
      sequence_id     BIGINT NOT NULL REFERENCES sequences(id) ON DELETE CASCADE,
      contact_id      BIGINT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
      current_step    INTEGER DEFAULT 0,
      status          TEXT DEFAULT 'active' CHECK (status IN ('active','paused','completed','exited','failed')),
      next_action_at  TIMESTAMPTZ DEFAULT NULL,
      enrolled_at     TIMESTAMPTZ DEFAULT NOW(),
      completed_at    TIMESTAMPTZ DEFAULT NULL,
      updated_at      TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_enrollments_next ON sequence_enrollments(next_action_at);
    CREATE INDEX IF NOT EXISTS idx_enrollments_status ON sequence_enrollments(status);

    -- ═══════════════════════════════════════════════════════════
    -- WEBHOOKS (outbound)
    -- ═══════════════════════════════════════════════════════════
    CREATE TABLE IF NOT EXISTS webhooks (
      id              BIGSERIAL PRIMARY KEY,
      name            TEXT NOT NULL,
      url             TEXT NOT NULL,
      events          TEXT DEFAULT '["*"]',
      secret          TEXT DEFAULT '',
      is_active       INTEGER DEFAULT 1,
      headers         TEXT DEFAULT '{}',
      last_triggered  TIMESTAMPTZ DEFAULT NULL,
      last_status     INTEGER DEFAULT NULL,
      failure_count   INTEGER DEFAULT 0,
      created_at      TIMESTAMPTZ DEFAULT NOW(),
      updated_at      TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS webhook_logs (
      id              BIGSERIAL PRIMARY KEY,
      webhook_id      BIGINT REFERENCES webhooks(id) ON DELETE CASCADE,
      direction       TEXT DEFAULT 'outbound' CHECK (direction IN ('inbound','outbound')),
      event_type      TEXT DEFAULT '',
      request_url     TEXT DEFAULT '',
      request_method  TEXT DEFAULT 'POST',
      request_headers TEXT DEFAULT '{}',
      request_body    TEXT DEFAULT '',
      response_status INTEGER DEFAULT NULL,
      response_body   TEXT DEFAULT '',
      success         INTEGER DEFAULT 0,
      error_message   TEXT DEFAULT '',
      duration_ms     INTEGER DEFAULT 0,
      created_at      TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_wh_logs_webhook ON webhook_logs(webhook_id);

    -- ═══════════════════════════════════════════════════════════
    -- SUPPRESSION LIST (global)
    -- ═══════════════════════════════════════════════════════════
    CREATE TABLE IF NOT EXISTS suppression_list (
      id              BIGSERIAL PRIMARY KEY,
      email           CITEXT NOT NULL UNIQUE,
      reason          TEXT DEFAULT 'manual' CHECK (reason IN ('manual','bounce','complaint','unsubscribe','invalid')),
      source          TEXT DEFAULT '',
      created_at      TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_suppression_email ON suppression_list(email);

    -- ═══════════════════════════════════════════════════════════
    -- API KEYS
    -- ═══════════════════════════════════════════════════════════
    CREATE TABLE IF NOT EXISTS api_keys (
      id              BIGSERIAL PRIMARY KEY,
      name            TEXT NOT NULL,
      key_hash        TEXT NOT NULL UNIQUE,
      prefix          TEXT NOT NULL,
      permissions     TEXT DEFAULT '["read"]',
      last_used_at    TIMESTAMPTZ DEFAULT NULL,
      expires_at      TIMESTAMPTZ DEFAULT NULL,
      is_active       INTEGER DEFAULT 1,
      created_at      TIMESTAMPTZ DEFAULT NOW()
    );

    -- ═══════════════════════════════════════════════════════════
    -- DAILY STATS (aggregated)
    -- ═══════════════════════════════════════════════════════════
    CREATE TABLE IF NOT EXISTS daily_stats (
      id              BIGSERIAL PRIMARY KEY,
      date            TEXT NOT NULL,
      campaign_id     BIGINT REFERENCES campaigns(id) ON DELETE CASCADE,
      sends           INTEGER DEFAULT 0,
      deliveries      INTEGER DEFAULT 0,
      opens           INTEGER DEFAULT 0,
      unique_opens    INTEGER DEFAULT 0,
      clicks          INTEGER DEFAULT 0,
      unique_clicks   INTEGER DEFAULT 0,
      bounces         INTEGER DEFAULT 0,
      complaints      INTEGER DEFAULT 0,
      unsubscribes    INTEGER DEFAULT 0,
      UNIQUE (date, campaign_id)
    );
    CREATE INDEX IF NOT EXISTS idx_daily_stats_date ON daily_stats(date);

    -- ═══════════════════════════════════════════════════════════
    -- LEAD-GEN INTEGRATIONS (Apollo, Hunter, Lead Magic, etc.)
    -- ═══════════════════════════════════════════════════════════
    CREATE TABLE IF NOT EXISTS integrations (
      id              BIGSERIAL PRIMARY KEY,
      name            TEXT NOT NULL,
      provider        TEXT NOT NULL,
      credentials     TEXT NOT NULL DEFAULT '{}',
      config          TEXT NOT NULL DEFAULT '{}',
      is_active       INTEGER DEFAULT 1,
      last_tested_at  TIMESTAMPTZ DEFAULT NULL,
      last_test_ok    INTEGER DEFAULT NULL,
      last_test_error TEXT DEFAULT '',
      total_imported  INTEGER DEFAULT 0,
      total_calls     INTEGER DEFAULT 0,
      created_at      TIMESTAMPTZ DEFAULT NOW(),
      updated_at      TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_integrations_provider ON integrations(provider);

    CREATE TABLE IF NOT EXISTS integration_sync_logs (
      id              BIGSERIAL PRIMARY KEY,
      integration_id  BIGINT REFERENCES integrations(id) ON DELETE CASCADE,
      action          TEXT NOT NULL,
      status          TEXT NOT NULL,
      query           TEXT DEFAULT '{}',
      results_count   INTEGER DEFAULT 0,
      imported_count  INTEGER DEFAULT 0,
      skipped_count   INTEGER DEFAULT 0,
      error_message   TEXT DEFAULT '',
      duration_ms     INTEGER DEFAULT 0,
      created_at      TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_int_logs_int ON integration_sync_logs(integration_id);
    CREATE INDEX IF NOT EXISTS idx_int_logs_created ON integration_sync_logs(created_at);

    -- ═══════════════════════════════════════════════════════════
    -- ASSETS (uploaded files, e.g. resume PDFs) + campaign links
    -- ═══════════════════════════════════════════════════════════
    CREATE TABLE IF NOT EXISTS assets (
      id              BIGSERIAL PRIMARY KEY,
      name            TEXT NOT NULL,
      filename        TEXT NOT NULL DEFAULT '',
      mime_type       TEXT NOT NULL DEFAULT 'application/octet-stream',
      size_bytes      INTEGER DEFAULT 0,
      data_base64     TEXT NOT NULL DEFAULT '',
      created_at      TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS campaign_attachments (
      campaign_id     BIGINT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
      asset_id        BIGINT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
      PRIMARY KEY (campaign_id, asset_id)
    );
    CREATE INDEX IF NOT EXISTS idx_campaign_attachments_asset ON campaign_attachments(asset_id);
  `);

  logger.info('Database schema initialized');
}

module.exports = { initializeSchema };
