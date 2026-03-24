# 14 — High-Level Implementation Guide

## The Big Picture

You are building a fully automated machine that:
1. **Watches** LinkedIn pages where your ideal customers hang out
2. **Captures** everyone who likes or comments on those posts
3. **Filters** down to only decision-makers in field service companies in the US
4. **Finds** their professional email address
5. **Sends** them a personalized email sequence referencing what they engaged with
6. **Syncs** every reply into your CRM so your VA can close the deal

**This runs 24/7 without human intervention.** You set it up once, then maintain it with ~10 minutes/day of monitoring.

---

## System Map

```
┌──────────────────────────────────────────────────────────────────────────┐
│                        YOUR OUTBOUND ENGINE                             │
│                                                                         │
│  SIGNAL LAYER          PROCESSING LAYER         EXECUTION LAYER         │
│  ─────────────         ────────────────         ────────────────        │
│                                                                         │
│  ┌───────────┐         ┌───────────┐           ┌───────────┐           │
│  │Cornersight│───────→ │  n8n Cloud │──────────→│ Plusvibe   │           │
│  │(Monitors) │  webhook│(Filter +   │  API call │(Sequences)│           │
│  └───────────┘         │ Route)     │           └─────┬─────┘           │
│                        │            │                  │                │
│  ┌───────────┐         │     ┌──────┴──────┐          │ replies        │
│  │Supergrow  │         │     │ Lead Magic  │          │                │
│  │(Content)  │         │     │(Email Find) │          ▼                │
│  └───────────┘         │     └─────────────┘   ┌───────────┐           │
│                        │                        │ HubSpot   │           │
│  ┌───────────┐         │                        │(CRM + VA) │           │
│  │GenSpark   │─────────┘ (static lists)        └───────────┘           │
│  │(Lists)    │                                                         │
│  └───────────┘         ┌─────────────┐                                 │
│                        │ Manus AI    │                                  │
│  ┌───────────┐         │(Research +  │                                  │
│  │Gmail      │         │ Scoring)    │                                  │
│  │(9 boxes)  │         └─────────────┘                                  │
│  └───────────┘                                                          │
└──────────────────────────────────────────────────────────────────────────┘
```

---

## Implementation in 5 Steps

### Step 1: Build the Foundation (Days 1-3)

**Goal:** Get all accounts live, domains configured, and warmup running.

```
Action Items:
├── Buy 3 domains (e.g., yourbrand-systems.com, getyourbrand.com, yourbrandgroup.com)
├── Set up Google Workspace → create 9 mailboxes (3 per domain)
├── Configure DNS for all 3 domains
│   ├── SPF record → v=spf1 include:_spf.google.com ~all
│   ├── DKIM record → generate in Google Admin Console
│   └── DMARC record → v=DMARC1; p=none; rua=mailto:...
├── Sign up for: n8n Cloud, Cornersight, Lead Magic, Plusvibe
├── Connect all 9 mailboxes to Plusvibe
└── Start warmup on all 9 mailboxes ← THIS IS THE CLOCK
```

**Why warmup first?** It takes 21 days. Everything else fits within that window. Start the clock immediately.

---

### Step 2: Wire the Pipeline (Days 3-12)

**Goal:** Build the complete n8n workflow from webhook to CRM.

```
The n8n workflow chain:

[Cornersight Webhook]
       │
       ▼
[Normalize Data] ← Clean up field names, split first/last name
       │
       ▼
[Filter: Job Title] ← CEO, Owner, VP Ops, etc.
       │ (pass)
       ▼
[Filter: US Location] ← State abbreviations + full names
       │ (pass)
       ▼
[Filter: Field Services] ← HVAC, plumbing, electrical, etc.
       │ (pass)
       ▼
[Lead Magic API] ← POST /v1/email/find → returns email + confidence
       │
       ▼
[Check: Email found + confidence > 0.7?]
       │ (yes)
       ▼
[Plusvibe API] ← Add contact to campaign with personalization vars
       │
       ▼
[HubSpot] ← Create/update contact with all enrichment data
       │
       ▼
[Log: Success] ← Google Sheet for tracking
```

**Parallel tasks during this phase:**
- Configure 10 Cornersight monitors on target LinkedIn pages
- Create HubSpot custom properties (lead_source, linkedin_url, outreach_status, etc.)
- Build email sequences in Plusvibe (3-step warm outreach)
- Start Supergrow AI content calendar

---

### Step 3: Test Everything (Days 13-14)

**Goal:** Verify every path works before real leads flow through.

```
Test Matrix:
├── Happy path: Full lead → enriched → campaigned → CRM'd ✓
├── Filter: Lead with wrong title → dropped ✓
├── Filter: Lead outside US → dropped ✓
├── Filter: Lead in wrong industry → dropped ✓
├── Enrichment: Lead with no email found → logged ✓
├── Enrichment: Low confidence email → logged ✓
├── Error: Lead Magic rate limit → retried ✓
├── Error: Plusvibe API error → logged ✓
├── Error: HubSpot auth expired → alerted ✓
└── Duplicate: Same LinkedIn URL twice → deduped ✓
```

**How to test:** Use curl or n8n's test mode to send sample webhook payloads.

---

### Step 4: Go Live (Day 24-28)

**Goal:** Enable production traffic and ramp volume.

