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
