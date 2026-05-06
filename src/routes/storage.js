const express = require('express');
const multer = require('multer');
const { uploadToBlob } = require('../utils/storage');
const { authenticate } = require('../middleware/auth');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

// POST /storage/upload
router.post('/upload', authenticate, upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file' });
  try {
    const path = req.body.path || `${Date.now()}-${req.file.originalname}`;
    const url = await uploadToBlob(path, req.file.buffer, req.file.mimetype);
    res.json({ path, url });
  } catch (err) {
    console.error('Storage upload error:', err);
    res.status(500).json({ error: 'Upload failed' });
  }
});

// GET /storage/:bucket/:path - redirect to blob URL
router.get('/:bucket/*', (req, res) => {
  const bucket = req.params.bucket;
  const filePath = req.params[0];
  const storageAccount = process.env.AZURE_STORAGE_ACCOUNT || 'kukistorageprod';
  res.redirect(`https://${storageAccount}.blob.core.windows.net/${bucket}/${filePath}`);
});

module.exports = router;
