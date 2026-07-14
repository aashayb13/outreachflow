const nodemailer = require('nodemailer');
const config = require('../config');
const logger = require('../utils/logger');
const { getEffectiveSmtp } = require('./settings');

let transporter = null;
let cachedSmtp = null;

async function getTransporter() {
  if (transporter) return transporter;
  const s = await getEffectiveSmtp();
  cachedSmtp = s;
  transporter = nodemailer.createTransport({
    host: s.host,
    port: s.port,
    secure: s.secure,
    auth: { user: s.user, pass: s.pass },
    pool: true,
    maxConnections: 5,
    maxMessages: 100,
    rateDelta: 1000,
    rateLimit: config.sendRate.perSecond,
  });
  return transporter;
}

function cleanOverrides(o) {
  const out = {};
  for (const [k, v] of Object.entries(o || {})) {
    if (v !== '' && v !== null && v !== undefined) out[k] = v;
  }
  return out;
}

/** Send a single email. Returns { success, messageId, error }. */
async function sendEmail({ to, subject, html, text, from, replyTo, headers = {}, attachments = [] }) {
  const transport = await getTransporter();
  const s = cachedSmtp || await getEffectiveSmtp();
  const fromAddress = from || `"${s.fromName}" <${s.fromEmail}>`;
  const mailOptions = {
    from: fromAddress,
    to, subject, html, text, attachments,
    replyTo: replyTo || s.fromEmail,
    headers: {
      'List-Unsubscribe': headers['List-Unsubscribe'] || '',
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
      'X-Campaign-ID': headers['X-Campaign-ID'] || '',
      ...headers,
    },
  };
  try {
    const info = await transport.sendMail(mailOptions);
    logger.debug(`Email sent to ${to}: ${info.messageId}`);
    return { success: true, messageId: info.messageId };
  } catch (error) {
    logger.error(`Failed to send email to ${to}: ${error.message}`);
    return { success: false, error: error.message };
  }
}

/**
 * Verify the SMTP connection. Pass `overrides` (unsaved form values) to test
 * them without persisting; otherwise the effective/saved settings are used.
 */
async function verifyConnection(overrides) {
  try {
    let transport;
    const ov = cleanOverrides(overrides);
    if (Object.keys(ov).length) {
      const base = await getEffectiveSmtp();
      const s = { ...base, ...ov };
      transport = nodemailer.createTransport({
        host: s.host,
        port: parseInt(s.port, 10) || 587,
        secure: s.secure === true || s.secure === 'true',
        auth: { user: s.user, pass: s.pass },
      });
    } else {
      transport = await getTransporter();
    }
    await transport.verify();
    logger.info('SMTP connection verified');
    return { success: true };
  } catch (error) {
    logger.error(`SMTP verification failed: ${error.message}`);
    return { success: false, error: error.message };
  }
}

/** Close the cached transporter pool. */
function closeTransporter() {
  if (transporter) { transporter.close(); transporter = null; }
  cachedSmtp = null;
}

// After saving new SMTP settings, drop the cached transporter so the next
// send/verify rebuilds it from the updated effective config.
const reloadTransporter = closeTransporter;

module.exports = { sendEmail, verifyConnection, closeTransporter, reloadTransporter };
