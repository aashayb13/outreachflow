# 02 — n8n Workflow Architecture

## Overview

This document details the complete n8n workflow: every node, every connection, data transformations, and branching logic. The workflow runs on n8n Cloud and processes Cornersight webhook events into enriched, campaign-ready leads.

---

## Main Workflow: Cornersight → Enrich → Campaign → CRM

### Visual Flow

```
[1. Webhook]
     |
[2. Set: Normalize]
     |
[3. Filter: Job Title]──── FAIL ──→ [Log: Filtered Out]
     |
   PASS
     |
[4. Filter: Location]──── FAIL ──→ [Log: Filtered Out]
     |
   PASS
     |
[5. Filter: Industry]──── FAIL ──→ [Log: Filtered Out]
     |
   PASS
     |
[6. HTTP: Lead Magic]
     |
[7. If: Email Found?]
     |              |
   YES             NO
     |              |
[8. If: Confidence  [12. Log: No Email]
    > 0.7?]
     |        |
   YES       NO
     |        |
[9. HTTP:    [12. Log: Low
 Plusvibe]    Confidence]
     |
[10. HubSpot:
  Create/Update]
     |
[11. Log: Success]
```

---

## Node-by-Node Configuration

### Node 1: Webhook (Trigger)

**Type:** Webhook
**Method:** POST
**Path:** `/cornersight-inbound`
**Authentication:** Header Auth
**Header name:** `X-Webhook-Secret`
**Header value:** (your secret — store in n8n credentials)

**Full URL (n8n Cloud):** `https://your-instance.app.n8n.cloud/webhook/cornersight-inbound`

**Expected incoming payload:**
```json
{
  "person_name": "John Smith",
  "linkedin_url": "https://www.linkedin.com/in/johnsmith",
  "post_url": "https://www.linkedin.com/posts/jobber_...",
  "engagement_type": "comment",
  "comment_text": "Great insights on fleet management!",
  "job_title": "CEO",
  "company": "Smith HVAC Services",
  "location": "Dallas, TX",
  "industry": "HVAC",
  "monitor_name": "Jobber",
  "timestamp": "2026-03-24T14:30:00Z"
}
```

> **Note:** Cornersight's exact payload format should be confirmed with their team. The Set node (Node 2) normalizes whatever format they send into the schema above.

---

### Node 2: Set (Normalize Fields)

**Type:** Set
**Purpose:** Standardize field names and extract first/last name

**Assignments:**
```
first_name     = {{ $json.person_name.split(' ')[0] }}
last_name      = {{ $json.person_name.split(' ').slice(1).join(' ') }}
linkedin_url   = {{ $json.linkedin_url }}
post_url       = {{ $json.post_url }}
engagement     = {{ $json.engagement_type }}
comment        = {{ $json.comment_text || '' }}
job_title      = {{ ($json.job_title || '').toLowerCase() }}
company        = {{ $json.company || '' }}
location       = {{ ($json.location || '').toLowerCase() }}
industry       = {{ ($json.industry || '').toLowerCase() }}
monitor        = {{ $json.monitor_name }}
received_at    = {{ $now.toISO() }}
```

**Keep only set fields:** Yes (clean payload)

---

### Node 3: Filter — Job Title (ICP)

**Type:** Filter
**Condition:** String → Contains (Any)

```
job_title contains any of:
  - ceo
  - owner
  - president
  - co-founder
  - cofounder
  - vp of operations
  - vice president
  - general manager
  - director of operations
  - operations manager
  - coo
  - managing partner
  - business owner
  - founder
```

**Behavior on fail:** Continue to "Log: Filtered Out" node

---

### Node 4: Filter — Location (US)

**Type:** Filter
**Condition:** String → Matches Regex

