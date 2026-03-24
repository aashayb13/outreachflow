# 09 — Email Infrastructure

## Overview

Email infrastructure is the foundation of cold outreach deliverability. Get this wrong and your emails go to spam. Get it right and you consistently land in the primary inbox. This covers domain setup, DNS authentication, mailbox configuration, and the 21-day warmup schedule.

**Setup:** 3 domains × 3 mailboxes = 9 total sending accounts
**Target:** 10,000 emails/month (~333/day)

---

## 1. Domain Strategy

### Why Separate Domains?

- **Protect your primary domain:** If an outreach domain gets flagged, your main business email is unaffected
- **Distribute risk:** Sending from 3 domains means no single domain bears the full volume
- **Rotation:** If one domain's reputation dips, the others keep sending while it recovers

### Domain Selection Rules

| Rule | Example (if primary = patriottech.com) |
|------|----------------------------------------|
| Similar to primary brand | patriottechsystems.com |
| Use .com TLD only | getpatriottech.com |
| No hyphens or numbers | patriottechgroup.com |
| Easy to spell | patriottechservices.com |
| Not confusingly similar to competitors | Avoid generic names |

### Domain Purchase

**Registrar options:** Namecheap, Cloudflare Registrar, Google Domains
**Cost:** ~$10-15/year per domain
**Total:** ~$30-45/year (~$4/mo)

**Immediately after purchase:**
- Enable WHOIS privacy
- Do NOT set up a website (not required for email)
- Optional: Set up a basic landing page (adds legitimacy)

---

## 2. DNS Records (Per Domain)

### Record 1: MX Records (Email Routing)

For Google Workspace:
```
Type: MX
Host: @
Priority: 1   | Value: ASPMX.L.GOOGLE.COM
Priority: 5   | Value: ALT1.ASPMX.L.GOOGLE.COM
Priority: 5   | Value: ALT2.ASPMX.L.GOOGLE.COM
Priority: 10  | Value: ALT3.ASPMX.L.GOOGLE.COM
Priority: 10  | Value: ALT4.ASPMX.L.GOOGLE.COM
TTL: 3600
```

### Record 2: SPF (Sender Policy Framework)

Tells receiving servers which servers are authorized to send email for your domain.

```
Type: TXT
Host: @
Value: v=spf1 include:_spf.google.com ~all
TTL: 3600
```

