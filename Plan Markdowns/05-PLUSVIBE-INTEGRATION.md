# 05 — Plusvibe Integration

## Overview

Plusvibe is the campaign execution engine. It handles mailbox warmup, multi-step email sequences, sending volume management, reply tracking, and inbox rotation. Once a lead is enriched by Lead Magic, n8n pushes it into Plusvibe where it enters an automated outreach sequence.

**Plan:** $77/month (Advanced plan recommended for webhook + API access)
**API docs:** developer.plusvibe.ai

---

## 1. What Plusvibe Handles

| Capability | Description |
|-----------|-------------|
| **Mailbox Warmup** | Automated warmup across all connected inboxes |
| **Inbox Rotation** | Distributes sends across 9 mailboxes automatically |
| **Sequences** | Multi-step email campaigns with delays |
| **Reply Detection** | Automatically detects and labels replies |
| **AI Personalization** | AI-generated first lines and variable substitution |
| **Unified Inbox** | All replies in one view with AI-powered tagging |
| **Webhooks** | Fire events on reply, bounce, open (Advanced plan) |
| **API** | Programmatic contact add, campaign management |

---

## 2. Account Setup

### Initial Configuration

1. **Sign up** at plusvibe.ai → Select Advanced plan ($77/mo)
2. **Connect mailboxes:** Add all 9 Google Workspace accounts
   - Settings → Mailboxes → Add Account → Google OAuth
   - Repeat for each of the 9 mailboxes
3. **Enable warmup** on every mailbox immediately (see Email Infrastructure doc)
4. **Set sending limits:**
   - Per mailbox: 40 emails/day (outreach) + 15/day (warmup)
   - Global daily max: 360 outreach emails/day
5. **Configure custom tracking domain** for each outreach domain
6. **Set timezone** to match your business hours

### Mailbox Configuration Checklist

For each of the 9 mailboxes:
- [ ] Connected via Google OAuth
- [ ] Warmup enabled
- [ ] Daily sending limit set (40 outreach + 15 warmup)
- [ ] Signature configured (matches Google Workspace signature)
- [ ] Custom tracking domain verified
- [ ] Reply detection enabled

---

## 3. Campaign Structure

### Campaign Organization

Create separate campaigns based on the signal source:

| Campaign Name | Source | Trigger |
|--------------|--------|---------|
| `CS-Jobber-Warm` | Cornersight → Jobber monitor | LinkedIn engagement |
| `CS-ServiceTitan-Warm` | Cornersight → ServiceTitan monitor | LinkedIn engagement |
| `CS-ColdIQ-Warm` | Cornersight → Cold IQ monitor | LinkedIn engagement |
| `CS-General-Warm` | Cornersight → Other monitors | LinkedIn engagement |
| `Static-Import` | GenSpark / CSV imports | Manual or scheduled |

### Why Separate Campaigns?

- Different opening lines referencing the specific post/company they engaged with
- Track which source produces the best reply rates
- A/B test messaging by source
- Easier to pause/adjust one source without affecting others

---

## 4. Email Sequences

### Sequence 1: Warm LinkedIn Engagement (Primary)

**Used for:** Leads captured via Cornersight (they engaged with a LinkedIn post)

**Step 1 — Day 0 (Immediate):**
```
Subject: {{first_name}}, saw your comment on {{monitor_name}}'s post

Hey {{first_name}},

Noticed you engaged with {{monitor_name}}'s recent post about {{topic}}
{{#if comment_text}}— loved your take: "{{comment_text_snippet}}"{{/if}}.

We work with {{industry}} companies like {{company}} to [value prop].

Would it make sense to connect for 15 minutes this week?

Best,
{{sender_name}}
```

**Step 2 — Day 3 (Follow-up):**
```
Subject: Re: {{first_name}}, saw your comment on {{monitor_name}}'s post

Hey {{first_name}},

Just bumping this up — I know things get busy running a {{industry}} operation.

Quick question: are you currently [specific pain point relevant to ICP]?

If so, I think we could help. If not, no worries at all.

{{sender_name}}
```

**Step 3 — Day 7 (Breakup):**
```
Subject: Re: {{first_name}}, saw your comment on {{monitor_name}}'s post

{{first_name}},

Wanted to send one last note. If the timing isn't right, totally understand.

If things change down the road, here's my calendar link: [link]

Either way, keep crushing it at {{company}}.

{{sender_name}}
```

### Sequence Variables

| Variable | Source | Description |
|----------|--------|-------------|
| `{{first_name}}` | Lead Magic / Cornersight | First name |
| `{{company}}` | Lead Magic / Cornersight | Company name |
| `{{industry}}` | ICP filter / Lead Magic | Industry |
| `{{monitor_name}}` | Cornersight | Which page they engaged on |
| `{{comment_text_snippet}}` | Cornersight | First 50 chars of their comment |
| `{{topic}}` | Derived from post URL | What the post was about |
| `{{sender_name}}` | Plusvibe mailbox | Sending persona name |

---

## 5. API Integration

### Authentication

All API requests require:
```
Authorization: Bearer YOUR_API_KEY
X-Workspace-Id: YOUR_WORKSPACE_ID
Content-Type: application/json
```

**Rate limit:** 5 requests/second

### Add Contact to Campaign

```
POST https://api.plusvibe.ai/v1/contacts
```

