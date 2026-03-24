# 06 — HubSpot Integration

## Overview

HubSpot is the CRM layer where all enriched leads land and where your VA manages conversations after someone replies. Every lead that passes through the pipeline gets a HubSpot contact with full enrichment data, engagement history, and outreach status tracking.

---

## 1. Connection Setup

### n8n ↔ HubSpot Authentication

**Method:** OAuth2 (recommended) or Private App

#### Option A: OAuth2 (Preferred)
1. In n8n Cloud → Credentials → Add New → HubSpot OAuth2
2. You'll be redirected to HubSpot to authorize
3. Grant the following scopes:
   - `crm.objects.contacts.read`
   - `crm.objects.contacts.write`
   - `crm.schemas.contacts.read`
   - `crm.objects.deals.read`
   - `crm.objects.deals.write`

#### Option B: Private App
1. HubSpot → Settings → Integrations → Private Apps → Create
2. Name: "n8n Outbound Pipeline"
3. Select scopes (same as above)
4. Copy the access token → add to n8n credentials

---

## 2. Custom Properties to Create

Before the pipeline goes live, create these custom properties in HubSpot:

### How to Create Custom Properties
HubSpot → Settings → Properties → Contact Properties → Create Property

| Property Name | Internal Name | Type | Group | Options |
|--------------|---------------|------|-------|---------|
| Lead Source | `lead_source` | Dropdown | Contact Info | cornersight_linkedin, static_list, website_visitor, manual |
| LinkedIn URL | `linkedin_url` | Single-line text | Contact Info | — |
| Engaged Post URL | `engaged_post_url` | Single-line text | Outbound Pipeline | — |
| Engagement Type | `engagement_type` | Dropdown | Outbound Pipeline | like, comment |
| Comment Text | `comment_text` | Multi-line text | Outbound Pipeline | — |
| Enrichment Confidence | `enrichment_confidence` | Number | Outbound Pipeline | — |
| Plusvibe Campaign | `plusvibe_campaign` | Single-line text | Outbound Pipeline | — |
| Outreach Status | `outreach_status` | Dropdown | Outbound Pipeline | queued, sent, opened, replied, booked, not_interested, bounced, unsubscribed |
| Manus Lead Score | `manus_lead_score` | Number | Outbound Pipeline | — |
| Source Monitor | `source_monitor` | Single-line text | Outbound Pipeline | — |
| First Outreach Date | `first_outreach_date` | Date | Outbound Pipeline | — |
| Reply Date | `reply_date` | Date | Outbound Pipeline | — |
| Pipeline Notes | `pipeline_notes` | Multi-line text | Outbound Pipeline | — |

### Property Group
Create a custom property group called **"Outbound Pipeline"** to keep these organized separately from standard HubSpot fields.

---

## 3. Contact Creation/Update Flow

### n8n HubSpot Node Configuration

**Node type:** HubSpot (built-in)
**Operation:** Create or Update
**Resource:** Contact
**Match by:** Email address

**Properties mapping:**

```
email              → {{ $json.email }}
firstname          → {{ $json.first_name }}
lastname           → {{ $json.last_name }}
company            → {{ $json.company }}
jobtitle           → {{ $json.job_title }}
city               → {{ $json.location }}
lead_source        → "cornersight_linkedin"
linkedin_url       → {{ $json.linkedin_url }}
engaged_post_url   → {{ $json.post_url }}
engagement_type    → {{ $json.engagement }}
comment_text       → {{ $json.comment }}
enrichment_confidence → {{ $json.confidence }}
plusvibe_campaign   → {{ campaign_name }}
outreach_status    → "queued"
source_monitor     → {{ $json.monitor }}
first_outreach_date → {{ $now.toISO() }}
lifecyclestage     → "lead"
```

### Duplicate Handling

HubSpot deduplicates by email address automatically. When using "Create or Update":
- **New email:** Creates new contact
- **Existing email:** Updates the contact with new data
- **Multiple engagements:** Each new engagement updates the fields (comment_text gets overwritten — consider appending to pipeline_notes instead)

---

## 4. Contact Lifecycle

### Status Flow

```
Cornersight engagement detected
     ↓
outreach_status: "queued"
lifecyclestage: "lead"
     ↓
Plusvibe sends first email
     ↓
outreach_status: "sent"
     ↓
Lead opens email
     ↓
outreach_status: "opened"
     ↓
Lead replies
     ↓
outreach_status: "replied"
     ↓ (VA takes over)
     ├── Meeting booked → outreach_status: "booked"
     │                     lifecyclestage: "salesqualifiedlead"
     │
     └── Not interested → outreach_status: "not_interested"
```

### Updating Status from Plusvibe Webhooks

