const path = require('path');
const fs = require('fs');
const { clipboard, nativeImage } = require('electron');

function generateFilename(pattern, format) {
  const now = new Date();
  const date = now.toISOString().split('T')[0];
  const time = now.toTimeString().split(' ')[0].replace(/:/g, '-');
  const timestamp = Date.now();
  const name = pattern
    .replace('{date}', date)
    .replace('{time}', time)
    .replace('{timestamp}', timestamp);
  return `${name}.${format}`;
}

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
  return dirPath;
}

function copyImageToClipboard(imagePath) {
  const img = nativeImage.createFromPath(imagePath);
  clipboard.writeImage(img);
}

function copyBufferToClipboard(buffer) {
  const img = nativeImage.createFromBuffer(buffer);
  clipboard.writeImage(img);
}

function bufferToDataUrl(buffer, mime = 'image/png') {
  return `data:${mime};base64,${buffer.toString('base64')}`;
}

function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

module.exports = {
  generateFilename,
  ensureDir,
  copyImageToClipboard,
  copyBufferToClipboard,
  bufferToDataUrl,
  formatBytes
};
