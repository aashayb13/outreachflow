/**
 * Apollo.io adapter
 *
 * Docs: https://docs.apollo.io/reference/people-api-search
 *
 * Auth: x-api-key header
 *
 * Flow:
 *  1. POST /mixed_people/api_search  → returns people WITHOUT emails
 *  2. POST /people/bulk_match        → enrich in batches of 10 to get emails
 *
 * Notes:
 *  - Apollo's api_search endpoint does NOT return emails or phone numbers.
 *    We must call bulk_match to enrich each person by their Apollo ID.
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
  docs_url: 'https://docs.apollo.io/reference/people-api-search',
  credential_fields: [
    { key: 'api_key', label: 'API Key', type: 'password', required: true,
      help: 'Get from Apollo Settings → Integrations → API' },
  ],
  search_fields: [
    { key: 'q_keywords', label: 'Keywords', type: 'text', placeholder: 'e.g. plumbing contractor' },
    { key: 'person_titles', label: 'Job Titles (comma-separated)', type: 'text',
      placeholder: 'Owner, CEO, General Manager' },
    { key: 'person_locations', label: 'Person Locations (comma-separated)', type: 'text',
      placeholder: 'Texas, Florida, California' },
    { key: 'organization_num_employees_ranges', label: 'Employee Range', type: 'text',
      placeholder: '1,10  or  11,50' },
    { key: 'person_seniorities', label: 'Seniority (comma-separated)', type: 'text',
      placeholder: 'owner, founder, c_suite, vp, director, manager' },
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

  // Debug: log Apollo response keys so we can see the actual structure
  const topKeys = data && typeof data === 'object' ? Object.keys(data) : [];
  console.log(`[Apollo] ${path} → status=${res.status}, keys=[${topKeys.join(',')}]`);
  if (data?.pagination) console.log(`[Apollo] pagination=${JSON.stringify(data.pagination)}`);
  if (!data?.people && !data?.contacts && !data?.matches) {
    // Log first 500 chars of response to see what we actually got
    console.log(`[Apollo] response sample: ${JSON.stringify(data).slice(0, 500)}`);
  } else {
    const arr = data.people || data.contacts || data.matches || [];
    console.log(`[Apollo] results count=${arr.length}, first person keys=${arr[0] ? Object.keys(arr[0]).join(',') : 'none'}`);
  }

  if (!res.ok) {
    const msg = data?.error || data?.message || data?.errors || `Apollo error ${res.status}`;
    const err = new Error(typeof msg === 'string' ? msg : JSON.stringify(msg));
    err.status = res.status;
    throw err;
  }
  return data;
}

/**
 * Enrich people by Apollo ID in batches of 10 to get emails.
 * Returns array of enriched person objects.
 */
async function _bulkEnrich(creds, people) {
  if (!people.length) return [];

  const enriched = [];
  // Apollo bulk_match allows max 10 per request
  for (let i = 0; i < people.length; i += 10) {
    const batch = people.slice(i, i + 10);
    const details = batch.map(p => ({ id: p.id }));

    try {
      const data = await _request(creds, '/people/bulk_match', {
        details,
        reveal_personal_emails: false,
      });
      const matches = Array.isArray(data?.matches) ? data.matches : [];
      enriched.push(...matches);
    } catch (err) {
      // If enrichment fails for a batch, skip it but continue
      console.warn(`Apollo bulk_match batch failed: ${err.message}`);
    }
  }
  return enriched;
}

async function test(creds) {
  // Lightweight call: search for 1 result to verify credentials work.
  const data = await _request(creds, '/mixed_people/api_search', { page: 1, per_page: 1 });
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
  const locations = splitList(params.person_locations);
  if (locations) body.person_locations = locations;
  const seniorities = splitList(params.person_seniorities);
  if (seniorities) body.person_seniorities = seniorities;
  const ranges = splitList(params.organization_num_employees_ranges);
  if (ranges) body.organization_num_employees_ranges = ranges;

  // Step 1: Search (returns people WITHOUT emails)
  console.log(`[Apollo] search body: ${JSON.stringify(body)}`);
  const data = await _request(creds, '/mixed_people/api_search', body);
  const people = Array.isArray(data?.people) ? data.people : [];

  if (!people.length) {
    return { leads: [], pagination: data?.pagination || null, total: 0 };
  }

  // Step 2: Enrich in batches of 10 to get emails
  const enrichedPeople = await _bulkEnrich(creds, people);

  // Build a lookup map by Apollo ID for enriched data
  const enrichedMap = new Map();
  for (const ep of enrichedPeople) {
    if (ep.id) enrichedMap.set(ep.id, ep);
  }

  // Merge: use search data as base, overlay email from enrichment
  const leads = people
    .map(p => {
      const enriched = enrichedMap.get(p.id) || {};
      const email = enriched.email || p.email || '';
      return {
        email,
        first_name: p.first_name || '',
        last_name: p.last_name || '',
        title: p.title || '',
        company: p.organization?.name || '',
        industry: p.organization?.industry || '',
        city: p.city || '',
        state: p.state || '',
        country: p.country || '',
        phone: enriched.phone || p.organization?.phone || '',
        custom_fields: {
          apollo_id: p.id,
          linkedin_url: p.linkedin_url || '',
          organization_website: p.organization?.website_url || '',
        },
      };
    })
    .filter(l => l.email && l.email !== 'email_not_unlocked@domain.com');

  return {
    leads,
    pagination: data?.pagination || null,
    total: data?.pagination?.total_entries ?? leads.length,
  };
}

module.exports = { meta, test, search };
