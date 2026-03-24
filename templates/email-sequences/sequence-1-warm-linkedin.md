# Email Sequence 1: Warm LinkedIn Engagement

**Used for:** Leads captured via Cornersight (engaged with a LinkedIn post)
**Steps:** 3 emails over 7 days
**Campaign type:** Warm outreach (they already showed interest)

---

## Step 1 — Day 0 (Same day as engagement)

**Subject:** {{first_name}}, saw your comment on {{monitor_name}}'s post

```
Hey {{first_name}},

Noticed you engaged with {{monitor_name}}'s recent post about [topic].
{{#if comment_text}}Your take — "{{comment_text_snippet}}" — really stood out.{{/if}}

We work with {{industry}} companies like {{company}} to [specific value proposition — e.g., "streamline scheduling and dispatch so owners can stop putting out fires"].

Would it make sense to connect for 15 minutes this week? I think there's a quick win I can show you.

Best,
{{sender_name}}
{{sender_title}} | {{sender_company}}
```

**Notes:**
- Reference the specific post/comment for personalization
- If engagement_type is "like" (no comment), drop the comment reference
- Keep it under 100 words
- One clear CTA (15-minute call)

---

## Step 2 — Day 3 (Follow-up)

**Subject:** Re: {{first_name}}, saw your comment on {{monitor_name}}'s post

```
Hey {{first_name}},

Just bumping this up — I know running a {{industry}} operation keeps you slammed.

Quick question: are you currently [specific pain point relevant to ICP — e.g., "tracking job profitability across your crew" / "struggling with scheduling gaps" / "losing techs to competitors"]?

If so, I think we could help. If not, no worries at all.

{{sender_name}}
```

**Notes:**
- Reply-thread format (Re: subject) for higher open rates
- Ask a question that provokes a yes/no response
- Short — under 60 words

---

## Step 3 — Day 7 (Breakup email)

**Subject:** Re: {{first_name}}, saw your comment on {{monitor_name}}'s post

```
{{first_name}},

Last note from me. If the timing isn't right, I totally get it.

If things change down the road, here's my calendar: [calendar_link]

Either way, keep crushing it at {{company}}.

{{sender_name}}
```

**Notes:**
- Breakup emails often get the highest reply rate
- Include a calendar link for frictionless booking
- Positive, no-pressure tone
- Under 40 words

---

## Variable Reference

| Variable | Source | Example |
|----------|--------|---------|
| `{{first_name}}` | Cornersight/Lead Magic | John |
| `{{company}}` | Cornersight/Lead Magic | Smith HVAC |
| `{{industry}}` | ICP filter | HVAC |
| `{{monitor_name}}` | Cornersight | Jobber |
| `{{comment_text_snippet}}` | Cornersight (first 50 chars) | "This is exactly what we needed" |
| `{{sender_name}}` | Plusvibe mailbox config | Alex Johnson |
| `{{sender_title}}` | Plusvibe mailbox config | Business Development |
| `{{sender_company}}` | Plusvibe mailbox config | Patriot Tech Systems |
| `{{calendar_link}}` | Static (Calendly/HubSpot) | https://calendly.com/... |

---

## A/B Test Suggestions

### Subject Lines to Test
- A: `{{first_name}}, saw your comment on {{monitor_name}}'s post`
- B: `Quick question for {{first_name}} at {{company}}`
- C: `{{first_name}} — noticed you follow {{monitor_name}}`
- D: `Idea for {{company}} based on your LinkedIn activity`

### Opening Lines to Test
- A: `Noticed you engaged with {{monitor_name}}'s recent post...`
- B: `Your comment on {{monitor_name}}'s post caught my eye...`
- C: `I see you're plugged into the {{industry}} community on LinkedIn...`
