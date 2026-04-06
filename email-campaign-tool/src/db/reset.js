require('dotenv').config();
const fs = require('fs');
const path = require('path');
const config = require('../config');

const dbPath = path.resolve(config.db.path);

if (fs.existsSync(dbPath)) {
  fs.unlinkSync(dbPath);
  console.log(`Deleted database: ${dbPath}`);
} else {
  console.log('No database file found — nothing to reset.');
}

console.log('Database reset complete. Run `npm run db:seed` to re-seed.');
