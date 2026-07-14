/**
 * Postgres connection layer.
 *
 * Exposes a thin async wrapper that mimics the better-sqlite3 API used
 * throughout the rest of the app:
 *
 *   const db = getDb();
 *   const row  = await db.prepare('SELECT * FROM contacts WHERE id = ?').get(id);
 *   const rows = await db.prepare('SELECT * FROM contacts WHERE status = ?').all('active');
 *   const r    = await db.prepare('INSERT INTO contacts (email) VALUES (?)').run(email);
 *   //  → r.changes, r.lastInsertRowid
 *
 * Transactions use AsyncLocalStorage so that any db.prepare(...).run/.get/.all
 * call inside the transaction callback automatically uses the same client:
 *
 *   await db.transaction(async () => {
 *     await db.prepare('INSERT ...').run(...);
 *     await db.prepare('UPDATE ...').run(...);
 *   })();
 *
 * The wrapper transparently translates SQLite-flavored SQL to Postgres so
 * existing query strings keep working:
 *   - `?` placeholders → `$1, $2, ...`
 *   - `datetime('now')` → `NOW()`
 *   - `date('now', '-30 days')` → `(NOW() - INTERVAL '30 days')::date`
 *   - `date(col)` → `(col)::date`
 *   - `strftime('%H', col)` → `to_char(col, 'HH24')`
 *   - `LIKE` → `ILIKE` (SQLite LIKE is case-insensitive by default)
 *   - `COLLATE NOCASE` → stripped (email columns use CITEXT instead)
 *   - `INSERT OR IGNORE INTO X ...` → `INSERT INTO X ... ON CONFLICT DO NOTHING`
 *   - `INSERT OR REPLACE INTO X ...` → callers must use `ON CONFLICT ... DO UPDATE` directly
 *   - INSERTs auto-append `RETURNING id` so `.run()` can populate lastInsertRowid
 */

const { Pool, types } = require('pg');
const { AsyncLocalStorage } = require('node:async_hooks');
const config = require('../config');
const logger = require('../utils/logger');

// pg returns BIGINT (OID 20) and NUMERIC (OID 1700) as strings by default
// to avoid loss of precision. Our IDs and counters fit comfortably in JS
// Number range, and the rest of the app expects numbers — parse them.
types.setTypeParser(20, (val) => parseInt(val, 10));     // BIGINT / BIGSERIAL
types.setTypeParser(1700, (val) => parseFloat(val));     // NUMERIC

const txStorage = new AsyncLocalStorage();
let pool = null;

/**
 * Initialize the Postgres connection pool. Must be called once during
 * server startup before getDb() is used.
 */
async function initDb() {
  if (pool) return pool;

  const connectionString = config.db.url;
  if (!connectionString) {
    throw new Error('DATABASE_URL is not set. Configure it in your environment.');
  }

  // Render's managed Postgres requires SSL but uses a self-signed cert.
  // For local dev (DATABASE_URL pointing at localhost) we skip SSL.
  const isLocal = /localhost|127\.0\.0\.1/.test(connectionString);
  pool = new Pool({
    connectionString,
    ssl: isLocal ? false : { rejectUnauthorized: false },
    max: parseInt(process.env.PG_POOL_MAX, 10) || 10,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000,
  });

  pool.on('error', (err) => {
    logger.error(`Postgres pool error: ${err.message}`);
  });

  // Sanity check the connection.
  const client = await pool.connect();
  try {
    await client.query('SELECT 1');
    logger.info('Postgres connection pool initialized');
  } finally {
    client.release();
  }

  return pool;
}

/**
 * Return the db facade. Resolves to the active transaction client (via
 * AsyncLocalStorage) when inside a transaction, otherwise the pool.
 */
function getDb() {
  if (!pool) throw new Error('Database not initialized. Call initDb() first.');
  return DB_FACADE;
}

async function closeDb() {
  if (pool) {
    await pool.end();
    pool = null;
    logger.info('Postgres connection pool closed');
  }
}

// Junction tables with composite primary keys and no `id` column.
// The translator must NOT auto-append `RETURNING id` for these inserts.
const TABLES_WITHOUT_ID = new Set(['list_contacts', 'contact_tags', 'campaign_attachments', 'app_settings']);

// ───────────────────────────────────────────────────────────────────
// SQL translator: SQLite flavor → Postgres flavor.
// ───────────────────────────────────────────────────────────────────

/**
 * Walks the SQL string and rewrites `?` placeholders to `$N`, skipping
 * anything inside single-quoted string literals or double-quoted identifiers.
 */
