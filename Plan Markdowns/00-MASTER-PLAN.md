# 00 — Master Plan: Outbound Lead Generation Pipeline

## Executive Summary

This system is a fully automated outbound lead generation engine that captures warm LinkedIn engagement signals, filters them to your Ideal Customer Profile, enriches contacts with verified professional emails, pushes them into multi-step email sequences, and syncs every reply into HubSpot for your VA to manage.

**Pipeline:** Cornersight → n8n Cloud → Lead Magic → Plusvibe → HubSpot

**Supplementary AI Layer:** Supergrow AI (content) + Manus AI (research/scoring) + GenSpark AI (list gen/analysis)

**Target Volume:** 10,000 emails/month | ~333/day | 9 mailboxes across 3 domains

---

## System Architecture

```
                            LINKEDIN ECOSYSTEM
                                   |
            ┌──────────────────────┼──────────────────────┐
            |                      |                      |
    ┌───────▼───────┐    ┌────────▼────────┐    ┌────────▼────────┐
    | Supergrow AI  |    |   Cornersight   |    |  Target Pages   |
    | (Content      |    |  (10 Monitors)  |    | Jobber, Service |
    |  Creation)    |    |  $90/mo         |    | Titan, Cold IQ  |
    └───────┬───────┘    └────────┬────────┘    | + 7 more        |
            |                     |              └─────────────────┘
            | Posts content       | Webhook (daily feed)
            | to LinkedIn         |
            ▼                     ▼
    ┌─────────────────────────────────────────────────────────────┐
    |                      n8n Cloud                              |
    |  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌───────────┐  |
    |  | Webhook  |→ | ICP      |→ | Lead     |→ | Plusvibe   |  |
    |  | Receiver |  | Filter   |  | Magic    |  | Push      |  |
    |  └──────────┘  | (Title,  |  | (Email   |  | (Campaign |  |
    |                | Industry,|  | Enrich)  |  |  Add)     |  |
    |                | Location)|  └──────────┘  └───────────┘  |
    |                └──────────┘        |              |        |
    |                     |              |              |        |
    |              ┌──────▼──────┐       |       ┌──────▼─────┐ |
    |              | Manus AI    |       |       | HubSpot    | |
    |              | (Research + |       |       | (CRM Sync) | |
    |              |  Scoring)   |       |       └────────────┘ |
    |              └─────────────┘       |                      |
    |                                    |                      |
    |              ┌─────────────┐       |                      |
    |              | GenSpark AI |       |                      |
    |              | (List Gen + |◄──────┘                      |
    |              |  Analysis)  |                              |
    |              └─────────────┘                              |
    └───────────────────────────────────────────────────────────┘
                          |                    |
                          ▼                    ▼
                 ┌─────────────────┐  ┌────────────────┐
                 |    Plusvibe     |  |    HubSpot     |
                 | (9 Mailboxes)  |  | (VA Dashboard) |
                 | Warmup+Send    |  | Contact Mgmt   |
                 | Reply Tracking |  | Deal Pipeline  |
                 └────────┬───────┘  └────────▲───────┘
                          |                   |
                          | Reply webhook     |
                          └───────────────────┘
```

---

## Component Summary

| Component | Role | Cost/mo | Account |
|-----------|------|---------|---------|
| **Cornersight** | LinkedIn engagement monitoring (10 monitors) | $90 | cornersight.io |
| **n8n Cloud** | Workflow automation, filtering, routing | ~$20-50 | n8n.io |
| **Lead Magic** | Email enrichment from LinkedIn profiles | $99 | leadmagic.io |
| **Plusvibe** | Email sending, warmup, sequences, reply tracking | $77 | plusvibe.ai |
| **HubSpot** | CRM, contact management, VA handoff | Free-$50 | hubspot.com |
| **Supergrow AI** | LinkedIn content creation & scheduling | $19 | supergrow.ai |
| **Manus AI** | Prospect research & lead scoring | Varies | manus.im |
| **GenSpark AI** | Lead list generation & data analysis | Varies | genspark.ai |
| **Domains (x3)** | Outreach sending domains | ~$4 | registrar |
| **Google Workspace** | 9 mailboxes across 3 domains | ~$99 | workspace.google.com |

