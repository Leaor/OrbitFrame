/**
 * Icon Generator for OrbitFrame
 * Run: node scripts/generate-icons.js
 *
 * Generates PNG tray icon from a simple canvas drawing.
 * For production, replace assets/icon.png and assets/tray-icon.png
 * with properly exported versions from the SVGs.
 */

const fs = require('fs');
const path = require('path');

// Create a minimal 1x1 transparent PNG as placeholder
// In production, convert icon.svg to icon.png using an image tool
const TRANSPARENT_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAADklEQVQ4jWNgGAWDEwAAAhAAAbMr4dYAAAAASUVORK5CYII=',
  'base64'
);

const assetsDir = path.join(__dirname, '..', 'assets');

if (!fs.existsSync(path.join(assetsDir, 'icon.png'))) {
  fs.writeFileSync(path.join(assetsDir, 'icon.png'), TRANSPARENT_PNG);
  console.log('Created placeholder icon.png');
}

if (!fs.existsSync(path.join(assetsDir, 'tray-icon.png'))) {
  fs.writeFileSync(path.join(assetsDir, 'tray-icon.png'), TRANSPARENT_PNG);
  console.log('Created placeholder tray-icon.png');
}

console.log('Done. Replace with real icons exported from the SVGs for production.');
