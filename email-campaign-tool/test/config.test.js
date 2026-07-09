const test = require('node:test');
const assert = require('node:assert/strict');

test('send-rate defaults are Gmail-safe when env unset', () => {
  delete process.env.SEND_RATE_PER_SECOND;
  delete process.env.SEND_RATE_PER_DAY;
  delete require.cache[require.resolve('../src/config')];
  const config = require('../src/config');
  assert.equal(config.sendRate.perSecond, 1);
  assert.equal(config.sendRate.perDay, 40);
});