```
Day 24: Warmup complete → enable Cornersight production webhooks
Day 24-25: 25 emails/mailbox/day (225 total)
Day 26-27: 30 emails/mailbox/day (270 total)
Day 28+:   35-40 emails/mailbox/day (315-360 total) ← full production
```

**First-day monitoring:**
- Watch n8n execution dashboard in real-time
- Verify first real leads flow through correctly
- Check that first emails land in inbox (not spam)
- Watch for any unexpected errors

---

### Step 5: Optimize & Scale (Week 5+)

**Goal:** Improve performance based on data, add supplementary channels.

```
Optimization cycle:
├── Review: Which monitors produce the most replies?
├── Review: Which email sequence step gets the most opens/replies?
├── Review: What job titles/industries respond best?
├── Adjust: Swap out low-performing monitors
├── Adjust: A/B test subject lines and email copy
├── Adjust: Tighten or loosen ICP filters
├── Add: GenSpark static lists for volume boost
├── Add: Manus AI scoring for prioritization
└── Scale: Add domains + mailboxes for more volume
```

---

## What You Need Before You Start

### Accounts to Create

| Account | URL | Cost |
|---------|-----|------|
| n8n Cloud | n8n.io | $50/mo |
| Cornersight | cornersight.io | $90/mo |
| Lead Magic | leadmagic.io | $99/mo |
| Plusvibe | plusvibe.ai | $77/mo |
| Google Workspace | workspace.google.com | $65/mo (9 users) |
| Supergrow AI | supergrow.ai | $19/mo |
| Domain Registrar | namecheap.com | ~$4/mo |

### Information to Have Ready

| Item | Details |
|------|---------|
| 3 domain names to purchase | Variations of your brand |
| 10 LinkedIn pages to monitor | Company pages + personal profiles in your niche |
| Your ICP definition | Job titles, industries, locations |
| Email sequence copy | 3-step warm outreach template |
| HubSpot access | Admin-level access for custom properties |
| VA briefing doc | What to do when leads reply |

### Decisions to Make

| Decision | Options |
|----------|---------|
| Sending persona names | Real team members or dedicated personas? |
| Campaign segmentation | One campaign or per-monitor campaigns? |
| Reply handling | VA handles all replies or triage by quality? |
| Static lists | Which markets/industries to target first? |
| Content strategy | Who posts, what topics, what frequency? |

---

## Total Cost Summary

| Category | Monthly |
|----------|---------|
| Core pipeline (Cornersight + n8n + Lead Magic + Plusvibe) | ~$316 |
| Email infra (domains + Google Workspace) | ~$69 |
| AI tools (Supergrow + Manus + GenSpark) | ~$65-100 |
| **Total** | **~$450-490/mo** |

---

## What Success Looks Like

### Month 1 (Ramp-up)
- Pipeline fully operational
- 5,000-7,000 emails sent (partial month due to warmup)
- 150-400 replies
- 20-50 meetings booked

### Month 2 (Full Production)
- 10,000 emails sent
- 300-800 replies
- 50-200 meetings booked
- First optimizations applied

### Month 3+ (Optimized)
- Consistent 10K+ emails/month
- Reply rates improving with A/B testing
- Static lists supplementing Cornersight volume
- Considering scaling to 15-20K/month

---

## Detailed Reference Documents

Each component has its own in-depth document:

| Doc | For When You Need To... |
|-----|------------------------|
| [01-Infrastructure Setup](01-INFRASTRUCTURE-SETUP.md) | Set up n8n, domains, mailboxes, DNS |
| [02-n8n Workflow Architecture](02-N8N-WORKFLOW-ARCHITECTURE.md) | Build every node in the pipeline |
| [03-Cornersight Integration](03-CORNERSIGHT-INTEGRATION.md) | Configure monitors and webhooks |
| [04-Lead Magic Integration](04-LEAD-MAGIC-INTEGRATION.md) | Set up email enrichment API calls |
| [05-Plusvibe Integration](05-PLUSVIBE-INTEGRATION.md) | Configure campaigns, sequences, API |
| [06-HubSpot Integration](06-HUBSPOT-INTEGRATION.md) | Set up CRM properties and VA workflow |
| [07-ICP Filtering Logic](07-ICP-FILTERING-LOGIC.md) | Define and configure all filter rules |
| [08-Error Handling Playbook](08-ERROR-HANDLING-PLAYBOOK.md) | Handle every failure mode |
| [09-Email Infrastructure](09-EMAIL-INFRASTRUCTURE.md) | Domain DNS, mailbox setup, warmup schedule |
| [10-Monitoring & Maintenance](10-MONITORING-MAINTENANCE.md) | Daily/weekly/monthly ops |
| [11-Supplementary AI Tools](11-SUPPLEMENTARY-TOOLS.md) | Supergrow, Manus, GenSpark guides |
| [12-Cost Breakdown](12-COST-BREAKDOWN.md) | Full financial analysis |
| [13-Timeline & Rollout](13-TIMELINE-PHASED-ROLLOUT.md) | Week-by-week implementation plan |

---

## One Final Note

**Start warmup on Day 1.** That 21-day clock is the only thing you can't compress. Everything else — building the pipeline, configuring monitors, writing sequences — fits within that window. The sooner you start warmup, the sooner you're live.
