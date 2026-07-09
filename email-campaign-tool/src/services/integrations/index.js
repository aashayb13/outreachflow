/**
 * Lead-gen integration registry & dispatcher.
 */

const apollo = require('./providers/apollo');
const hunter = require('./providers/hunter');
const leadmagic = require('./providers/leadmagic');
const clearbit = require('./providers/clearbit');
const snov = require('./providers/snov');

const { decryptJSON } = require('./_crypto');
const { importLeads } = require('./_importer');
const { getDb } = require('../../db/connection');
const logger = require('../../utils/logger');

const PROVIDERS = {
  [apollo.meta.id]: apollo,
  [hunter.meta.id]: hunter,
  [leadmagic.meta.id]: leadmagic,
  [clearbit.meta.id]: clearbit,
  [snov.meta.id]: snov,
};

function listProviders() {
  return Object.values(PROVIDERS).map(p => p.meta);
}

function getProvider(id) {
  const p = PROVIDERS[id];
  if (!p) throw new Error(`Unknown provider: ${id}`);
  return p;
}

async function _logSync({ integration_id, action, status, query, results_count, imported_count, skipped_count, error_message, duration_ms }) {
  try {
    const db = getDb();
    await db.prepare(`
      INSERT INTO integration_sync_logs
        (integration_id, action, status, query, results_count, imported_count, skipped_count, error_message, duration_ms)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      integration_id || null,
      action,
      status,
      JSON.stringify(query || {}),
      results_count || 0,
      imported_count || 0,
      skipped_count || 0,
      error_message || '',
      duration_ms || 0
    );

    if (integration_id) {
      await db.prepare('UPDATE integrations SET total_calls = total_calls + 1, updated_at = NOW() WHERE id = ?').run(integration_id);
    }
  } catch (err) {
    logger.error(`Failed to write integration sync log: ${err.message}`);
  }
}

async function testIntegration(integration) {
  const provider = getProvider(integration.provider);
  const creds = decryptJSON(integration.credentials);
  const start = Date.now();
  try {
    const result = await provider.test(creds);
    await _logSync({
      integration_id: integration.id, action: 'test', status: 'success',
      duration_ms: Date.now() - start,
    });
    const db = getDb();
    await db.prepare("UPDATE integrations SET last_tested_at = NOW(), last_test_ok = 1, last_test_error = '' WHERE id = ?").run(integration.id);
    return result;
  } catch (err) {
    await _logSync({
      integration_id: integration.id, action: 'test', status: 'error',
      error_message: err.message, duration_ms: Date.now() - start,
    });
    const db = getDb();
    await db.prepare('UPDATE integrations SET last_tested_at = NOW(), last_test_ok = 0, last_test_error = ? WHERE id = ?').run(err.message, integration.id);
    throw err;
  }
}

async function searchIntegration(integration, params) {
  const provider = getProvider(integration.provider);
  const creds = decryptJSON(integration.credentials);
  const start = Date.now();
  try {
    const result = await provider.search(creds, params || {});
    await _logSync({
      integration_id: integration.id, action: 'search', status: 'success',
      query: params, results_count: result?.leads?.length || 0,
      duration_ms: Date.now() - start,
    });
    return result;
  } catch (err) {
    await _logSync({
      integration_id: integration.id, action: 'search', status: 'error',
      query: params, error_message: err.message, duration_ms: Date.now() - start,
    });
    throw err;
  }
}

async function importFromIntegration(integration, options = {}) {
  const { params = {}, list_id, tags = [], dry_run = false } = options;
  const provider = getProvider(integration.provider);
  const creds = decryptJSON(integration.credentials);
  const start = Date.now();
  try {
    const result = await provider.search(creds, params, { dryRun: dry_run });
    const leads = result?.leads || [];
    const importResult = await importLeads(leads, {
      source: `integration:${integration.provider}`,
      list_id,
      tags,
      dry_run,
    });

    await _logSync({
      integration_id: integration.id,
      action: dry_run ? 'search' : 'import',
      status: 'success',
      query: params,
      results_count: leads.length,
      imported_count: importResult.imported,
      skipped_count: importResult.skipped,
      duration_ms: Date.now() - start,
    });

    if (!dry_run && importResult.imported > 0) {
      const db = getDb();
      await db.prepare('UPDATE integrations SET total_imported = total_imported + ?, updated_at = NOW() WHERE id = ?').run(importResult.imported, integration.id);
    }

    return { ...importResult, total_results: leads.length, raw_pagination: result?.pagination, enrich_errors: result?.enrich_errors || 0 };
  } catch (err) {
    await _logSync({
      integration_id: integration.id, action: 'import', status: 'error',
      query: params, error_message: err.message, duration_ms: Date.now() - start,
    });
    throw err;
  }
}

module.exports = {
  listProviders,
  getProvider,
  testIntegration,
  searchIntegration,
  importFromIntegration,
};
