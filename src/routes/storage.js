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

// GET /storage/:bucket/:path - proxy blob content (works even if public access is disabled)
const { BlobServiceClient } = require('@azure/storage-blob');
router.get('/:bucket/*', async (req, res) => {
  const bucket = req.params.bucket;
  const filePath = req.params[0];
  const connectionString = process.env.AZURE_STORAGE_CONNECTION_STRING;
  if (!connectionString) {
    const storageAccount = process.env.AZURE_STORAGE_ACCOUNT || 'kukistorageprod';
    return res.redirect(`https://${storageAccount}.blob.core.windows.net/${bucket}/${filePath}`);
  }
  try {
    const client = BlobServiceClient.fromConnectionString(connectionString);
    const container = client.getContainerClient(bucket);
    const blockBlob = container.getBlockBlobClient(filePath);
    const download = await blockBlob.download(0);
    res.setHeader('Content-Type', download.contentType || 'image/jpeg');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    download.readableStreamBody.pipe(res);
  } catch (err) {
    console.error('Storage proxy error:', err.message);
    res.status(404).json({ error: 'File not found' });
  }
});

module.exports = router;
