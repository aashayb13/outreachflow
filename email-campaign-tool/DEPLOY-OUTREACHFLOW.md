# OutreachFlow — Deploy Checklist (all free)

App = **Render** free web service. Database = **Supabase** free Postgres.

> Two things to know about the free setup:
> - The Render web service **sleeps after 15 min of inactivity** (~1 min cold
>   start on wake). **"Send now" from the dashboard works fine.** Time-based
>   sending (scheduled campaigns / drip sequences) is **disabled in code** — see
>   the commented-out `startScheduler()` in `src/server.js`. Re-enable it later on
>   a paid always-on instance, or keep the app awake with a free uptime pinger
>   (UptimeRobot / cron-job.org) hitting `/health` every ~10 min.
> - The DB is **Supabase** (external, free, **persistent** — unlike Render's own
>   free Postgres it does not expire after 30 days).

## 1. Create the Supabase database
1. Sign up at [supabase.com](https://supabase.com) → **New project**. Choose a
   region near your Render region (Render defaults to US West / Oregon) and set a
   strong **database password** — save it.
2. Wait for provisioning to finish (~2 min).
3. Top bar → **Connect** → **Session pooler** tab. (Do NOT use "Direct
   connection" — it's IPv6-only and Render can't reach it.) Copy the URI:
   `postgresql://postgres.<ref>:[YOUR-PASSWORD]@aws-0-<region>.pooler.supabase.com:5432/postgres`
4. Replace `[YOUR-PASSWORD]` with your password from step 1. That full string is
   your `DATABASE_URL`.

## 2. Deploy on Render
1. Push this repo to GitHub.
2. Render → **New +** → **Blueprint** → connect the repo (it reads the root
   `render.yaml`). It provisions one free web service — no DB, since you're on
   Supabase.

## 3. Set the `sync: false` env vars in the Render dashboard
- `DATABASE_URL` — the Supabase Session-pooler string from step 1 (password filled in)
- `APP_SECRET` — a strong random 32+ char string (NOT the dev default). Encrypts
  stored integration keys + signs JWTs; don't rotate it later or saved API keys break.
- `APP_EMAIL` / `APP_PASSWORD` — your dashboard login
- `BASE_URL` — your Render URL, e.g. `https://outreachflow.onrender.com` (fill in after first deploy)
- `SMTP_USER` (your Gmail), `SMTP_PASS` (16-char Google App Password),
  `SMTP_FROM_EMAIL` (= your Gmail), `SMTP_FROM_NAME` (your name)
- `TRACKING_DOMAIN` — = `BASE_URL` (only used if you turn open/click tracking on)

(Baked-in, no entry needed: `SMTP_HOST=smtp.gmail.com`, `SMTP_PORT=587`, `SMTP_SECURE=false`.)

## 4. First boot & use
1. Deploy. On first boot the schema auto-creates in your Supabase DB (it also
   enables the `citext` extension automatically).
2. Now that you know your Render URL, set `BASE_URL` (and `TRACKING_DOMAIN`) to it
   → save → it redeploys. This makes unsubscribe links / tracking pixels resolve.
3. Enable 2FA + an **App Password** on the Gmail account first, or SMTP auth fails.
4. Log in → **Integrations**: add your Apollo API key → **Settings**: verify SMTP
   → send a test email to yourself.
5. *(Optional)* Seed sample data — run it **locally** against the same DB: put
   your Supabase `DATABASE_URL` in `email-campaign-tool/.env`, then `npm run db:seed`.
   (Render's free plan has no shell, so run seeds from your machine.)
