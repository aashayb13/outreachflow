const test = require('node:test');
const assert = require('node:assert/strict');
const nodemailer = require('nodemailer');
const mailer = require('../src/services/mailer');

test('attachments are passed through to nodemailer', async () => {
  let captured = null;
  const orig = nodemailer.createTransport;
  nodemailer.createTransport = () => ({
    sendMail: async (opts) => { captured = opts; return { messageId: 'x' }; },
    verify: async () => true,
    close: () => {},
  });
  mailer.closeTransporter(); // clear cached transport so the stub is used

  const atts = [{ filename: 'resume.pdf', content: Buffer.from('hi'), contentType: 'application/pdf' }];
  const res = await mailer.sendEmail({ to: 'a@b.com', subject: 's', html: '<p>h</p>', text: 't', attachments: atts });

  nodemailer.createTransport = orig;
  mailer.closeTransporter();

  assert.equal(res.success, true);
  assert.ok(Array.isArray(captured.attachments));
  assert.equal(captured.attachments[0].filename, 'resume.pdf');
});

test('verifyConnection(overrides) tests ad-hoc settings without saving', async () => {
  const orig = nodemailer.createTransport;
  let opts = null;
  nodemailer.createTransport = (o) => { opts = o; return { verify: async () => true, close() {} }; };
  mailer.closeTransporter();

  const r = await mailer.verifyConnection({ host: 'smtp.test', port: '465', secure: 'true', user: 'u', pass: 'p' });

  nodemailer.createTransport = orig;
  mailer.closeTransporter();

  assert.equal(r.success, true);
  assert.equal(opts.host, 'smtp.test');
  assert.equal(opts.port, 465);
  assert.equal(opts.secure, true);
});
