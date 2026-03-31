const logger = require('../utils/logger');

function errorHandler(err, req, res, _next) {
  logger.error(`${req.method} ${req.path} — ${err.message}`, { stack: err.stack });

  const status = err.status || err.statusCode || 500;
  const message = status === 500 ? 'Internal server error' : err.message;

  if (req.accepts('html') && !req.path.startsWith('/api/')) {
    return res.status(status).render('error', { layout: false, status, message });
  }

  res.status(status).json({ error: message });
}

function notFound(req, res) {
  if (req.accepts('html') && !req.path.startsWith('/api/')) {
    return res.status(404).render('error', { layout: false, status: 404, message: 'Page not found' });
  }
  res.status(404).json({ error: 'Not found' });
}

module.exports = { errorHandler, notFound };
