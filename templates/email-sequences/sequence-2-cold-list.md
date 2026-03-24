# Email Sequence 2: Cold Static List

**Used for:** Leads imported from GenSpark lists, Apollo, Sales Navigator, CSV imports
**Steps:** 3 emails over 10 days
**Campaign type:** Cold outreach (no prior engagement signal)

---

## Step 1 — Day 0

**Subject:** {{first_name}}, quick question about {{company}}

```
Hey {{first_name}},

I came across {{company}} while researching {{industry}} companies in {{location}}.

We help {{industry}} business owners [specific value proposition — e.g., "cut scheduling gaps in half" / "stop losing revenue to no-shows" / "get dispatch running without constant babysitting"].

Is this something you're actively working on, or is it on the back burner?

Either way, happy to share what's working for other {{industry}} companies your size.

{{sender_name}}
{{sender_title}} | {{sender_company}}
```

**Notes:**
- No LinkedIn engagement to reference, so lead with research
- Ask an open-ended question to start a conversation
- Under 80 words

---

## Step 2 — Day 4 (Value-add follow-up)

**Subject:** Re: {{first_name}}, quick question about {{company}}

```
{{first_name}},

Wanted to share one thing that might be useful —

[Insert specific insight, stat, or mini case study relevant to their industry]

For example, one of our {{industry}} clients went from [before state] to [after state] in [timeframe].

Worth a 10-minute chat to see if something similar could work for {{company}}?

{{sender_name}}
```

**Notes:**
- Provide value, not just another ask
- Social proof with a specific result
- Lower the commitment (10 minutes, not 30)

---

## Step 3 — Day 10 (Breakup)

**Subject:** Re: {{first_name}}, quick question about {{company}}

```
{{first_name}},

I'll keep this short — I've reached out a couple times and haven't heard back, so I don't want to be a pest.

If you ever want to explore [value prop], here's my calendar: [calendar_link]

Wishing you and the {{company}} team a great rest of the quarter.

{{sender_name}}
```

**Notes:**
- Longer gap (Day 10 vs Day 7) for cold outreach
- Self-aware tone ("don't want to be a pest")
- Calendar link for easy booking
- Positive close

---

## Variable Reference

| Variable | Source | Example |
|----------|--------|---------|
| `{{first_name}}` | Import/Lead Magic | Maria |
| `{{company}}` | Import/Lead Magic | Rodriguez Plumbing |
| `{{industry}}` | Import/ICP filter | Plumbing |
| `{{location}}` | Import/Lead Magic | Miami, FL |
| `{{sender_name}}` | Plusvibe mailbox | Michael Torres |
| `{{sender_title}}` | Plusvibe mailbox | Partnership Manager |
| `{{sender_company}}` | Plusvibe mailbox | Patriot Tech Systems |
| `{{calendar_link}}` | Static | https://calendly.com/... |

---

## Key Differences from Warm Sequence

| Aspect | Warm (Sequence 1) | Cold (Sequence 2) |
|--------|-------------------|-------------------|
| Opening hook | LinkedIn engagement reference | Research/industry reference |
| Timing | 0, 3, 7 days | 0, 4, 10 days |
| Tone | "Saw you..." (warm) | "Came across..." (cold) |
| Expected reply rate | 5-10% | 2-5% |
| Personalization source | Cornersight data | Company/industry data |
