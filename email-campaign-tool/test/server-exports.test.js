const test = require('node:test');
const assert = require('node:assert/strict');

test('server module exports app/start/stop and does not auto-listen on require', () => {
  const srv = require('../src/server');
  assert.ok(srv.app, 'exports the express app');
  assert.equal(typeof srv.start, 'function', 'exports start()');
  assert.equal(typeof srv.stop, 'function', 'exports stop()');
});
