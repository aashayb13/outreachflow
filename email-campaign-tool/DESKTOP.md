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
