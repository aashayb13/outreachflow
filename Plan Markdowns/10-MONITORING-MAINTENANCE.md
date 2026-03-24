# 10 — Monitoring & Maintenance

## Overview

An automated pipeline is only as good as its monitoring. Without visibility, issues go undetected and leads get lost. This document covers daily, weekly, and monthly operational tasks, health checks, alerts, and the dashboards you need.

---

## 1. Daily Operations (10 minutes/day)

### Morning Checklist

| Task | Where | What to Look For |
|------|-------|-----------------|
| Check n8n executions | n8n Cloud dashboard | Any failed executions in last 24h? |
| Check Plusvibe replies | Plusvibe unified inbox | New replies from leads? |
| Check warmup health | Plusvibe warmup dashboard | All 9 mailboxes warming? No flags? |
| Check bounce rate | Plusvibe campaign stats | Bounce rate < 3%? |
| Review HubSpot replied leads | HubSpot "Replied Leads" view | New leads for VA to handle? |
| Spot-check error log | Google Sheets error log | Any new critical errors? |

### Automated Daily Summary

Create an n8n workflow that runs at 8 AM daily:

```
[Schedule Trigger: 8:00 AM]
  → [n8n API: Get execution stats for last 24h]
  → [Google Sheets: Count new leads added today]
  → [HubSpot: Count contacts by outreach_status]
  → [Set: Compile summary]
  → [Email: Send daily report to admin]
```

**Daily Report Template:**

```
Pipeline Daily Report — {{ date }}

Leads received:     {{ webhook_count }}
ICP matches:        {{ icp_passed }} ({{ icp_rate }}%)
Emails enriched:    {{ enriched_count }}
Added to campaigns: {{ campaign_adds }}
Replies received:   {{ reply_count }}
Bounces:            {{ bounce_count }}

Errors: {{ error_count }}
Dead letter items:  {{ dead_letter_count }}

Credit balance (Lead Magic): {{ credits_remaining }}
```

---

## 2. Weekly Operations (30 minutes/week)

### Monday Review

| Task | Action |
|------|--------|
| **Campaign performance** | Check open rates, reply rates per campaign in Plusvibe |
| **Filter analysis** | Review Google Sheets filter logs — any good leads being dropped? |
| **Sequence optimization** | Check which email step gets the most replies — adjust timing? |
| **Dead letter queue** | Process any unresolved items from the week |
| **Monitor performance** | Which Cornersight monitors produced the most ICP-fit leads? |
| **Credit check** | Lead Magic credits remaining — on track for the month? |

### Weekly Metrics Dashboard

Track these week-over-week:

| Metric | Week 1 | Week 2 | Week 3 | Week 4 | Trend |
|--------|--------|--------|--------|--------|-------|
| Leads captured | — | — | — | — | — |
| ICP match rate | — | — | — | — | — |
| Enrichment rate | — | — | — | — | — |
| Email open rate | — | — | — | — | — |
| Reply rate | — | — | — | — | — |
| Bounce rate | — | — | — | — | — |
| Meetings booked | — | — | — | — | — |
| Pipeline errors | — | — | — | — | — |

---

## 3. Monthly Operations (1-2 hours/month)

### Month-End Review

| Task | Details |
|------|---------|
| **Full performance report** | Leads → Enriched → Contacted → Replied → Booked → Closed |
| **Cost analysis** | Actual spend vs budget; cost per lead, cost per reply |
| **Monitor rotation** | Drop low-performing Cornersight monitors, add new ones |
| **ICP refinement** | Adjust title/industry/location filters based on reply data |
| **Sequence A/B testing** | Review which subject lines/copy performed best |
| **Domain health check** | Check sender reputation for all 3 domains |
| **Compliance review** | Unsubscribe rate, spam complaints, bounces — all within limits? |
| **Credit reconciliation** | Lead Magic credits used vs expected |

### Sender Reputation Check

Use these tools monthly:

