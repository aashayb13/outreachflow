# OutreachFlow Desktop (.exe) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Package the existing OutreachFlow Express/EJS app as a single portable `OutreachFlow.exe` desktop app (Electron) that opens the same UI in its own window, plus an in-app SMTP Settings page stored encrypted in Supabase.

**Architecture:** A thin Electron main process loads a `settings.env` bootstrap file into `process.env`, starts the existing Express server **in-process** on a dynamic free port, and shows a `BrowserWindow` pointed at it. SMTP credentials move from env-only to a DB-backed, encrypted, in-app settings page (env remains the fallback). Apollo is unchanged.

**Tech Stack:** Node ≥18, Express, EJS, `pg`, `nodemailer`, `bcryptjs` (all pure JS — no native modules), Electron + electron-builder (portable target), `node:test`.

## Global Constraints

- Windows-only, personal, single-machine. No installer, signing, or auto-update.
- All runtime deps are pure JS — **no `electron-rebuild`/native step**.
- Product name is **`OutreachFlow`**; bootstrap config lives at `%APPDATA%\OutreachFlow\settings.env`.
- Encryption is AES-256-GCM keyed by `APP_SECRET` via the existing `src/services/integrations/_crypto.js`. **`APP_SECRET` is set once and never changed** (changing it orphans stored Apollo/SMTP secrets).
- DB access goes through the existing facade: `db.prepare(sql).run/get/all(...)`, `?` placeholders. **Tables with no `id` column must be registered in `TABLES_WITHOUT_ID` in `src/db/connection.js`** or the translator's auto-`RETURNING id` breaks inserts.
- Tests use `node --test` with `node:test` + `node:assert/strict` and stub via globals/module properties. Do **not** add a new test framework.
- Commit after every task.

---

### Task 1: Refactor `server.js` to export `start`/`stop` and not auto-listen when required

**Files:**
- Modify: `email-campaign-tool/src/server.js:162-210`
- Test: `email-campaign-tool/test/server-exports.test.js` (create)

**Interfaces:**
- Produces: `module.exports = { app, start, stop }` where `start(): Promise<http.Server>` (resolves once listening) and `stop(): Promise<void>` (graceful shutdown). Consumed by Task 4's `electron/main.js`.

- [ ] **Step 1: Write the failing test**

Create `email-campaign-tool/test/server-exports.test.js`:
```js
const test = require('node:test');
const assert = require('node:assert/strict');

test('server module exports app/start/stop and does not auto-listen on require', () => {
  const srv = require('../src/server');
  assert.ok(srv.app, 'exports the express app');
  assert.equal(typeof srv.start, 'function', 'exports start()');
  assert.equal(typeof srv.stop, 'function', 'exports stop()');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd email-campaign-tool && node --test test/server-exports.test.js`
Expected: FAIL — current `module.exports = app`, so `srv.start`/`srv.stop` are `undefined`. (It may also try to auto-start and log a DB error; that's the behavior we're removing.)

- [ ] **Step 3: Replace the "Start Server" / shutdown / exports section**

In `src/server.js`, replace everything from the `// ─── Start Server ───` comment (line ~161) through the end of the file (`module.exports = app;`) with:
```js
// ─── Start / Stop ───────────────────────────────────────────────────
let server = null;

async function start() {
  await initDb();
  await initializeSchema();

  await new Promise((resolve) => {
    server = app.listen(config.port, () => {
      logger.info(`OutreachFlow running on http://localhost:${config.port} (env: ${config.env})`);
      // Background scheduler stays off by preference (send-now mode).
      // startScheduler();
      resolve();
    });
  });
  return server;
}

async function stop() {
  stopScheduler();
  closeTransporter();
  try { await closeDb(); } catch (_) { /* ignore */ }
  await new Promise((resolve) => {
    if (!server) return resolve();
    server.close(() => resolve());
  });
}

