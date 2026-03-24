# 03 — Cornersight Integration

## Overview

Cornersight is the signal capture layer. It monitors LinkedIn company pages and personal profiles, detecting every like and comment on their posts. This gives you a daily stream of warm leads — people who are already engaging with content relevant to your ICP.

**Plan:** $90/month for 10 monitors

---

## 1. What Cornersight Does

- Monitors up to 10 LinkedIn profiles/company pages
- Captures everyone who likes or comments on their posts
- Provides: person name, LinkedIn URL, which post they engaged with, comment text
- Fires a webhook with this data automatically (daily or real-time depending on plan)

---

## 2. Monitor Selection Strategy (10 Monitors)

### Criteria for Choosing Pages to Monitor

The best pages to monitor are ones where **your ICP is actively engaging**. For field services targeting:

| # | Monitor Target | Type | Why |
|---|---------------|------|-----|
| 1 | **Jobber** | Company Page | Massive field service audience, high engagement |
| 2 | **ServiceTitan** | Company Page | Enterprise field service, decision-maker engagement |
| 3 | **Cold IQ** | Personal Profile | Cold outreach community, service business owners |
| 4 | **Housecall Pro** | Company Page | Home service software, owner-level audience |
| 5 | **FieldEdge** | Company Page | HVAC/plumbing/electrical specific |
| 6 | **GoHighLevel** | Company Page | Agency + service business owners |
| 7 | **Tommy Mello** | Personal Profile | A1 Garage Door founder, huge trades following |
| 8 | **Adi Klevit** | Personal Profile | Business process consultant for trades |
| 9 | **Successware** | Company Page | HVAC/plumbing software |
| 10 | **BuildOps** | Company Page | Commercial contractor audience |

### How to Evaluate New Monitors

Before adding a monitor, check:
1. Does the page post at least 3x/week?
2. Do posts get 50+ engagements?
3. Are the people engaging decision-makers in field services?
4. Is the content relevant to your ICP's pain points?

### Rotating Monitors

Review monitor performance monthly:
- Which monitors produce the most ICP-fit leads?
- Which monitors produce leads that convert to replies?
- Drop low-performers and test new pages

---

## 3. Webhook Configuration

### Setup in Cornersight

1. Log into Cornersight dashboard
2. Go to Settings → Webhooks (or Integrations)
3. Add webhook URL: `https://your-instance.app.n8n.cloud/webhook/cornersight-inbound`
4. Set authentication header:
   - Header: `X-Webhook-Secret`
   - Value: `your-shared-secret-here`
5. Select events to fire on: All engagement events (likes + comments)
6. Set frequency: Real-time (preferred) or Daily batch

### Webhook Security

- Use a shared secret in the header for authentication
- n8n validates the header before processing
- Keep the webhook URL private (not in public code)
- Rotate the secret quarterly

---

## 4. Expected Webhook Payload

> **Important:** Confirm the exact payload format with Cornersight support. Below is the expected/normalized schema.

### Single Engagement Event

```json
{
  "event_type": "engagement",
  "person_name": "John Smith",
  "linkedin_url": "https://www.linkedin.com/in/johnsmith",
  "post_url": "https://www.linkedin.com/posts/jobber_field-service-tips-activity-123456789",
  "engagement_type": "comment",
  "comment_text": "This is exactly what we needed for our HVAC business!",
  "job_title": "CEO",
  "company": "Smith HVAC Services",
  "location": "Dallas, TX",
  "industry": "HVAC",
  "monitor_name": "Jobber",
  "timestamp": "2026-03-24T14:30:00Z"
}
```

### Batch Event (if Cornersight sends daily batches)

```json
{
  "event_type": "daily_batch",
  "monitor_name": "Jobber",
  "date": "2026-03-24",
  "engagements": [
    {
      "person_name": "John Smith",
      "linkedin_url": "https://www.linkedin.com/in/johnsmith",
      "post_url": "https://www.linkedin.com/posts/...",
      "engagement_type": "like",
      "comment_text": null,
      "job_title": "Owner",
      "company": "Smith Plumbing",
      "location": "Austin, TX",
      "industry": "Plumbing"
    },
    {
      "person_name": "Jane Doe",
      "linkedin_url": "https://www.linkedin.com/in/janedoe",
      "post_url": "https://www.linkedin.com/posts/...",
      "engagement_type": "comment",
      "comment_text": "Love this approach to scheduling.",
      "job_title": "VP Operations",
      "company": "Doe Electric",
      "location": "Phoenix, AZ",
      "industry": "Electrical"
    }
  ]
}
```

**If batch format:** Add a "Split In Batches" node in n8n after the webhook to process each engagement individually.

---

## 5. Data Fields Reference

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `person_name` | string | Yes | Full name of the person who engaged |
| `linkedin_url` | string | Yes | Their LinkedIn profile URL |
| `post_url` | string | Yes | The LinkedIn post they engaged with |
| `engagement_type` | string | Yes | "like" or "comment" |
| `comment_text` | string | No | What they wrote (null for likes) |
| `job_title` | string | Varies | Their LinkedIn job title (may need enrichment) |
| `company` | string | Varies | Their company name |
| `location` | string | Varies | Their location |
| `industry` | string | Varies | Their industry |
| `monitor_name` | string | Yes | Which monitor captured this (e.g., "Jobber") |
| `timestamp` | ISO 8601 | Yes | When the engagement happened |

### Fields That May Need Enrichment

Cornersight may not provide all fields (job_title, company, location, industry) for every lead. If missing:
- Lead Magic can often fill these from the LinkedIn URL
- Or use a separate LinkedIn profile enrichment API call before filtering

---

## 6. Handling Cornersight Limitations

### Missing Data
- If `job_title` is empty: Skip the title filter OR run LinkedIn enrichment first
- If `location` is empty: Default to "unknown" and flag for manual review
- If `industry` is empty: Try to infer from company name or job title

### Duplicate Leads
- Same person may engage on multiple posts across multiple monitors
- **Deduplication strategy:** Before processing, check if `linkedin_url` already exists in HubSpot
  - If yes: Update the contact with the new engagement data (don't create duplicate)
  - If no: Process as new lead

### Rate Limits
- If Cornersight sends a large daily batch (100+ leads), use n8n's "Split In Batches" with a 1-second delay between items to avoid hitting Lead Magic's rate limits

---

## 7. Testing the Cornersight Webhook

### Manual Test (before Cornersight is live)

Use n8n's webhook test mode or send a test payload via curl:

```bash
curl -X POST https://your-instance.app.n8n.cloud/webhook-test/cornersight-inbound \
  -H "Content-Type: application/json" \
  -H "X-Webhook-Secret: your-shared-secret-here" \
  -d '{
    "person_name": "Test User",
    "linkedin_url": "https://www.linkedin.com/in/testuser",
    "post_url": "https://www.linkedin.com/posts/test",
    "engagement_type": "comment",
    "comment_text": "Testing the pipeline",
    "job_title": "CEO",
    "company": "Test HVAC Co",
    "location": "Miami, FL",
    "industry": "HVAC",
    "monitor_name": "Jobber",
    "timestamp": "2026-03-24T14:30:00Z"
  }'
```

### Validation Checklist
- [ ] Webhook receives the payload in n8n
- [ ] Fields are correctly parsed and normalized
- [ ] Authentication header is validated
- [ ] Batch payloads are split into individual items
- [ ] Duplicate LinkedIn URLs are detected
