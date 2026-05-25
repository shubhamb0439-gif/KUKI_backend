const express = require('express');
const multer = require('multer');
const { BlobServiceClient } = require('@azure/storage-blob');
const { uploadToBlob } = require('../utils/storage');
const { authenticate } = require('../middleware/auth');

const router = express.Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 200 * 1024 * 1024 }, // 200MB — covers video uploads
});

// POST /storage/upload
router.post('/upload', authenticate, upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file' });
  const bucket = req.body.bucket || process.env.AZURE_STORAGE_CONTAINER || 'profile-photos';
  const path = req.body.path || `${Date.now()}-${req.file.originalname}`;
  try {
    await uploadToBlob(path, req.file.buffer, req.file.mimetype, bucket);
    res.json({ path });
  } catch (err) {
    console.error('Storage upload error:', err);
    res.status(500).json({ error: 'Upload failed' });
  }
});

// GET /storage/:bucket/:filename — proxy with range request support for video seeking
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

    const props = await blockBlob.getProperties();
    const fileSize = props.contentLength;
    const contentType = props.contentType || 'application/octet-stream';

    res.setHeader('Accept-Ranges', 'bytes');

    const rangeHeader = req.headers['range'];
    if (rangeHeader) {
      const [startStr, endStr] = rangeHeader.replace(/bytes=/, '').split('-');
      const start = parseInt(startStr, 10);
      const end = endStr ? parseInt(endStr, 10) : fileSize - 1;
      const chunkSize = end - start + 1;

      const download = await blockBlob.download(start, chunkSize);
      res.status(206);
      res.setHeader('Content-Range', `bytes ${start}-${end}/${fileSize}`);
      res.setHeader('Content-Length', chunkSize);
      res.setHeader('Content-Type', contentType);
      download.readableStreamBody.pipe(res);
    } else {
      const download = await blockBlob.download(0);
      res.setHeader('Content-Type', contentType);
      res.setHeader('Content-Length', fileSize);
      res.setHeader('Cache-Control', 'public, max-age=86400');
      download.readableStreamBody.pipe(res);
    }
  } catch (err) {
    console.error('Storage proxy error:', err.message);
    res.status(404).json({ error: 'File not found' });
  }
});

module.exports = router;
