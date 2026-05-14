const { BlobServiceClient } = require('@azure/storage-blob');

function getBlobClient() {
  const connectionString = process.env.AZURE_STORAGE_CONNECTION_STRING;
  if (!connectionString) throw new Error('AZURE_STORAGE_CONNECTION_STRING not set');
  return BlobServiceClient.fromConnectionString(connectionString);
}

async function uploadToBlob(blobName, buffer, contentType) {
  const client = getBlobClient();
  const containerName = process.env.AZURE_STORAGE_CONTAINER || 'profile-photos';
  const container = client.getContainerClient(containerName);

  try { await container.createIfNotExists(); } catch (e) {
    console.log('Container createIfNotExists skipped:', e.code || e.message);
  }

  const blockBlob = container.getBlockBlobClient(blobName);
  console.log(`Uploading to Azure: ${containerName}/${blobName} (${buffer.length} bytes, ${contentType})`);
  await blockBlob.uploadData(buffer, {
    blobHTTPHeaders: { blobContentType: contentType },
  });
  console.log(`Azure upload success: ${blockBlob.url}`);

  const apiBase = process.env.API_BASE_URL;
  if (apiBase) {
    return `${apiBase.replace(/\/$/, '')}/storage/${containerName}/${blobName}`;
  }
  return blockBlob.url;
}

async function deleteFromBlob(blobName) {
  const client = getBlobClient();
  const container = client.getContainerClient(process.env.AZURE_STORAGE_CONTAINER || 'profile-photos');
  await container.getBlockBlobClient(blobName).deleteIfExists();
}

module.exports = { uploadToBlob, deleteFromBlob };
