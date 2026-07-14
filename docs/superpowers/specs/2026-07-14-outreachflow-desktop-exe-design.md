# OutreachFlow Desktop (.exe) — Design

**Date:** 2026-07-14
**Status:** Approved for planning
**Author:** Aashay Bhujbal (with Claude)

## 1. Goal

Package the existing OutreachFlow web app (Node/Express + EJS, in
`email-campaign-tool/`) as a single portable **`OutreachFlow.exe`** that lives on
the user's Windows desktop. Double-clicking it opens the **exact same UI** as the
Render deployment in its own desktop window — no browser tab, no console window.

The desktop app:
- Runs the existing Express server unchanged (same routes, views, features).
- Connects to the **same Supabase Postgres** for data.
- Connects to the **paid Apollo API** (already configured in-app) and sends email
  via **Gmail SMTP**.
- Lets the paid Render web service be decommissioned (running locally at home
  removes the SMTP-port block that forced the paid tier in the first place).

### Non-goals
- No change to the app's look, features, or existing routes/views.
- No installer, code signing, auto-update, or cross-platform builds (Windows,
  personal single-machine use only).
- No public tracking/unsubscribe URLs — those still require a public host and
  remain out of scope (documented limitation, unchanged from today).

## 2. Locked decisions

| Decision | Choice | Rationale |
|---|---|---|
| Packaging | Electron | User wants a true windowed desktop app (its own window, no browser/console). |
| Server execution | **In-process** (Electron `require`s and starts the server) | One process, one clean shutdown path, no extra Node binary to bundle. |
| Config bootstrap | `settings.env` file in `%APPDATA%\OutreachFlow\` | Holds values needed *before* the DB/login are reachable; always writable. |
| SMTP config | **In-app Settings page**, stored encrypted in Supabase | Day-to-day no text file; mirrors existing Apollo integration pattern. |
| Output | **Portable single `.exe`** (electron-builder `portable` target) | Matches "keep it on my desktop." |
| Port | **Dynamic free port** each launch | Avoids "port already in use." |
| Icon | **Generated** simple icon (`.ico`) | User opted for auto-generated. |
| Scope | Windows, personal, single machine | Per user. |

## 3. Architecture

```
OutreachFlow.exe (Electron)
├─ electron/main.js  (main process)
│   1. read %APPDATA%\OutreachFlow\settings.env  → process.env
│      (first run: create from template, open in Notepad, prompt, quit)
│   2. pick a free TCP port → process.env.PORT
│   3. require('../src/server') → await start()   [Express listens on localhost:PORT]
│   4. BrowserWindow → loadURL('http://localhost:PORT')
│   5. on quit → await stop() (closeDb, closeTransporter, server.close)
│
└─ existing app (reused as-is)
    src/**  views/**  public/**  node_modules/**
```

All existing dependencies are **pure JavaScript** (`pg`, `bcryptjs`, `nodemailer`,
`express`, `ejs`) — **no native modules**, so no native rebuild step is needed for
Electron packaging.

## 4. Component detail

### 4.1 Phase 1 — Electron wrapper, config file, packaging

**New files (under `email-campaign-tool/`):**

- `electron/main.js` — main process (see flow above). Responsibilities:
  - Resolve `settingsPath = path.join(app.getPath('userData'), 'settings.env')`.
  - **First-run**: if the file is missing, copy `electron/settings-template.env`
    to it, `shell.openPath()` it (opens in Notepad), show a dialog
    ("Fill in your settings and reopen OutreachFlow"), then `app.quit()`.
  - Load it into `process.env` (via `dotenv.config({ path: settingsPath })`)
    **before** requiring the server or `src/config`.
  - Find a free ephemeral port, set `process.env.PORT`, `NODE_ENV=production`
    (so winston logs to stdout, avoiding file-write in a packaged bundle).
  - `const { start, stop } = require('../src/server'); await start();`
  - Create `BrowserWindow` (icon set, sensible min size), `loadURL(localhost:PORT)`.
  - `setWindowOpenHandler` → external links open in the default browser.
  - On `window-all-closed` → `await stop()` then quit.
  - **Error surface**: if `start()` rejects (e.g. bad `DATABASE_URL`), show a
    dialog with the error message and a button to open `settings.env`.
- `electron/settings-template.env` — commented template written on first run.
- `electron/build/icon.ico` — generated app icon.

**Changed files:**

- `src/server.js`
  - Guard auto-start: only auto-run when launched directly —
    `if (require.main === module) { start().catch(...) }`.
  - Have `start()` return a promise that resolves on the `listen` callback
    (so Electron can await "ready" before loading the URL).
  - Extract the existing shutdown logic into an exported `stop()` (reused by
    `SIGTERM`/`SIGINT` and by Electron on quit).
  - `module.exports = { app, start, stop }`.
- `package.json`
  - Add devDeps: `electron`, `electron-builder`.
  - Set `"main": "electron/main.js"` (Electron's entry). `npm start` is
    unaffected — it runs `node src/server.js` by explicit path, ignoring `main`.
  - Add scripts: `"electron": "electron ."`, `"dist": "electron-builder --win portable"`.
  - Add `build` config: `appId`, `productName: "OutreachFlow"`,
    `win.target: portable`, `portable.artifactName: "OutreachFlow.exe"`,
    `files: [src, views, public, electron, package.json]`, `asar: true`.
  - Fallback noted: if asar breaks EJS/static reads in the smoke test, add
    `asarUnpack` for `views/**` and `public/**` (or `asar: false`).

**`settings.env` contents (bootstrap only):**
```
DATABASE_URL = <Supabase Session-pooler connection string, with password>
APP_SECRET   = <long random string — SET ONCE, NEVER CHANGE>
APP_EMAIL    = <your app login email>
APP_PASSWORD = <your app login password>
# Optional: BASE_URL, SMTP_* as initial fallback before you set SMTP in-app
```

> **APP_SECRET is the encryption key** for both the Apollo key and the SMTP
> credentials stored in Supabase. If it changes, previously stored secrets can no
> longer be decrypted and must be re-entered. The template states this loudly.

**Output of Phase 1:** a working `OutreachFlow.exe`. SMTP can already work via the
optional `SMTP_*` fallback lines in `settings.env`.

### 4.2 Phase 2 — In-app SMTP settings (DB-backed, encrypted)

**Storage** — new table in `src/db/schema.js` (idempotent DDL):
```sql
CREATE TABLE IF NOT EXISTS app_settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL DEFAULT '',
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
```
SMTP is stored under `key = 'smtp'` as an AES-256-GCM blob (reusing
`src/services/integrations/_crypto.js`).

**New service** `src/services/settings.js`:
- `getSmtpSettings()` → decrypt the `smtp` row → object (or `{}`).
- `saveSmtpSettings(obj)` → merge over existing (a blank password keeps the old
  one), encrypt, upsert.
- `getEffectiveSmtp()` → **DB settings layered over env** (`config.smtp`); DB wins
  for any provided field. Returns `{host, port, secure, user, pass, fromName, fromEmail}`.

**Mailer refactor** `src/services/mailer.js`:
- `getTransporter()` becomes async, built from `getEffectiveSmtp()`; cached.
- Add `reloadTransporter()` (closes the cached transporter so the next build
  re-reads settings) — called after a successful save.
- `sendEmail` / `verifyConnection` await `getTransporter()`; `from` defaults come
  from effective settings.
- `verifyConnection(overrides?)` can build a **temporary** transporter from unsaved
  form values, enabling "Test before Save."

**Routes** — new `src/routes/settings.js` (`authenticate` on all):
- `GET  /api/settings/smtp` → effective settings, password masked, plus
  `source: 'db' | 'env'`.
- `PUT  /api/settings/smtp` (`requirePermission('admin')`) → save → `reloadTransporter()`.
- `POST /api/settings/smtp/test` (`admin`) → verify effective or body-supplied creds.
- Mounted in `server.js`: `app.use('/api/settings', require('./routes/settings'))`.
- Existing `POST /api/auth/verify-smtp` kept working (delegates to effective settings).

**View** `views/settings.ejs`:
- Replace the read-only SMTP card with an editable Alpine form: From name, From
  email, Host (default `smtp.gmail.com`), Port (default `587`), User, Password
  (masked; blank = keep existing) + **Save** and **Test** buttons — styled like the
  Integrations screen. Loads current values via `GET /api/settings/smtp`.
- Keep the Gmail app-password / deliverability guidance card.
- The `/settings` route in `server.js` no longer needs to inject `smtp_*` from env
  (the page fetches them); keep `send_rate`, `tracking_domain`, etc.

**Apollo:** unchanged — already in Settings → Integrations, stored encrypted.

## 5. Data flow (send an email, desktop)

1. User double-clicks `OutreachFlow.exe`.
2. Electron loads `settings.env` → `process.env` → starts Express on a free port.
3. Window shows the UI; user logs in (`APP_EMAIL`/`APP_PASSWORD`).
4. Contacts/lists/templates load from **Supabase** (`DATABASE_URL`).
5. Apollo import uses the encrypted key from Supabase (Settings → Integrations).
6. "Send now" → mailer uses **effective SMTP** (DB settings from the in-app page,
   else env fallback) → Gmail sends → results written to Supabase.
7. Closing the window → graceful `stop()` (DB pool + SMTP pool closed).

## 6. Testing

- **Phase 1 (manual smoke):** `npm run dist` → launch `OutreachFlow.exe` on the
  desktop → first-run creates and opens `settings.env` → fill it → relaunch →
  window opens → login works → lists/contacts load from Supabase → Apollo "Test"
  in Integrations passes.
- **Phase 2:**
  - Unit: `test/settings.test.js` — encrypt/decrypt round-trip and the
    `getEffectiveSmtp` DB-over-env precedence (pure merge extracted for testability).
  - Manual: Settings → enter SMTP → **Test** (success) → **Save** → send a real
    test email → confirm receipt and a row in Supabase.
- Existing `node --test` suite must still pass.

## 7. Risks & mitigations

- **asar reads for `views`/`public`** — Electron patches `fs` for asar reads;
  verified in the smoke test. Fallback: `asarUnpack` those folders or `asar:false`.
- **Logs to disk in a packaged bundle** — avoided by `NODE_ENV=production`
  (winston → stdout); `server.js` already tolerates a failed `logs/` mkdir.
- **Native modules** — none present, so no `electron-rebuild` needed.
- **Port conflict** — dynamic free port removes it.
- **APP_SECRET rotation** — documented as set-once; changing it orphans stored
  secrets.

## 8. Build order

- **Phase 1** delivers a working desktop `.exe` (SMTP via `settings.env` fallback).
- **Phase 2** adds the in-app SMTP Settings page and DB storage.

Each phase is independently shippable and testable.
