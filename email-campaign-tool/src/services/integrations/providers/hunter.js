/**
 * Hunter.io adapter
 *
 * Docs: https://hunter.io/api-documentation/v2
 *
 * Supports two flows:
 *  - Domain Search: GET /v2/domain-search?domain=acme.com
 *  - Email Finder:  GET /v2/email-finder?domain=acme.com&first_name=...&last_name=...
 */

const BASE_URL = 'https://api.hunter.io/v2';

const meta = {
  id: 'hunter',
  name: 'Hunter.io',
  description: 'Find professional email addresses by company domain.',
  docs_url: 'https://hunter.io/api-documentation/v2',
  credential_fields: [
    { key: 'api_key', label: 'API Key', type: 'password', required: true,
      help: 'Get from Hunter Dashboard → API' },
  ],
  search_fields: [
    { key: 'mode', label: 'Mode', type: 'select', options: ['domain_search', 'email_finder'],
      default: 'domain_search' },
    { key: 'domain', label: 'Company Domain', type: 'text', placeholder: 'acme.com', required: true },
    { key: 'first_name', label: 'First Name (email_finder only)', type: 'text' },
    { key: 'last_name', label: 'Last Name (email_finder only)', type: 'text' },
    { key: 'department', label: 'Department (domain_search)', type: 'text', placeholder: 'sales, executive' },
    { key: 'limit', label: 'Limit', type: 'number', default: 25 },
  ],
};

async function _get(creds, path, query) {
  const apiKey = (creds && creds.api_key) || '';
  if (!apiKey) throw new Error('Hunter API key not configured');

  const url = new URL(`${BASE_URL}${path}`);
  for (const [k, v] of Object.entries(query || {})) {
    if (v !== undefined && v !== '' && v !== null) url.searchParams.set(k, v);
  }
  url.searchParams.set('api_key', apiKey);

  const res = await fetch(url.toString());
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { raw: text }; }

  if (!res.ok || data?.errors) {
    const msg = data?.errors?.[0]?.details || `Hunter error ${res.status}`;
    const err = new Error(msg);
    err.status = res.status;
    throw err;
  }
  return data;
}

async function test(creds) {
  // Account endpoint is the canonical health-check.
  const data = await _get(creds, '/account', {});
  return { ok: true, info: { plan: data?.data?.plan_name, searches_left: data?.data?.requests?.searches?.available } };
}

async function search(creds, params = {}) {
  const mode = params.mode || 'domain_search';

  if (mode === 'email_finder') {
    if (!params.domain || !params.first_name || !params.last_name) {
      throw new Error('email_finder requires domain, first_name, and last_name');
    }
    const data = await _get(creds, '/email-finder', {
      domain: params.domain,
      first_name: params.first_name,
      last_name: params.last_name,
    });
    const d = data?.data || {};
    if (!d.email) return { leads: [], total: 0 };
    return {
      leads: [{
        email: d.email,
        first_name: d.first_name || params.first_name,
        last_name: d.last_name || params.last_name,
        title: d.position || '',
        company: d.company || '',
        phone: d.phone_number || '',
        custom_fields: { hunter_score: d.score, hunter_sources: d.sources?.length || 0 },
      }],
      total: 1,
    };
  }

  // domain_search
  if (!params.domain) throw new Error('domain is required');
  const data = await _get(creds, '/domain-search', {
    domain: params.domain,
    limit: parseInt(params.limit, 10) || 25,
    department: params.department || undefined,
  });
  const d = data?.data || {};
  const emails = Array.isArray(d.emails) ? d.emails : [];
  const leads = emails.map(e => ({
    email: e.value,
    first_name: e.first_name || '',
    last_name: e.last_name || '',
    title: e.position || '',
    company: d.organization || '',
    phone: e.phone_number || '',
    custom_fields: {
      hunter_confidence: e.confidence,
      hunter_department: e.department,
      hunter_seniority: e.seniority,
      linkedin_url: e.linkedin || '',
      twitter: e.twitter || '',
    },
  }));

  return { leads, total: leads.length, organization: d.organization, domain: d.domain };
}

module.exports = { meta, test, search };