// Auto-start ONLY when launched directly (`node src/server.js`) — not when
// required by Electron (electron/main.js) or by tests.
if (require.main === module) {
  start().catch((err) => {
    logger.error(`Failed to start: ${err.message}`);
    process.exit(1);
  });

  const shutdown = async (signal) => {
    logger.info(`${signal} received. Shutting down...`);
    await stop();
    process.exit(0);
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

module.exports = { app, start, stop };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd email-campaign-tool && node --test test/server-exports.test.js`
Expected: PASS (3 assertions).

Run the full suite to confirm no regressions: `cd email-campaign-tool && npm test`
Expected: all existing tests still PASS.

- [ ] **Step 5: Commit**

```bash
git add email-campaign-tool/src/server.js email-campaign-tool/test/server-exports.test.js
git commit -m "refactor(server): export start/stop, guard auto-listen for Electron"
```

---

### Task 2: Electron helper library (`getFreePort`, `ensureSettingsFile`)

**Files:**
- Create: `email-campaign-tool/electron/lib.js`
- Test: `email-campaign-tool/test/electron-lib.test.js`

**Interfaces:**
- Produces: `getFreePort(): Promise<number>` and `ensureSettingsFile(targetPath: string, templatePath: string): { created: boolean, path: string }`. Consumed by Task 4's `electron/main.js`.

- [ ] **Step 1: Write the failing test**

Create `email-campaign-tool/test/electron-lib.test.js`:
```js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { getFreePort, ensureSettingsFile } = require('../electron/lib');

test('getFreePort returns a usable port number', async () => {
  const port = await getFreePort();
  assert.equal(typeof port, 'number');
  assert.ok(port > 0 && port < 65536, 'port in valid range');
});

test('ensureSettingsFile creates from template when missing, then leaves it alone', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'of-'));
  const tpl = path.join(dir, 'tpl.env');
  const target = path.join(dir, 'nested', 'settings.env');
  fs.writeFileSync(tpl, 'DATABASE_URL=\nAPP_SECRET=\n');

  const first = ensureSettingsFile(target, tpl);
  assert.equal(first.created, true);
  assert.ok(fs.existsSync(target), 'file created');
  assert.equal(fs.readFileSync(target, 'utf8'), 'DATABASE_URL=\nAPP_SECRET=\n');

  fs.writeFileSync(target, 'DATABASE_URL=filled\n');
  const second = ensureSettingsFile(target, tpl);
  assert.equal(second.created, false, 'does not overwrite existing');
  assert.equal(fs.readFileSync(target, 'utf8'), 'DATABASE_URL=filled\n', 'user edits preserved');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd email-campaign-tool && node --test test/electron-lib.test.js`
Expected: FAIL — `Cannot find module '../electron/lib'`.

- [ ] **Step 3: Create the helper**

Create `email-campaign-tool/electron/lib.js`:
```js
const net = require('net');
const fs = require('fs');
const path = require('path');

/** Resolve to an available TCP port on 127.0.0.1. */
function getFreePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

/**
 * Ensure a settings file exists at targetPath. If missing, copy templatePath
 * into it (creating parent dirs). Never overwrites an existing file.
 * Returns { created, path }.
 */
function ensureSettingsFile(targetPath, templatePath) {
  if (fs.existsSync(targetPath)) return { created: false, path: targetPath };
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.copyFileSync(templatePath, targetPath);
  return { created: true, path: targetPath };
}

module.exports = { getFreePort, ensureSettingsFile };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd email-campaign-tool && node --test test/electron-lib.test.js`
Expected: PASS (both tests).

- [ ] **Step 5: Commit**

```bash
git add email-campaign-tool/electron/lib.js email-campaign-tool/test/electron-lib.test.js
git commit -m "feat(electron): add free-port + settings-file helpers"
```

---

### Task 3: Generate the app icon (dependency-free PNG generator)

**Files:**
- Create: `email-campaign-tool/electron/build/make-icon.js`
- Create (generated): `email-campaign-tool/electron/build/icon.png`

**Interfaces:**
- Produces: `electron/build/icon.png` (256×256 RGBA). Consumed by Task 4 (`win.icon` and `BrowserWindow` icon).

- [ ] **Step 1: Create the icon generator**

Create `email-campaign-tool/electron/build/make-icon.js`:
```js
// Generates electron/build/icon.png (256x256, RGBA) with no external deps.
// A rounded indigo tile with a white ring ("O" for OutreachFlow).
// Run: node electron/build/make-icon.js
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const SIZE = 256;
const BG = [79, 70, 229];     // indigo #4f46e5
const FG = [255, 255, 255];   // white

function insideRoundedRect(x, y, size, r) {
  const min = r, max = size - 1 - r;
  const cx = Math.min(Math.max(x, min), max);
  const cy = Math.min(Math.max(y, min), max);
  const dx = x - cx, dy = y - cy;
  return dx * dx + dy * dy <= r * r;
}

function buildPixels() {
  const px = Buffer.alloc(SIZE * SIZE * 4);
  const c = (SIZE - 1) / 2;
  const corner = 48, outerR = 92, innerR = 56;
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const i = (y * SIZE + x) * 4;
      if (!insideRoundedRect(x, y, SIZE, corner)) { px[i + 3] = 0; continue; }
      const d = Math.hypot(x - c, y - c);
      const col = d <= outerR && d >= innerR ? FG : BG;
      px[i] = col[0]; px[i + 1] = col[1]; px[i + 2] = col[2]; px[i + 3] = 255;
    }
  }
  return px;
}

const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) c = CRC[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const t = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([t, data])), 0);
  return Buffer.concat([len, t, data, crc]);
}
function encodePng(px) {
  const sig = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(SIZE, 0); ihdr.writeUInt32BE(SIZE, 4);
  ihdr[8] = 8; ihdr[9] = 6; // 8-bit, RGBA
  const stride = SIZE * 4 + 1;
  const raw = Buffer.alloc(SIZE * stride);
  for (let y = 0; y < SIZE; y++) {
    raw[y * stride] = 0; // filter: none
    px.copy(raw, y * stride + 1, y * SIZE * 4, (y + 1) * SIZE * 4);
  }
  const idat = zlib.deflateSync(raw);
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}

const out = path.join(__dirname, 'icon.png');
fs.writeFileSync(out, encodePng(buildPixels()));
console.log('Wrote', out);
```

- [ ] **Step 2: Generate the icon**

Run: `cd email-campaign-tool && node electron/build/make-icon.js`
Expected: prints `Wrote .../electron/build/icon.png`.

- [ ] **Step 3: Verify the PNG is valid and 256×256**

Run: `cd email-campaign-tool && node -e "const fs=require('fs');const b=fs.readFileSync('electron/build/icon.png');const w=b.readUInt32BE(16),h=b.readUInt32BE(20);console.log('sig',b.slice(1,4).toString(),'size',w+'x'+h)"`
Expected: `sig PNG size 256x256`. (Optional: open `electron/build/icon.png` to eyeball — an indigo tile with a white ring.)

- [ ] **Step 4: Commit**

```bash
git add email-campaign-tool/electron/build/make-icon.js email-campaign-tool/electron/build/icon.png
git commit -m "feat(electron): generate app icon"
```

---

### Task 4: Electron main process, settings template, packaging config, build the .exe

**Files:**
- Create: `email-campaign-tool/electron/main.js`
- Create: `email-campaign-tool/electron/settings-template.env`
- Modify: `email-campaign-tool/package.json` (main, scripts, devDeps, build config)

**Interfaces:**
- Consumes: `require('../src/server')` → `{ start, stop }` (Task 1); `require('./lib')` → `{ getFreePort, ensureSettingsFile }` (Task 2); `electron/build/icon.png` (Task 3).

- [ ] **Step 1: Create the settings template**

Create `email-campaign-tool/electron/settings-template.env`:
```
# ────────────────────────────────────────────────────────────────
# OutreachFlow — local settings. Fill in the blanks, SAVE, then
# reopen OutreachFlow.
#
# APP_SECRET encrypts your Apollo key and SMTP password inside
# Supabase. SET IT ONCE. If you change it later you must re-enter
# those credentials in the app.
# ────────────────────────────────────────────────────────────────

