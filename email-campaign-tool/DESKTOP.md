# OutreachFlow Desktop (.exe)

Run OutreachFlow as a desktop app on Windows — same UI as the deployed version,
in its own window. Data stays in Supabase; Apollo and Gmail are reached over the
internet. Once this works you can delete the paid Render service.

## Build the installer

```bash
cd email-campaign-tool
npm install
npm run icon      # generates the app icon (one-time)
npm run dist      # builds dist/OutreachFlow-Setup.exe
```

> Requires Windows **Developer Mode** on (Settings → System → For developers) so
> electron-builder can extract its toolchain — otherwise the build fails with a
> "cannot create symbolic link" error.

Run **`dist/OutreachFlow-Setup.exe`** once. It installs per-user (no admin needed)
and creates an **OutreachFlow** shortcut on your Desktop and Start Menu. Launch it
from there — no `ffmpeg.dll`/DLL errors, because all files are installed in place
(unlike the old single-file "portable" build, which failed to unpack DLLs on some
machines).

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

That's it — the app opens straight to the dashboard with **no login**. (To turn a
login screen back on, set `DISABLE_AUTH=false` and add `APP_EMAIL`/`APP_PASSWORD`.)

## Connect Apollo (paid API)

1. Log in → click **API Integrations** in the sidebar (the `/integrations` page; it's a separate top-level item, not inside Settings).
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
