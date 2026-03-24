# 08 — Error Handling Playbook

## Overview

Every automated pipeline will encounter errors. This playbook documents every failure mode, its likely cause, how to detect it, and what to do about it. The goal: **never lose a lead** and **never let the pipeline silently break**.

---

## 1. Error Handling Philosophy

1. **Log everything** — failed leads go to a Google Sheet, not into the void
2. **Retry transient errors** — API timeouts and rate limits are temporary
3. **Alert on critical failures** — authentication errors and persistent failures need human attention
4. **Never duplicate outreach** — better to miss a lead than to email someone twice
5. **Degrade gracefully** — if one service is down, queue leads for later processing

---

## 2. Error Categories

### Category A: Webhook/Input Errors

| Error | Cause | Detection | Resolution |
|-------|-------|-----------|------------|
| **Webhook not firing** | Cornersight misconfigured or down | No executions in n8n for 24+ hours | Check Cornersight dashboard, re-verify webhook URL |
| **Invalid payload** | Cornersight changed their format | n8n Set node fails, error execution logged | Check execution log, update field mappings |
| **Auth failure** | Webhook secret mismatch | 401/403 in Cornersight logs | Re-sync the shared secret in both systems |
| **Empty payload** | Cornersight sent an empty body | Set node produces null values | Add a filter: if person_name is empty, skip |
| **Duplicate webhook** | Cornersight fires same event twice | Same linkedin_url processed twice | Deduplicate via HubSpot search before processing |

### Category B: Filter Errors

| Error | Cause | Detection | Resolution |
|-------|-------|-----------|------------|
| **All leads filtered out** | Filters too strict, or data format changed | Zero leads passing to Lead Magic for 24h+ | Review filter logs, check data format |
| **Wrong leads passing** | Filter terms too broad | Bad leads in Plusvibe campaigns | Tighten filter terms, add exclusions |
| **Regex failure** | Location regex doesn't match format | Leads with valid US location being dropped | Update regex to match new format |
| **Null field crash** | Filter receives null instead of string | n8n execution error | Add null checks before each filter |

### Category C: Lead Magic Errors

| Error | HTTP Code | Cause | Resolution |
|-------|-----------|-------|------------|
| **Invalid API key** | 401 | Key expired or wrong | Update key in n8n credentials |
| **Rate limit exceeded** | 429 | Too many requests | Enable retry with delay; add Wait node |
| **Server error** | 500 | Lead Magic outage | Retry 2x; if persistent, log lead for later |
| **Bad request** | 400 | Malformed name/domain | Log the input data; fix field mapping |
| **No email found** | 200 (null) | Person not in their database | Log to "no email" sheet; this is expected for ~30% |
| **Low confidence** | 200 (<0.7) | Email uncertain | Log to "low confidence" sheet; optionally verify separately |
| **Timeout** | — | Network issue or slow response | Retry 2x with 5s delay |
| **Credits exhausted** | 402/403 | Monthly credits used up | Alert admin; upgrade plan or wait for reset |

### Category D: Plusvibe Errors

