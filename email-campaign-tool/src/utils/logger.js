const winston = require('winston');
const path = require('path');
const fs = require('fs');
const config = require('../config');

const isProd = config.env === 'production';

// In production (Render, Docker, etc.) we log to stdout/stderr only — the
// platform captures it. Writing to ./logs would be lost on every restart
// because Render's filesystem is ephemeral outside mounted disks.
//
// In development we ALSO write to local files for easier debugging.

const transports = [];

// Always log to console. In production use JSON for log aggregators;
// in dev use a colorized human-readable format.
transports.push(new winston.transports.Console({
  format: isProd
    ? winston.format.combine(
        winston.format.timestamp(),
        winston.format.errors({ stack: true }),
        winston.format.json()
      )
    : winston.format.combine(
        winston.format.colorize(),
        winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
        winston.format.printf(({ timestamp, level, message, stack, ...meta }) => {
          const metaStr = Object.keys(meta).length > 1 ? ` ${JSON.stringify(meta)}` : '';
          return `${timestamp} [${level}]: ${stack || message}${metaStr}`;
        })
      ),
}));

// Optional file transports for local dev only.
if (!isProd) {
  try {
    const logDir = path.resolve('logs');
    if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });
    transports.push(new winston.transports.File({
      filename: path.join(logDir, 'error.log'),
      level: 'error', maxsize: 5 * 1024 * 1024, maxFiles: 5,
    }));
    transports.push(new winston.transports.File({
      filename: path.join(logDir, 'combined.log'),
      maxsize: 5 * 1024 * 1024, maxFiles: 5,
    }));
  } catch (_) { /* fall back to console-only */ }
}

const logger = winston.createLogger({
  level: isProd ? 'info' : 'debug',
  defaultMeta: { service: 'email-campaign-tool' },
  transports,
  exitOnError: false,
});

module.exports = logger;