function rewritePlaceholders(sql) {
  let out = '';
  let n = 0;
  let i = 0;
  while (i < sql.length) {
    const ch = sql[i];

    if (ch === "'") {
      out += ch;
      i++;
      while (i < sql.length) {
        out += sql[i];
        if (sql[i] === "'") {
          if (sql[i + 1] === "'") {
            out += sql[i + 1];
            i += 2;
            continue;
          }
          i++;
          break;
        }
        i++;
      }
      continue;
    }

    if (ch === '"') {
      out += ch;
      i++;
      while (i < sql.length && sql[i] !== '"') {
        out += sql[i];
        i++;
      }
      if (i < sql.length) {
        out += '"';
        i++;
      }
      continue;
    }

    if (ch === '-' && sql[i + 1] === '-') {
      while (i < sql.length && sql[i] !== '\n') {
        out += sql[i];
        i++;
      }
      continue;
    }

    if (ch === '?') {
      n++;
      out += '$' + n;
      i++;
      continue;
    }

    out += ch;
    i++;
  }
  return out;
}

function translateSql(rawSql) {
  let sql = rawSql;

  // INSERT OR IGNORE INTO foo (...) VALUES (...) → INSERT INTO foo (...) VALUES (...) ON CONFLICT DO NOTHING
  // We do this BEFORE auto-RETURNING-id so the ON CONFLICT lands before RETURNING.
  let isInsertOrIgnore = false;
  if (/^\s*INSERT\s+OR\s+IGNORE\s+INTO/i.test(sql)) {
    isInsertOrIgnore = true;
    sql = sql.replace(/^\s*INSERT\s+OR\s+IGNORE\s+INTO/i, 'INSERT INTO');
  }
  if (/^\s*INSERT\s+OR\s+REPLACE\s+INTO/i.test(sql)) {
    // Callers needing UPSERT should write `ON CONFLICT (...) DO UPDATE` directly.
    sql = sql.replace(/^\s*INSERT\s+OR\s+REPLACE\s+INTO/i, 'INSERT INTO');
  }

  // datetime('now') / datetime("now") → NOW()
  sql = sql.replace(/datetime\(\s*['"]now['"]\s*\)/gi, 'NOW()');

  // date('now', '-30 days') → (NOW() - INTERVAL '30 days')::date
  sql = sql.replace(
    /date\(\s*['"]now['"]\s*,\s*['"]([+-]?\d+)\s+(day|days|hour|hours|minute|minutes|month|months|year|years)['"]\s*\)/gi,
    (_m, num, unit) => {
      const n = parseInt(num, 10);
      const sign = n < 0 ? '-' : '+';
      const abs = Math.abs(n);
      return `(NOW() ${sign} INTERVAL '${abs} ${unit.toLowerCase()}')::date`;
    }
  );

  // date(col) → (col)::date — only when col is a single identifier (avoid mangling DATE keyword usage)
  sql = sql.replace(/\bdate\(\s*([a-zA-Z_][\w.]*)\s*\)/gi, '($1)::date');

  // strftime('%H', col) → to_char(col, 'HH24')
  sql = sql.replace(/strftime\(\s*['"]%H['"]\s*,\s*([^)]+?)\s*\)/gi, "to_char($1, 'HH24')");
  sql = sql.replace(/strftime\(\s*['"]%Y-%m-%d['"]\s*,\s*([^)]+?)\s*\)/gi, "to_char($1, 'YYYY-MM-DD')");
  sql = sql.replace(/strftime\(\s*['"]%Y-%m['"]\s*,\s*([^)]+?)\s*\)/gi, "to_char($1, 'YYYY-MM')");

  // COLLATE NOCASE — strip (email columns use CITEXT)
  sql = sql.replace(/\s+COLLATE\s+NOCASE/gi, '');

  // SQLite LIKE is case-insensitive; Postgres LIKE is case-sensitive — use ILIKE.
  // Match " LIKE " as a whole word so we don't touch identifiers.
  sql = sql.replace(/\bLIKE\b/gi, 'ILIKE');

  // RANDOM() — works in both SQLite and Postgres, no change needed.

  // last_insert_rowid() — not used directly anymore (RETURNING id handles it),
  // but if it appears, blow up loudly so we notice.
  if (/last_insert_rowid\s*\(/i.test(sql)) {
    throw new Error(`SQL contains last_insert_rowid() — use RETURNING id instead: ${rawSql}`);
  }

  // Append ON CONFLICT DO NOTHING for INSERT OR IGNORE
  if (isInsertOrIgnore) {
    // Place before any existing RETURNING clause
    if (/\bRETURNING\b/i.test(sql)) {
      sql = sql.replace(/\bRETURNING\b/i, 'ON CONFLICT DO NOTHING RETURNING');
    } else {
      sql = sql.trimEnd().replace(/;?\s*$/, '') + ' ON CONFLICT DO NOTHING';
    }
  }

  // Auto-append RETURNING id to INSERT statements that don't already return,
  // so .run() can expose lastInsertRowid like better-sqlite3.
  //
  // Skip junction tables that have no `id` column (composite primary keys) —
  // appending RETURNING id there would error with "column id does not exist".
  const insertMatch = sql.match(/^\s*INSERT\s+INTO\s+([a-zA-Z_][\w]*)/i);
  if (insertMatch && !/\bRETURNING\b/i.test(sql)) {
    const table = insertMatch[1].toLowerCase();
    if (!TABLES_WITHOUT_ID.has(table)) {
      sql = sql.trimEnd().replace(/;?\s*$/, '') + ' RETURNING id';
    }
  }

  // Now rewrite ? → $N (must be last so we don't double-count $-substituted text)
  sql = rewritePlaceholders(sql);

  return sql;
}

// Cache translated SQL keyed by raw SQL string (route handlers reuse the same strings).
const translateCache = new Map();
function getTranslatedSql(raw) {
  let cached = translateCache.get(raw);
  if (cached) return cached;
  cached = translateSql(raw);
  if (translateCache.size < 5000) translateCache.set(raw, cached);
  return cached;
}

// ───────────────────────────────────────────────────────────────────
// Statement / db facade
// ───────────────────────────────────────────────────────────────────

function getQueryRunner() {
  // If we're inside a transaction, use that client; otherwise the pool.
  return txStorage.getStore() || pool;
}

function flattenParams(params) {
  // db.prepare(sql).run(a, b, c) → params = [a, b, c]
  // db.prepare(sql).run([a, b, c]) → params = [[a, b, c]] — flatten one level for convenience
  if (params.length === 1 && Array.isArray(params[0])) return params[0];
  return params;
}

function createStatement(rawSql) {
  const translated = getTranslatedSql(rawSql);
  // Only look for an `id` in the result rows if the translated SQL actually
  // returns one — i.e. it's an INSERT and we appended RETURNING id (which we
  // skip for junction tables, see TABLES_WITHOUT_ID).
  const returnsId = /\bRETURNING\b[\s\S]*\bid\b/i.test(translated);

  return {
    async run(...params) {
      const args = flattenParams(params);
      const runner = getQueryRunner();
      try {
        const result = await runner.query(translated, args);
        const lastInsertRowid = returnsId && result.rows && result.rows[0]
          ? result.rows[0].id
          : undefined;
        return {
          changes: result.rowCount || 0,
          lastInsertRowid,
        };
      } catch (err) {
        throw enrichSqlError(err, rawSql, args);
      }
    },

    async get(...params) {
      const args = flattenParams(params);
      const runner = getQueryRunner();
      try {
        const result = await runner.query(translated, args);
        return result.rows[0];
      } catch (err) {
        throw enrichSqlError(err, rawSql, args);
      }
    },

    async all(...params) {
      const args = flattenParams(params);
      const runner = getQueryRunner();
      try {
        const result = await runner.query(translated, args);
        return result.rows;
      } catch (err) {
        throw enrichSqlError(err, rawSql, args);
      }
    },
  };
}

function enrichSqlError(err, rawSql, params) {
  // Surface a SQLite-style "UNIQUE constraint" message so route handlers
  // that string-match on it keep working.
  if (err.code === '23505') {
    err.message = `UNIQUE constraint failed: ${err.detail || err.message}`;
  }
  err.sql = rawSql;
  err.params = params;
  return err;
}

const DB_FACADE = {
  prepare(sql) {
    return createStatement(sql);
  },

  async exec(sql) {
    // Multi-statement script execution (DDL). No translation — caller is
    // expected to provide Postgres-flavored SQL here (used only by schema.js).
    const runner = getQueryRunner();
    await runner.query(sql);
  },

  /**
   * Wrap a callback in a transaction. Returns a function (matching the
   * better-sqlite3 API) that, when invoked, runs the callback inside a
   * BEGIN/COMMIT block. Any db.prepare(...) calls made inside the callback
   * automatically use the same client via AsyncLocalStorage.
   */
  transaction(fn) {
    return async (...args) => {
      // Nested transactions: just run the inner function with the existing client.
      if (txStorage.getStore()) {
        return fn(...args);
      }

      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const result = await txStorage.run(client, () => fn(...args));
        await client.query('COMMIT');
        return result;
      } catch (err) {
        try { await client.query('ROLLBACK'); } catch (_) { /* ignore */ }
        throw err;
      } finally {
        client.release();
      }
    };
  },
};

module.exports = { initDb, getDb, closeDb };
