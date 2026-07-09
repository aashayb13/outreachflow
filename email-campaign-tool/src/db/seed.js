require('dotenv').config();
const { initDb, getDb, closeDb } = require('./connection');
const { initializeSchema } = require('./schema');

async function seed() {
  await initDb();
  await initializeSchema();
  const db = getDb();

  // ─── Starter template (generic, de-branded) ───────────────────────
  await db.transaction(async () => {
    await db.prepare(`
      INSERT OR IGNORE INTO templates (name, subject, html_content, text_content, category, variables)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      'Cold Outreach (starter)',
      'Quick question, {{first_name}}',
      '',
      "Hi {{first_name|there}},\n\nI came across {{company}} and wanted to reach out.\n\n[Write your pitch here.]\n\nBest,\nYour Name\n\n{{unsubscribe_link}}",
      'outreach',
      '["first_name","company","unsubscribe_link"]'
    );
  })();
  console.log('Seeded 1 starter template');

  // ─── Generic tags ─────────────────────────────────────────────────
  const tags = [
    { name: 'cold-outreach', color: '#6B7280' },
    { name: 'job-application', color: '#2563EB' },
  ];
  await db.transaction(async () => {
    for (const t of tags) {
      await db.prepare('INSERT OR IGNORE INTO tags (name, color) VALUES (?, ?)').run(t.name, t.color);
    }
  })();
  console.log(`Seeded ${tags.length} tags`);

  await closeDb();
  console.log('\nSeed complete! Start the app with: npm run dev');
}

seed().catch(err => { console.error('Seed failed:', err); process.exit(1); });
