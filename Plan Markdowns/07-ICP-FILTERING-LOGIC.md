# 07 — ICP Filtering Logic

## Overview

The ICP (Ideal Customer Profile) filter is the gatekeeper of the pipeline. It ensures only leads that match your target audience move forward to enrichment and outreach. Every lead from Cornersight passes through three sequential filters: Job Title, Location, and Industry. Only leads that pass ALL three continue.

**ICP Scope:** All field services — decision-makers at US-based service companies

---

## 1. Filter Architecture

```
Incoming Lead
     |
[Filter 1: Job Title] ──── FAIL → Log & Drop
     |
   PASS
     |
[Filter 2: Location]  ──── FAIL → Log & Drop
     |
   PASS
     |
[Filter 3: Industry]  ──── FAIL → Log & Drop
     |
   PASS
     |
Continue to Lead Magic enrichment
```

**Why three separate filters (not one)?**
- Easier to debug (see exactly WHERE a lead was filtered out)
- Easier to adjust (loosen one filter without touching others)
- Better logging (track filter-out rates per category)

---

## 2. Filter 1: Job Title

### Purpose
Only process decision-makers who can say "yes" to your offer.

### Matching Rules

**Match type:** Case-insensitive contains (any)

| Match Term | Catches |
|-----------|---------|
| `ceo` | CEO, Co-CEO |
| `owner` | Owner, Co-Owner, Business Owner |
| `president` | President, Vice President |
| `founder` | Founder, Co-Founder |
| `co-founder` | Co-Founder |
| `vp of operations` | VP of Operations |
| `vice president` | Vice President of anything |
| `general manager` | General Manager, GM |
| `director of operations` | Director of Operations |
| `operations manager` | Operations Manager |
| `coo` | COO, Chief Operating Officer |
| `managing partner` | Managing Partner |
| `managing director` | Managing Director |
| `principal` | Principal |
| `gm` | GM (use with caution — short match) |

### n8n Filter Node Config

```
Field:    {{ $json.job_title }}
Operation: Contains (Any of)
Values:   ceo, owner, president, founder, co-founder, vp of operations,
          vice president, general manager, director of operations,
          operations manager, coo, managing partner, managing director,
          principal, chief operating
Case sensitive: No
```

### Edge Cases

| Scenario | Handle |
|----------|--------|
| Title is empty/null | **Fail the filter** (log for manual review) |
| Title is "Marketing Manager" | Filtered out (correct — not a decision-maker) |
| Title is "Co-Founder & CEO" | Passes (matches both "founder" and "ceo") |
| Title is "Account Executive" | Filtered out (correct) |
| Title is "Owner/Operator" | Passes (matches "owner") |
| Title contains "former CEO" | Passes (matches "ceo" — consider adding "former" exclusion) |

### Exclusion Terms (Optional)

If you get false positives, add an exclusion filter AFTER the title match:

```
Exclude if job_title contains any of:
  - former
  - ex-
  - retired
  - intern
  - assistant
  - associate
```

---

## 3. Filter 2: Location (United States)

### Purpose
Only process leads located in the United States.

### Matching Rules

**Match type:** Case-insensitive regex match

**Regex pattern:**
```regex
\b(AL|AK|AZ|AR|CA|CO|CT|DE|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY)\b
```

**Plus full state names and country identifiers:**
```regex
alabama|alaska|arizona|arkansas|california|colorado|connecticut|delaware|florida|georgia|hawaii|idaho|illinois|indiana|iowa|kansas|kentucky|louisiana|maine|maryland|massachusetts|michigan|minnesota|mississippi|missouri|montana|nebraska|nevada|new hampshire|new jersey|new mexico|new york|north carolina|north dakota|ohio|oklahoma|oregon|pennsylvania|rhode island|south carolina|south dakota|tennessee|texas|utah|vermont|virginia|washington|west virginia|wisconsin|wyoming|united states|usa|u\.s\.|US
```

### n8n Filter Node Config

```
Field:    {{ $json.location }}
Operation: Matches Regex
Value:    (the regex above)
Case sensitive: No
```

### Common Location Formats

| Format | Matches? |
|--------|----------|
| "Dallas, TX" | Yes (TX) |
| "New York, New York" | Yes (new york) |
| "United States" | Yes (united states) |
| "Phoenix, Arizona, USA" | Yes (arizona, USA) |
| "Toronto, ON, Canada" | No |
| "London, UK" | No |
| "" (empty) | No — fails filter |

### Handling Empty Location

If Cornersight doesn't always provide location:
- **Option A:** Fail the filter (conservative — may lose good leads)
- **Option B:** Pass to Lead Magic enrichment and check location from enriched data
- **Recommended:** Option B — use Lead Magic's profile enrichment to get location, then filter

---

