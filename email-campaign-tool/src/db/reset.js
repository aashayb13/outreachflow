require('dotenv').config();
const { initDb, getDb, closeDb } = require('./connection');

/**
 * Drops all tables in the public schema. Run with care.
 *   npm run db:reset
 *
 * Followed by `npm run db:seed` to recreate the schema and seed data.
 */
async function reset() {
  await initDb();
  const db = getDb();

  const tables = [
    'integration_sync_logs',
    'integrations',
    'webhook_logs',
    'webhooks',
    'sequence_enrollments',
    'sequence_steps',
    'sequences',
    'daily_stats',
    'events',
    'campaign_recipients',
    'campaigns',
    'templates',
    'contact_tags',
    'tags',
    'list_contacts',
    'lists',
    'suppression_list',
    'api_keys',
    'contacts',
  ];

  for (const t of tables) {
    await db.exec(`DROP TABLE IF EXISTS ${t} CASCADE;`);
    console.log(`Dropped ${t}`);
  }

  await closeDb();
  console.log('\nDatabase reset complete. Run `npm run db:seed` to re-seed.');
}

reset().catch(err => { console.error('Reset failed:', err); process.exit(1); });
