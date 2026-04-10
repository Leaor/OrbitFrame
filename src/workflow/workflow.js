const { clipboard, nativeImage, Notification, BrowserWindow, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const config = require('../utils/config');
const helpers = require('../utils/helpers');
const uploadModule = require('../upload/upload');

async function executeAfterCapture(result, captureType) {
  const actions = config.get('afterCapture');
  const savePath = config.get('general.savePath');
  helpers.ensureDir(savePath);

  let savedPath = null;
  let uploadResult = null;

  // Determine workflow steps
  const activeWorkflow = actions.activeWorkflow || 'quick-copy';
  const workflows = actions.workflows || {};
  const workflow = workflows[activeWorkflow];
  const steps = workflow ? workflow.steps : [];

  // Save to file (from workflow steps or legacy toggle)
  const shouldSave = steps.includes('save') || actions.saveToFile;
  if (shouldSave && result.buffer) {
    const filename = result.filename || helpers.generateFilename(
      config.get('general.filenamePattern'),
      config.get('general.imageFormat')
    );
    savedPath = path.join(savePath, filename);
    fs.writeFileSync(savedPath, result.buffer);
    result.savedPath = savedPath;
  }

  // Copy to clipboard (from workflow steps or legacy toggle)
  const shouldCopy = steps.includes('copy') || actions.copyToClipboard;
  if (shouldCopy && result.buffer) {
    const img = nativeImage.createFromBuffer(result.buffer);
    clipboard.writeImage(img);
  }

  // Auto upload (from workflow steps or legacy toggle)
  const shouldUpload = steps.includes('upload') || actions.autoUpload;
  if (shouldUpload && savedPath) {
    try {
      uploadResult = await uploadModule.upload(savedPath);
      result.uploadResult = uploadResult;

      if (uploadResult.url && (steps.includes('copy-url') || actions.autoUpload)) {
        clipboard.writeText(uploadResult.url);
      }
    } catch (err) {
      console.error('Auto-upload failed:', err);
    }
  }

  // Open editor (from workflow steps or legacy toggle)
  const shouldEdit = steps.includes('edit') || actions.openEditor;
  if (shouldEdit && result.buffer) {
    const mainWin = BrowserWindow.getAllWindows().find(w => !w.isDestroyed());
    if (mainWin) {
      mainWin.show();
      mainWin.webContents.send('open-editor', {
        buffer: result.buffer.toString('base64'),
        filename: result.filename,
        width: result.width,
        height: result.height
      });
    }
  }

  // Show the after-capture floating popup
  if (actions.showPopup !== false && result.buffer) {
    // This calls back into main.js via require
    const mainProcess = require('../main/main');
    if (typeof mainProcess.showAfterCapturePopup === 'function') {
      mainProcess.showAfterCapturePopup({
        buffer: result.buffer,
        filename: result.filename,
        savedPath,
        uploadResult,
        type: captureType,
        width: result.width,
        height: result.height
      });
    }
  }

  // Also send preview to main window (for history tracking)
  const mainWin = BrowserWindow.getAllWindows().find(w => !w.isDestroyed());
  if (mainWin) {
    mainWin.webContents.send('show-capture-preview', {
      buffer: result.buffer ? result.buffer.toString('base64') : null,
      filename: result.filename,
      savedPath,
      uploadResult,
      type: captureType
    });
  }

  // Notification (from workflow steps or legacy toggle)
  const shouldNotify = steps.includes('notify') || actions.showNotification;
  if (shouldNotify) {
    const notifBody = uploadResult?.url
      ? `Uploaded: ${uploadResult.url}`
      : savedPath
        ? `Saved: ${path.basename(savedPath)}`
        : 'Capture complete';

    new Notification({
      title: 'OrbitFrame',
      body: notifBody
    }).show();
  }

  return { savedPath, uploadResult };
}

module.exports = { executeAfterCapture };
