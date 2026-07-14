/**
 * /api/settings — app-level settings (currently SMTP/email).
 * All routes require auth; writes require the 'admin' permission.
 * The password is never returned in full — only a masked preview.
 */
const express = require('express');
const router = express.Router();

const { authenticate, requirePermission } = require('../middleware/auth');
const { getEffectiveSmtp, saveSmtpSettings } = require('../services/settings');
const { verifyConnection, reloadTransporter } = require('../services/mailer');
const { maskSecret } = require('../services/integrations/_crypto');

router.use(authenticate);

function publicSmtp(s) {
  return {
    host: s.host || '',
    port: s.port || 587,
    secure: !!s.secure,
    user: s.user || '',
    pass: s.pass ? maskSecret(s.pass) : '',
    has_pass: !!s.pass,
    fromName: s.fromName || '',
    fromEmail: s.fromEmail || '',
    source: s.source || 'env',
  };
}

router.get('/smtp', async (req, res, next) => {
  try {
    const s = await getEffectiveSmtp();
    res.json({ smtp: publicSmtp(s) });
  } catch (err) { next(err); }
});

router.put('/smtp', requirePermission('admin'), async (req, res, next) => {
  try {
    const { host, port, secure, user, pass, fromName, fromEmail } = req.body || {};
    await saveSmtpSettings({ host, port, secure, user, pass, fromName, fromEmail });
    reloadTransporter();
    const s = await getEffectiveSmtp();
    res.json({ smtp: publicSmtp(s) });
  } catch (err) { next(err); }
});

router.post('/smtp/test', requirePermission('admin'), async (req, res) => {
  const result = await verifyConnection(req.body || {});
  res.status(result.success ? 200 : 400).json(result);
});

module.exports = router;
