# 13 — Timeline & Phased Rollout

## Overview

The pipeline takes approximately 4 weeks from start to full production. The critical bottleneck is the 21-day email warmup period — everything else is built in parallel during that time.

---

## Master Timeline

```
Week 1: Infrastructure + Warmup Start
Week 2: Core Pipeline Build + Testing
Week 3: AI Tools + Advanced Features + Warmup Continues
Week 4: Go Live + Ramp Volume
Week 5+: Optimize + Scale
```

---

## Week 1: Foundation (Days 1-7)

### Day 1 — Account Setup

| Task | Time | Priority |
|------|------|----------|
| Sign up for n8n Cloud (Pro plan) | 15 min | Critical |
| Sign up for Cornersight ($90/mo) | 15 min | Critical |
| Sign up for Lead Magic ($99/mo, Essential) | 15 min | Critical |
| Sign up for Plusvibe ($77/mo, Advanced) | 15 min | Critical |
| Purchase 3 outreach domains | 30 min | Critical |
| Sign up for Supergrow AI ($19/mo) | 15 min | High |

**Day 1 deliverable:** All accounts created, domains purchased

### Day 2 — DNS & Mailboxes

| Task | Time | Priority |
|------|------|----------|
| Set up Google Workspace on all 3 domains | 1 hr | Critical |
| Create 9 mailboxes (3 per domain) | 1 hr | Critical |
| Configure SPF records (3 domains) | 30 min | Critical |
| Generate and configure DKIM (3 domains) | 30 min | Critical |
| Set up DMARC in monitoring mode (3 domains) | 15 min | Critical |
| Set up profile photos + signatures for all mailboxes | 1 hr | High |

**Day 2 deliverable:** All mailboxes live, DNS records configured

### Day 3 — Start Warmup + Cornersight

| Task | Time | Priority |
|------|------|----------|
| Connect all 9 mailboxes to Plusvibe | 45 min | Critical |
| Enable warmup on all 9 mailboxes | 15 min | Critical |
| Verify DNS (SPF/DKIM/DMARC) is propagated | 30 min | Critical |
| Configure 10 Cornersight monitors | 1 hr | Critical |
| Set up Cornersight webhook URL (pointing to n8n) | 30 min | Critical |

**Day 3 deliverable:** Warmup running, Cornersight monitoring live

### Days 4-7 — Begin Pipeline Build

| Task | Time | Priority |
|------|------|----------|
| Create n8n webhook endpoint | 30 min | Critical |
| Build Set node (normalize fields) | 30 min | Critical |
| Build ICP Filter nodes (title, location, industry) | 1.5 hr | Critical |
| Set up Lead Magic credentials in n8n | 15 min | Critical |
| Build Lead Magic HTTP Request node | 45 min | Critical |
| Test Lead Magic with sample data | 30 min | Critical |
| Begin Supergrow content calendar | 1 hr | High |

**Week 1 deliverable:** Warmup running (Day 3), Cornersight live, first half of pipeline built

---

## Week 2: Core Pipeline Complete (Days 8-14)

### Days 8-10 — Complete Pipeline

| Task | Time | Priority |
|------|------|----------|
| Set up Plusvibe API credentials in n8n | 15 min | Critical |
| Build Plusvibe HTTP Request node | 45 min | Critical |
| Create Plusvibe campaigns (per monitor) | 1 hr | Critical |
| Build email sequences in Plusvibe | 2 hr | Critical |
| Set up HubSpot OAuth2 in n8n | 30 min | Critical |
| Create HubSpot custom properties | 1 hr | Critical |
| Build HubSpot create/update node | 45 min | Critical |
| Wire full pipeline end-to-end | 1 hr | Critical |

### Days 11-12 — Error Handling & Logging

| Task | Time | Priority |
|------|------|----------|
| Create Google Sheets for logging (filtered, errors, dead letter) | 30 min | High |
| Build error branches in n8n workflow | 1.5 hr | High |
| Build Dead Letter Queue logging | 30 min | High |
| Set up n8n global error handler workflow | 45 min | High |
| Configure retry settings on all HTTP nodes | 30 min | High |

### Days 13-14 — Testing

| Task | Time | Priority |
|------|------|----------|
| Send test webhooks through full pipeline | 1 hr | Critical |
| Test each filter with pass and fail cases | 1 hr | Critical |
| Test Lead Magic with real LinkedIn profiles | 30 min | Critical |
| Verify Plusvibe receives test contacts | 30 min | Critical |
| Verify HubSpot contacts created correctly | 30 min | Critical |
| Test error paths (no email, bad data, rate limit) | 1 hr | High |
| Fix any issues found during testing | 1-3 hr | Critical |

**Week 2 deliverable:** Full pipeline built, tested, and ready (waiting on warmup)

---

## Week 3: AI Integration + Polish (Days 15-21)

### Days 15-17 — Reply Handler + AI Tools

| Task | Time | Priority |
|------|------|----------|
| Set up Plusvibe reply webhook in n8n | 45 min | High |
| Build reply handler workflow (Plusvibe → HubSpot) | 1.5 hr | High |
| Set up Supergrow AI content calendar (3-5 posts/week) | 1.5 hr | High |
| First batch of LinkedIn content ready | 2 hr | High |
| Set up GenSpark AI account | 30 min | Medium |
| Build first static list with GenSpark | 1 hr | Medium |

