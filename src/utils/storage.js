const { BlobServiceClient } = require('@azure/storage-blob');

function getBlobClient() {
  const connectionString = process.env.AZURE_STORAGE_CONNECTION_STRING;
  if (!connectionString) throw new Error('AZURE_STORAGE_CONNECTION_STRING not set');
  return BlobServiceClient.fromConnectionString(connectionString);
}

async function uploadToBlob(blobName, buffer, contentType) {
  const client = getBlobClient();
  const container = client.getContainerClient(process.env.AZURE_STORAGE_CONTAINER || 'profile-photos');
  // createIfNotExists with access:'blob' throws on accounts where public blob access is disabled.
  // Swallow the error — if the container already exists we can still upload fine.
  try {
    await container.createIfNotExists({ access: 'blob' });
  } catch (_) {
    await container.createIfNotExists();
  }
  const blockBlob = container.getBlockBlobClient(blobName);
  await blockBlob.upload(buffer, buffer.length, {
    blobHTTPHeaders: { blobContentType: contentType },
  });
  // If API_BASE_URL is set, return a proxied URL through our own backend
  // (works even when Azure Blob container has public access disabled).
  // Otherwise fall back to the direct Azure blob URL.
  const apiBase = process.env.API_BASE_URL;
  if (apiBase) {
    const containerName = process.env.AZURE_STORAGE_CONTAINER || 'profile-photos';
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
