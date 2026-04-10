const fs = require('fs');
const path = require('path');
const FormData = require('form-data');
const fetch = require('node-fetch');
const config = require('../utils/config');
const helpers = require('../utils/helpers');

async function upload(filePath, service) {
  service = service || config.get('upload.defaultService');

  switch (service) {
    case 'imgur':
      return uploadToImgur(filePath);
    case 'custom':
      return uploadToCustom(filePath);
    case 'local':
      return saveLocal(filePath);
    default:
      throw new Error(`Unknown upload service: ${service}`);
  }
}

async function uploadToImgur(filePath) {
  const imgurConfig = config.get('upload.imgur');
  if (!imgurConfig.clientId) {
    throw new Error('Imgur Client ID not configured. Set it in Settings → Upload.');
  }

  const imageData = fs.readFileSync(filePath).toString('base64');

  const response = await fetch('https://api.imgur.com/3/image', {
    method: 'POST',
    headers: {
      Authorization: `Client-ID ${imgurConfig.clientId}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      image: imageData,
      type: 'base64',
      title: 'OrbitFrame Capture'
    })
  });

  const data = await response.json();

  if (!data.success) {
    throw new Error(data.data?.error || 'Imgur upload failed');
  }

  return {
    url: data.data.link,
    deleteHash: data.data.deletehash,
    id: data.data.id,
    service: 'imgur'
  };
}

async function uploadToCustom(filePath) {
  const customConfig = config.get('upload.custom');

  if (!customConfig.url) {
    throw new Error('Custom upload URL not configured.');
  }

  const form = new FormData();
  form.append(customConfig.fieldName || 'file', fs.createReadStream(filePath));

  const headers = { ...customConfig.headers };

  const response = await fetch(customConfig.url, {
    method: customConfig.method || 'POST',
    headers,
    body: form
  });

  const data = await response.json();

  // Extract URL from response using dot-path notation
  const urlPath = customConfig.responseUrlPath || 'url';
  const url = urlPath.split('.').reduce((obj, key) => obj?.[key], data);

  return {
    url: url || 'Upload complete (no URL returned)',
    service: 'custom',
    rawResponse: data
  };
}

async function saveLocal(filePath) {
  const savePath = config.get('general.savePath');
  helpers.ensureDir(savePath);

  const filename = path.basename(filePath);
  const destPath = path.join(savePath, filename);

  if (filePath !== destPath) {
    fs.copyFileSync(filePath, destPath);
  }

  const localConfig = config.get('upload.local');

  return {
    url: localConfig.serverEnabled
      ? `${localConfig.baseUrl}/${filename}`
      : `file://${destPath}`,
    path: destPath,
    service: 'local'
  };
}

async function uploadBuffer(buffer, filename, service) {
  const tempDir = require('os').tmpdir();
  const tempPath = path.join(tempDir, filename);
  fs.writeFileSync(tempPath, buffer);

  try {
    const result = await upload(tempPath, service);
    return result;
  } finally {
    try { fs.unlinkSync(tempPath); } catch {}
  }
}

module.exports = { upload, uploadBuffer, uploadToImgur, uploadToCustom, saveLocal };
