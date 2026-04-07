/**
 * Snov.io adapter
 *
 * Docs: https://snov.io/api
 *
 * Auth flow: OAuth2 client_credentials. We exchange client_id + client_secret
 * for a short-lived access token, then call the v1 endpoints with it.
 *
 * Endpoint used:
 *  - GET /v1/get-domain-emails-with-info  (find emails by domain)
 */

const BASE_URL = 'https://api.snov.io';

const meta = {
  id: 'snov',
  name: 'Snov.io',
  description: 'Email finder, drip campaigns, and lead enrichment from company domains.',
  docs_url: 'https://snov.io/api',
  credential_fields: [
    { key: 'client_id', label: 'Client ID', type: 'text', required: true },
    { key: 'client_secret', label: 'Client Secret', type: 'password', required: true },
  ],
  search_fields: [
    { key: 'domain', label: 'Company Domain', type: 'text', placeholder: 'acme.com', required: true },
    { key: 'type', label: 'Type', type: 'select', options: ['all', 'personal', 'generic'], default: 'all' },
    { key: 'limit', label: 'Limit', type: 'number', default: 25 },
  ],
};

async function _getToken(creds) {
  if (!creds?.client_id || !creds?.client_secret) {
    throw new Error('Snov.io client_id and client_secret are required');
  }
  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: creds.client_id,
    client_secret: creds.client_secret,
  });
  const res = await fetch(`${BASE_URL}/v1/oauth/access_token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.access_token) {
    throw new Error(data.error || `Snov auth failed (${res.status})`);
  }
  return data.access_token;
}

async function test(creds) {
  const token = await _getToken(creds);
  // Cheapest authenticated endpoint — get user balance.
  const res = await fetch(`${BASE_URL}/v1/get-balance?access_token=${encodeURIComponent(token)}`);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.message || `Snov error ${res.status}`);
  return { ok: true, info: { balance: data?.data?.balance ?? data?.balance ?? null } };
}

async function search(creds, params = {}) {
  if (!params.domain) throw new Error('domain is required');
  const token = await _getToken(creds);

  const url = new URL(`${BASE_URL}/v1/get-domain-emails-with-info`);
  url.searchParams.set('access_token', token);
  url.searchParams.set('domain', params.domain);
  url.searchParams.set('type', params.type || 'all');
  url.searchParams.set('limit', String(parseInt(params.limit, 10) || 25));

  const res = await fetch(url.toString());
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.message || `Snov error ${res.status}`);

  const emails = Array.isArray(data?.emails) ? data.emails : [];
  const leads = emails.map(e => ({
    email: e.email,
    first_name: e.firstName || '',
    last_name: e.lastName || '',
    title: e.position || '',
    company: data?.companyName || '',
    custom_fields: {
      snov_type: e.type,
      snov_status: e.status,
    },
  }));
  return { leads, total: leads.length, organization: data?.companyName };
}

module.exports = { meta, test, search };
