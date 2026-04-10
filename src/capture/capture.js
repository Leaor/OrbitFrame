const { desktopCapturer, screen, BrowserWindow } = require('electron');
const screenshot = require('screenshot-desktop');
const path = require('path');
const fs = require('fs');
const config = require('../utils/config');
const helpers = require('../utils/helpers');

let lastRegion = null;

async function captureFullscreen() {
  const displays = screen.getAllDisplays();
  const primaryDisplay = screen.getPrimaryDisplay();

  try {
    // Use screenshot-desktop for reliable fullscreen capture
    const imgBuffer = await screenshot({ format: 'png' });
    const filename = helpers.generateFilename(
      config.get('general.filenamePattern'),
      config.get('general.imageFormat')
    );

    return {
      buffer: imgBuffer,
      filename,
      width: primaryDisplay.size.width,
      height: primaryDisplay.size.height,
      type: 'fullscreen'
    };
  } catch (err) {
    // Fallback: use desktopCapturer
    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: {
        width: primaryDisplay.size.width * primaryDisplay.scaleFactor,
        height: primaryDisplay.size.height * primaryDisplay.scaleFactor
      }
    });

    if (sources.length === 0) throw new Error('No screen sources found');

    const source = sources[0];
    const imgBuffer = source.thumbnail.toPNG();
    const filename = helpers.generateFilename(
      config.get('general.filenamePattern'),
      'png'
    );

    return {
      buffer: imgBuffer,
      filename,
      width: primaryDisplay.size.width,
      height: primaryDisplay.size.height,
      type: 'fullscreen'
    };
  }
}

async function captureRegion(region) {
  lastRegion = region;
  const { x, y, width, height } = region;

  // Capture fullscreen first, then crop
  const fullCapture = await captureFullscreen();
  const Jimp = require('jimp');

  const image = await Jimp.read(fullCapture.buffer);
  const scaleFactor = screen.getPrimaryDisplay().scaleFactor;

  image.crop(
    Math.round(x * scaleFactor),
    Math.round(y * scaleFactor),
    Math.round(width * scaleFactor),
    Math.round(height * scaleFactor)
  );

  const buffer = await image.getBufferAsync(Jimp.MIME_PNG);
  const filename = helpers.generateFilename(
    config.get('general.filenamePattern'),
    'png'
  );

  return {
    buffer,
    filename,
    width,
    height,
    region,
    type: 'region'
  };
}

async function captureLastRegion() {
  if (!lastRegion) {
    throw new Error('No previous region capture found');
  }
  return captureRegion(lastRegion);
}

async function captureWindow() {
  const sources = await desktopCapturer.getSources({
    types: ['window'],
    thumbnailSize: { width: 1920, height: 1080 },
    fetchWindowIcons: true
  });

  if (sources.length === 0) throw new Error('No window sources found');

  // Return the focused/first window
  const source = sources[0];
  const imgBuffer = source.thumbnail.toPNG();
  const filename = helpers.generateFilename(
    config.get('general.filenamePattern'),
    'png'
  );

  return {
    buffer: imgBuffer,
    filename,
    width: source.thumbnail.getSize().width,
    height: source.thumbnail.getSize().height,
    windowName: source.name,
    type: 'window'
  };
}

async function captureScrolling() {
  // Scrolling capture is initiated via the renderer process
  // This returns a placeholder; the actual stitching happens in the UI
  const fullCapture = await captureFullscreen();
  return {
    ...fullCapture,
    type: 'scrolling'
  };
}

async function recordGif(region) {
  // GIF recording is handled by the renderer using MediaRecorder API
  // This module provides the metadata
  return {
    type: 'gif',
    region,
    fps: config.get('general.gifFps'),
    width: config.get('general.gifWidth')
  };
}

async function recordVideo(region) {
  return {
    type: 'video',
    region,
    fps: config.get('general.videoFps'),
    format: config.get('general.videoFormat'),
    includeAudio: config.get('recording.includeSystemAudio'),
    includeMic: config.get('recording.includeMicrophone')
  };
}

module.exports = {
  captureFullscreen,
  captureRegion,
  captureLastRegion,
  captureWindow,
  captureScrolling,
  recordGif,
  recordVideo
};
