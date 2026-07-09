# OutreachFlow — Render Deploy Checklist

1. Push this repo to GitHub.
2. Render → New → Blueprint → connect the repo (root `render.yaml`).
   Render provisions the web service + managed Postgres.
3. Set the `sync:false` env vars in the Render dashboard:
   - APP_SECRET  (a strong random 32+ char string — NOT the dev default)
   - APP_EMAIL / APP_PASSWORD  (your dashboard login)
   - BASE_URL  (your Render URL, e.g. https://outreachflow.onrender.com)
   - SMTP_USER  (your Gmail), SMTP_PASS (16-char Google App Password),
     SMTP_FROM_EMAIL (= your Gmail), SMTP_FROM_NAME (your name)
   - TRACKING_DOMAIN  (= BASE_URL; only used if you turn tracking on)
   (SEND_RATE_PER_SECOND=1, SEND_RATE_PER_DAY=40, SMTP_HOST/PORT are already in render.yaml.)
4. Deploy. On first boot the schema auto-creates.
5. Run the seed once (optional) via a Render shell: `npm run db:seed`.
6. Log in, add your Apollo API key on Integrations, upload your resume on a campaign, send a test to yourself.
7. Enable 2FA + App Password on the Gmail account first, or SMTP auth will fail.
