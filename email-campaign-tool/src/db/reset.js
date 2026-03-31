require('dotenv').config();
const fs = require('fs');
const path = require('path');
const config = require('../config');

const dbPath = path.resolve(config.db.path);

if (fs.existsSync(dbPath)) {
  fs.unlinkSync(dbPath);
  console.log(`Deleted database: ${dbPath}`);
}
// Remove WAL/SHM if present
for (const ext of ['-wal', '-shm']) {
  const p = dbPath + ext;
  if (fs.existsSync(p)) fs.unlinkSync(p);
}

console.log('Database reset. Run `npm run db:seed` to recreate.');
