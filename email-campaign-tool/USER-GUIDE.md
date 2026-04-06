# Email Campaign Tool — User Guide

## Getting Started

1. Open the app in your browser (default: `http://localhost:3000`)
2. Log in with your APP_SECRET password from the `.env` file
3. You'll land on the **Dashboard** with an overview of sends, opens, clicks, and bounces

## Core Features

### Contacts
- **Add contacts** individually or import via CSV
- Tag contacts for segmentation (e.g., "warm-lead", "field-services")
- View engagement history per contact

### Lists
- Group contacts into targeted lists (e.g., "HVAC Prospects", "Plumbing Leads")
- Assign contacts to multiple lists
- Use lists to target campaigns and sequences

### Templates
- Create reusable HTML email templates
- Use merge tags like `{{first_name}}` for personalization
- Preview templates before sending

### Campaigns
- Create one-time email blasts targeting a specific list
- Choose a template or write custom HTML
- Set subject line, from name, and reply-to address
- **Send**, **pause**, **resume**, or **duplicate** campaigns from the list view

### Sequences (Drip Campaigns)
- Build multi-step automated email flows
- Define delay between steps (e.g., Day 1: intro, Day 3: follow-up, Day 7: case study)
- Enroll contacts and track per-step performance

### Analytics
- Track open rates, click rates, bounces, and unsubscribes
- View daily send volume and contact growth trends
- See top-performing campaigns at a glance

### Webhooks
- Send real-time event data (opens, clicks, bounces) to external systems
- Connect to CRMs, Slack, or automation platforms via webhook URLs

### Settings
- View SMTP configuration status
- Manage API keys for programmatic access
- Adjust send rate limits

## Automated Email Flow Setup

1. **Build your list** — Import contacts via CSV or add them through the API
2. **Create templates** — Design your email sequence (intro, follow-up, closer)
3. **Set up a Sequence** — Add each template as a step with appropriate delays
4. **Enroll contacts** — Add list members to the sequence
5. **Monitor** — Track engagement on the Analytics dashboard and adjust timing/content as needed

### API-Driven Automation
The app exposes a full REST API (`/api/*`) so you can:
- Push new contacts from lead gen tools (Cornersight, Lead Magic, etc.)
- Trigger sequence enrollment programmatically
- Pull analytics data into external dashboards
- Use webhooks to notify downstream systems (HubSpot, n8n, etc.)

Pass your API key via `X-API-Key` header on all API requests.
