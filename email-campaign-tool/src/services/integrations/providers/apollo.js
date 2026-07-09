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
 *  - Apollo's People Search is rate-limited per minute/hour/day. We
 *    auto-paginate up to `max_results` (hard-capped at 500, 20 pages max)
 *    with a 250ms delay between pages to stay gentle on rate limits.
 */

const BASE_URL = 'https://api.apollo.io/api/v1';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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
    { key: 'q_keywords', label: 'Keywords', type: 'text', placeholder: 'e.g. fintech, SaaS, logistics' },
    { key: 'person_titles', label: 'Job Titles (comma-separated)', type: 'text',
      placeholder: 'Founder, CTO, Engineering Manager, Recruiter' },
    { key: 'person_locations', label: 'Person Location (comma-separated)', type: 'text',
      placeholder: 'United States, London, Remote' },
    { key: 'organization_locations', label: 'Company HQ Location (comma-separated)', type: 'text',
      placeholder: 'United States, San Francisco' },
    { key: 'organization_num_employees_ranges', label: 'Employee Range', type: 'text',
      placeholder: '1,10  or  11,50' },
    { key: 'person_seniorities', label: 'Seniority (comma-separated)', type: 'text',
      placeholder: 'owner, founder, c_suite, vp, director, manager' },
    { key: 'page', label: 'Start Page', type: 'number', default: 1 },
    { key: 'per_page', label: 'Per Page (max 100)', type: 'number', default: 25 },
    { key: 'max_results', label: 'Max results to pull (uses credits)', type: 'number', default: 25 },
    { key: 'reveal_personal_emails', label: 'Include personal emails (uses more credits)', type: 'checkbox', default: false },
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

/**
 * Enrich people by Apollo ID in batches of 10 to get emails.
 * Returns { matches, failedBatches }.
 */
async function _bulkEnrich(creds, people, revealPersonal = false) {
  if (!people.length) return { matches: [], failedBatches: 0 };

  const enriched = [];
  let failedBatches = 0;
  for (let i = 0; i < people.length; i += 10) {
    const batch = people.slice(i, i + 10);
    const details = batch.map((p) => ({ id: p.id }));
    try {
      const data = await _request(creds, '/people/bulk_match', {
        details,
        reveal_personal_emails: !!revealPersonal,
      });
      const matches = Array.isArray(data?.matches) ? data.matches : [];
      enriched.push(...matches);
    } catch (err) {
      failedBatches++;
    }
  }
  return { matches: enriched, failedBatches };
}

/**
 * Merge search-result person with (optional) bulk_match enrichment data
 * into a normalized lead object.
 */
function _mapLead(p, enriched) {
  const email = enriched.email || p.email || '';
  return {
    email,
    first_name: enriched.first_name || p.first_name || '',
    last_name: enriched.last_name || p.last_name || '',
    title: enriched.title || p.title || '',
    company: enriched.organization?.name || p.organization?.name || '',
    industry: p.organization?.industry || '',
    city: enriched.city || p.city || '',
    state: enriched.state || p.state || '',
    country: enriched.country || p.country || '',
    phone: enriched.phone_numbers?.[0]?.sanitized_number || enriched.phone || '',
    custom_fields: {
      apollo_id: p.id,
      linkedin_url: enriched.linkedin_url || p.linkedin_url || '',
      organization_website: enriched.organization?.website_url || p.organization?.website_url || '',
    },
  };
}

async function test(creds) {
  const data = await _request(creds, '/mixed_people/api_search', { page: 1, per_page: 1 });
  return { ok: true, info: { total: data?.pagination?.total_entries ?? data?.total_entries ?? null } };
}

async function search(creds, params = {}, options = {}) {
  const perPage = Math.max(1, Math.min(parseInt(params.per_page, 10) || 25, 100));
  const startPage = Math.max(1, parseInt(params.page, 10) || 1);
  const maxResults = Math.max(1, Math.min(parseInt(params.max_results, 10) || perPage, 500));
  const MAX_PAGES = 20; // hard safety cap on API calls per search

  const body = { page: startPage, per_page: perPage };
  if (params.q_keywords) body.q_keywords = params.q_keywords;
  const titles = splitList(params.person_titles);
  if (titles) body.person_titles = titles;
  const locations = splitList(params.person_locations);
  if (locations) body.person_locations = locations;
  const orgLocations = splitList(params.organization_locations);
  if (orgLocations) body.organization_locations = orgLocations;
  const seniorities = splitList(params.person_seniorities);
  if (seniorities) body.person_seniorities = seniorities;
  const ranges = splitList(params.organization_num_employees_ranges);
  if (ranges) body.organization_num_employees_ranges = ranges;

  // Step 1: Search (paged) — collect people up to maxResults.
  let allPeople = [];
  let apiTotal = 0;
  let lastPagination = null;
  for (let i = 0; i < MAX_PAGES && allPeople.length < maxResults; i++) {
    body.page = startPage + i;
    const data = await _request(creds, '/mixed_people/api_search', body);
    const people = Array.isArray(data?.people) ? data.people : [];
    apiTotal = data?.pagination?.total_entries ?? data?.total_entries ?? apiTotal;
    lastPagination = data?.pagination || lastPagination;
    if (!people.length) break;
    allPeople.push(...people);
    if (people.length < perPage) break; // last page reached
    if (allPeople.length < maxResults) await sleep(250); // be gentle on Apollo rate limits
  }
  allPeople = allPeople.slice(0, maxResults);

  if (!allPeople.length) {
    return { leads: [], pagination: lastPagination, total: apiTotal };
  }

  // Dry-run preview: skip bulk_match enrichment entirely (saves email credits).
  if (options.dryRun) {
    const leads = allPeople.map((p) => _mapLead(p, {}));
    return { leads, pagination: lastPagination, total: apiTotal };
  }

  // Step 2: Enrich in batches of 10 to get emails
  const revealPersonal = params.reveal_personal_emails === true || params.reveal_personal_emails === 'true';
  const { matches: enrichedPeople, failedBatches } = await _bulkEnrich(creds, allPeople, revealPersonal);
  const enrichedMap = new Map();
  for (const ep of enrichedPeople) {
    if (ep.id) enrichedMap.set(ep.id, ep);
  }

  const leads = allPeople
    .map((p) => _mapLead(p, enrichedMap.get(p.id) || {}))
    .filter((l) => l.email && l.email !== 'email_not_unlocked@domain.com');

  return { leads, pagination: lastPagination, total: apiTotal, enrich_errors: failedBatches };
}

module.exports = { meta, test, search };
