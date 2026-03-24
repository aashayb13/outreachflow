# 04 — Lead Magic Integration

## Overview

Lead Magic is the email enrichment layer. It takes a LinkedIn profile (or name + company domain) and returns a verified professional email address. This is what turns a LinkedIn engagement into a reachable contact.

**Plan:** $99/month for 10,000 credits (Essential plan)
**Cost per lookup:** 1 credit per found email; `not_found` results are free

---

## 1. API Reference

### Base URL
```
https://api.leadmagic.io/v1
```

### Authentication
All requests require the `X-API-Key` header:
```
X-API-Key: your_api_key_here
```

### Key Endpoints

| Endpoint | Method | Purpose | Credits |
|----------|--------|---------|---------|
| `/email/find` | POST | Find email from name + domain | 1/found |
| `/profile/enrich` | POST | Enrich from LinkedIn URL | 1/found |
| `/email/verify` | POST | Verify an email is deliverable | 1 |
| `/company/enrich` | POST | Get company data from domain | 1 |

---

## 2. Primary Flow: Email Finder

### Request
```
POST https://api.leadmagic.io/v1/email/find
Content-Type: application/json
X-API-Key: your_api_key_here
```

**Body:**
```json
{
  "first_name": "John",
  "last_name": "Smith",
  "domain": "smithhvac.com"
}
```

### Response — Email Found
```json
{
  "email": "john@smithhvac.com",
  "confidence": 0.95,
  "type": "professional",
  "status": "valid",
  "first_name": "John",
  "last_name": "Smith",
  "domain": "smithhvac.com"
}
```

### Response — Not Found
```json
{
  "email": null,
  "confidence": 0,
  "status": "not_found",
  "first_name": "John",
  "last_name": "Smith",
  "domain": "smithhvac.com"
}
```

**Note:** `not_found` results do NOT consume credits.

---

## 3. Alternative Flow: LinkedIn Profile Enrichment

If Cornersight provides the LinkedIn URL but not enough data for name+domain lookup:

### Request
```
POST https://api.leadmagic.io/v1/profile/enrich
Content-Type: application/json
X-API-Key: your_api_key_here
```

**Body:**
```json
{
  "linkedin_url": "https://www.linkedin.com/in/johnsmith"
}
```

### Response
```json
{
  "first_name": "John",
  "last_name": "Smith",
  "email": "john@smithhvac.com",
  "confidence": 0.92,
  "job_title": "CEO",
  "company": "Smith HVAC Services",
  "company_domain": "smithhvac.com",
  "location": "Dallas, TX",
  "industry": "HVAC",
  "linkedin_url": "https://www.linkedin.com/in/johnsmith"
}
```

**This is the preferred endpoint** because it also fills in missing data (job title, company, location, industry) that Cornersight may not provide.

---

## 4. n8n HTTP Request Node Configuration

### Setup in n8n

**Node type:** HTTP Request
**Method:** POST
**URL:** `https://api.leadmagic.io/v1/email/find`

**Headers:**
| Name | Value |
|------|-------|
| `X-API-Key` | `={{ $credentials.leadMagicApiKey }}` |
| `Content-Type` | `application/json` |

**Body (JSON):**
```json
{
  "first_name": "={{ $json.first_name }}",
  "last_name": "={{ $json.last_name }}",
  "domain": "={{ $json.company.replace(/[^a-zA-Z0-9 ]/g, '').replace(/ /g, '').toLowerCase() }}.com"
}
```

### Domain Extraction Logic

The tricky part is getting the company domain from the company name. Options:

1. **Simple guess:** `companyname.com` (strip special chars)
2. **Lead Magic company enrich:** Call `/company/enrich` first to get the real domain
3. **Use LinkedIn profile enrichment instead:** The `/profile/enrich` endpoint handles this automatically

**Recommendation:** Use the LinkedIn profile enrichment endpoint (`/profile/enrich`) as the primary method. It's more reliable and provides additional data.

---

## 5. Credit Management

### Monthly Budget

| Item | Credits |
|------|---------|
| Plan allowance | 10,000/month |
| Estimated daily leads from Cornersight | ~100-300 |
| Estimated ICP-fit leads (after filtering) | ~30-100/day |
| Monthly enrichment attempts | ~900-3,000 |
| Not-found (free) estimated at ~30% | ~270-900 free |
| Credits consumed (found results) | ~630-2,100/month |

**You'll have plenty of headroom** at 10K credits/month. Even at maximum throughput, you won't use more than ~3,000 credits.

### Monitoring Credits

- Check credit balance via Lead Magic dashboard
- Set up alerts when credits drop below 1,000
- Credits roll over monthly on paid plans

### Cost Optimization

1. **Filter BEFORE enriching:** ICP filters run first → only enrich leads that match
2. **Deduplicate:** Check HubSpot before enriching → skip existing contacts
3. **Cache results:** Store enrichment results in HubSpot → don't re-enrich the same person
4. **Not-found is free:** Failed lookups don't cost anything

---

## 6. Rate Limits

| Limit | Value |
|-------|-------|
| Requests per minute | 400 |
| Requests per period | 3,000 |
| Response time | <100ms average |

### Handling Rate Limits in n8n

If processing large batches, add throttling:

```
Split In Batches (batch size: 50)
  → Wait (1 second)
  → HTTP Request (Lead Magic)
```

**For real-time webhook processing** (1 lead at a time), rate limits won't be an issue.

### Rate Limit Response
```
HTTP 429 Too Many Requests
Headers:
  RateLimit-Remaining: 0
  RateLimit-Reset: 1679616000
```

**n8n retry config:** Set retry on failure = 2 attempts, delay = 10 seconds

---

## 7. Error Handling

| Scenario | HTTP Code | Action |
|----------|-----------|--------|
| Email found | 200 | Continue to Plusvibe |
| Not found | 200 (email=null) | Log to "No Email" sheet |
| Invalid API key | 401 | Alert admin, halt workflow |
| Rate limit exceeded | 429 | Retry after RateLimit-Reset |
| Server error | 500 | Retry 2x, then log to error sheet |
| Invalid request | 400 | Log the payload for debugging |
| Network timeout | — | Retry 2x with 5s delay |

### n8n Error Branch

After the HTTP Request node, add an error output:
- Connect error output → Set node → Google Sheets (log error)
- Include: lead name, LinkedIn URL, error code, error message, timestamp

---

## 8. Lead Magic MCP Server (Bonus)

Lead Magic provides a Model Context Protocol (MCP) server for direct integration with AI tools like Claude:

```bash
npx @anthropic/leadmagic-mcp
```

**Environment variable:**
```
LEADMAGIC_API_KEY=your_key_here
```

This can be useful for:
- Ad-hoc enrichment research via Claude
- Building AI-powered lead analysis workflows
- Integrating with Manus AI for deeper prospect research

---

## 9. Testing

### Test with Known LinkedIn Profile

```bash
curl -X POST https://api.leadmagic.io/v1/email/find \
  -H "Content-Type: application/json" \
  -H "X-API-Key: your_key_here" \
  -d '{
    "first_name": "Your",
    "last_name": "Name",
    "domain": "yourcompany.com"
  }'
```

### Validation Checklist
- [ ] API key works (200 response, not 401)
- [ ] Known email returns correct result
- [ ] Unknown person returns `not_found` (no credit consumed)
- [ ] Rate limit headers are present in response
- [ ] n8n node correctly passes data to next step
- [ ] Error branch catches non-200 responses
- [ ] Confidence score is accessible in output