**Body:**
```json
{
  "email": "john@smithhvac.com",
  "first_name": "John",
  "last_name": "Smith",
  "company_name": "Smith HVAC Services",
  "campaign_id": "cam_abc123",
  "custom_variables": {
    "linkedin_url": "https://www.linkedin.com/in/johnsmith",
    "engagement_type": "comment",
    "post_url": "https://www.linkedin.com/posts/...",
    "comment_text": "Great insights!",
    "monitor_name": "Jobber",
    "industry": "HVAC"
  }
}
```

**Response — Success:**
```json
{
  "id": "con_xyz789",
  "email": "john@smithhvac.com",
  "status": "queued",
  "campaign_id": "cam_abc123",
  "created_at": "2026-03-24T14:30:00Z"
}
```

**Response — Duplicate:**
```json
{
  "error": "Contact already exists in this campaign",
  "email": "john@smithhvac.com"
}
```

### n8n HTTP Request Node Configuration

**Node type:** HTTP Request
**Method:** POST
**URL:** `https://api.plusvibe.ai/v1/contacts`

**Headers:**
```
Authorization: Bearer {{ $credentials.plusvibeApiKey }}
X-Workspace-Id: {{ $credentials.plusvibeWorkspaceId }}
Content-Type: application/json
```

**Body (JSON):**
```json
{
  "email": "={{ $json.email }}",
  "first_name": "={{ $json.first_name }}",
  "last_name": "={{ $json.last_name }}",
  "company_name": "={{ $json.company }}",
  "campaign_id": "={{ $json.monitor === 'Jobber' ? 'cam_JOBBER_ID' : $json.monitor === 'ServiceTitan' ? 'cam_ST_ID' : 'cam_DEFAULT_ID' }}",
  "custom_variables": {
    "linkedin_url": "={{ $json.linkedin_url }}",
    "engagement_type": "={{ $json.engagement }}",
    "post_url": "={{ $json.post_url }}",
    "comment_text": "={{ $json.comment }}",
    "monitor_name": "={{ $json.monitor }}",
    "industry": "={{ $json.industry }}"
  }
}
```

---

## 6. Webhook Integration (Reply Tracking)

### Setup in Plusvibe

1. Go to Settings → Webhooks
2. Add webhook URL: `https://your-instance.app.n8n.cloud/webhook/plusvibe-reply`
3. Select events: Reply received, Bounce detected, Unsubscribe
4. Set authentication header

### Webhook Events

**Reply Received:**
```json
{
  "event": "reply",
  "contact": {
    "email": "john@smithhvac.com",
    "first_name": "John",
    "last_name": "Smith"
  },
  "campaign_id": "cam_abc123",
  "reply_text": "Yes, I'd love to learn more. Can we talk Thursday?",
  "sequence_step": 1,
  "replied_at": "2026-03-25T10:15:00Z"
}
```

**Bounce Detected:**
```json
{
  "event": "bounce",
  "contact": {
    "email": "john@smithhvac.com"
  },
  "campaign_id": "cam_abc123",
  "bounce_type": "hard",
  "bounced_at": "2026-03-24T15:00:00Z"
}
```

### n8n Reply Handler Workflow

```
[Webhook: /plusvibe-reply]
  → [Switch: event type]
    → "reply": [HubSpot: Update contact status = "replied"]
                → [HubSpot: Add note with reply text]
    → "bounce": [HubSpot: Update contact status = "bounced"]
                 → [Alert: Notify admin of hard bounce]
    → "unsubscribe": [HubSpot: Update contact status = "unsubscribed"]
```

---

## 7. Campaign Performance Tracking

### Key Metrics to Monitor

| Metric | Target | Red Flag |
|--------|--------|----------|
| Open rate | 40-60% | < 25% |
| Reply rate | 3-8% | < 1% |
| Bounce rate | < 3% | > 5% |
| Unsubscribe rate | < 1% | > 2% |
| Spam complaint rate | < 0.1% | > 0.3% |

### Review Cadence

- **Daily:** Check reply inbox, monitor bounce rate
- **Weekly:** Review open/reply rates per campaign, adjust messaging
- **Monthly:** Full campaign performance review, A/B test results, monitor rotation decisions

---

## 8. Sending Schedule

### Optimal Send Times (Field Services ICP)

- **Best days:** Tuesday, Wednesday, Thursday
- **Best times:** 7:00-9:00 AM and 1:00-3:00 PM (recipient's local time)
- **Avoid:** Monday morning (inbox overload), Friday afternoon (checked out)

### Daily Volume Ramp

| Week | Per Mailbox/Day | Total/Day | Monthly Rate |
|------|----------------|-----------|--------------|
| Week 1 (post-warmup) | 25 | 225 | 6,750 |
| Week 2 | 30 | 270 | 8,100 |
| Week 3 | 35 | 315 | 9,450 |
| Week 4+ | 40 | 360 | 10,800 |

---

## 9. Testing

### Validation Checklist
- [ ] All 9 mailboxes connected and verified in Plusvibe
- [ ] Warmup running on all mailboxes
- [ ] Test campaign created with test sequence
- [ ] API call successfully adds a contact to test campaign
- [ ] Contact receives first email within expected timeframe
- [ ] Reply webhook fires and reaches n8n
- [ ] Bounce webhook fires correctly
- [ ] Custom variables render correctly in email templates
- [ ] Campaign routing logic works (different campaigns per monitor)
