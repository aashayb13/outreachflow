const nodemailer = require('nodemailer');
const config = require('../config');
const logger = require('../utils/logger');

let transporter = null;

function getTransporter() {
  if (transporter) return transporter;

  transporter = nodemailer.createTransport({
    host: config.smtp.host,
    port: config.smtp.port,
    secure: config.smtp.secure,
    auth: {
      user: config.smtp.user,
      pass: config.smtp.pass,
    },
    pool: true,
    maxConnections: 5,
    maxMessages: 100,
    rateDelta: 1000,
    rateLimit: config.sendRate.perSecond,
  });

  return transporter;
}

/**
 * Send a single email.
 * Returns { success, messageId, error }
 */
async function sendEmail({ to, subject, html, text, from, replyTo, headers = {} }) {
  const transport = getTransporter();

  const fromAddress = from || `"${config.smtp.fromName}" <${config.smtp.fromEmail}>`;
  const mailOptions = {
    from: fromAddress,
    to,
    subject,
    html,
    text,
    replyTo: replyTo || config.smtp.fromEmail,
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
 * Verify SMTP connection is working.
 */
async function verifyConnection() {
  try {
    const transport = getTransporter();
    await transport.verify();
    logger.info('SMTP connection verified');
    return { success: true };
  } catch (error) {
    logger.error(`SMTP verification failed: ${error.message}`);
    return { success: false, error: error.message };
  }
}

/**
 * Close the transporter pool.
 */
function closeTransporter() {
  if (transporter) {
    transporter.close();
    transporter = null;
  }
}

module.exports = { sendEmail, verifyConnection, closeTransporter };
