const net = require('net');
const fs = require('fs');
const path = require('path');

/** Resolve to an available TCP port on 127.0.0.1. */
function getFreePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

/**
 * Ensure a settings file exists at targetPath. If missing, copy templatePath
 * into it (creating parent dirs). Never overwrites an existing file.
 * Returns { created, path }.
 */
function ensureSettingsFile(targetPath, templatePath) {
  if (fs.existsSync(targetPath)) return { created: false, path: targetPath };
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.copyFileSync(templatePath, targetPath);
  return { created: true, path: targetPath };
}

module.exports = { getFreePort, ensureSettingsFile };
