const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { getFreePort, ensureSettingsFile } = require('../electron/lib');

test('getFreePort returns a usable port number', async () => {
  const port = await getFreePort();
  assert.equal(typeof port, 'number');
  assert.ok(port > 0 && port < 65536, 'port in valid range');
});

test('ensureSettingsFile creates from template when missing, then leaves it alone', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'of-'));
  const tpl = path.join(dir, 'tpl.env');
  const target = path.join(dir, 'nested', 'settings.env');
  fs.writeFileSync(tpl, 'DATABASE_URL=\nAPP_SECRET=\n');

  const first = ensureSettingsFile(target, tpl);
  assert.equal(first.created, true);
  assert.ok(fs.existsSync(target), 'file created');
  assert.equal(fs.readFileSync(target, 'utf8'), 'DATABASE_URL=\nAPP_SECRET=\n');

  fs.writeFileSync(target, 'DATABASE_URL=filled\n');
  const second = ensureSettingsFile(target, tpl);
  assert.equal(second.created, false, 'does not overwrite existing');
  assert.equal(fs.readFileSync(target, 'utf8'), 'DATABASE_URL=filled\n', 'user edits preserved');
});
