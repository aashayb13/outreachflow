# 11 — Supplementary AI Tools

## Overview

The core pipeline (Cornersight → n8n → Lead Magic → Plusvibe → HubSpot) handles the automated flow. The supplementary AI tools add three layers on top:

1. **Supergrow AI** — Creates the LinkedIn content that generates the engagements Cornersight captures
2. **Manus AI** — Deep prospect research and lead scoring for higher-quality outreach
3. **GenSpark AI** — Lead list generation and data analysis for static imports and market intelligence

---

## 1. Supergrow AI — LinkedIn Content Engine

### Role in the Pipeline

Supergrow AI **feeds the top of the funnel**. The more engaging content appears on the LinkedIn pages you monitor, the more people like and comment, the more warm leads Cornersight captures.

```
Supergrow AI creates content
  → Content gets posted to LinkedIn
  → People engage (likes/comments)
  → Cornersight captures engagements
  → Pipeline processes leads
```

### What Supergrow Does

| Feature | How It Helps |
|---------|-------------|
| **AI Post Generator** | Creates LinkedIn posts from prompts, articles, or topics |
| **Content DNA** | Learns your tone, vocabulary, and expertise for consistent voice |
| **Carousel Maker** | Creates swipeable visual posts (high engagement format) |
| **Auto-Scheduling** | Posts at peak engagement times automatically |
| **Post Scoring** | Rates post quality before publishing |
| **First Comment Automation** | Auto-posts a comment to spark discussions |

### Setup

1. **Sign up** at supergrow.ai ($19/month)
2. **Connect LinkedIn account(s)** — Connect the profiles that post to the pages you're monitoring
3. **Configure Content DNA:**
   - Input your brand voice, key topics, and expertise areas
   - Feed it 10-20 of your best-performing past posts
   - Set tone: professional but conversational
4. **Set up content calendar:**
   - 3-5 posts/week per connected profile
   - Mix of: industry insights, pain points, tips, case studies, questions
   - Focus on topics that resonate with field service decision-makers

### Content Strategy for Maximum Engagement

**Post types that generate the most engagement:**

| Type | Example | Why It Works |
|------|---------|-------------|
| **Pain point posts** | "The #1 reason HVAC companies lose techs isn't pay..." | Decision-makers relate and comment |
| **Hot takes** | "ServiceTitan isn't the right fit for every contractor" | Provokes discussion |
| **Questions** | "Owners: What's the one thing you'd automate first?" | Directly asks for comments |
| **Data/stats** | "67% of plumbing companies don't track job profitability" | Attracts shares and "true" comments |
| **Carousels** | "5 things I learned running a $5M roofing company" | High save rate, swipe engagement |
| **Personal stories** | "I almost quit my HVAC business in year 2. Here's what changed." | Emotional connection |

### Content Calendar Template

| Day | Post Type | Topic Area | Monitor Page |
|-----|-----------|-----------|-------------|
| Monday | Pain point | Scheduling/dispatch | Jobber |
| Tuesday | Carousel | Growth tips | ServiceTitan |
| Wednesday | Question | Team management | HousecallPro |
| Thursday | Hot take | Industry trend | General |
| Friday | Story/Case study | Client success | General |

### Integration with Pipeline

Supergrow doesn't directly integrate with n8n. Its value is **indirect**:
- More/better content → More engagement → More Cornersight captures → More leads

**Tracking Supergrow's impact:**
- Track which Cornersight monitors produce the most leads
- Compare lead volume before and after consistent content cadence
- Map Plusvibe reply rates to content topics (are leads from certain topics more responsive?)

---

## 2. Manus AI — Prospect Research & Scoring

### Role in the Pipeline

Manus AI adds **intelligence** to the pipeline. Instead of treating every ICP-fit lead equally, Manus researches each prospect and scores them so you can prioritize outreach and personalize better.

```
Lead passes ICP filters
  → Manus AI researches the company and person
  → Returns: company size, revenue estimate, tech stack, pain points, lead score
  → Score stored in HubSpot (manus_lead_score)
  → High-score leads get priority in Plusvibe sequences
```

### What Manus AI Does

| Capability | Application |
|-----------|------------|
| **Company profiling** | Revenue estimate, employee count, tech stack, service area |
| **Prospect research** | LinkedIn activity, content they engage with, pain points |
| **Lead scoring** | Score 0-100 based on fit, intent, and accessibility |
| **BANT qualification** | Budget, Authority, Need, Timeline assessment |
| **Competitive intel** | What tools/services they currently use |

### Integration Options

#### Option A: Manual Research (Start Here)

Use Manus AI manually for high-value leads:
1. VA identifies replied leads in HubSpot
2. Before responding, VA runs Manus research on the lead
3. Manus provides company intel and talking points
4. VA uses this for a more informed response

#### Option B: Automated Research via n8n (Advanced)

Add a Manus AI step to the n8n workflow:

```
[After Lead Magic enrichment]
  → [HTTP Request: Manus AI — research company]
  → [Set: Extract lead score + company data]
  → [HubSpot: Update contact with score + intel]
  → [Switch: Score > 70?]
    → High priority: Fast-track campaign (send immediately)
    → Standard: Normal campaign (queue for next day)
```

**Note:** This depends on Manus AI having an API. If it's a web-based tool only, stick with Option A.

### Lead Scoring Model