The n8n reply handler workflow updates these fields:

**On reply:**
```
outreach_status = "replied"
reply_date = {{ $json.replied_at }}
pipeline_notes = "Reply: {{ $json.reply_text.substring(0, 500) }}"
```

**On bounce:**
```
outreach_status = "bounced"
pipeline_notes = "Bounced: {{ $json.bounce_type }}"
```

**On unsubscribe:**
```
outreach_status = "unsubscribed"
```

---

## 5. VA Dashboard & Workflow

### Creating a Saved View for VA

In HubSpot → Contacts → Create View:

**View: "Replied Leads — Ready for VA"**
- Filter: `outreach_status` is `replied`
- Sort by: `reply_date` (newest first)
- Columns: Name, Company, Job Title, Reply Date, Comment Text, Source Monitor

**View: "All Pipeline Leads"**
- Filter: `lead_source` is `cornersight_linkedin`
- Sort by: `first_outreach_date` (newest first)
- Columns: Name, Company, Outreach Status, Enrichment Confidence, Source Monitor

**View: "Booked Meetings"**
- Filter: `outreach_status` is `booked`
- Columns: Name, Company, Job Title, Reply Date

### VA Standard Operating Procedure

1. **Daily task:** Check "Replied Leads — Ready for VA" view
2. **For each replied lead:**
   - Read the reply text in `pipeline_notes`
   - Check their LinkedIn profile (link in `linkedin_url`)
   - Respond personally from your email (not Plusvibe)
   - If interested: Schedule a call, update status to "booked"
   - If not interested: Update status to "not_interested"
3. **Weekly task:** Review pipeline metrics in dashboard

---

## 6. HubSpot API Details

### Create Contact (v3 API)

```
POST https://api.hubapi.com/crm/v3/objects/contacts
Authorization: Bearer YOUR_ACCESS_TOKEN
Content-Type: application/json
```

**Body:**
```json
{
  "properties": {
    "email": "john@smithhvac.com",
    "firstname": "John",
    "lastname": "Smith",
    "company": "Smith HVAC Services",
    "jobtitle": "CEO",
    "city": "Dallas, TX",
    "lead_source": "cornersight_linkedin",
    "linkedin_url": "https://www.linkedin.com/in/johnsmith",
    "outreach_status": "queued",
    "lifecyclestage": "lead"
  }
}
```

### Update Contact by Email

```
PATCH https://api.hubapi.com/crm/v3/objects/contacts/{contactId}
Authorization: Bearer YOUR_ACCESS_TOKEN
Content-Type: application/json
```

Or use the email as identifier:
```
PATCH https://api.hubapi.com/crm/v3/objects/contacts/john@smithhvac.com?idProperty=email
```

### Search for Contact (Deduplication)

```
POST https://api.hubapi.com/crm/v3/objects/contacts/search
```

**Body:**
```json
{
  "filterGroups": [{
    "filters": [{
      "propertyName": "linkedin_url",
      "operator": "EQ",
      "value": "https://www.linkedin.com/in/johnsmith"
    }]
  }],
  "properties": ["email", "firstname", "lastname", "outreach_status"]
}
```

---

## 7. Reporting Dashboard

### Create a HubSpot Dashboard: "Outbound Pipeline"

**Widgets:**

1. **Pipeline Funnel**
   - Total leads captured → ICP filtered → Enriched → Sequenced → Replied → Booked

2. **Leads by Source Monitor**
   - Bar chart: Leads per Cornersight monitor

3. **Outreach Status Distribution**
   - Pie chart: queued, sent, opened, replied, booked, not_interested, bounced

4. **Reply Rate by Campaign**
   - Table: Campaign name, sends, replies, reply rate %

5. **Weekly Lead Volume**
   - Line chart: New leads per week over time

---

## 8. Compliance Notes

- **Do not send bulk cold emails from HubSpot itself** — use Plusvibe for cold outreach
- HubSpot is for CRM/tracking only in this pipeline
- Ensure contacts have `lead_source` set so you can distinguish outbound from inbound
- Honor unsubscribes: when Plusvibe reports an unsubscribe, mark the contact accordingly
- GDPR: If targeting EU leads, ensure consent mechanisms are in place (US-only ICP avoids this for now)

---

## 9. Testing

### Validation Checklist
- [ ] n8n can authenticate with HubSpot (OAuth2 or Private App)
- [ ] All custom properties created and visible in HubSpot
- [ ] "Outbound Pipeline" property group exists
- [ ] Test contact created via n8n with all fields populated
- [ ] Duplicate contact updates correctly (not duplicated)
- [ ] Status update from n8n (simulating reply webhook) works
- [ ] VA views created and showing correct data
- [ ] Dashboard widgets rendering correctly
