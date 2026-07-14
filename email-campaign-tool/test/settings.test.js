const test = require('node:test');
const assert = require('node:assert/strict');
const { mergeSmtp, getSmtpSettings } = require('../src/services/settings');

test('mergeSmtp: DB values override env; blank DB fields are ignored', () => {
  const env = { host: 'smtp.gmail.com', port: 587, secure: false, user: 'env@x.com', pass: 'envpass', fromName: 'Env', fromEmail: 'env@x.com' };
  const db = { user: 'db@x.com', pass: '', fromName: 'DB Name' };
  const out = mergeSmtp(env, db);
  assert.equal(out.user, 'db@x.com', 'db user wins');
  assert.equal(out.pass, 'envpass', 'blank db pass keeps env pass');
  assert.equal(out.fromName, 'DB Name');
  assert.equal(out.host, 'smtp.gmail.com', 'env host retained');
});

test('mergeSmtp: coerces port to int and secure to boolean', () => {
  const out = mergeSmtp({ host: 'h', port: 587, secure: false }, { port: '465', secure: 'true' });
  assert.equal(out.port, 465);
  assert.equal(out.secure, true);
});

test('getSmtpSettings returns {} when DB is not initialized (no throw)', async () => {
  const r = await getSmtpSettings();
  assert.deepEqual(r, {});
});
