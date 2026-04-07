/**
 * Clearbit (Person + Company Enrichment) adapter
 *
 * Docs: https://dashboard.clearbit.com/docs
 *
 * Note: Clearbit was acquired by HubSpot. The classic enrichment API still
 * works for existing customers but new signups go through HubSpot's
 * "Breeze Intelligence". This adapter targets the legacy v2 endpoints.
 *
 * Auth: Bearer token
 * Endpoint: GET https://person-stream.clearbit.com/v2/combined/find?email=...
 */

const BASE_URL = 'https://person-stream.clearbit.com/v2';

const meta = {
  id: 'clearbit',
  name: 'Clearbit (HubSpot Breeze)',
  description: 'Enrich a known email with full person + company profile.',
  docs_url: 'https://dashboard.clearbit.com/docs',
  credential_fields: [
    { key: 'api_key', label: 'API Key', type: 'password', required: true,
      help: 'Get from Clearbit Dashboard → API Keys' },
  ],
  search_fields: [
    { key: 'email', label: 'Email to Enrich', type: 'email', required: true },
  ],
};

async function _get(creds, path, query) {
  const apiKey = (creds && creds.api_key) || '';
  if (!apiKey) throw new Error('Clearbit API key not configured');

  const url = new URL(`${BASE_URL}${path}`);
  for (const [k, v] of Object.entries(query || {})) {
    if (v !== undefined && v !== '' && v !== null) url.searchParams.set(k, v);
  }
  const res = await fetch(url.toString(), {
    headers: { 'Authorization': `Bearer ${apiKey}` },
  });
  if (res.status === 202) return { pending: true };
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { raw: text }; }
  if (!res.ok) {
    const msg = data?.error?.message || `Clearbit error ${res.status}`;
    const err = new Error(msg);
    err.status = res.status;
    throw err;
  }
  return data;
}

async function test(creds) {
  // No cheap "ping" endpoint — issue a known no-result lookup.
  try {
    await _get(creds, '/combined/find', { email: 'test@clearbit.com' });
    return { ok: true };
  } catch (err) {
    // 404 (not found) still means the key is valid.
    if (err.status === 404) return { ok: true };
    throw err;
  }
}

async function search(creds, params = {}) {
  if (!params.email) throw new Error('email is required');
  const data = await _get(creds, '/combined/find', { email: params.email });
  if (data?.pending) return { leads: [], total: 0, pending: true };

  const p = data?.person || {};
  const c = data?.company || {};
  if (!p.email && !params.email) return { leads: [], total: 0 };

  return {
    leads: [{
      email: p.email || params.email,
      first_name: p.name?.givenName || '',
      last_name: p.name?.familyName || '',
      title: p.employment?.title || '',
      company: c.name || p.employment?.name || '',
      industry: c.category?.industry || '',
      city: p.geo?.city || c.geo?.city || '',
      state: p.geo?.state || c.geo?.state || '',
      country: p.geo?.country || c.geo?.country || '',
      phone: c.phone || '',
      custom_fields: {
        clearbit_id: p.id,
        linkedin_url: p.linkedin?.handle ? `https://linkedin.com/in/${p.linkedin.handle}` : '',
        company_domain: c.domain || '',
        company_size: c.metrics?.employees,
      },
    }],
    total: 1,
  };
}

module.exports = { meta, test, search };
