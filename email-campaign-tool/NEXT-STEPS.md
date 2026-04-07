# NEXT STEPS — Render deployment

> Snapshot taken 2026-04-07 right after pushing the deployment-ready code to
> GitHub. Use this as a quick checklist when you come back. Full runbook lives
> in [DEPLOY.md](./DEPLOY.md).

## Where you are

- [x] Code is pushed to `main` on GitHub
- [x] `render.yaml` exists at the repo root (canonical Blueprint)
- [x] `email-campaign-tool/render.yaml` exists as the manual-deploy fallback
- [x] Production hardening done (`trust proxy`, stdout JSON logs, `npm ci`, safe dir creation)
- [x] DEPLOY.md written
- [ ] **YOU ARE HERE — create the Blueprint in Render**

---

## Step-by-step (resume here)

### 1. Create the Blueprint
1. Go to https://dashboard.render.com
2. **New +** → **Blueprint**
3. Connect GitHub if needed → select **`outbound-flow-marcus`** repo
4. Render auto-detects `render.yaml` and shows: 1 web service + 1 disk (1 GB)
5. Click **Apply**

The first build will start but won't finish until env vars are set.

### 2. Set required env vars
Service → **Environment** tab:

| Variable | Value |
|---|---|
| `APP_SECRET` | **Generate with `openssl rand -hex 32` — save it, this is your dashboard login password** |
| `BASE_URL` | leave blank for now |
| `TRACKING_DOMAIN` | leave blank for now |

SMTP fields can stay blank (you can deploy without email sending).

Click **Save Changes**.

### 3. Deploy
**Manual Deploy** → **Deploy latest commit**

Watch logs for:
```
Database loaded from: /data/campaigns.db
Database schema initialized
Email Campaign Tool — Running!
Scheduler started
```

### 4. First login
1. Click your service URL (top of the Render page, looks like `https://email-campaign-tool-xxxx.onrender.com`)
2. Redirected to `/login`
3. Enter your `APP_SECRET` as the password
4. You're in

### 5. Set BASE_URL + TRACKING_DOMAIN (post-deploy)
Now that you know your URL, go back to **Environment** and set:
- `BASE_URL` = `https://your-actual-url.onrender.com`
- `TRACKING_DOMAIN` = `https://your-actual-url.onrender.com`

Save → auto-redeploys. This makes unsubscribe links + tracking pixels work.

### 6. Verify all tabs load
Sidebar tabs to check:
- Dashboard, Campaigns, Contacts, Lists, Templates, Sequences
- **API Integrations** (should show 5 provider cards)
- Webhooks, Analytics, Settings

### 7. (Later) Add SMTP
When you have Gmail App Password / Mailgun / SendGrid creds:
- `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM_NAME`, `SMTP_FROM_EMAIL`
- Test from the Settings tab → Verify SMTP

### 8. (Later) Add integrations
- API Integrations tab → pick a provider → paste API key → Test → Search

---

## Critical things not to forget

- **`APP_SECRET` is your login password.** Save it the moment you generate it.
- **Don't rotate `APP_SECRET` casually** — it'll make all stored integration credentials un-decryptable. You'd have to re-enter every Apollo/Hunter/etc API key.
- **Don't scale to 2+ instances** — sql.js is single-instance only.
- **Persistent disk is at `/data`** — don't write anything important elsewhere; the rest of the filesystem is wiped on every deploy.

---

## If something breaks

| Symptom | Fix |
|---|---|
| 404 on a tab after deploy | Old build cached → Manual Deploy → Clear build cache & deploy |
| "Invalid password" on login | `APP_SECRET` doesn't match what's in Render env tab |
| Health check failing | Check logs — usually a missing env var or DB write error |
| Cookies not setting | Old build, redeploy |

Full troubleshooting in [DEPLOY.md](./DEPLOY.md#troubleshooting).
