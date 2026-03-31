const { getDb } = require('./connection');
const logger = require('../utils/logger');

function initializeSchema() {
  const db = getDb();

  db.exec(`
    -- ═══════════════════════════════════════════════════════════
    -- CONTACTS
    -- ═══════════════════════════════════════════════════════════
    CREATE TABLE IF NOT EXISTS contacts (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      email           TEXT NOT NULL UNIQUE COLLATE NOCASE,
      first_name      TEXT DEFAULT '',
      last_name       TEXT DEFAULT '',
      company         TEXT DEFAULT '',
      phone           TEXT DEFAULT '',
      title           TEXT DEFAULT '',
      industry        TEXT DEFAULT '',
      city            TEXT DEFAULT '',
      state           TEXT DEFAULT '',
      country         TEXT DEFAULT '',
      custom_fields   TEXT DEFAULT '{}',  -- JSON
      status          TEXT DEFAULT 'active' CHECK(status IN ('active','unsubscribed','bounced','complained','suppressed')),
      lead_score      INTEGER DEFAULT 0,
      source          TEXT DEFAULT '',
      created_at      DATETIME DEFAULT (datetime('now')),
      updated_at      DATETIME DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_contacts_email ON contacts(email);
    CREATE INDEX IF NOT EXISTS idx_contacts_status ON contacts(status);

    -- ═══════════════════════════════════════════════════════════
    -- LISTS
    -- ═══════════════════════════════════════════════════════════
    CREATE TABLE IF NOT EXISTS lists (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      name            TEXT NOT NULL,
      description     TEXT DEFAULT '',
      type            TEXT DEFAULT 'static' CHECK(type IN ('static','dynamic')),
      segment_rules   TEXT DEFAULT '[]',  -- JSON rules for dynamic lists
      contact_count   INTEGER DEFAULT 0,
      created_at      DATETIME DEFAULT (datetime('now')),
      updated_at      DATETIME DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS list_contacts (
      list_id         INTEGER NOT NULL REFERENCES lists(id) ON DELETE CASCADE,
      contact_id      INTEGER NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
      added_at        DATETIME DEFAULT (datetime('now')),
      PRIMARY KEY (list_id, contact_id)
    );
    CREATE INDEX IF NOT EXISTS idx_list_contacts_contact ON list_contacts(contact_id);

    -- ═══════════════════════════════════════════════════════════
    -- TAGS
    -- ═══════════════════════════════════════════════════════════
    CREATE TABLE IF NOT EXISTS tags (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      name            TEXT NOT NULL UNIQUE,
      color           TEXT DEFAULT '#6B7280',
      created_at      DATETIME DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS contact_tags (
      contact_id      INTEGER NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
      tag_id          INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
      PRIMARY KEY (contact_id, tag_id)
    );

    -- ═══════════════════════════════════════════════════════════
    -- EMAIL TEMPLATES
    -- ═══════════════════════════════════════════════════════════
    CREATE TABLE IF NOT EXISTS templates (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      name            TEXT NOT NULL,
      subject         TEXT NOT NULL DEFAULT '',
      html_content    TEXT NOT NULL DEFAULT '',
      text_content    TEXT DEFAULT '',
      category        TEXT DEFAULT 'general',
      thumbnail_url   TEXT DEFAULT '',
      variables       TEXT DEFAULT '[]',  -- JSON list of merge variables
      is_active       INTEGER DEFAULT 1,
      created_at      DATETIME DEFAULT (datetime('now')),
      updated_at      DATETIME DEFAULT (datetime('now'))
    );

    -- ═══════════════════════════════════════════════════════════
    -- CAMPAIGNS
    -- ═══════════════════════════════════════════════════════════
    CREATE TABLE IF NOT EXISTS campaigns (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      name            TEXT NOT NULL,
      subject         TEXT NOT NULL DEFAULT '',
      from_name       TEXT DEFAULT '',
      from_email      TEXT DEFAULT '',
      reply_to        TEXT DEFAULT '',
      template_id     INTEGER REFERENCES templates(id),
      html_content    TEXT DEFAULT '',
      text_content    TEXT DEFAULT '',
      status          TEXT DEFAULT 'draft' CHECK(status IN ('draft','scheduled','sending','sent','paused','cancelled','archived')),
      type            TEXT DEFAULT 'regular' CHECK(type IN ('regular','ab_test','automated','rss')),
      -- A/B test fields
      ab_variant      TEXT DEFAULT NULL,  -- 'A' or 'B' or null
      ab_parent_id    INTEGER DEFAULT NULL REFERENCES campaigns(id),
      ab_test_field   TEXT DEFAULT NULL CHECK(ab_test_field IN ('subject','content','from_name',NULL)),
      ab_split_pct    INTEGER DEFAULT 50,
      ab_winner_metric TEXT DEFAULT 'open_rate' CHECK(ab_winner_metric IN ('open_rate','click_rate','conversion_rate',NULL)),
      ab_auto_send_winner INTEGER DEFAULT 0,
      -- Scheduling
      scheduled_at    DATETIME DEFAULT NULL,
      send_started_at DATETIME DEFAULT NULL,
      send_completed_at DATETIME DEFAULT NULL,
      -- Targeting
      list_ids        TEXT DEFAULT '[]',   -- JSON array of list IDs
      segment_rules   TEXT DEFAULT '[]',   -- JSON segment conditions
      exclude_list_ids TEXT DEFAULT '[]',
      -- Settings
      track_opens     INTEGER DEFAULT 1,
      track_clicks    INTEGER DEFAULT 1,
      utm_source      TEXT DEFAULT '',
      utm_medium      TEXT DEFAULT 'email',
      utm_campaign    TEXT DEFAULT '',
      -- Stats (denormalized for quick access)
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
      created_at      DATETIME DEFAULT (datetime('now')),
      updated_at      DATETIME DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_campaigns_status ON campaigns(status);
    CREATE INDEX IF NOT EXISTS idx_campaigns_scheduled ON campaigns(scheduled_at);

    -- ═══════════════════════════════════════════════════════════
    -- CAMPAIGN RECIPIENTS (send queue)
    -- ═══════════════════════════════════════════════════════════
    CREATE TABLE IF NOT EXISTS campaign_recipients (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      campaign_id     INTEGER NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
      contact_id      INTEGER NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
      email           TEXT NOT NULL,
      status          TEXT DEFAULT 'queued' CHECK(status IN ('queued','sending','sent','delivered','bounced','failed','skipped')),
      sent_at         DATETIME DEFAULT NULL,
      delivered_at    DATETIME DEFAULT NULL,
      message_id      TEXT DEFAULT '',
      error_message   TEXT DEFAULT '',
      created_at      DATETIME DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_cr_campaign ON campaign_recipients(campaign_id);
    CREATE INDEX IF NOT EXISTS idx_cr_contact ON campaign_recipients(contact_id);
    CREATE INDEX IF NOT EXISTS idx_cr_status ON campaign_recipients(status);

    -- ═══════════════════════════════════════════════════════════
    -- EVENTS (opens, clicks, bounces, unsubscribes, etc.)
    -- ═══════════════════════════════════════════════════════════
    CREATE TABLE IF NOT EXISTS events (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      campaign_id     INTEGER REFERENCES campaigns(id) ON DELETE SET NULL,
      contact_id      INTEGER REFERENCES contacts(id) ON DELETE SET NULL,
      recipient_id    INTEGER REFERENCES campaign_recipients(id) ON DELETE SET NULL,
      type            TEXT NOT NULL CHECK(type IN ('send','delivered','open','click','bounce','complaint','unsubscribe','conversion','forward')),
      url             TEXT DEFAULT '',
      ip_address      TEXT DEFAULT '',
      user_agent      TEXT DEFAULT '',
      metadata        TEXT DEFAULT '{}',  -- JSON
      created_at      DATETIME DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_events_campaign ON events(campaign_id);
    CREATE INDEX IF NOT EXISTS idx_events_contact ON events(contact_id);
    CREATE INDEX IF NOT EXISTS idx_events_type ON events(type);
    CREATE INDEX IF NOT EXISTS idx_events_created ON events(created_at);

    -- ═══════════════════════════════════════════════════════════
    -- DRIP SEQUENCES / AUTOMATIONS
    -- ═══════════════════════════════════════════════════════════
    CREATE TABLE IF NOT EXISTS sequences (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      name            TEXT NOT NULL,
      description     TEXT DEFAULT '',
      trigger_type    TEXT DEFAULT 'manual' CHECK(trigger_type IN ('manual','list_join','tag_added','webhook','date_field','form_submit')),
      trigger_config  TEXT DEFAULT '{}',   -- JSON
      status          TEXT DEFAULT 'draft' CHECK(status IN ('draft','active','paused','archived')),
      list_ids        TEXT DEFAULT '[]',
      total_enrolled  INTEGER DEFAULT 0,
      total_completed INTEGER DEFAULT 0,
      created_at      DATETIME DEFAULT (datetime('now')),
      updated_at      DATETIME DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS sequence_steps (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      sequence_id     INTEGER NOT NULL REFERENCES sequences(id) ON DELETE CASCADE,
      step_order      INTEGER NOT NULL,
      type            TEXT DEFAULT 'email' CHECK(type IN ('email','delay','condition','webhook','tag','list_action')),
      -- For email steps
      subject         TEXT DEFAULT '',
      html_content    TEXT DEFAULT '',
      text_content    TEXT DEFAULT '',
      template_id     INTEGER REFERENCES templates(id),
      -- For delay steps
      delay_amount    INTEGER DEFAULT 1,
      delay_unit      TEXT DEFAULT 'days' CHECK(delay_unit IN ('minutes','hours','days','weeks')),
      -- For condition steps
      condition_rules TEXT DEFAULT '{}',   -- JSON
      -- For webhook steps
      webhook_url     TEXT DEFAULT '',
      webhook_method  TEXT DEFAULT 'POST',
      webhook_headers TEXT DEFAULT '{}',
      webhook_body    TEXT DEFAULT '',
      -- For tag/list steps
      action_type     TEXT DEFAULT '',
      action_target   TEXT DEFAULT '',
      -- Meta
      is_active       INTEGER DEFAULT 1,
      created_at      DATETIME DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_seq_steps_seq ON sequence_steps(sequence_id, step_order);

    CREATE TABLE IF NOT EXISTS sequence_enrollments (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      sequence_id     INTEGER NOT NULL REFERENCES sequences(id) ON DELETE CASCADE,
      contact_id      INTEGER NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
      current_step    INTEGER DEFAULT 0,
      status          TEXT DEFAULT 'active' CHECK(status IN ('active','paused','completed','exited','failed')),
      next_action_at  DATETIME DEFAULT NULL,
      enrolled_at     DATETIME DEFAULT (datetime('now')),
      completed_at    DATETIME DEFAULT NULL,
      updated_at      DATETIME DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_enrollments_next ON sequence_enrollments(next_action_at);
    CREATE INDEX IF NOT EXISTS idx_enrollments_status ON sequence_enrollments(status);

    -- ═══════════════════════════════════════════════════════════
    -- WEBHOOKS (outbound)
    -- ═══════════════════════════════════════════════════════════
    CREATE TABLE IF NOT EXISTS webhooks (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      name            TEXT NOT NULL,
      url             TEXT NOT NULL,
      events          TEXT DEFAULT '["*"]',  -- JSON array of event types to listen for
      secret          TEXT DEFAULT '',
      is_active       INTEGER DEFAULT 1,
      headers         TEXT DEFAULT '{}',
      last_triggered  DATETIME DEFAULT NULL,
      last_status     INTEGER DEFAULT NULL,
      failure_count   INTEGER DEFAULT 0,
      created_at      DATETIME DEFAULT (datetime('now')),
      updated_at      DATETIME DEFAULT (datetime('now'))
    );

    -- ═══════════════════════════════════════════════════════════
    -- WEBHOOK LOGS
    -- ═══════════════════════════════════════════════════════════
    CREATE TABLE IF NOT EXISTS webhook_logs (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      webhook_id      INTEGER REFERENCES webhooks(id) ON DELETE CASCADE,
      direction       TEXT DEFAULT 'outbound' CHECK(direction IN ('inbound','outbound')),
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
      created_at      DATETIME DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_wh_logs_webhook ON webhook_logs(webhook_id);

    -- ═══════════════════════════════════════════════════════════
    -- SUPPRESSION LIST (global)
    -- ═══════════════════════════════════════════════════════════
    CREATE TABLE IF NOT EXISTS suppression_list (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      email           TEXT NOT NULL UNIQUE COLLATE NOCASE,
      reason          TEXT DEFAULT 'manual' CHECK(reason IN ('manual','bounce','complaint','unsubscribe','invalid')),
      source          TEXT DEFAULT '',
      created_at      DATETIME DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_suppression_email ON suppression_list(email);

    -- ═══════════════════════════════════════════════════════════
    -- API KEYS
    -- ═══════════════════════════════════════════════════════════
    CREATE TABLE IF NOT EXISTS api_keys (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      name            TEXT NOT NULL,
      key_hash        TEXT NOT NULL UNIQUE,
      prefix          TEXT NOT NULL,
      permissions     TEXT DEFAULT '["read"]',  -- JSON
      last_used_at    DATETIME DEFAULT NULL,
      expires_at      DATETIME DEFAULT NULL,
      is_active       INTEGER DEFAULT 1,
      created_at      DATETIME DEFAULT (datetime('now'))
    );

    -- ═══════════════════════════════════════════════════════════
    -- DAILY STATS (aggregated)
    -- ═══════════════════════════════════════════════════════════
    CREATE TABLE IF NOT EXISTS daily_stats (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      date            TEXT NOT NULL,
      campaign_id     INTEGER REFERENCES campaigns(id) ON DELETE CASCADE,
      sends           INTEGER DEFAULT 0,
      deliveries      INTEGER DEFAULT 0,
      opens           INTEGER DEFAULT 0,
      unique_opens    INTEGER DEFAULT 0,
      clicks          INTEGER DEFAULT 0,
      unique_clicks   INTEGER DEFAULT 0,
      bounces         INTEGER DEFAULT 0,
      complaints      INTEGER DEFAULT 0,
      unsubscribes    INTEGER DEFAULT 0,
      UNIQUE(date, campaign_id)
    );
    CREATE INDEX IF NOT EXISTS idx_daily_stats_date ON daily_stats(date);
  `);

  logger.info('Database schema initialized');
}

module.exports = { initializeSchema };
