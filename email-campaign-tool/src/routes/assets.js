const express = require('express');
const multer = require('multer');
const router = express.Router();
const { getDb } = require('../db/connection');
const { authenticate, requirePermission } = require('../middleware/auth');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

router.use(authenticate);

// List assets (metadata only — never send data_base64 in the list)
router.get('/', async (req, res, next) => {
  try {
    const db = getDb();
    const assets = await db.prepare(
      'SELECT id, name, filename, mime_type, size_bytes, created_at FROM assets ORDER BY created_at DESC'
    ).all();
    res.json({ assets });
  } catch (err) { next(err); }
});

// Upload an asset
router.post('/', requirePermission('write'), upload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded (field name "file")' });
    const db = getDb();
    const name = (req.body && req.body.name) || req.file.originalname;
    const dataBase64 = req.file.buffer.toString('base64');
    const result = await db.prepare(`
      INSERT INTO assets (name, filename, mime_type, size_bytes, data_base64)
      VALUES (?, ?, ?, ?, ?)
    `).run(name, req.file.originalname, req.file.mimetype, req.file.size, dataBase64);
    const asset = await db.prepare(
      'SELECT id, name, filename, mime_type, size_bytes, created_at FROM assets WHERE id = ?'
    ).get(result.lastInsertRowid);
    res.status(201).json({ asset });
  } catch (err) { next(err); }
});

// Delete an asset
router.delete('/:id', requirePermission('write'), async (req, res, next) => {
  try {
    const db = getDb();
    await db.prepare('DELETE FROM assets WHERE id = ?').run(req.params.id);
    res.json({ message: 'Asset deleted' });
  } catch (err) { next(err); }
});

module.exports = router;