# Supabase -> Project -> Connect -> Session pooler (port 5432), with your password.
DATABASE_URL=

# Any long random string. Set once, never change.
APP_SECRET=

# The email + password you will use to LOG IN to OutreachFlow.
APP_EMAIL=
APP_PASSWORD=

# ─── Optional SMTP fallback ───
# You can instead set these in the app: Settings -> Email, after logging in.
# SMTP_HOST=smtp.gmail.com
# SMTP_PORT=587
# SMTP_SECURE=false
# SMTP_USER=
# SMTP_PASS=
# SMTP_FROM_NAME=
# SMTP_FROM_EMAIL=
```

- [ ] **Step 2: Create the Electron main process**

Create `email-campaign-tool/electron/main.js`:
```js
const path = require('path');
const dotenv = require('dotenv');
const { app, BrowserWindow, dialog, shell, Menu } = require('electron');
const { getFreePort, ensureSettingsFile } = require('./lib');

app.setName('OutreachFlow'); // fixes %APPDATA%\OutreachFlow path in dev + packaged

const TEMPLATE = path.join(__dirname, 'settings-template.env');
const ICON = path.join(__dirname, 'build', 'icon.png');

let mainWindow = null;
let serverApi = null;

const settingsPath = () => path.join(app.getPath('userData'), 'settings.env');

async function boot() {
  const target = settingsPath();
  const { created } = ensureSettingsFile(target, TEMPLATE);

  if (created) {
    await shell.openPath(target);
    dialog.showMessageBoxSync({
      type: 'info',
      title: 'OutreachFlow — first-time setup',
      message: 'Welcome to OutreachFlow',
      detail: `A settings file was created and opened for you:\n\n${target}\n\n` +
              `Fill in DATABASE_URL, APP_SECRET, APP_EMAIL and APP_PASSWORD, ` +
              `save the file, then reopen OutreachFlow.`,
      buttons: ['Quit'],
    });
    app.quit();
    return;
  }

  // Load settings.env into process.env BEFORE requiring the server.
  dotenv.config({ path: target });
  process.env.PORT = String(await getFreePort());
  process.env.NODE_ENV = process.env.NODE_ENV || 'production';

  try {
    serverApi = require('../src/server');
    await serverApi.start();
  } catch (err) {
    dialog.showMessageBoxSync({
      type: 'error',
      title: 'OutreachFlow — could not start',
      message: 'OutreachFlow could not start.',
      detail: `${err.message}\n\nCheck your settings file:\n${target}`,
      buttons: ['OK'],
    });
    await shell.openPath(target);
    app.quit();
    return;
  }

  createWindow();
}

function createWindow() {
  Menu.setApplicationMenu(null);
  mainWindow = new BrowserWindow({
    width: 1280, height: 860, minWidth: 900, minHeight: 600,
    title: 'OutreachFlow', icon: ICON,
    webPreferences: { contextIsolation: true, nodeIntegration: false },
  });
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
  mainWindow.loadURL(`http://localhost:${process.env.PORT}`);
  mainWindow.on('closed', () => { mainWindow = null; });
}

app.whenReady().then(boot);