**Total estimated monthly cost: $460-$490/mo**

---

## Data Flow (Per Lead)

```
1. Someone likes/comments on a Jobber LinkedIn post
2. Cornersight detects engagement → fires webhook to n8n
3. n8n receives: {name, linkedin_url, post_url, engagement_type, comment_text}
4. n8n filters: Is this person CEO/Owner/VP in field services in the US?
   → NO: Drop (optionally log to Google Sheet)
   → YES: Continue
5. n8n calls Lead Magic API with LinkedIn profile → gets professional email
   → No email found: Log for manual review
   → Email found (confidence > 0.7): Continue
6. n8n pushes lead to Plusvibe campaign (auto-assigned based on source/segment)
7. n8n creates/updates HubSpot contact with all enrichment data
8. Plusvibe sends 3-step email sequence over 7-10 days
9. Lead replies → Plusvibe webhook → n8n → HubSpot status updated
10. VA sees replied lead in HubSpot → takes over conversation
```

---

## ICP Definition — All Field Services

**Job Titles (decision-makers):**
CEO, Owner, President, Co-Founder, VP of Operations, General Manager, Director of Operations, Operations Manager, COO, Managing Partner, Business Owner

**Industries:**
HVAC, Plumbing, Electrical, Roofing, General Contracting, Landscaping, Pest Control, Cleaning/Janitorial, Restoration, Moving, Property Management, Facilities Management, Fleet Services, Solar, Garage Doors, Painting, Flooring, Fencing, Tree Service, Pool Service

**Geography:** United States (all states)

---

## Document Index

| Doc | Title | What You'll Find |
|-----|-------|-----------------|
| [01](01-INFRASTRUCTURE-SETUP.md) | Infrastructure Setup | n8n Cloud, domains, DNS, mailboxes |
| [02](02-N8N-WORKFLOW-ARCHITECTURE.md) | n8n Workflow Architecture | Every node, every connection, data schemas |
| [03](03-CORNERSIGHT-INTEGRATION.md) | Cornersight Integration | 10 monitors, webhook setup, payload format |
| [04](04-LEAD-MAGIC-INTEGRATION.md) | Lead Magic Integration | API calls, credits, enrichment logic |
| [05](05-PLUSVIBE-INTEGRATION.md) | Plusvibe Integration | Campaigns, sequences, warmup, API |
| [06](06-HUBSPOT-INTEGRATION.md) | HubSpot Integration | Custom properties, lifecycle, VA workflow |
| [07](07-ICP-FILTERING-LOGIC.md) | ICP Filtering Logic | All filter rules, n8n node configs |
| [08](08-ERROR-HANDLING-PLAYBOOK.md) | Error Handling Playbook | Every failure mode and fix |
| [09](09-EMAIL-INFRASTRUCTURE.md) | Email Infrastructure | Domains, DNS records, warmup schedule |
| [10](10-MONITORING-MAINTENANCE.md) | Monitoring & Maintenance | Health checks, alerts, weekly ops |
| [11](11-SUPPLEMENTARY-TOOLS.md) | Supplementary AI Tools | Supergrow, Manus, GenSpark integration |
| [12](12-COST-BREAKDOWN.md) | Cost Breakdown | Monthly/annual projections |
| [13](13-TIMELINE-PHASED-ROLLOUT.md) | Timeline & Phased Rollout | Week-by-week implementation plan |

---

## Quick-Start Checklist

- [ ] Sign up: Cornersight, n8n Cloud, Lead Magic, Plusvibe
- [ ] Purchase 3 outreach domains
- [ ] Set up DNS (SPF, DKIM, DMARC) for each domain
- [ ] Create 9 Google Workspace mailboxes (3 per domain)
- [ ] Connect mailboxes to Plusvibe and start warmup
- [ ] Configure 10 Cornersight monitors
- [ ] Build n8n workflow (webhook → filter → enrich → push → sync)
- [ ] Create HubSpot custom properties
- [ ] Test full pipeline with mock data
- [ ] Go live after 21-day warmup completes
- [ ] Brief VA on HubSpot replied-lead workflow
- [ ] Set up Supergrow content cadence
- [ ] Configure Manus AI research workflows
- [ ] Set up GenSpark for list generation