| Factor | Points | Data Source |
|--------|--------|------------|
| Company size: 5-50 employees | +20 | Manus research |
| Company size: 50-200 | +15 | Manus research |
| Revenue: $1M-$10M | +20 | Manus research |
| Uses field service software (Jobber, ServiceTitan, etc.) | +15 | Manus research |
| Active on LinkedIn (posts/comments regularly) | +10 | Cornersight data |
| Commented (vs just liked) | +10 | Cornersight data |
| Comment mentions a pain point | +10 | NLP analysis |
| Located in top 20 metro areas | +5 | Location data |
| Multiple engagements across monitors | +15 | Deduplication check |

**Score tiers:**
- **80-100:** Hot lead — personalized, fast-tracked sequence
- **60-79:** Warm lead — standard sequence with personalization
- **40-59:** Cool lead — standard sequence
- **Below 40:** Low priority — still enters sequence but no special treatment

---

## 3. GenSpark AI — Lead List Generation & Analysis

### Role in the Pipeline

GenSpark AI handles **static list generation** — building targeted lead lists from scratch that can be imported into the pipeline alongside the live Cornersight signals.

```
GenSpark generates lead list (e.g., "HVAC companies in Texas with 10-50 employees")
  → Exported as CSV/spreadsheet
  → Uploaded to Google Sheets
  → n8n "Static Import" workflow processes the list
  → Lead Magic enriches → Plusvibe campaigns → HubSpot
```

### What GenSpark Does

| Capability | Application |
|-----------|------------|
| **Lead list generation** | Create targeted lists by industry, location, size, etc. |
| **Data analysis** | Analyze campaign performance data for optimization |
| **Lead capture apps** | Build landing pages/lead magnets that feed into the pipeline |
| **Spreadsheet generation** | Structured lead data with scores and categories |
| **Outreach templates** | Generate personalized email templates at scale |

### Use Case 1: Static List Import

**Scenario:** You want to target all HVAC company owners in the Dallas-Fort Worth area.

1. **Prompt GenSpark:**
   ```
   Generate a list of HVAC company owners in the Dallas-Fort Worth, Texas area.
   Include: company name, owner name, city, estimated employee count,
   estimated revenue, website URL, LinkedIn URL if available.
   Focus on companies with 5-100 employees.
   ```

2. **GenSpark returns:** Structured spreadsheet with ~50-200 leads

3. **Upload to Google Sheets:** "Static Import — DFW HVAC"

4. **n8n Static Import workflow processes the list:**
   ```
   [Schedule: Run once when sheet is populated]
     → [Google Sheets: Read all rows]
     → [Split In Batches: 50 at a time]
     → [HTTP Request: Lead Magic (enrich with email)]
     → [If: Email found?]
       → [HTTP Request: Plusvibe (add to "Static-Import" campaign)]
       → [HubSpot: Create contact with lead_source = "static_list"]
   ```

### Use Case 2: Campaign Performance Analysis

**Scenario:** After 1 month of running, analyze what's working.

1. **Export data from:**
   - Plusvibe: Campaign metrics (opens, replies, bounces per sequence)
   - HubSpot: Lead pipeline data (status, source, monitor)
   - Google Sheets: Filter logs

2. **Prompt GenSpark:**
   ```
   Analyze this campaign data. Tell me:
   - Which Cornersight monitor produces the highest reply rate?
   - Which email sequence step gets the most replies?
   - Which industries have the highest engagement?
   - What job titles respond most?
   - What's our cost per meeting booked?
   Provide actionable recommendations for optimization.
   ```

3. **GenSpark returns:** Analysis with charts, insights, and specific recommendations

### Use Case 3: Lead Capture Apps

**Scenario:** Build a quick landing page that captures leads into the pipeline.

1. **Prompt GenSpark:** "Build a simple lead capture page for field service businesses interested in [your offering]"
2. **GenSpark generates:** A functional landing page with form
3. **Connect form submissions** to n8n via webhook
4. **Process through the same pipeline** (skip Cornersight, enter at Lead Magic enrichment)

---

## 4. Integration Architecture (All AI Tools)

```
                    ┌─────────────────┐
                    | Supergrow AI    |
                    | (Content)       |
                    └────────┬────────┘
                             | Posts to LinkedIn
                             ▼
                    ┌─────────────────┐
                    | LinkedIn Pages  |←─── People engage
                    └────────┬────────┘
                             | Cornersight captures
                             ▼
┌─────────────┐     ┌─────────────────┐     ┌─────────────────┐
| GenSpark AI |     |    n8n Cloud    |     |   Manus AI      |
| (List Gen)  |────→| (Processing)   |────→| (Research +     |
└─────────────┘     └────────┬────────┘     |  Scoring)       |
  Static lists               |              └─────────────────┘
  feed in here               ▼
                    ┌─────────────────┐
                    | Lead Magic +    |
                    | Plusvibe +      |
                    | HubSpot        |
                    └─────────────────┘
```

---

## 5. Priority & Sequencing

Don't try to set up all three AI tools at once. Prioritize:

| Priority | Tool | When | Why |
|----------|------|------|-----|
| 1 (Day 3) | **Supergrow AI** | During warmup period | Start creating content immediately — engagement takes time to build |
| 2 (Day 10) | **GenSpark AI** | After core pipeline tested | Import static lists to supplement Cornersight volume |
| 3 (Day 15) | **Manus AI** | After first replies come in | Use research to improve response quality and scoring |

---

## 6. Cost Summary

| Tool | Monthly Cost | Annual Cost |
|------|-------------|------------|
| Supergrow AI | $19/mo | $228/yr |
| Manus AI | Varies (usage-based) | ~$100-300/yr estimated |
| GenSpark AI | Varies (usage-based) | ~$100-200/yr estimated |
| **Total supplementary** | **~$40-80/mo** | **~$430-730/yr** |