app.on('window-all-closed', async () => {
  try { if (serverApi) await serverApi.stop(); } catch (_) { /* ignore */ }
  app.quit();
});
```

- [ ] **Step 3: Update `package.json` — entry, scripts, devDeps, build config**

In `email-campaign-tool/package.json`:
- Change `"main": "src/server.js"` → `"main": "electron/main.js"`.
- In `"scripts"`, add:
```json
"electron": "electron .",
"icon": "node electron/build/make-icon.js",
"dist": "electron-builder --win portable"
```
- In `"devDependencies"`, add:
```json
"electron": "^31.7.6",
"electron-builder": "^24.13.3"
```
- Add a top-level `"build"` key:
```json
"build": {
  "appId": "com.outreachflow.desktop",
  "productName": "OutreachFlow",
  "asar": true,
  "files": ["src/**/*", "views/**/*", "electron/**/*", "package.json"],
  "directories": { "output": "dist" },
  "win": { "target": "portable", "icon": "electron/build/icon.png" },
  "portable": { "artifactName": "OutreachFlow.exe" }
}
```

> Note: `npm start` still runs `node src/server.js` (explicit path), unaffected by the `main` change. There is no `public/` folder, so it is intentionally omitted from `files`.

- [ ] **Step 4: Install Electron toolchain**

Run: `cd email-campaign-tool && npm install`
Expected: installs `electron` + `electron-builder` (a large download, several hundred MB — may take a few minutes). Exit code 0.

- [ ] **Step 5: Dev smoke test (before packaging)**

Run: `cd email-campaign-tool && npm run electron`
Expected on FIRST run: a Notepad window opens `%APPDATA%\OutreachFlow\settings.env` and a dialog says "first-time setup". Fill the file with real values (Supabase `DATABASE_URL`, an `APP_SECRET`, `APP_EMAIL`, `APP_PASSWORD`), save, quit the dialog, and run `npm run electron` again.
Expected on SECOND run: an OutreachFlow window opens showing the login page; logging in with `APP_EMAIL`/`APP_PASSWORD` loads the dashboard with data from Supabase. Close the window — the process exits cleanly.

- [ ] **Step 6: Build the portable .exe**

Run: `cd email-campaign-tool && npm run dist`
Expected: electron-builder produces `email-campaign-tool/dist/OutreachFlow.exe`. Verify: `ls -la dist/OutreachFlow.exe` shows a multi-hundred-MB file.

Double-click `dist/OutreachFlow.exe` (or copy it to the Desktop) and confirm the same window opens and login works.

> Fallback: if the UI shows blank / EJS or static assets fail to load from inside the asar, set `"asar": false` in the build config (or add `"asarUnpack": ["views/**"]`) and rebuild.

- [ ] **Step 7: Ignore build artifacts**

Add to `email-campaign-tool/.gitignore` (create the lines if not present):
```
dist/
```

- [ ] **Step 8: Commit**

```bash
git add email-campaign-tool/electron/main.js email-campaign-tool/electron/settings-template.env email-campaign-tool/package.json email-campaign-tool/package-lock.json email-campaign-tool/.gitignore
git commit -m "feat(electron): desktop app wrapper + portable .exe packaging"
```

---

### Task 5: `app_settings` table + settings service (encrypted SMTP storage)

**Files:**
- Modify: `email-campaign-tool/src/db/schema.js` (add `app_settings` table after the `api_keys` table, ~line 307)
- Modify: `email-campaign-tool/src/db/connection.js:107` (register `app_settings` in `TABLES_WITHOUT_ID`)
- Create: `email-campaign-tool/src/services/settings.js`
- Test: `email-campaign-tool/test/settings.test.js`

**Interfaces:**
- Produces: `getSmtpSettings(): Promise<object>`, `saveSmtpSettings(input): Promise<object>`, `getEffectiveSmtp(): Promise<{host,port,secure,user,pass,fromName,fromEmail,source}>`, `mergeSmtp(envSmtp, dbSmtp): object`, `SMTP_KEY: 'smtp'`. Consumed by mailer (Task 6) and routes (Task 7).

- [ ] **Step 1: Write the failing test**

Create `email-campaign-tool/test/settings.test.js`:
```js
const test = require('node:test');
const assert = require('node:assert/strict');
const { mergeSmtp, getSmtpSettings } = require('../src/services/settings');

test('mergeSmtp: DB values override env; blank DB fields are ignored', () => {
  const env = { host: 'smtp.gmail.com', port: 587, secure: false, user: 'env@x.com', pass: 'envpass', fromName: 'Env', fromEmail: 'env@x.com' };
  const db = { user: 'db@x.com', pass: '', fromName: 'DB Name' };
  const out = mergeSmtp(env, db);
  assert.equal(out.user, 'db@x.com', 'db user wins');
  assert.equal(out.pass, 'envpass', 'blank db pass keeps env pass');
  assert.equal(out.fromName, 'DB Name');
  assert.equal(out.host, 'smtp.gmail.com', 'env host retained');
});

test('mergeSmtp: coerces port to int and secure to boolean', () => {
  const out = mergeSmtp({ host: 'h', port: 587, secure: false }, { port: '465', secure: 'true' });
  assert.equal(out.port, 465);
  assert.equal(out.secure, true);
});