| Error | HTTP Code | Cause | Resolution |
|-------|-----------|-------|------------|
| **Invalid API key** | 401 | Key expired or wrong | Update key in n8n credentials |
| **Rate limit** | 429 | >5 requests/second | Add delay between requests |
| **Duplicate contact** | 409/400 | Contact already in campaign | Skip (this is fine — don't re-add) |
| **Campaign not found** | 404 | Campaign ID wrong or deleted | Verify campaign IDs in n8n config |
| **Invalid email** | 400 | Email format invalid | This shouldn't happen after Lead Magic; log and skip |
| **Server error** | 500 | Plusvibe outage | Retry 2x; log lead for manual add later |
| **Workspace not found** | 403 | Wrong workspace ID | Verify workspace ID in credentials |

### Category E: HubSpot Errors

| Error | HTTP Code | Cause | Resolution |
|-------|-----------|-------|------------|
| **Auth expired** | 401 | OAuth token expired | Re-authenticate in n8n (OAuth2 should auto-refresh) |
| **Rate limit** | 429 | HubSpot API limits (100 calls/10s) | Add delay; use batch API for bulk |
| **Property not found** | 400 | Custom property doesn't exist | Create the missing property in HubSpot |
| **Invalid property value** | 400 | Value doesn't match dropdown options | Check dropdown option spelling matches exactly |
| **Duplicate contact** | 409 | Contact exists (shouldn't happen with "create or update") | Use upsert operation |
| **Scope missing** | 403 | OAuth scope not granted | Re-authorize with correct scopes |

---

## 3. n8n Error Workflow Configuration

### Global Error Handler

Create a separate workflow that catches all errors:

```
[Error Trigger]
     |
[Set: Extract error details]
     |
[Switch: Error severity]
     |
     ├── Critical (auth failures, credits exhausted)
     │   → [Email: Alert admin]
     │   → [Google Sheets: Log to "Critical Errors" tab]
     │
     ├── Transient (rate limits, timeouts)
     │   → [Google Sheets: Log to "Transient Errors" tab]
     │   → (Retry handled by node config)
     │
     └── Expected (no email found, filtered out)
         → [Google Sheets: Log to appropriate tab]
```

### Error Data to Log

For every error, log:

```json
{
  "timestamp": "2026-03-24T14:30:00Z",
  "workflow": "Cornersight Pipeline",
  "node": "Lead Magic API",
  "error_type": "rate_limit",
  "http_code": 429,
  "error_message": "Rate limit exceeded",
  "lead_name": "John Smith",
  "lead_linkedin": "https://linkedin.com/in/johnsmith",
  "lead_email": null,
  "input_data": { ... },
  "retry_count": 2,
  "resolved": false
}
```

---

## 4. Retry Configuration

### Per-Node Retry Settings

| Node | Retry on Fail | Max Retries | Wait Between | Retry Codes |
|------|--------------|-------------|--------------|-------------|
| Lead Magic HTTP | Yes | 2 | 10 seconds | 429, 500, 502, 503 |
| Plusvibe HTTP | Yes | 2 | 5 seconds | 429, 500, 502, 503 |
| HubSpot | Yes | 2 | 5 seconds | 429, 500, 502, 503 |

### Do NOT Retry

- 400 Bad Request (fix the data, don't retry the same bad request)
- 401 Unauthorized (fix credentials, don't retry)
- 404 Not Found (fix the endpoint/ID, don't retry)

---

## 5. Dead Letter Queue

For leads that fail all retries, create a "Dead Letter" Google Sheet:

**Sheet:** "Pipeline — Dead Letter Queue"
**Columns:** Timestamp, Lead Name, LinkedIn URL, Email (if known), Failed Node, Error Message, Status

**Process:**
1. Leads that exhaust all retries get logged here
2. Daily: Review the dead letter queue
3. Fix the issue, then manually re-process or mark as "skipped"

---

## 6. Monitoring Alerts

### Critical Alerts (Immediate — Email/Slack)

| Trigger | Alert |
|---------|-------|
| Auth failure on any API (401) | "CRITICAL: [Service] authentication failed — pipeline paused" |
| Lead Magic credits < 500 | "WARNING: Lead Magic credits running low (X remaining)" |
| Zero webhook events in 24h | "WARNING: No Cornersight data received in 24 hours" |
| Error rate > 20% in 1 hour | "ALERT: Pipeline error rate spiked to X%" |

### Daily Summary (Email)

- Leads received: X
- Leads passed ICP: X (Y%)
- Leads enriched: X
- Leads added to campaigns: X
- Errors: X (breakdown by type)
- Dead letter queue: X items

---

## 7. Recovery Procedures

### Scenario: Lead Magic is Down for 2 Hours

1. Incoming leads still processed through filters
2. Lead Magic calls fail and get logged to Dead Letter queue
3. When Lead Magic comes back:
   - Read Dead Letter queue
   - Re-process each lead through Lead Magic
   - Continue the pipeline from enrichment step

**n8n implementation:** Schedule a "Dead Letter Processor" workflow that runs every 6 hours, reads unresolved items from the Dead Letter sheet, and re-processes them.

### Scenario: Plusvibe API Changes

1. Existing contacts in Plusvibe are unaffected
2. New adds will fail with 400/404 errors
3. Leads get logged to Dead Letter queue with enriched data
4. Fix the API call format
5. Re-process Dead Letter items

### Scenario: HubSpot OAuth Expires

1. n8n will get 401 errors on HubSpot calls
2. Critical alert fires
3. Leads continue through Cornersight → filter → Lead Magic → Plusvibe (CRM sync fails)
4. Re-authenticate HubSpot in n8n
5. Run a batch sync of all leads added to Plusvibe since the auth failure

---

## 8. Error Testing Checklist

Before going live, test each error path:

- [ ] Send webhook with missing fields → handled gracefully
- [ ] Send webhook with wrong auth header → rejected
- [ ] Simulate Lead Magic 429 → retries and succeeds
- [ ] Simulate Lead Magic returning no email → logged correctly
- [ ] Send invalid campaign ID to Plusvibe → error caught and logged
- [ ] Disconnect HubSpot OAuth → error alert fires
- [ ] Send duplicate LinkedIn URL → deduplication works
- [ ] Send lead with empty job title → filter handles null
- [ ] Fill Dead Letter queue → re-processor picks them up