```
location matches regex: \b(AL|AK|AZ|AR|CA|CO|CT|DE|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY|alabama|alaska|arizona|arkansas|california|colorado|connecticut|delaware|florida|georgia|hawaii|idaho|illinois|indiana|iowa|kansas|kentucky|louisiana|maine|maryland|massachusetts|michigan|minnesota|mississippi|missouri|montana|nebraska|nevada|new hampshire|new jersey|new mexico|new york|north carolina|north dakota|ohio|oklahoma|oregon|pennsylvania|rhode island|south carolina|south dakota|tennessee|texas|utah|vermont|virginia|washington|west virginia|wisconsin|wyoming|united states|usa|u\.s\.)\b
```

**Case insensitive:** Yes

---

### Node 5: Filter — Industry (Field Services)

**Type:** Filter
**Condition:** String → Contains (Any)

```
industry contains any of:
  - hvac
  - plumbing
  - plumber
  - electrical
  - electrician
  - roofing
  - roofer
  - contracting
  - contractor
  - construction
  - landscaping
  - landscape
  - pest control
  - cleaning
  - janitorial
  - restoration
  - moving
  - property management
  - facilities
  - fleet
  - solar
  - garage door
  - painting
  - painter
  - flooring
  - fencing
  - tree service
  - pool service
  - home service
  - field service
  - trades
```

---

### Node 6: HTTP Request — Lead Magic (Email Enrichment)

**Type:** HTTP Request
**Method:** POST
**URL:** `https://api.leadmagic.io/v1/email/find`

**Headers:**
```
X-API-Key: {{ $credentials.leadMagicApiKey }}
Content-Type: application/json
```

**Body (JSON):**
```json
{
  "first_name": "{{ $json.first_name }}",
  "last_name": "{{ $json.last_name }}",
  "domain": "{{ $json.company.replace(/[^a-zA-Z0-9]/g, '').toLowerCase() }}.com"
}
```

**Alternative (if Lead Magic supports LinkedIn URL lookup):**
```json
{
  "linkedin_url": "{{ $json.linkedin_url }}"
}
```

**Response handling:**
- On success: Pass `email` and `confidence` to next node
- On error (4xx/5xx): Route to error handler
- **Retry on failure:** Yes, 2 retries with 5-second delay

**Rate limiting:** Add a Wait node (1 second) before this if processing batches to stay under 400 req/min.

---

### Node 7: If — Email Found?

**Type:** If
**Condition:**
```
{{ $json.email }} is not empty
AND
{{ $json.email }} is not equal to null
```

**True output:** → Node 8
**False output:** → Node 12 (Log: No Email Found)

---

### Node 8: If — Confidence Check

**Type:** If
**Condition:**
```
{{ $json.confidence }} is greater than or equal to 0.7
```

**True output:** → Node 9 (Plusvibe)
**False output:** → Node 12 (Log: Low Confidence)

---

### Node 9: HTTP Request — Plusvibe (Add to Campaign)

**Type:** HTTP Request
**Method:** POST
**URL:** `https://api.plusvibe.ai/v1/contacts` (confirm with Plusvibe docs)

**Headers:**
```
Authorization: Bearer {{ $credentials.plusvibeApiKey }}
Content-Type: application/json
X-Workspace-Id: {{ $credentials.plusvibeWorkspaceId }}
```

**Body (JSON):**
```json
{
  "email": "{{ $json.email }}",
  "first_name": "{{ $json.first_name }}",
  "last_name": "{{ $json.last_name }}",
  "company": "{{ $json.company }}",
  "linkedin_url": "{{ $json.linkedin_url }}",
  "campaign_id": "{{ $json.monitor === 'Jobber' ? 'CAMPAIGN_ID_JOBBER' : 'CAMPAIGN_ID_DEFAULT' }}",
  "custom_fields": {
    "engagement_type": "{{ $json.engagement }}",
    "post_url": "{{ $json.post_url }}",
    "comment_text": "{{ $json.comment }}"
  }
}
```

**Campaign routing logic:** Use a Switch node before this if you need to route to different campaigns based on the source monitor or industry.

---

### Node 10: HubSpot — Create/Update Contact

**Type:** HubSpot (built-in node)
**Operation:** Create or Update
**Resource:** Contact
**Lookup by:** Email

