/**
 * Lead Magic adapter
 *
 * Docs: https://docs.leadmagic.io/
 *
 * Lead Magic exposes single-record enrichment endpoints (email-finder,
 * email-validate, mobile-finder, b2b-profile-search). It does not provide a
 * search-by-criteria like Apollo, so this adapter focuses on enrichment.
 *
 * Auth: X-API-Key header
 * Endpoints used:
 *  - POST /v1/credits          (test)
 *  - POST /v1/email-finder     (find email by name + domain)
 *  - POST /v1/email-validate   (verify deliverability)
 */

const BASE_URL = 'https://api.leadmagic.io';

const meta = {
  id: 'leadmagic',
  name: 'Lead Magic',
  description: 'Email finder & verifier — find and validate emails by name + company domain.',
  docs_url: 'https://docs.leadmagic.io/',
  credential_fields: [
    { key: 'api_key', label: 'API Key', type: 'password', required: true,
      help: 'Get from Lead Magic Dashboard → API' },
  ],
  search_fields: [
    { key: 'mode', label: 'Mode', type: 'select', options: ['email_finder', 'email_validate'],
      default: 'email_finder' },
    { key: 'first_name', label: 'First Name', type: 'text' },
    { key: 'last_name', label: 'Last Name', type: 'text' },
    { key: 'domain', label: 'Company Domain', type: 'text', placeholder: 'acme.com' },
    { key: 'company_name', label: 'Company Name (optional)', type: 'text' },
    { key: 'email', label: 'Email (validate mode only)', type: 'email' },
  ],
};

async function _post(creds, path, body) {
  const apiKey = (creds && creds.api_key) || '';
  if (!apiKey) throw new Error('Lead Magic API key not configured');

  const res = await fetch(`${BASE_URL}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-API-Key': apiKey,
    },
    body: JSON.stringify(body || {}),
  });

  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { raw: text }; }

  if (!res.ok) {
    const msg = data?.message || data?.error || `Lead Magic error ${res.status}`;
    const err = new Error(typeof msg === 'string' ? msg : JSON.stringify(msg));
    err.status = res.status;
    throw err;
  }
  return data;
}

async function test(creds) {
  const data = await _post(creds, '/credits', {});
  return { ok: true, info: { credits: data?.credits ?? data?.balance ?? null } };
}

async function search(creds, params = {}) {
  const mode = params.mode || 'email_finder';

  if (mode === 'email_validate') {
    if (!params.email) throw new Error('email is required for validate mode');
    const data = await _post(creds, '/email-validate', { email: params.email });
    if (data?.email_status && data.email_status !== 'valid') {
      return { leads: [], total: 0, validation: data };
    }
    return {
      leads: [{
        email: params.email,
        first_name: data?.first_name || '',
        last_name: data?.last_name || '',
        company: data?.company_name || '',
        custom_fields: {
          leadmagic_status: data?.email_status,
          leadmagic_provider: data?.email_provider,
        },
      }],
      total: 1,
      validation: data,
    };
  }

  // email_finder
  if (!params.first_name || !params.last_name || !params.domain) {
    throw new Error('email_finder requires first_name, last_name, and domain');
  }
  const data = await _post(creds, '/email-finder', {
    first_name: params.first_name,
    last_name: params.last_name,
    domain: params.domain,
    company_name: params.company_name || undefined,
  });

  if (!data?.email) return { leads: [], total: 0, raw: data };

  return {
    leads: [{
      email: data.email,
      first_name: params.first_name,
      last_name: params.last_name,
      company: params.company_name || data.company_name || '',
      custom_fields: {
        leadmagic_status: data.email_status,
        leadmagic_confidence: data.confidence,
      },
    }],
    total: 1,
  };
}

module.exports = { meta, test, search };