| Tool | Purpose |
|------|---------|
| Google Postmaster Tools | Domain reputation, spam rate, authentication |
| mail-tester.com | Send test email, get deliverability score |
| MXToolbox Blacklist Check | Check if any domain is blacklisted |
| Plusvibe warmup stats | Inbox placement rate per mailbox |

### Monthly KPIs

| KPI | Target | Formula |
|-----|--------|---------|
| Lead capture rate | 100+/day | Webhook events per day |
| ICP match rate | 10-20% | ICP passed / total captured |
| Enrichment rate | 60-70% | Emails found / enrichment attempts |
| Campaign add rate | 95%+ | Added to Plusvibe / emails found |
| Open rate | 40-60% | Opens / emails sent |
| Reply rate | 3-8% | Replies / emails sent |
| Positive reply rate | 1-3% | Interested replies / emails sent |
| Meeting book rate | 0.5-2% | Meetings / emails sent |
| Bounce rate | <3% | Bounces / emails sent |
| Cost per lead | <$0.05 | Monthly cost / total leads |
| Cost per reply | <$5 | Monthly cost / total replies |
| Cost per meeting | <$50 | Monthly cost / meetings booked |

---

## 4. Alert Configuration

### Critical Alerts (Immediate)

Set up these alerts via n8n workflows that send email/Slack notifications:

| Alert | Trigger | Action |
|-------|---------|--------|
| Pipeline down | 0 webhook executions in 12 hours | Email admin |
| Auth failure | Any 401 error from Lead Magic, Plusvibe, or HubSpot | Email admin |
| High bounce rate | Bounce rate > 5% in any campaign in last 24h | Email admin + pause campaign |
| Spam complaint | Any spam complaint detected | Email admin + review immediately |
| Credits low | Lead Magic credits < 1,000 | Email admin |
| Credits exhausted | Lead Magic credits = 0 | Email admin + pause enrichment |

### Warning Alerts (Daily Digest)

| Alert | Trigger |
|-------|---------|
| Low enrichment rate | <40% of leads getting emails in last 24h |
| Low ICP match rate | <5% of leads passing filters |
| High error rate | >10% of executions failing |
| Dead letter growing | >20 unprocessed items in dead letter queue |
| Warmup issues | Any mailbox warmup paused or flagged |

### n8n Alert Workflow

```
[Schedule: Every 1 hour]
  → [n8n API: Get execution stats]
  → [If: Error rate > threshold]
     → [Email: Send alert]
  → [HTTP: Check Lead Magic credit balance]
  → [If: Credits < 1000]
     → [Email: Send alert]
```

---

## 5. Maintenance Tasks

### Quarterly

- [ ] Rotate DKIM keys on all domains
- [ ] Rotate webhook secrets
- [ ] Rotate API keys (if services support it)
- [ ] Review and update ICP filter terms
- [ ] Audit HubSpot custom properties (still needed? any new ones?)
- [ ] Clean up Google Sheets logs (archive old data)

### As Needed

- [ ] Add new Cornersight monitors when pages are identified
- [ ] Create new Plusvibe campaigns for new segments
- [ ] Add new domains/mailboxes when scaling
- [ ] Update email sequences based on performance data
- [ ] Upgrade Lead Magic plan if credits consistently run out

---

## 6. Troubleshooting Quick Reference

| Symptom | Likely Cause | Fix |
|---------|-------------|-----|
| No leads coming in | Cornersight webhook broken | Check Cornersight dashboard, test webhook |
| All leads filtered out | Data format changed or filters too strict | Check filter logs, verify data format |
| No emails being found | Lead Magic issue or wrong field mapping | Test API directly, check field mapping |
| Emails going to spam | DNS misconfigured or reputation issue | Check SPF/DKIM/DMARC, review reputation |
| Low open rates | Subject lines or sender reputation | A/B test subjects, check warmup health |
| Low reply rates | Copy not resonating or wrong ICP | Review sequences, check ICP fit |
| High bounce rate | Bad email data or list quality | Pause, verify enrichment quality |
| n8n workflow errors | API changes or credential issues | Check execution logs, update as needed |
| HubSpot sync failing | OAuth expired or property missing | Re-auth, verify properties exist |