**Properties to set:**
```
email            = {{ $json.email }}
firstname        = {{ $json.first_name }}
lastname         = {{ $json.last_name }}
company          = {{ $json.company }}
jobtitle         = {{ $json.job_title }}
city             = {{ $json.location }}
lead_source      = "cornersight_linkedin"
linkedin_url     = {{ $json.linkedin_url }}
engaged_post_url = {{ $json.post_url }}
engagement_type  = {{ $json.engagement }}
comment_text     = {{ $json.comment }}
enrichment_confidence = {{ $json.confidence }}
plusvibe_campaign = {{ campaign name or ID }}
outreach_status  = "queued"
source_monitor   = {{ $json.monitor }}
```

**Duplicate handling:** "Update if exists" using email as the unique identifier.

---

### Node 11: Set — Log Success

**Type:** Set (or Google Sheets Append)
**Purpose:** Log successful lead processing for monitoring

**Log entry:**
```json
{
  "status": "success",
  "email": "{{ $json.email }}",
  "name": "{{ $json.first_name }} {{ $json.last_name }}",
  "campaign": "{{ campaign }}",
  "timestamp": "{{ $now.toISO() }}"
}
```

---

### Node 12: Set — Log Failures

**Type:** Google Sheets → Append Row
**Spreadsheet:** "Outbound Pipeline — Filtered/Failed Leads"

**Tabs:**
- `filtered_title` — Failed job title filter
- `filtered_location` — Failed location filter
- `filtered_industry` — Failed industry filter
- `no_email` — Lead Magic returned no email
- `low_confidence` — Email confidence below 0.7

**Row data:**
```
Name | LinkedIn URL | Job Title | Location | Industry | Reason | Timestamp
```

---

## Sub-Workflow: Reply Tracking (Plusvibe → HubSpot)

```
[Webhook: Plusvibe Reply]
     |
[Set: Extract reply data]
     |
[HubSpot: Update Contact]
  - outreach_status = "replied"
  - notes = reply text
     |
[If: Positive reply?]
     |           |
   YES          NO
     |           |
[HubSpot:    [HubSpot:
 Update       Update
 status =     status =
 "booked"]    "not_interested"]
```

### Plusvibe Reply Webhook
**Path:** `/plusvibe-reply`
**Expected payload:**
```json
{
  "email": "lead@company.com",
  "reply_text": "Yes, I'd love to chat...",
  "campaign_id": "...",
  "sequence_step": 2,
  "replied_at": "2026-03-24T14:30:00Z"
}
```

---

## Sub-Workflow: Static List Import (GenSpark/CSV)

```
[Manual Trigger or Schedule]
     |
[Google Sheets: Read rows from import sheet]
     |
[Split in Batches: 50 at a time]
     |
[HTTP Request: Lead Magic (email enrichment)]
     |
[If: Email found?]
     |
[HTTP Request: Plusvibe (add to static list campaign)]
     |
[HubSpot: Create/Update Contact]
  - lead_source = "static_list"
```

---

## n8n Credential Setup

| Credential Name | Type | Required Values |
|-----------------|------|-----------------|
| `leadMagicApiKey` | Header Auth | X-API-Key value |
| `plusvibeApiKey` | Header Auth | Bearer token |
| `plusvibeWorkspaceId` | Generic | Workspace ID |
| `hubspotOAuth` | OAuth2 | Client ID, Secret, Scopes |
| `googleSheetsOAuth` | OAuth2 | Google Cloud Project credentials |
| `cornersightWebhookSecret` | Header Auth | Shared secret for webhook validation |

---

## Execution Settings

| Setting | Value | Why |
|---------|-------|-----|
| Timeout | 120 seconds | Some API calls may be slow |
| Retry on fail | 2 retries, 5s delay | Handle transient API errors |
| Error workflow | Enabled → sends to error logging workflow | Never lose a lead |
| Save executions | Yes, keep for 30 days | Debugging and auditing |
| Timezone | America/New_York (or your TZ) | Accurate timestamps |
