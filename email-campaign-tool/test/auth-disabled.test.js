const test = require('node:test');
const assert = require('node:assert/strict');
const config = require('../src/config');
const { authenticate, requirePermission } = require('../src/middleware/auth');

test('authenticate bypasses auth and grants admin when authDisabled', async () => {
  const orig = config.authDisabled;
  config.authDisabled = true;
  try {
    let nexted = false;
    const req = { headers: {} };
    const res = {
      redirect() { throw new Error('should not redirect when auth disabled'); },
      status() { throw new Error('should not 401 when auth disabled'); },
    };
    await authenticate(req, res, () => { nexted = true; });
    assert.equal(nexted, true, 'next() called without any token');
    assert.deepEqual(req.permissions, ['read', 'write', 'admin']);
    assert.equal(req.authMethod, 'none');
  } finally {
    config.authDisabled = orig;
  }
});

test('requirePermission passes through when authDisabled', () => {
  const orig = config.authDisabled;
  config.authDisabled = true;
  try {
    let nexted = false;
    requirePermission('admin')({ permissions: [] }, {}, () => { nexted = true; });
    assert.equal(nexted, true, 'permission gate bypassed when auth disabled');
  } finally {
    config.authDisabled = orig;
  }
});

test('authenticate still enforces auth when NOT disabled (HTML → redirect to /login)', async () => {
  const orig = config.authDisabled;
  config.authDisabled = false;
  try {
    let redirectedTo = null;
    const req = { headers: {}, query: {}, accepts: () => true };
    const res = { redirect(url) { redirectedTo = url; } };
    await authenticate(req, res, () => { throw new Error('must not call next() when unauthenticated'); });
    assert.equal(redirectedTo, '/login');
  } finally {
    config.authDisabled = orig;
  }
});
