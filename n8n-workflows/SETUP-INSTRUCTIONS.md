# n8n Workflow Import & Setup Instructions

## What's Included

| File | Workflow | Purpose |
|------|----------|---------|
| `01-main-pipeline.json` | Cornersight Outbound Pipeline | Main flow: webhook → filter → enrich → campaign → CRM |
| `02-reply-handler.json` | Plusvibe Reply Handler | Reply/bounce/unsub → HubSpot status update |
| `03-static-list-import.json` | Static List Import | Google Sheets → Lead Magic → Plusvibe → HubSpot |
| `04-daily-monitor.json` | Daily Pipeline Health Monitor | 8 AM daily report + alerts |

---

## Step 1: Import Workflows into n8n Cloud

1. Log into your n8n Cloud instance
2. Go to **Workflows** → click the **"..."** menu → **Import from File**
3. Select `01-main-pipeline.json` → Import
4. Repeat for `02-reply-handler.json`, `03-static-list-import.json`, `04-daily-monitor.json`

All four workflows will appear in your workflow list.

---

## Step 2: Create Credentials in n8n

Before the workflows will work, you need to create these credentials:

### 2a. Lead Magic API Key
1. Go to **Credentials** → **Add Credential** → **Header Auth**
2. Name: `Lead Magic API Key`
3. Header Name: `X-API-Key`
4. Header Value: (paste your Lead Magic API key from leadmagic.io dashboard)
5. Save

### 2b. Plusvibe API Key
1. **Add Credential** → **Header Auth**
2. Name: `Plusvibe API Key`
3. Header Name: `Authorization`
4. Header Value: `Bearer YOUR_PLUSVIBE_API_KEY`
5. Save

### 2c. HubSpot OAuth2
1. **Add Credential** → **HubSpot OAuth2 API**
2. Click **Connect** → authorize with your HubSpot account
3. Grant all requested scopes
4. Save

### 2d. Google Sheets OAuth2
1. **Add Credential** → **Google Sheets OAuth2 API**
2. Click **Connect** → authorize with your Google account
3. Save

---

## Step 3: Create the Google Sheet for Logging

1. Create a new Google Spreadsheet named: **"Outbound Pipeline Logs"**
2. Create these tabs (sheets):
   - `Success Log` — columns: status, email, name, company, monitor, campaign, confidence, timestamp
   - `Filtered Leads` — columns: status, reason, name, linkedin_url, job_title, company, location, industry, monitor, email, confidence, timestamp
   - `Reply Log` — columns: event_type, email, first_name, last_name, campaign_id, reply_text, sequence_step, event_time
3. Copy the Google Sheet URL

---

## Step 4: Replace Placeholder Values

Open each workflow in the n8n editor and replace these placeholders:

### In ALL workflows:
| Placeholder | Replace With |
|-------------|-------------|
| `REPLACE_WITH_GOOGLE_SHEET_URL` | Your Google Sheet URL from Step 3 |
| `REPLACE_WITH_GOOGLE_SHEETS_CREDENTIAL_ID` | Select your Google Sheets credential |
| `REPLACE_WITH_HUBSPOT_CREDENTIAL_ID` | Select your HubSpot OAuth2 credential |

### In `01-main-pipeline.json`:
| Placeholder | Replace With |
|-------------|-------------|
| `REPLACE_WITH_LEAD_MAGIC_CREDENTIAL_ID` | Select your Lead Magic credential |
| `REPLACE_WITH_PLUSVIBE_CREDENTIAL_ID` | Select your Plusvibe credential |
| `REPLACE_WITH_PLUSVIBE_WORKSPACE_ID` | Your Plusvibe workspace ID |
| `REPLACE_WITH_JOBBER_CAMPAIGN_ID` | Plusvibe campaign ID for Jobber leads |
| `REPLACE_WITH_SERVICETITAN_CAMPAIGN_ID` | Plusvibe campaign ID for ServiceTitan leads |
| `REPLACE_WITH_COLDIQ_CAMPAIGN_ID` | Plusvibe campaign ID for Cold IQ leads |
| `REPLACE_WITH_HOUSECALLPRO_CAMPAIGN_ID` | Plusvibe campaign ID for Housecall Pro leads |
| `REPLACE_WITH_FIELDEDGE_CAMPAIGN_ID` | Plusvibe campaign ID for FieldEdge leads |
| `REPLACE_WITH_GOHIGHLEVEL_CAMPAIGN_ID` | Plusvibe campaign ID for GoHighLevel leads |
| `REPLACE_WITH_TOMMYMELLO_CAMPAIGN_ID` | Plusvibe campaign ID for Tommy Mello leads |
| `REPLACE_WITH_ADIKLEVIT_CAMPAIGN_ID` | Plusvibe campaign ID for Adi Klevit leads |
| `REPLACE_WITH_SUCCESSWARE_CAMPAIGN_ID` | Plusvibe campaign ID for Successware leads |
| `REPLACE_WITH_BUILDOPS_CAMPAIGN_ID` | Plusvibe campaign ID for BuildOps leads |
| `REPLACE_WITH_DEFAULT_CAMPAIGN_ID` | Plusvibe default/catch-all campaign ID |

