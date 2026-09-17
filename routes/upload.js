const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/auth');
const upload = require('../middleware/upload');

/**
 * POST /api/upload
 * Field: 'file'
 * Returns: { url: '/uploads/...filename', mimetype, size, originalname }
 *
 * Any authenticated user may upload — the frontend sends profile photos,
 * lesson images/videos/audio, and note attachments through this endpoint.
 */
router.post('/', protect, upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ message: 'No file uploaded' });
  res.status(201).json({
    url: `/uploads/${req.file.filename}`,
    mimetype: req.file.mimetype,
    size: req.file.size,
    originalname: req.file.originalname,
  });
});

module.exports = router;
