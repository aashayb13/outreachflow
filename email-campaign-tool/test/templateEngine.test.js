const test = require('node:test');
const assert = require('node:assert/strict');
const { renderTemplate } = require('../src/services/templateEngine');

test('unresolved tag with no fallback renders empty (not literal)', () => {
  assert.equal(renderTemplate('Hi {{first_name}}, welcome', {}), 'Hi , welcome');
});

test('fallback is still used when provided', () => {
  assert.equal(renderTemplate('Hi {{first_name|there}}', {}), 'Hi there');
});

test('value is used when present', () => {
  assert.equal(renderTemplate('Hi {{first_name}}', { first_name: 'Sam' }), 'Hi Sam');
});
