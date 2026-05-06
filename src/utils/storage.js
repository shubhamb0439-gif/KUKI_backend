const { BlobServiceClient } = require('@azure/storage-blob');

function getBlobClient() {
  const connectionString = process.env.AZURE_STORAGE_CONNECTION_STRING;
  if (!connectionString) throw new Error('AZURE_STORAGE_CONNECTION_STRING not set');
  return BlobServiceClient.fromConnectionString(connectionString);
}

async function uploadToBlob(blobName, buffer, contentType) {
  const client = getBlobClient();
  const container = client.getContainerClient(process.env.AZURE_STORAGE_CONTAINER || 'profile-photos');
  await container.createIfNotExists({ access: 'blob' });
  const blockBlob = container.getBlockBlobClient(blobName);
  await blockBlob.upload(buffer, buffer.length, {
    blobHTTPHeaders: { blobContentType: contentType },
  });
  return blockBlob.url;
}

async function deleteFromBlob(blobName) {
  const client = getBlobClient();
  const container = client.getContainerClient(process.env.AZURE_STORAGE_CONTAINER || 'profile-photos');
  await container.getBlockBlobClient(blobName).deleteIfExists();
}

module.exports = { uploadToBlob, deleteFromBlob };
