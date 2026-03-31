const initSqlJs = require('sql.js');
const path = require('path');
const fs = require('fs');
const config = require('../config');
const logger = require('../utils/logger');

let db = null;
let SQL = null;
let dbPath = null;
let saveTimer = null;
let inTransaction = false;
let dirty = false;

/**
 * Initialize the SQL.js engine and load/create the database file.
 * Must be called once before getDb().
 */
async function initDb() {
  if (db) return db;

  SQL = await initSqlJs();
  dbPath = path.resolve(config.db.path);
  const dbDir = path.dirname(dbPath);

  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
  }

  if (fs.existsSync(dbPath)) {
    const buffer = fs.readFileSync(dbPath);
    db = new SQL.Database(buffer);
    logger.info(`Database loaded from: ${dbPath}`);
  } else {
    db = new SQL.Database();
    logger.info(`New database created: ${dbPath}`);
  }

  // Pragmas
  db.run('PRAGMA foreign_keys = ON;');

  // Auto-save every 30 seconds
  saveTimer = setInterval(() => { if (dirty) saveDb(); }, 30000);

  return db;
}

/**
 * Get the database instance (synchronous — initDb must have been called).
 */
function getDb() {
  if (!db) throw new Error('Database not initialized. Call initDb() first.');
  return createDbProxy(db);
}

/**
 * Persist the in-memory database to disk.
 */
function saveDb() {
  if (!db || !dbPath) return;
  try {
    const data = db.export();
    const buffer = Buffer.from(data);
    fs.writeFileSync(dbPath, buffer);
    dirty = false;
  } catch (err) {
    logger.error(`Failed to save database: ${err.message}`);
  }
}

function markDirty() {
  dirty = true;
  // Save immediately if not in a transaction
  if (!inTransaction) saveDb();
}

/**
 * Close and save the database.
 */
function closeDb() {
  if (saveTimer) { clearInterval(saveTimer); saveTimer = null; }
  saveDb();
  if (db) {
    db.close();
    db = null;
    logger.info('Database connection closed');
  }
}

/**
 * Create a proxy that wraps sql.js DB with a better-sqlite3-compatible API.
 */
function createDbProxy(rawDb) {
  return {
    prepare(sql) {
      return createStatementProxy(rawDb, sql);
    },
    exec(sql) {
      rawDb.exec(sql);
      markDirty();
    },
    pragma(pragma) {
      try { rawDb.run(`PRAGMA ${pragma}`); } catch {}
    },
    transaction(fn) {
      return (...args) => {
        inTransaction = true;
        rawDb.exec('BEGIN TRANSACTION');
        try {
          const result = fn(...args);
          rawDb.exec('COMMIT');
          inTransaction = false;
          markDirty();
          return result;
        } catch (err) {
          try { rawDb.exec('ROLLBACK'); } catch {}
          inTransaction = false;
          throw err;
        }
      };
    },
    close() {
      rawDb.close();
    },
  };
}

function createStatementProxy(rawDb, sql) {
  return {
    run(...params) {
      rawDb.run(sql, params);
      const changes = rawDb.getRowsModified();
      const result = rawDb.exec('SELECT last_insert_rowid() as id');
      const lastInsertRowid = result.length > 0 ? result[0].values[0][0] : 0;
      markDirty();
      return { changes, lastInsertRowid };
    },
    get(...params) {
      const stmt = rawDb.prepare(sql);
      stmt.bind(params);
      if (stmt.step()) {
        const cols = stmt.getColumnNames();
        const vals = stmt.get();
        stmt.free();
        const row = {};
        for (let i = 0; i < cols.length; i++) row[cols[i]] = vals[i];
        return row;
      }
      stmt.free();
      return undefined;
    },
    all(...params) {
      const results = [];
      const stmt = rawDb.prepare(sql);
      stmt.bind(params);
      while (stmt.step()) {
        const cols = stmt.getColumnNames();
        const vals = stmt.get();
        const row = {};
        for (let i = 0; i < cols.length; i++) row[cols[i]] = vals[i];
        results.push(row);
      }
      stmt.free();
      return results;
    },
  };
}

module.exports = { initDb, getDb, closeDb, saveDb };