test('getSmtpSettings returns {} when DB is not initialized (no throw)', async () => {
  const r = await getSmtpSettings();
  assert.deepEqual(r, {});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd email-campaign-tool && node --test test/settings.test.js`
Expected: FAIL — `Cannot find module '../src/services/settings'`.

- [ ] **Step 3: Register the table in the SQL translator**

In `src/db/connection.js:107`, change:
```js
const TABLES_WITHOUT_ID = new Set(['list_contacts', 'contact_tags', 'campaign_attachments']);
```
to:
```js
const TABLES_WITHOUT_ID = new Set(['list_contacts', 'contact_tags', 'campaign_attachments', 'app_settings']);
```

- [ ] **Step 4: Add the schema table**

In `src/db/schema.js`, immediately after the `api_keys` `CREATE TABLE (...)` statement (the `);` at ~line 307), add:
```sql
    -- ═══════════════════════════════════════════════════════════
    -- APP SETTINGS (key/value; SMTP creds stored encrypted)
    -- ═══════════════════════════════════════════════════════════
    CREATE TABLE IF NOT EXISTS app_settings (
      key        TEXT PRIMARY KEY,
      value      TEXT NOT NULL DEFAULT '',
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );
```

- [ ] **Step 5: Create the settings service**

Create `email-campaign-tool/src/services/settings.js`:
```js
/**
 * App-level settings stored in the app_settings key/value table.
 * SMTP credentials are AES-256-GCM encrypted with APP_SECRET (same scheme as
 * lead-gen integrations). DB settings layer over env; env is the fallback.
 */
const { getDb } = require('../db/connection');
const config = require('../config');
const { encryptJSON, decryptJSON } = require('./integrations/_crypto');
const logger = require('../utils/logger');

const SMTP_KEY = 'smtp';

/** Read stored SMTP settings, or {} if unset OR the DB is unavailable. */
async function getSmtpSettings() {
  try {
    const db = getDb();
    const row = await db.prepare('SELECT value FROM app_settings WHERE key = ?').get(SMTP_KEY);
    if (!row || !row.value) return {};
    return decryptJSON(row.value);
  } catch (err) {
    logger.warn(`getSmtpSettings fell back to env: ${err.message}`);
    return {};
  }
}

/** Merge + persist SMTP settings. Blank fields keep the prior value. */
async function saveSmtpSettings(input) {
  const db = getDb();
  const existing = await getSmtpSettings();
  const merged = { ...existing };
  for (const [k, v] of Object.entries(input || {})) {
    if (v !== '' && v !== null && v !== undefined) merged[k] = v;
  }
  const value = encryptJSON(merged);
  await db.prepare(`
    INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, NOW())
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()
  `).run(SMTP_KEY, value);
  return merged;
}

/** Pure merge (DB over env). Exported for testing. */
function mergeSmtp(envSmtp, dbSmtp) {
  const out = { ...envSmtp };
  for (const [k, v] of Object.entries(dbSmtp || {})) {
    if (v !== '' && v !== null && v !== undefined) out[k] = v;
  }
  if (out.port !== undefined) out.port = parseInt(out.port, 10) || 587;
  out.secure = out.secure === true || out.secure === 'true';
  return out;
}

/** Effective SMTP config used by the mailer, plus a `source` flag. */
async function getEffectiveSmtp() {
  const dbSmtp = await getSmtpSettings();
  const envSmtp = {
    host: config.smtp.host,
    port: config.smtp.port,
    secure: config.smtp.secure,
    user: config.smtp.user,
    pass: config.smtp.pass,
    fromName: config.smtp.fromName,
    fromEmail: config.smtp.fromEmail,
  };
  return { ...mergeSmtp(envSmtp, dbSmtp), source: Object.keys(dbSmtp).length ? 'db' : 'env' };
}

module.exports = { getSmtpSettings, saveSmtpSettings, getEffectiveSmtp, mergeSmtp, SMTP_KEY };
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd email-campaign-tool && node --test test/settings.test.js`
Expected: PASS (3 tests).

- [ ] **Step 7: Commit**

```bash
git add email-campaign-tool/src/db/schema.js email-campaign-tool/src/db/connection.js email-campaign-tool/src/services/settings.js email-campaign-tool/test/settings.test.js
git commit -m "feat(settings): app_settings table + encrypted SMTP settings service"
```

---

### Task 6: Mailer reads effective (DB-or-env) SMTP; supports test-before-save

**Files:**
- Modify: `email-campaign-tool/src/services/mailer.js`
- Test: `email-campaign-tool/test/mailer.test.js` (existing — keep passing; add one case)

**Interfaces:**
- Consumes: `getEffectiveSmtp()` (Task 5).
- Produces: `sendEmail(...)`, `verifyConnection(overrides?)`, `closeTransporter()`, `reloadTransporter()`. `reloadTransporter` consumed by routes (Task 7).

- [ ] **Step 1: Add the failing test case**

Append to `email-campaign-tool/test/mailer.test.js`:
```js
test('verifyConnection(overrides) tests ad-hoc settings without saving', async () => {
  const orig = nodemailer.createTransport;
  let opts = null;
  nodemailer.createTransport = (o) => { opts = o; return { verify: async () => true, close() {} }; };
  mailer.closeTransporter();

  const r = await mailer.verifyConnection({ host: 'smtp.test', port: '465', secure: 'true', user: 'u', pass: 'p' });

  nodemailer.createTransport = orig;
  mailer.closeTransporter();

  assert.equal(r.success, true);
  assert.equal(opts.host, 'smtp.test');
  assert.equal(opts.port, 465);
  assert.equal(opts.secure, true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd email-campaign-tool && node --test test/mailer.test.js`
Expected: FAIL — current `verifyConnection` takes no overrides and ignores them (`opts.host` would be the env host, not `smtp.test`).

- [ ] **Step 3: Rewrite the mailer**

Replace the entire contents of `email-campaign-tool/src/services/mailer.js` with:
```js
const nodemailer = require('nodemailer');
const config = require('../config');
const logger = require('../utils/logger');
const { getEffectiveSmtp } = require('./settings');

let transporter = null;

async function getTransporter() {
  if (transporter) return transporter;
  const s = await getEffectiveSmtp();
  transporter = nodemailer.createTransport({
    host: s.host,
    port: s.port,
    secure: s.secure,
    auth: { user: s.user, pass: s.pass },
    pool: true,
    maxConnections: 5,
    maxMessages: 100,
    rateDelta: 1000,
    rateLimit: config.sendRate.perSecond,
  });
  return transporter;
}

function cleanOverrides(o) {
  const out = {};
  for (const [k, v] of Object.entries(o || {})) {
    if (v !== '' && v !== null && v !== undefined) out[k] = v;
  }
  return out;
}

/** Send a single email. Returns { success, messageId, error }. */
async function sendEmail({ to, subject, html, text, from, replyTo, headers = {}, attachments = [] }) {
  const transport = await getTransporter();
  const s = await getEffectiveSmtp();
  const fromAddress = from || `"${s.fromName}" <${s.fromEmail}>`;
  const mailOptions = {
    from: fromAddress,
    to, subject, html, text, attachments,
    replyTo: replyTo || s.fromEmail,
    headers: {
      'List-Unsubscribe': headers['List-Unsubscribe'] || '',
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
      'X-Campaign-ID': headers['X-Campaign-ID'] || '',
      ...headers,
    },
  };
  try {
    const info = await transport.sendMail(mailOptions);
    logger.debug(`Email sent to ${to}: ${info.messageId}`);
    return { success: true, messageId: info.messageId };
  } catch (error) {
    logger.error(`Failed to send email to ${to}: ${error.message}`);
    return { success: false, error: error.message };
  }
}

/**
 * Verify the SMTP connection. Pass `overrides` (unsaved form values) to test
 * them without persisting; otherwise the effective/saved settings are used.
 */
async function verifyConnection(overrides) {
  try {
    let transport;
    const ov = cleanOverrides(overrides);
    if (Object.keys(ov).length) {
      const base = await getEffectiveSmtp();
      const s = { ...base, ...ov };
      transport = nodemailer.createTransport({
        host: s.host,
        port: parseInt(s.port, 10) || 587,
        secure: s.secure === true || s.secure === 'true',
        auth: { user: s.user, pass: s.pass },
      });
    } else {
      transport = await getTransporter();
    }
    await transport.verify();
    logger.info('SMTP connection verified');
    return { success: true };
  } catch (error) {
    logger.error(`SMTP verification failed: ${error.message}`);
    return { success: false, error: error.message };
  }
}

/** Close the cached transporter pool. */
function closeTransporter() {
  if (transporter) { transporter.close(); transporter = null; }
}

// After saving new SMTP settings, drop the cached transporter so the next
// send/verify rebuilds it from the updated effective config.
const reloadTransporter = closeTransporter;

module.exports = { sendEmail, verifyConnection, closeTransporter, reloadTransporter };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd email-campaign-tool && node --test test/mailer.test.js`
Expected: PASS — both the original "attachments" test and the new overrides test. (No DB is initialized in this test; `getEffectiveSmtp` falls back to env, which is what the stub expects.)

- [ ] **Step 5: Commit**

```bash
git add email-campaign-tool/src/services/mailer.js email-campaign-tool/test/mailer.test.js
git commit -m "feat(mailer): use effective (DB-or-env) SMTP + test-before-save"
```

---

### Task 7: Settings API routes (`/api/settings/smtp` GET/PUT/test)

**Files:**
- Create: `email-campaign-tool/src/routes/settings.js`
- Modify: `email-campaign-tool/src/server.js:89` (mount the router)

**Interfaces:**
- Consumes: `getEffectiveSmtp`, `saveSmtpSettings` (Task 5); `verifyConnection`, `reloadTransporter` (Task 6); `maskSecret` from `src/services/integrations/_crypto.js`; `authenticate`, `requirePermission` from `src/middleware/auth.js`.
- Produces HTTP: `GET /api/settings/smtp` → `{ smtp }`; `PUT /api/settings/smtp` → `{ smtp }`; `POST /api/settings/smtp/test` → `{ success, error? }`. Consumed by the view (Task 8).

- [ ] **Step 1: Create the router**

Create `email-campaign-tool/src/routes/settings.js`:
```js
/**
 * /api/settings — app-level settings (currently SMTP/email).
 * All routes require auth; writes require the 'admin' permission.
 * The password is never returned in full — only a masked preview.
 */
const express = require('express');
const router = express.Router();

const { authenticate, requirePermission } = require('../middleware/auth');
const { getEffectiveSmtp, saveSmtpSettings } = require('../services/settings');
const { verifyConnection, reloadTransporter } = require('../services/mailer');
const { maskSecret } = require('../services/integrations/_crypto');

router.use(authenticate);

function publicSmtp(s) {
  return {
    host: s.host || '',
    port: s.port || 587,
    secure: !!s.secure,
    user: s.user || '',
    pass: s.pass ? maskSecret(s.pass) : '',
    has_pass: !!s.pass,
    fromName: s.fromName || '',
    fromEmail: s.fromEmail || '',
    source: s.source || 'env',
  };
}

router.get('/smtp', async (req, res, next) => {
  try {
    const s = await getEffectiveSmtp();
    res.json({ smtp: publicSmtp(s) });
  } catch (err) { next(err); }
});

router.put('/smtp', requirePermission('admin'), async (req, res, next) => {
  try {
    const { host, port, secure, user, pass, fromName, fromEmail } = req.body || {};
    await saveSmtpSettings({ host, port, secure, user, pass, fromName, fromEmail });
    reloadTransporter();
    const s = await getEffectiveSmtp();
    res.json({ smtp: publicSmtp(s) });
  } catch (err) { next(err); }
});

router.post('/smtp/test', requirePermission('admin'), async (req, res) => {
  const result = await verifyConnection(req.body || {});
  res.status(result.success ? 200 : 400).json(result);
});

module.exports = router;
```

- [ ] **Step 2: Mount the router**

In `src/server.js`, in the `// ─── API Routes ───` block, add after line 89 (`app.use('/api/assets', ...)`):
```js
app.use('/api/settings', require('./routes/settings'));
```

- [ ] **Step 3: Verify the module loads without error**

Run: `cd email-campaign-tool && node -e "require('./src/routes/settings'); console.log('settings router OK')"`
Expected: prints `settings router OK` (no throw).

- [ ] **Step 4: Verify server still boots (requires a valid DATABASE_URL in .env)**

Run: `cd email-campaign-tool && node -e "require('./src/server').start().then(()=>{console.log('BOOT OK');return require('./src/server').stop()}).then(()=>process.exit(0)).catch(e=>{console.error(e.message);process.exit(1)})"`
Expected: `BOOT OK` then clean exit. (Full functional check of the endpoints happens through the UI in Task 8.)

- [ ] **Step 5: Commit**

```bash
git add email-campaign-tool/src/routes/settings.js email-campaign-tool/src/server.js
git commit -m "feat(settings): /api/settings/smtp GET/PUT/test routes"
```

---

### Task 8: Editable SMTP card in the Settings UI

**Files:**
- Modify: `email-campaign-tool/views/settings.ejs` (replace the read-only SMTP card + extend `settingsApp()`)
- Modify: `email-campaign-tool/src/server.js:143-155` (drop now-unused `smtp_*` template vars)

**Interfaces:**
- Consumes HTTP: `GET/PUT /api/settings/smtp`, `POST /api/settings/smtp/test` (Task 7); `api.get/put/post` helpers from `views/layout.ejs:120`.

- [ ] **Step 1: Replace the SMTP card markup**

In `views/settings.ejs`, replace the entire `<!-- SMTP Settings -->` card (lines 5–19, the `<div class="bg-white ...">...</div>` block ending before `<!-- API Keys -->`) with:
```html
    <!-- Email (SMTP) Settings -->
    <div class="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
      <h3 class="font-semibold text-gray-700 mb-4"><i class="fas fa-envelope text-gray-400 mr-2"></i>Email (SMTP)</h3>
      <div class="space-y-3 text-sm">
        <div>
          <label class="block text-gray-500 mb-1">From name</label>
          <input x-model="smtp.fromName" class="w-full border border-gray-300 rounded-lg px-3 py-2" placeholder="Your Name" />
        </div>
        <div>
          <label class="block text-gray-500 mb-1">From email</label>
          <input x-model="smtp.fromEmail" class="w-full border border-gray-300 rounded-lg px-3 py-2" placeholder="you@gmail.com" />
        </div>
        <div class="grid grid-cols-2 gap-2">
          <div>
            <label class="block text-gray-500 mb-1">SMTP host</label>
            <input x-model="smtp.host" class="w-full border border-gray-300 rounded-lg px-3 py-2" placeholder="smtp.gmail.com" />
          </div>
          <div>
            <label class="block text-gray-500 mb-1">Port</label>
            <input x-model="smtp.port" type="number" class="w-full border border-gray-300 rounded-lg px-3 py-2" placeholder="587" />
          </div>
        </div>
        <div>
          <label class="block text-gray-500 mb-1">SMTP user</label>
          <input x-model="smtp.user" class="w-full border border-gray-300 rounded-lg px-3 py-2" placeholder="you@gmail.com" />
        </div>
        <div>
          <label class="block text-gray-500 mb-1">Password / App password</label>
          <input x-model="smtp.pass" type="password" class="w-full border border-gray-300 rounded-lg px-3 py-2"
                 :placeholder="smtp.has_pass ? '******** (leave blank to keep current)' : 'Gmail 16-char app password'" />
        </div>
        <label class="flex items-center gap-2 text-gray-600">
          <input type="checkbox" x-model="smtp.secure" /> Use SSL (port 465)
        </label>
      </div>
      <div class="flex items-center gap-2 mt-4">
        <button @click="saveSMTP()" class="bg-green-500 text-white px-4 py-2 rounded-lg text-sm hover:bg-green-600"><i class="fas fa-save mr-1"></i> Save</button>
        <button @click="testSMTP()" class="bg-blue-500 text-white px-4 py-2 rounded-lg text-sm hover:bg-blue-600"><i class="fas fa-plug mr-1"></i> Test</button>
        <span class="text-xs text-gray-400" x-text="'Source: ' + (smtp.source || 'env')"></span>
      </div>
      <p x-show="smtpStatus" class="mt-2 text-sm" :class="smtpOk ? 'text-green-600' : 'text-red-600'" x-text="smtpStatus"></p>
      <p class="text-xs text-gray-400 mt-3">Gmail needs an App Password (2FA must be on). Stored encrypted in your database.</p>
    </div>
```

- [ ] **Step 2: Extend the `settingsApp()` Alpine component**

In the `<script>` at the bottom of `views/settings.ejs`, update `settingsApp()`:

Change the data return to add the `smtp` object (extend the existing first line):
```js
    apiKeys: [], newKeyName: '', newKey: '', smtpStatus: '', smtpOk: false, suppressionCount: 0,
    smtp: { host: '', port: 587, secure: false, user: '', pass: '', has_pass: false, fromName: '', fromEmail: '', source: 'env' },
```

In `load()`, after the suppression fetch, add:
```js
      const sm = await api.get('/api/settings/smtp');
      this.smtp = { ...this.smtp, ...sm.smtp };
```

Replace the existing `verifySMTP()` method with these three methods:
```js
    async saveSMTP() {
      try {
        const d = await api.put('/api/settings/smtp', this.smtp);
        this.smtp = { ...this.smtp, ...d.smtp, pass: '' };
        toast('SMTP settings saved');
      } catch (e) {}
    },

    async testSMTP() {
      this.smtpStatus = 'Testing...';
      try {
        const d = await api.post('/api/settings/smtp/test', this.smtp);
        this.smtpOk = d.success;
        this.smtpStatus = d.success ? 'Connection successful!' : 'Failed: ' + (d.error || 'Unknown error');
      } catch (e) {
        this.smtpOk = false;
        this.smtpStatus = 'Connection failed';
      }
    },
```

> The old SMTP card's only button called `verifySMTP()`; it is replaced by `testSMTP()`. No other view references `verifySMTP`.

- [ ] **Step 3: Remove now-unused template vars from the `/settings` route**

In `src/server.js`, in the `app.get('/settings', ...)` handler (lines 143–155), delete the four `smtp_host` / `smtp_port` / `smtp_user` / `smtp_from` properties (the page now fetches them via the API). Keep `title`, `page`, `send_rate`, `send_daily`, `tracking_domain`. Result:
```js
app.get('/settings', authenticate, (req, res) => {
  res.render('settings', {
    title: 'Settings',
    page: 'settings',
    send_rate: config.sendRate.perSecond,
    send_daily: config.sendRate.perDay,
    tracking_domain: config.tracking.domain,
  });
});
```

- [ ] **Step 4: Manual verification through the UI**

Run: `cd email-campaign-tool && npm start` (with a valid `.env`), open `http://localhost:3000`, log in, go to **Settings**.
Expected:
1. The **Email (SMTP)** card shows the current values (masked password if one is set, `Source: env` or `db`).
2. Enter your Gmail details + 16-char app password → click **Test** → "Connection successful!".
3. Click **Save** → toast "SMTP settings saved"; reload the page → values persist and `Source: db`.
4. Send a real test campaign to yourself → the email arrives.

- [ ] **Step 5: Commit**

```bash
git add email-campaign-tool/views/settings.ejs email-campaign-tool/src/server.js
git commit -m "feat(settings): editable in-app SMTP settings page"
```

---

### Task 9: `DESKTOP.md` — build + connect Apollo + connect SMTP walkthrough

**Files:**
- Create: `email-campaign-tool/DESKTOP.md`

**Interfaces:** none (documentation). This is the user-facing "next steps for connecting API and SMTP" deliverable.

- [ ] **Step 1: Write the doc**

Create `email-campaign-tool/DESKTOP.md`:
```markdown
# OutreachFlow Desktop (.exe)

Run OutreachFlow as a desktop app on Windows — same UI as the deployed version,
in its own window. Data stays in Supabase; Apollo and Gmail are reached over the
internet. Once this works you can delete the paid Render service.

## Build the .exe

```bash
cd email-campaign-tool
npm install
npm run icon      # generates the app icon (one-time)
npm run dist      # builds dist/OutreachFlow.exe
```

Copy `dist/OutreachFlow.exe` to your Desktop.

## First launch — settings.env

On the first run, a text file opens automatically at:

```
%APPDATA%\OutreachFlow\settings.env
```

Fill it in and save, then reopen OutreachFlow:

- `DATABASE_URL` — Supabase → Project → **Connect** → **Session pooler** (port 5432),
  with your DB password in the string.
- `APP_SECRET` — any long random string. **Set once, never change** (it encrypts
  your Apollo key and SMTP password in Supabase).
- `APP_EMAIL` / `APP_PASSWORD` — the login you'll use for the app.

## Connect Apollo (paid API)

1. Log in → **Settings → Integrations** (the `/integrations` page).
2. Add **Apollo** → paste your Apollo API key → **Test** → **Save**.
   The key is stored encrypted in Supabase.
3. Use **Lists → Apollo Search** to pull and import leads.

## Connect Gmail (SMTP) sending

1. In Google: enable **2-Step Verification**, then create an **App Password**
   (Google Account → Security → App passwords). It's 16 characters.
2. In OutreachFlow: **Settings → Email (SMTP)**:
   - From name / From email: your Gmail address.
   - SMTP host `smtp.gmail.com`, port `587`, SSL off (or port `465`, SSL on).
   - SMTP user: your Gmail address. Password: the 16-char app password.
3. Click **Test** → expect "Connection successful!" → **Save**.
4. Send a test campaign to yourself to confirm delivery.

Sending from your own machine avoids the SMTP-port block that the free Render tier
imposes — no paid host needed.

## Notes & limits

- The app only runs while `OutreachFlow.exe` is open. "Send now" mode is used
  (no background scheduling), so that's fine.
- Open/click tracking and hosted unsubscribe links point at `localhost` and are
  not reachable by recipients — emails still send fine; only those tracking
  features need a public URL.
- To move the app to another folder/PC, copy `OutreachFlow.exe`; your
  `settings.env` stays in `%APPDATA%\OutreachFlow\` on each machine.
```

- [ ] **Step 2: Verify it renders**

Open `email-campaign-tool/DESKTOP.md` and confirm the code fences and steps read correctly.

- [ ] **Step 3: Commit**

```bash
git add email-campaign-tool/DESKTOP.md
git commit -m "docs: OutreachFlow desktop build + connect Apollo/SMTP guide"
```

---

## Self-Review

**Spec coverage:**
- Electron wrapper, in-process server, dynamic port, window → Tasks 1, 4. ✓
- `settings.env` bootstrap + first-run open-in-Notepad → Tasks 2, 4. ✓
- Portable single `.exe`, generated icon → Tasks 3, 4. ✓
- `app_settings` table, encrypted SMTP, DB-over-env precedence → Task 5. ✓
- Mailer uses effective settings + test-before-save + reload-on-save → Task 6. ✓
- `/api/settings/smtp` GET/PUT/test, keep `verify-smtp` working → Task 7 (existing `/api/auth/verify-smtp` calls `verifyConnection()` with no args → effective settings, unchanged). ✓
- Editable in-app SMTP page mirroring Integrations → Task 8. ✓
- Apollo unchanged → no task needed. ✓
- Connect-Apollo/SMTP walkthrough (user's explicit ask) → Task 9. ✓
- `APP_SECRET` set-once warning → Task 4 template + Task 9 doc. ✓

**Placeholder scan:** No TBD/TODO; every code and command step contains full content. ✓

**Type consistency:** `start`/`stop` (Task 1) consumed in Task 4; `getEffectiveSmtp`/`saveSmtpSettings`/`mergeSmtp` (Task 5) consumed in Tasks 6–7; `verifyConnection(overrides)`/`reloadTransporter` (Task 6) consumed in Task 7; `GET/PUT/POST /api/settings/smtp` (Task 7) consumed in Task 8; `api.get/put/post` confirmed present in `layout.ejs`. `app_settings` registered in `TABLES_WITHOUT_ID` (Task 5) so inserts don't get auto-`RETURNING id`. ✓
```