**Rules:**
- Only one SPF record per domain
- `~all` = soft fail (recommended for setup phase)
- Upgrade to `-all` (hard fail) after confirming everything works
- Stay under 10 DNS lookups (Google's include counts as ~4)

### Record 3: DKIM (DomainKeys Identified Mail)

Adds a cryptographic signature to every email proving it came from your domain.

**Setup:**
1. Google Workspace Admin Console → Apps → Google Workspace → Gmail
2. Click "Authenticate email"
3. Select your domain → Generate new record
4. Copy the DKIM key

```
Type: TXT
Host: google._domainkey
Value: v=DKIM1; k=rsa; p=MIIBIjANBg... (Google-generated key)
TTL: 3600
```

**After adding the DNS record:**
- Wait 24-48 hours for propagation
- Return to Admin Console → Click "Start authentication"
- Status should change to "Authenticating email"

### Record 4: DMARC (Domain-based Message Authentication)

Tells receiving servers what to do with emails that fail SPF/DKIM checks.

**Phase 1 — Monitoring (Weeks 1-2):**
```
Type: TXT
Host: _dmarc
Value: v=DMARC1; p=none; rua=mailto:dmarc-reports@yourdomain.com; pct=100
TTL: 3600
```

**Phase 2 — Quarantine (Weeks 3-4):**
```
Value: v=DMARC1; p=quarantine; rua=mailto:dmarc-reports@yourdomain.com; pct=100
```

**Phase 3 — Reject (Week 5+):**
```
Value: v=DMARC1; p=reject; rua=mailto:dmarc-reports@yourdomain.com; pct=100
```

### Record 5: Custom Tracking Domain (for Plusvibe)

```
Type: CNAME
Host: track (or email-track)
Value: (provided by Plusvibe during setup)
TTL: 3600
```

This ensures click tracking and open tracking use your domain, not Plusvibe's generic domain.

---

## 3. DNS Verification

After setting up all records, verify with these tools:

| Tool | URL | What It Checks |
|------|-----|---------------|
| MXToolbox | mxtoolbox.com/supertool | SPF, MX, DNS |
| DKIM Validator | dkimvalidator.com | DKIM signature |
| DMARC Analyzer | dmarcanalyzer.com | DMARC policy |
| Mail-Tester | mail-tester.com | Overall deliverability score |
| Google Admin Toolbox | toolbox.googleapps.com/apps/checkmx | Google-specific checks |

**Target scores:**
- Mail-Tester: 9/10 or higher
- All SPF/DKIM/DMARC: Pass

---

## 4. Google Workspace Mailbox Setup

### Mailbox Matrix

| Domain | Mailbox | Display Name | Role |
|--------|---------|-------------|------|
| domain1.com | alex@domain1.com | Alex [LastName] | Primary persona |
| domain1.com | michael@domain1.com | Michael [LastName] | Secondary persona |
| domain1.com | sarah@domain1.com | Sarah [LastName] | Tertiary persona |
| domain2.com | alex@domain2.com | Alex [LastName] | Primary persona |
| domain2.com | michael@domain2.com | Michael [LastName] | Secondary persona |
| domain2.com | sarah@domain2.com | Sarah [LastName] | Tertiary persona |
| domain3.com | alex@domain3.com | Alex [LastName] | Primary persona |
| domain3.com | michael@domain3.com | Michael [LastName] | Secondary persona |
| domain3.com | sarah@domain3.com | Sarah [LastName] | Tertiary persona |

### Per-Mailbox Setup

For each of the 9 mailboxes:

1. **Create user** in Google Workspace Admin Console
2. **Set display name** (First Last)
3. **Add profile photo** (professional headshot — can use AI-generated)
4. **Create email signature:**
   ```
   Alex Johnson
   Business Development | Patriot Tech Systems
   Phone: (555) 123-4567
   ```
5. **Enable 2FA**
6. **Set recovery email** to admin account
7. **Send a test email** to a personal account to verify delivery

### Google Workspace Sending Limits

| Account Type | Daily Limit | Safe Cold Outreach Limit |
|-------------|-------------|--------------------------|
| Business Starter | 2,000/day | 40-50/day |
| Business Standard | 2,000/day | 40-50/day |
| Enterprise | 2,000/day | 40-50/day |

**Important:** The 2,000/day limit is total. We're only using 40-50 for cold outreach + 10-15 for warmup = ~55-65/day, well within limits.

---

## 5. Warmup Schedule (21 Days)

### What Email Warmup Does

Warmup gradually builds your mailbox's sender reputation by:
- Sending real emails to a warmup network
- Recipients open, read, and reply to these emails
- This tells Gmail/Outlook that your mailbox sends legitimate, wanted email
- After warmup, your cold emails are more likely to land in Primary inbox

### Warmup Configuration in Plusvibe

For each of the 9 mailboxes:
- **Enable warmup:** Yes
- **Initial daily volume:** 10-15 emails/day
- **Ramp rate:** Plusvibe handles this automatically
- **Warmup duration:** Minimum 21 days (30 recommended)

### Day-by-Day Schedule

| Day | Warmup Emails/Day | Cold Emails/Day | Total/Day | Notes |
|-----|-------------------|-----------------|-----------|-------|
| 1-3 | 10 | 0 | 10 | Warmup only |
| 4-7 | 15 | 0 | 15 | Warmup only |
| 8-10 | 20 | 0 | 20 | Warmup only |
| 11-14 | 25 | 5 | 30 | Begin light cold outreach |
| 15-18 | 25 | 10 | 35 | Increase cold volume |
| 19-21 | 20 | 15 | 35 | Shift ratio toward cold |
| 22-28 | 15 | 25 | 40 | Ramp cold outreach |
| 29+ | 10-15 | 40 | 50-55 | Full production |

**Per-mailbox numbers above.** Multiply by 9 for total system capacity.

### Post-Warmup Maintenance

**Never stop warmup completely.** Keep 10-15 warmup emails/day per mailbox running permanently. This maintains sender reputation as you scale cold volume.

### Monitoring During Warmup

Check daily:
- [ ] Warmup emails landing in inbox (not spam)
- [ ] Warmup reply rate looks normal (>30%)
- [ ] No Google security alerts on any mailbox
- [ ] No sending restrictions triggered

---

## 6. Sending Volume Math

### Capacity at Full Production

```
9 mailboxes × 40 cold emails/day = 360 cold emails/day
360 × 30 days = 10,800 emails/month
```

### Adding Warmup

```
9 mailboxes × (40 cold + 15 warmup) = 495 total emails/day
Well within Google Workspace's 2,000/day limit per account
```

### Scaling Beyond 10K/Month

| Target Volume | Mailboxes Needed | Domains Needed |
|--------------|-----------------|----------------|
| 10,000/mo | 9 (current) | 3 (current) |
| 15,000/mo | 13 | 4-5 |
| 20,000/mo | 17 | 5-6 |
| 30,000/mo | 25 | 8-9 |

**To scale:** Add new domains + mailboxes, warm them up for 21 days, then add to Plusvibe rotation.

---

## 7. Deliverability Best Practices

### Do

- Always include an unsubscribe link (Plusvibe handles this)
- Use custom tracking domains (not Plusvibe's shared domain)
- Keep subject lines under 60 characters
- Personalize the first line (reference their LinkedIn engagement)
- Send during business hours (recipient's timezone)
- Maintain warmup even during active sending

### Don't

- Don't use spam trigger words (free, guarantee, act now, limited time)
- Don't include more than 1 link in the email
- Don't use HTML-heavy templates (plain text performs better for cold)
- Don't send over 50 cold emails/day per mailbox
- Don't use URL shorteners (flagged as suspicious)
- Don't include large images or attachments
- Don't send to catch-all domains without verification

### Bounce Rate Management

| Bounce Type | Threshold | Action |
|-------------|-----------|--------|
| Hard bounce | > 3% | Pause campaign, clean list |
| Soft bounce | > 5% | Monitor, retry once |
| Spam complaints | > 0.1% | STOP immediately, review copy |

---

## 8. Testing Checklist

- [ ] All 3 domains registered with WHOIS privacy
- [ ] MX records pointing to Google Workspace
- [ ] SPF records set and validated
- [ ] DKIM records generated and authenticated
- [ ] DMARC records set to p=none (monitoring)
- [ ] All 9 mailboxes created in Google Workspace
- [ ] Each mailbox has: display name, photo, signature, 2FA
- [ ] Custom tracking domains configured in Plusvibe
- [ ] Warmup enabled on all 9 mailboxes
- [ ] Test emails from each mailbox arrive in inbox (not spam)
- [ ] Mail-Tester score is 9/10+ for each domain
- [ ] SPF/DKIM/DMARC all pass on test emails
