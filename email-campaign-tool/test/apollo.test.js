const test = require('node:test');
const assert = require('node:assert/strict');
const apollo = require('../src/services/integrations/providers/apollo');

function mockFetch(handlers) {
  const calls = [];
  global.fetch = async (url, opts) => {
    const body = JSON.parse(opts.body);
    calls.push({ url, body });
    const path = url.replace('https://api.apollo.io/api/v1', '');
    const h = handlers[path];
    const data = typeof h === 'function' ? h(body) : h;
    return { ok: true, status: 200, text: async () => JSON.stringify(data) };
  };
  return calls;
}

test('dry run does NOT call bulk_match enrichment', async () => {
  const calls = mockFetch({
    '/mixed_people/api_search': { people: [{ id: 'p1', first_name: 'A', last_name: 'B' }], pagination: { total_entries: 1 } },
    '/people/bulk_match': { matches: [] },
  });
  const res = await apollo.search({ api_key: 'k' }, { per_page: 25 }, { dryRun: true });
  const urls = calls.map(c => c.url);
  assert.ok(urls.some(u => u.includes('api_search')), 'api_search should be called');
  assert.ok(!urls.some(u => u.includes('bulk_match')), 'bulk_match must NOT be called on dry run');
  assert.equal(res.leads.length, 1, 'preview keeps rows even without email');
});

test('auto-paginates up to max_results (real import)', async () => {
  const pageSize = 2;
  const calls = mockFetch({
    '/mixed_people/api_search': (body) => {
      const page = body.page;
      if (page > 3) return { people: [], pagination: { total_entries: 6, page } };
      const base = (page - 1) * pageSize;
      const people = [base, base + 1].map(i => ({ id: 'p' + i, first_name: 'F' + i }));
      return { people, pagination: { total_entries: 6, page } };
    },
    '/people/bulk_match': (body) => ({ matches: body.details.map(d => ({ id: d.id, email: d.id + '@x.com' })) }),
  });
  const res = await apollo.search({ api_key: 'k' }, { per_page: 2, max_results: 5 });
  const searchCalls = calls.filter(c => c.url.includes('api_search'));
  assert.ok(searchCalls.length >= 3, 'should fetch at least 3 pages');
  assert.ok(res.leads.length >= 5, 'should collect at least max_results leads');
});

test('reveal_personal_emails flag threads into bulk_match', async () => {
  const calls = mockFetch({
    '/mixed_people/api_search': { people: [{ id: 'p1' }], pagination: { total_entries: 1 } },
    '/people/bulk_match': { matches: [{ id: 'p1', email: 'p1@x.com' }] },
  });
  await apollo.search({ api_key: 'k' }, { per_page: 25, reveal_personal_emails: true });
  const match = calls.find(c => c.url.includes('bulk_match'));
  assert.equal(match.body.reveal_personal_emails, true);
});
