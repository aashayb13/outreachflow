# 12 — Cost Breakdown

## Overview

Complete cost analysis for running the outbound pipeline at ~10,000 emails/month. Broken down by component with monthly and annual projections.

---

## 1. Core Pipeline Costs

| Component | Monthly Cost | Annual Cost | Notes |
|-----------|-------------|------------|-------|
| **Cornersight** | $90 | $1,080 | 10 monitors, LinkedIn engagement tracking |
| **n8n Cloud** | $50 | $600 | Pro plan (~10K executions/mo) |
| **Lead Magic** | $99 | $1,188 | Essential plan (10K credits/mo) |
| **Plusvibe** | $77 | $924 | Advanced plan (webhooks + API) |
| **HubSpot** | $0-50 | $0-600 | Free tier works; Starter if needed |
| **Core Total** | **$316-366** | **$3,792-4,392** | |

---

## 2. Email Infrastructure Costs

| Component | Monthly Cost | Annual Cost | Notes |
|-----------|-------------|------------|-------|
| **Domains (x3)** | ~$4 | ~$45 | 3 domains @ ~$15/yr each |
| **Google Workspace** | $65 | $778 | 9 mailboxes @ $7.20/mo each (Business Starter) |
| **Infra Total** | **~$69** | **~$823** | |

---

## 3. Supplementary AI Tools

| Component | Monthly Cost | Annual Cost | Notes |
|-----------|-------------|------------|-------|
| **Supergrow AI** | $19 | $228 | LinkedIn content creation |
| **Manus AI** | ~$25-50 | ~$300-600 | Usage-based; estimate for moderate use |
| **GenSpark AI** | ~$20-30 | ~$240-360 | Usage-based; estimate for moderate use |
| **AI Total** | **~$64-99** | **~$768-1,188** | |

---

## 4. Total Monthly Cost

| Category | Low Estimate | High Estimate |
|----------|-------------|--------------|
| Core pipeline | $316 | $366 |
| Email infrastructure | $69 | $69 |
| Supplementary AI | $64 | $99 |
| **TOTAL** | **$449/mo** | **$534/mo** |

**Annual: $5,388 - $6,408**

---

## 5. Cost Per Lead Metrics

Based on 10,000 emails/month and expected conversion rates:

| Metric | Volume | Cost (at $490/mo avg) |
|--------|--------|----------------------|
| Emails sent/month | 10,000 | $0.049/email |
| Leads captured (pre-filter) | ~3,000-9,000 | $0.05-0.16/lead |
| ICP-fit leads (post-filter) | ~300-1,000 | $0.49-1.63/lead |
| Enriched leads (with email) | ~200-700 | $0.70-2.45/lead |
| Opens | ~4,000-6,000 | $0.08-0.12/open |
| Replies | ~300-800 | $0.61-1.63/reply |
| Positive replies | ~100-300 | $1.63-4.90/positive reply |
| Meetings booked | ~50-200 | $2.45-9.80/meeting |

### Comparison: What These Leads Would Cost Elsewhere

| Lead Source | Cost Per Meeting |
|-------------|-----------------|
| **This pipeline** | **$2.45-9.80** |
| LinkedIn Sales Navigator + manual outreach | $50-150 |
| Apollo.io + Instantly | $15-40 |
| Agency-managed outbound | $100-300 |
| Google Ads (service businesses) | $150-500 |
| Trade show leads | $200-1,000 |

---

## 6. Credit Usage Projections

### Lead Magic Credits

| Scenario | Leads to Enrich/Mo | Credits Used | Plan Needed |
|----------|-------------------|--------------|-------------|
| Conservative | 500 | ~350 (30% not_found free) | Essential ($99) |
| Moderate | 1,500 | ~1,050 | Essential ($99) |
| Aggressive | 3,000 | ~2,100 | Essential ($99) |
| Max throughput | 5,000 | ~3,500 | Essential ($99) |

**Verdict:** Essential plan (10K credits) provides massive headroom.

### n8n Executions

| Item | Executions/Day | Monthly |
|------|---------------|---------|
| Main workflow (per lead) | ~100-300 | ~3,000-9,000 |
| Reply handler | ~10-30 | ~300-900 |
| Static import runs | ~5-10 | ~150-300 |
| Monitoring workflows | ~5 | ~150 |
| **Total** | **~120-345** | **~3,600-10,350** |

**Verdict:** Pro plan (10K executions) is right-sized. May need upgrade if volume grows.

---

## 7. Scaling Costs

### To 20,000 emails/month

| Change | Additional Cost |
|--------|----------------|
| +3 domains | +$4/mo |
| +9 mailboxes (Google Workspace) | +$65/mo |
| Lead Magic upgrade to Growth (20K credits) | +$80/mo ($179 total) |
| n8n execution upgrade | +$0-30/mo |
| **Total additional** | **~$150-180/mo** |
| **New total** | **~$600-715/mo** |

### To 30,000 emails/month

| Change | Additional Cost |
|--------|----------------|
| +6 domains | +$8/mo |
| +18 mailboxes | +$130/mo |
| Lead Magic Ultimate (50K credits) | +$300/mo ($399 total) |
| n8n Enterprise or higher tier | +$50-100/mo |
| Plusvibe higher tier (if needed) | +$50-100/mo |
| **Total additional** | **~$540-640/mo** |
| **New total** | **~$990-1,175/mo** |

---

## 8. One-Time Setup Costs

If setting up internally (no external consultant):

| Item | Cost | Notes |
|------|------|-------|
| Domain registration (3 domains) | ~$45 | One-time, then ~$45/yr renewal |
| Google Workspace setup | $0 | Included in monthly subscription |
| n8n workflow build time | $0 (internal) | ~8-16 hours of setup work |
| Testing and QA | $0 (internal) | ~4-8 hours |
| **Total one-time** | **~$45** | |

### vs. External Setup

| Option | Cost | What's Included |
|--------|------|-----------------|
| Self-build (this guide) | ~$45 | Everything — you follow these docs |
| Marcus basic setup | $950 | Full flow + handoff session |
| Marcus full package | $1,800 | Full flow + website ID + static imports + signals + training |

---

## 9. ROI Projections

### Conservative Scenario
- Monthly cost: $490
- Meetings booked: 50/month
- Close rate: 10%
- Deals closed: 5/month
- Average deal value: $2,000
- **Monthly revenue: $10,000**
- **ROI: 1,941%**

### Moderate Scenario
- Monthly cost: $490
- Meetings booked: 100/month
- Close rate: 15%
- Deals closed: 15/month
- Average deal value: $3,000
- **Monthly revenue: $45,000**
- **ROI: 9,082%**

### Aggressive Scenario
- Monthly cost: $490
- Meetings booked: 200/month
- Close rate: 20%
- Deals closed: 40/month
- Average deal value: $5,000
- **Monthly revenue: $200,000**
- **ROI: 40,716%**

> **Note:** ROI depends heavily on your offer, close rate, and deal size. Even the conservative scenario shows strong returns.

---

## 10. Budget Optimization Tips

1. **Start with HubSpot free tier** — upgrade only if you need automation features
2. **Monitor Lead Magic credits** — if consistently under 3K/month, could downgrade
3. **Use n8n Cloud Starter** first — upgrade to Pro only if you exceed 2,500 executions
4. **Batch process where possible** — reduces n8n execution count
5. **Prioritize high-score leads** — better reply rates = more efficient credit usage
6. **Review monthly** — cut tools that aren't pulling their weight