### In `02-reply-handler.json`:
| Placeholder | Replace With |
|-------------|-------------|
| `REPLACE_WITH_HUBSPOT_CREDENTIAL_ID` | Select your HubSpot OAuth2 credential |

### In `03-static-list-import.json`:
| Placeholder | Replace With |
|-------------|-------------|
| `REPLACE_WITH_IMPORT_SHEET_URL` | URL of your import Google Sheet |
| `REPLACE_WITH_STATIC_IMPORT_CAMPAIGN_ID` | Plusvibe campaign ID for static imports |

### In `04-daily-monitor.json`:
| Placeholder | Replace With |
|-------------|-------------|
| `REPLACE_WITH_ADMIN_EMAIL` | Your email address for reports/alerts |

---

## Step 5: Connect Credentials to Nodes

After importing, n8n may show credential warnings on nodes. For each node with a warning:
1. Double-click the node
2. In the **Credential** dropdown, select the matching credential you created
3. Save

---

## Step 6: Test the Main Pipeline

1. Open `Cornersight Outbound Pipeline` workflow
2. Click **Test Workflow** (this activates the webhook in test mode)
3. In a terminal, run this curl command (replace YOUR_N8N_URL):

```bash
curl -X POST https://YOUR_N8N_URL/webhook-test/cornersight-inbound \
  -H "Content-Type: application/json" \
  -H "X-Webhook-Secret: your-secret-here" \
  -d '{
    "person_name": "John Smith",
    "linkedin_url": "https://www.linkedin.com/in/john-smith-hvac",
    "post_url": "https://www.linkedin.com/posts/jobber_test",
    "engagement_type": "comment",
    "comment_text": "Great insights on fleet management!",
    "job_title": "CEO",
    "company": "Smith HVAC Services",
    "location": "Dallas, TX",
    "industry": "HVAC",
    "monitor_name": "Jobber",
    "timestamp": "2026-03-24T14:30:00Z"
  }'
```

4. Watch the execution in n8n — the lead should flow through all nodes
5. Check your Google Sheet for a new row in "Success Log"
6. Check HubSpot for the new contact

---

## Step 7: Activate Workflows

Once testing passes:

1. Open each workflow
2. Toggle the **Active** switch in the top-right corner
3. Active workflows:
   - `Cornersight Outbound Pipeline` → receives live webhooks
   - `Plusvibe Reply Handler` → receives reply/bounce events
   - `Static List Import` → runs daily at 9 AM
   - `Daily Pipeline Health Monitor` → runs daily at 8 AM

---

## Step 8: Configure Cornersight Webhook URL

1. Log into Cornersight
2. Go to Settings → Webhooks
3. Set the webhook URL to: `https://YOUR_N8N_URL/webhook/cornersight-inbound`
4. Set auth header: `X-Webhook-Secret: your-secret-here`
5. Enable the webhook

---

## Step 9: Configure Plusvibe Reply Webhook

1. Log into Plusvibe
2. Go to Settings → Webhooks
3. Set the webhook URL to: `https://YOUR_N8N_URL/webhook/plusvibe-reply`
4. Select events: Reply, Bounce, Unsubscribe
5. Enable the webhook

---

## Troubleshooting

| Issue | Fix |
|-------|-----|
| Webhook not receiving data | Check the URL is correct; check n8n workflow is **Active** |
| Credential error on nodes | Re-select the credential in the node settings |
| Filter dropping everything | Check the test payload format matches what Cornersight sends |
| Lead Magic returning errors | Verify API key; check credit balance |
| HubSpot property error | Create all custom properties first (see `templates/hubspot-properties.json`) |
| Google Sheets not logging | Re-authorize Google Sheets credential; check sheet URL and tab names |