## 4. Filter 3: Industry (All Field Services)

### Purpose
Only process leads in field service industries.

### Complete Industry Match List

**Match type:** Case-insensitive contains (any)

```
hvac
plumbing
plumber
electrical
electrician
roofing
roofer
contracting
contractor
construction
landscaping
landscape
lawn care
pest control
exterminator
cleaning
janitorial
maid service
restoration
water damage
fire damage
mold remediation
moving
relocation
property management
facilities management
facility management
fleet service
fleet management
solar
solar installation
garage door
overhead door
painting
painter
flooring
floor
fencing
fence
tree service
tree care
arborist
pool service
pool maintenance
home service
home improvement
field service
trades
skilled trades
handyman
remodeling
renovation
demolition
excavation
concrete
masonry
welding
insulation
window
gutter
chimney
septic
irrigation
sprinkler
locksmith
appliance repair
```

### n8n Filter Node Config

```
Field:    {{ $json.industry }}
Operation: Contains (Any of)
Values:   (all terms from list above)
Case sensitive: No
```

### Industry Inference

If `industry` field is empty, try to infer from:
1. **Company name:** "Smith HVAC" → industry = "hvac"
2. **Job title context:** "Roofing Contractor" → industry = "roofing"
3. **LinkedIn profile data:** Lead Magic enrichment may include industry

**n8n implementation:** Add a Code node before Filter 3 that tries to infer industry:

```javascript
// Infer industry from company name if industry field is empty
const companyLower = ($json.company || '').toLowerCase();
const titleLower = ($json.job_title || '').toLowerCase();
const combined = companyLower + ' ' + titleLower;

const industryKeywords = {
  'hvac': ['hvac', 'heating', 'cooling', 'air conditioning'],
  'plumbing': ['plumb', 'plumber', 'plumbing'],
  'electrical': ['electric', 'electrical', 'electrician'],
  'roofing': ['roof', 'roofing', 'roofer'],
  'landscaping': ['landscape', 'landscaping', 'lawn'],
  'pest control': ['pest', 'exterminator'],
  'cleaning': ['clean', 'janitorial', 'maid'],
  'construction': ['construct', 'contractor', 'contracting', 'building'],
  'solar': ['solar'],
  'restoration': ['restoration', 'water damage', 'fire damage'],
  'painting': ['paint', 'painter', 'painting'],
  'moving': ['moving', 'relocation', 'mover'],
  'pool service': ['pool'],
  'tree service': ['tree', 'arborist'],
  'fencing': ['fence', 'fencing'],
  'flooring': ['floor', 'flooring'],
  'garage door': ['garage door'],
  'property management': ['property management', 'property mgmt'],
};

let inferredIndustry = $json.industry || '';

if (!inferredIndustry) {
  for (const [industry, keywords] of Object.entries(industryKeywords)) {
    if (keywords.some(kw => combined.includes(kw))) {
      inferredIndustry = industry;
      break;
    }
  }
}

return { ...$json, industry: inferredIndustry };
```

---

## 5. Filter Performance Metrics

### What to Track

| Metric | How to Calculate | Target |
|--------|-----------------|--------|
| Total leads received | Count webhook events | — |
| Title filter pass rate | Passed / Total | 20-40% |
| Location filter pass rate | Passed / Title passed | 60-80% |
| Industry filter pass rate | Passed / Location passed | 40-60% |
| Overall ICP match rate | Final passed / Total | 5-15% |

### Logging Filtered Leads

For each filter stage, log dropped leads to a Google Sheet tab:

| Tab | Columns |
|-----|---------|
| `filtered_title` | Name, LinkedIn URL, Actual Title, Monitor, Timestamp |
| `filtered_location` | Name, LinkedIn URL, Location, Monitor, Timestamp |
| `filtered_industry` | Name, LinkedIn URL, Industry, Company, Monitor, Timestamp |

### Monthly Review

Every month, review the filter logs to:
1. **Find missed opportunities:** Good leads filtered incorrectly → add new match terms
2. **Find false positives:** Bad leads getting through → tighten filters
3. **Optimize conversion:** Which monitor produces the highest ICP match rate?

---

## 6. Advanced: Filter Scoring (Optional Future Enhancement)

Instead of binary pass/fail, assign a lead score:

| Factor | Points |
|--------|--------|
| Title: CEO/Owner/President | +30 |
| Title: VP/Director | +20 |
| Title: Manager | +10 |
| Location: US | +20 |
| Industry: Exact match | +30 |
| Industry: Partial/inferred | +15 |
| Engagement: Comment (vs like) | +10 |
| Comment mentions pain point | +10 |

**Threshold:** Process leads scoring 50+
**Store score in:** HubSpot `manus_lead_score` property

This can be combined with Manus AI research for deeper scoring.
