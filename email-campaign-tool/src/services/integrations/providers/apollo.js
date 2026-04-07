/**
 * Apollo.io adapter
 *
 * Docs: https://docs.apollo.io/reference/people-search
 *
 * Auth: x-api-key header
 * Endpoint: POST https://api.apollo.io/api/v1/mixed_people/search
 *
 * Notes:
 *  - Apollo masks emails on free/lower plans (`email_status: 'unavailable'`).
 *    We surface only leads with a real email so we don't import junk.
 *  - Apollo's People Search is rate-limited per minute/hour/day. We do NOT
 *    auto-paginate beyond the requested page to stay safe.
 */

const BASE_URL = 'https://api.apollo.io/api/v1';

const meta = {
  id: 'apollo',
  name: 'Apollo.io',
  description: 'B2B contact database with 275M+ contacts. Search by title, company, industry, location.',
  docs_url: 'https://docs.apollo.io/reference/people-search',
  credential_fields: [
    { key: 'api_key', label: 'API Key', type: 'password', required: true,
      help: 'Get from Apollo Settings → Integrations → API' },
  ],
  search_fields: [
    { key: 'q_keywords', label: 'Keywords', type: 'text', placeholder: 'e.g. plumbing contractor' },
    { key: 'person_titles', label: 'Job Titles (comma-separated)', type: 'text',
      placeholder: 'Owner, CEO, General Manager' },
    { key: 'organization_industries', label: 'Industries (comma-separated)', type: 'text',
      placeholder: 'plumbing, hvac, electrical' },
    { key: 'organization_locations', label: 'Locations (comma-separated)', type: 'text',
      placeholder: 'Texas, Florida, California' },
    { key: 'organization_num_employees_ranges', label: 'Employee Range', type: 'text',
      placeholder: '1,10  or  11,50' },
    { key: 'page', label: 'Page', type: 'number', default: 1 },
    { key: 'per_page', label: 'Per Page (max 100)', type: 'number', default: 25 },
  ],
};

function splitList(v) {
  if (!v) return undefined;
  if (Array.isArray(v)) return v.filter(Boolean);
  return String(v).split(',').map(s => s.trim()).filter(Boolean);
}

async function _request(creds, path, body) {
  const apiKey = (creds && creds.api_key) || '';
  if (!apiKey) throw new Error('Apollo API key not configured');

  const res = await fetch(`${BASE_URL}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-cache',
      'x-api-key': apiKey,
    },
    body: JSON.stringify(body || {}),
  });

  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { raw: text }; }

  if (!res.ok) {
    const msg = data?.error || data?.message || data?.errors || `Apollo error ${res.status}`;
    const err = new Error(typeof msg === 'string' ? msg : JSON.stringify(msg));
    err.status = res.status;
    throw err;
  }
  return data;
}

async function test(creds) {
  // Lightweight call: search for 1 result.
  const data = await _request(creds, '/mixed_people/search', { page: 1, per_page: 1 });
  return { ok: true, info: { total: data?.pagination?.total_entries ?? null } };
}

async function search(creds, params = {}) {
  const body = {
    page: parseInt(params.page, 10) || 1,
    per_page: Math.min(parseInt(params.per_page, 10) || 25, 100),
  };

  if (params.q_keywords) body.q_keywords = params.q_keywords;
  const titles = splitList(params.person_titles);
  if (titles) body.person_titles = titles;
  const industries = splitList(params.organization_industries);
  if (industries) body.organization_industries = industries;
  const locations = splitList(params.organization_locations);
  if (locations) body.organization_locations = locations;
  const ranges = splitList(params.organization_num_employees_ranges);
  if (ranges) body.organization_num_employees_ranges = ranges;

  const data = await _request(creds, '/mixed_people/search', body);
  const people = Array.isArray(data?.people) ? data.people : [];

  const leads = people
    .filter(p => p.email && p.email !== 'email_not_unlocked@domain.com')
    .map(p => ({
      email: p.email,
      first_name: p.first_name || '',
      last_name: p.last_name || '',
      title: p.title || '',
      company: p.organization?.name || '',
      industry: p.organization?.industry || '',
      city: p.city || '',
      state: p.state || '',
      country: p.country || '',
      phone: p.organization?.phone || '',
      custom_fields: {
        apollo_id: p.id,
        linkedin_url: p.linkedin_url || '',
        organization_website: p.organization?.website_url || '',
      },
    }));

  return {
    leads,
    pagination: data?.pagination || null,
    total: data?.pagination?.total_entries ?? leads.length,
  };
}

module.exports = { meta, test, search };