### Days 18-19 — Static Import Workflow

| Task | Time | Priority |
|------|------|----------|
| Build n8n static import sub-workflow | 1.5 hr | Medium |
| Create Google Sheets import template | 30 min | Medium |
| Test static import with sample list | 45 min | Medium |
| Process first GenSpark list through pipeline | 1 hr | Medium |

### Days 20-21 — Monitoring & Alerts

| Task | Time | Priority |
|------|------|----------|
| Build daily summary email workflow | 1 hr | High |
| Set up critical alert triggers | 1 hr | High |
| Create HubSpot "Replied Leads" view for VA | 30 min | High |
| Create HubSpot reporting dashboard | 1 hr | Medium |
| Set up Manus AI for manual prospect research | 30 min | Medium |
| Verify warmup is healthy across all mailboxes | 30 min | Critical |

**Week 3 deliverable:** AI tools configured, monitoring in place, warmup nearing completion

---

## Week 4: Go Live & Ramp (Days 22-28)

### Day 22-23 — Pre-Launch

| Task | Time | Priority |
|------|------|----------|
| Final warmup health check (all 9 mailboxes) | 30 min | Critical |
| Send test emails to seed accounts (check inbox placement) | 30 min | Critical |
| Verify DMARC reports are clean | 15 min | High |
| Mail-Tester score check (target 9/10+) | 30 min | High |
| Upgrade DMARC to p=quarantine | 15 min | High |
| Final pipeline walkthrough (end-to-end test) | 1 hr | Critical |

### Day 24 — Launch Day

| Task | Time | Priority |
|------|------|----------|
| Enable Cornersight production webhooks | 15 min | Critical |
| Set Plusvibe sending limit to 25/mailbox/day | 15 min | Critical |
| Monitor first batch of real leads through pipeline | 1 hr | Critical |
| Verify first emails land in inbox | 30 min | Critical |
| Watch for any errors in real-time | 1 hr | Critical |

### Days 25-28 — Ramp Volume

| Day | Per Mailbox | Total/Day | Notes |
|-----|-----------|-----------|-------|
| Day 24-25 | 25 | 225 | Initial launch |
| Day 26-27 | 30 | 270 | First ramp |
| Day 28 | 35 | 315 | Second ramp |

**Week 4 deliverable:** Pipeline live, emails sending, first replies coming in

---

## Week 5+: Optimize & Scale

### Day 29-35 — Full Production

| Task | Priority |
|------|----------|
| Ramp to 40 emails/mailbox/day (360/day total) | Critical |
| Brief VA on HubSpot workflow | Critical |
| VA begins handling replied leads | Critical |
| First weekly performance review | High |
| Adjust ICP filters based on initial data | High |
| Optimize email sequences based on open/reply rates | High |
| Upgrade DMARC to p=reject | Medium |
| Begin regular Supergrow content publishing | High |

### Month 2 — Optimization

| Task | Priority |
|------|----------|
| Full month-end performance review | High |
| Rotate underperforming Cornersight monitors | Medium |
| A/B test email subject lines | Medium |
| Process first GenSpark static lists at scale | Medium |
| Implement Manus AI scoring (if API available) | Low |
| Consider adding domains/mailboxes for volume growth | Low |

---

## Critical Path

The minimum path to sending first real outreach:

```
Day 1:  Buy domains + create mailboxes
Day 2:  Configure DNS + connect to Plusvibe
Day 3:  Start warmup
Days 3-14: Build pipeline (parallel with warmup)
Day 24: Warmup complete → GO LIVE
```

**The warmup period is the critical path.** Everything else fits within those 21 days.

---

## Risk Mitigation

| Risk | Impact | Mitigation |
|------|--------|-----------|
| Warmup takes longer than 21 days | Delays launch by 1-2 weeks | Start warmup Day 1; monitor daily |
| Cornersight payload format unexpected | Pipeline needs rework | Test with real webhook before building filters |
| Lead Magic returns low match rate | Fewer leads entering campaigns | Have GenSpark static lists as backup volume |
| Plusvibe API not well-documented | Integration takes longer | Reach out to Plusvibe support early; use Zapier bridge if needed |
| HubSpot OAuth issues | CRM sync fails | Use Private App as backup auth method |
| Domain gets blacklisted | Emails go to spam | 3-domain strategy means 2 others still work; investigate and remediate |

---

## Time Investment Summary

| Phase | Hours | Calendar Days |
|-------|-------|--------------|
| Account setup & DNS | 4-6 hrs | Days 1-2 |
| Pipeline build | 12-16 hrs | Days 3-12 |
| Testing & debugging | 4-8 hrs | Days 13-14 |
| AI tools & monitoring | 6-10 hrs | Days 15-21 |
| Launch & ramp | 4-6 hrs | Days 22-28 |
| **Total** | **30-46 hrs** | **28 days** |

Most of the calendar time is the warmup period. Actual hands-on work is ~30-46 hours spread across 4 weeks.
