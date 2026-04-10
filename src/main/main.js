const { app, BrowserWindow, Tray, Menu, globalShortcut, ipcMain, nativeImage, dialog, screen, desktopCapturer, Notification } = require('electron');
const path = require('path');
const fs = require('fs');

// Handle single instance
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
}

let mainWindow = null;
let tray = null;
let regionWindow = null;
let editorWindow = null;
let settingsWindow = null;
let afterCaptureWindow = null;

// Lazy-load modules to improve startup time
let config, helpers, captureModule, uploadModule, workflowModule;

function loadModules() {
  config = require('../utils/config');
  helpers = require('../utils/helpers');
  captureModule = require('../capture/capture');
  uploadModule = require('../upload/upload');
  workflowModule = require('../workflow/workflow');
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 900,
    height: 640,
    minWidth: 700,
    minHeight: 500,
    frame: false,
    show: false,
    icon: path.join(__dirname, '../../assets/icon.png'),
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      enableRemoteModule: true
    },
    backgroundColor: '#0D1117'
  });

  mainWindow.loadFile(path.join(__dirname, '../ui/index.html'));

  mainWindow.once('ready-to-show', () => {
    if (!config.get('general.startMinimized')) {
      mainWindow.show();
    }
  });

  mainWindow.on('close', (e) => {
    if (config.get('general.showTrayIcon')) {
      e.preventDefault();
      mainWindow.hide();
    }
  });
}

function createTray() {
  const icon = nativeImage.createFromPath(
    path.join(__dirname, '../../assets/tray-icon.png')
  ).resize({ width: 16, height: 16 });

  tray = new Tray(icon.isEmpty() ? nativeImage.createEmpty() : icon);

  const contextMenu = Menu.buildFromTemplate([
    { label: 'OrbitFrame', enabled: false, icon: icon.isEmpty() ? undefined : icon },
    { type: 'separator' },

    // ── Capture ──
    { label: '  CAPTURE', enabled: false },
    { label: '    Fullscreen', accelerator: config.get('hotkeys.fullscreen'), click: () => doCapture('fullscreen') },
    { label: '    Region Select', accelerator: config.get('hotkeys.region'), click: () => doCapture('region') },
    { label: '    Active Window', accelerator: config.get('hotkeys.window'), click: () => doCapture('window') },
    { label: '    Scrolling Capture', accelerator: config.get('hotkeys.scrolling'), click: () => doCapture('scrolling') },
    { type: 'separator' },

    // ── Record ──
    { label: '  RECORD', enabled: false },
    { label: '    GIF Recording', accelerator: config.get('hotkeys.gif'), click: () => doCapture('gif') },
    { label: '    Video Recording', accelerator: config.get('hotkeys.video'), click: () => doCapture('video') },
    { type: 'separator' },

    // ── Tools ──
    { label: '  TOOLS', enabled: false },
    { label: '    OCR — Extract Text', accelerator: config.get('hotkeys.ocr'), click: () => doCapture('ocr') },
    { label: '    Image Editor', click: () => { mainWindow.show(); mainWindow.webContents.send('navigate', 'editor'); } },
    { type: 'separator' },

    // ── Quick Access ──
    { label: '    Open Dashboard', click: () => mainWindow.show() },
    { label: '    History', click: () => { mainWindow.show(); mainWindow.webContents.send('navigate', 'history'); } },
    { label: '    Settings', click: () => openSettings() },
    { type: 'separator' },
    { label: '    Quit OrbitFrame', click: () => { app.isQuitting = true; app.quit(); } }
  ]);

  tray.setToolTip('OrbitFrame — Screen Capture Toolkit');
  tray.setContextMenu(contextMenu);
  tray.on('double-click', () => mainWindow.show());
}

// ──── After Capture Popup ────

function showAfterCapturePopup(data) {
  if (afterCaptureWindow && !afterCaptureWindow.isDestroyed()) {
    afterCaptureWindow.close();
  }

  const display = screen.getPrimaryDisplay();
  const { width: screenW, height: screenH } = display.workAreaSize;
  const popupW = 356;
  const popupH = 280;

  afterCaptureWindow = new BrowserWindow({
    width: popupW,
    height: popupH,
    x: screenW - popupW - 16,
    y: screenH - popupH - 16,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    movable: true,
    focusable: true,
    show: false,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });

  afterCaptureWindow.loadFile(path.join(__dirname, '../ui/after-capture.html'));

  afterCaptureWindow.once('ready-to-show', () => {
    afterCaptureWindow.show();

    // Build auto-actions based on active workflow
    const activeWorkflow = config.get('afterCapture.activeWorkflow') || 'quick-copy';
    const workflows = config.get('afterCapture.workflows') || {};
    const workflow = workflows[activeWorkflow];
    const autoActions = [];
    if (workflow) {
      if (workflow.steps.includes('copy')) autoActions.push('copy');
      if (workflow.steps.includes('save')) autoActions.push('save');
    }

    afterCaptureWindow.webContents.send('load-capture', {
      buffer: data.buffer ? data.buffer.toString('base64') : null,
      filename: data.filename,
      savedPath: data.savedPath,
      type: data.type,
      width: data.width,
      height: data.height,
      autoActions
    });
  });

  afterCaptureWindow.on('closed', () => {
    afterCaptureWindow = null;
  });
}

// ──── After Capture IPC Actions ────

function setupAfterCaptureIPC() {
  ipcMain.on('after-capture-action', async (event, action, data) => {
    switch (action) {
      case 'copy': {
        if (data.buffer) {
          const img = nativeImage.createFromBuffer(Buffer.from(data.buffer, 'base64'));
          const { clipboard } = require('electron');
          clipboard.writeImage(img);
        }
        break;
      }
      case 'save': {
        if (data.buffer) {
          const savePath = config.get('general.savePath');
          helpers.ensureDir(savePath);
          const filename = data.filename || helpers.generateFilename(
            config.get('general.filenamePattern'),
            config.get('general.imageFormat')
          );
          const fullPath = path.join(savePath, filename);
          fs.writeFileSync(fullPath, Buffer.from(data.buffer, 'base64'));
          data.savedPath = fullPath;
        }
        break;
      }
      case 'edit': {
        mainWindow.show();
        mainWindow.webContents.send('open-editor', {
          buffer: data.buffer,
          filename: data.filename
        });
        break;
      }
      case 'upload': {
        if (data.savedPath) {
          try {
            const result = await uploadModule.upload(data.savedPath);
            if (result?.url) {
              const { clipboard } = require('electron');
              clipboard.writeText(result.url);
              if (afterCaptureWindow && !afterCaptureWindow.isDestroyed()) {
                afterCaptureWindow.webContents.send('upload-complete', result.url);
              }
            }
          } catch (err) {
            console.error('Upload failed:', err);
          }
        }
        break;
      }
      case 'ocr': {
        if (data.savedPath || data.buffer) {
          try {
            const { runOCR } = require('../capture/ocr');
            let ocrPath = data.savedPath;
            if (!ocrPath && data.buffer) {
              const tmp = path.join(app.getPath('temp'), 'orbframe-ocr-tmp.png');
              fs.writeFileSync(tmp, Buffer.from(data.buffer, 'base64'));
              ocrPath = tmp;
            }
            const text = await runOCR(ocrPath);
            const { clipboard } = require('electron');
            clipboard.writeText(text);
            if (afterCaptureWindow && !afterCaptureWindow.isDestroyed()) {
              afterCaptureWindow.webContents.send('ocr-complete', text);
            }
          } catch (err) {
            console.error('OCR failed:', err);
          }
        }
        break;
      }
      case 'delete': {
        if (data.savedPath && fs.existsSync(data.savedPath)) {
          fs.unlinkSync(data.savedPath);
        }
        break;
      }
      case 'pin': {
        // Create a small always-on-top preview window
        if (data.buffer) {
          const pinWin = new BrowserWindow({
            width: 300,
            height: 200,
            frame: false,
            alwaysOnTop: true,
            resizable: true,
            transparent: false,
            webPreferences: { nodeIntegration: true, contextIsolation: false }
          });
          pinWin.loadURL(`data:text/html,<body style="margin:0;background:#000"><img src="data:image/png;base64,${data.buffer}" style="width:100%;height:100%;object-fit:contain"><script>window.onkeydown=e=>{if(e.key==='Escape')window.close()}</script></body>`);
        }
        break;
      }
      case 'settings': {
        mainWindow.show();
        mainWindow.webContents.send('navigate', 'settings');
        break;
      }
    }
  });

  ipcMain.on('close-after-capture', () => {
    if (afterCaptureWindow && !afterCaptureWindow.isDestroyed()) {
      afterCaptureWindow.close();
    }
  });
}

function registerHotkeys() {
  globalShortcut.unregisterAll();
  const hotkeys = config.get('hotkeys');

  const bindings = {
    fullscreen: () => doCapture('fullscreen'),
    region: () => doCapture('region'),
    window: () => doCapture('window'),
    scrolling: () => doCapture('scrolling'),
    gif: () => doCapture('gif'),
    video: () => doCapture('video'),
    clipboard: () => doCapture('clipboard'),
    ocr: () => doCapture('ocr'),
    lastRegion: () => doCapture('lastRegion')
  };

  for (const [action, shortcut] of Object.entries(hotkeys)) {
    if (shortcut && bindings[action]) {
      try {
        globalShortcut.register(shortcut, bindings[action]);
      } catch (err) {
        console.error(`Failed to register hotkey ${shortcut} for ${action}:`, err.message);
      }
    }
  }
}

async function doCapture(type) {
  try {
    let result;
    switch (type) {
      case 'fullscreen':
        result = await captureModule.captureFullscreen();
        break;
      case 'region':
        result = await openRegionSelector();
        break;
      case 'window':
        result = await captureModule.captureWindow();
        break;
      case 'scrolling':
        result = await captureModule.captureScrolling();
        break;
      case 'gif':
        result = await openRecordingSelector('gif');
        break;
      case 'video':
        result = await openRecordingSelector('video');
        break;
      case 'ocr':
        result = await openRegionSelector('ocr');
        break;
      case 'clipboard':
        result = await captureModule.captureFullscreen();
        if (result) helpers.copyBufferToClipboard(result.buffer);
        return;
      case 'lastRegion':
        result = await captureModule.captureLastRegion();
        break;
    }

    if (result) {
      if (result._toolbarAction) {
        await handleToolbarQuickAction(result._toolbarAction, result);
      } else {
        await workflowModule.executeAfterCapture(result, type);
      }
    }
  } catch (err) {
    console.error(`Capture error (${type}):`, err);
    showNotification('Capture Failed', err.message);
  }
}

async function openRegionSelector(mode = 'capture') {
  // Pre-capture the screen before overlay appears (for toolbar annotation flow)
  let preCapture = null;
  try {
    preCapture = await captureModule.captureFullscreen();
  } catch (err) {
    console.error('Pre-capture failed, falling back to transparent overlay:', err);
  }

  const primaryDisplay = screen.getPrimaryDisplay();
  const sf = primaryDisplay.scaleFactor;

  return new Promise((resolve, reject) => {
    const displays = screen.getAllDisplays();

    // Compute bounding box across all displays
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    displays.forEach(d => {
      minX = Math.min(minX, d.bounds.x);
      minY = Math.min(minY, d.bounds.y);
      maxX = Math.max(maxX, d.bounds.x + d.bounds.width);
      maxY = Math.max(maxY, d.bounds.y + d.bounds.height);
    });

    regionWindow = new BrowserWindow({
      x: minX,
      y: minY,
      width: maxX - minX,
      height: maxY - minY,
      frame: false,
      transparent: true,
      alwaysOnTop: true,
      skipTaskbar: true,
      fullscreen: false,
      resizable: false,
      webPreferences: {
        nodeIntegration: true,
        contextIsolation: false
      }
    });

    regionWindow.loadFile(path.join(__dirname, '../ui/region-selector.html'));
    regionWindow.setAlwaysOnTop(true, 'screen-saver');
    regionWindow.maximize();

    // Send pre-captured screenshot to overlay once ready
    regionWindow.once('ready-to-show', () => {
      regionWindow.webContents.send('init-region-capture', {
        screenshot: preCapture ? preCapture.buffer.toString('base64') : null,
        scaleFactor: sf,
        mode: mode
      });
    });

    // Cleanup helper — removes all region IPC listeners
    const cleanup = () => {
      ipcMain.removeListener('region-confirmed', onConfirmed);
      ipcMain.removeListener('region-selected', onSelected);
      ipcMain.removeListener('region-cancelled', onCancelled);
    };

    // New: toolbar confirms with pre-rendered annotated image
    const onConfirmed = (event, data) => {
      cleanup();
      if (regionWindow) { regionWindow.close(); regionWindow = null; }

      const buffer = Buffer.from(data.imageBase64, 'base64');
      const filename = helpers.generateFilename(
        config.get('general.filenamePattern'), 'png'
      );

      const result = {
        buffer,
        filename,
        width: data.region.width,
        height: data.region.height,
        region: data.region,
        type: 'region'
      };

      if (data.quickAction && data.quickAction !== 'confirm') {
        result._toolbarAction = data.quickAction;
      }

      resolve(result);
    };

    // Legacy: direct region selection (OCR mode / no pre-capture fallback)
    const onSelected = async (event, region) => {
      cleanup();
      if (regionWindow) { regionWindow.close(); regionWindow = null; }
      try {
        const result = await captureModule.captureRegion(region);
        resolve(result);
      } catch (err) {
        reject(err);
      }
    };

    const onCancelled = () => {
      cleanup();
      if (regionWindow) { regionWindow.close(); regionWindow = null; }
      resolve(null);
    };

    ipcMain.once('region-confirmed', onConfirmed);
    ipcMain.once('region-selected', onSelected);
    ipcMain.once('region-cancelled', onCancelled);
  });
}

async function handleToolbarQuickAction(action, result) {
  const data = {
    buffer: result.buffer.toString('base64'),
    filename: result.filename,
    savedPath: null
  };

  switch (action) {
    case 'save':
    case 'copy-path': {
      const savePath = config.get('general.savePath');
      helpers.ensureDir(savePath);
      const fullPath = path.join(savePath, result.filename);
      fs.writeFileSync(fullPath, result.buffer);
      result.savedPath = fullPath;
      if (action === 'copy-path') {
        require('electron').clipboard.writeText(fullPath);
        showNotification('Path Copied', fullPath);
      } else {
        showNotification('Capture Saved', fullPath);
      }
      break;
    }
    case 'copy': {
      const img = nativeImage.createFromBuffer(result.buffer);
      require('electron').clipboard.writeImage(img);
      showNotification('Copied', 'Image copied to clipboard');
      break;
    }
    case 'edit': {
      mainWindow.show();
      mainWindow.webContents.send('open-editor', {
        buffer: data.buffer,
        filename: data.filename
      });
      break;
    }
    case 'upload': {
      const savePath = config.get('general.savePath');
      helpers.ensureDir(savePath);
      const fullPath = path.join(savePath, result.filename);
      fs.writeFileSync(fullPath, result.buffer);
      result.savedPath = fullPath;
      try {
        const uploadResult = await uploadModule.upload(fullPath);
        if (uploadResult?.url) {
          require('electron').clipboard.writeText(uploadResult.url);
          showNotification('Uploaded', `URL copied: ${uploadResult.url}`);
        }
      } catch (err) {
        showNotification('Upload Failed', err.message);
      }
      break;
    }
    case 'ocr': {
      try {
        const tmp = path.join(app.getPath('temp'), 'orbframe-ocr-tmp.png');
        fs.writeFileSync(tmp, result.buffer);
        const { runOCR } = require('../capture/ocr');
        const text = await runOCR(tmp);
        require('electron').clipboard.writeText(text);
        showNotification('OCR Complete', 'Text copied to clipboard');
      } catch (err) {
        showNotification('OCR Failed', err.message);
      }
      break;
    }
    case 'pin': {
      const pinWin = new BrowserWindow({
        width: Math.min(result.width || 400, 500),
        height: Math.min(result.height || 300, 400),
        frame: false,
        alwaysOnTop: true,
        resizable: true,
        transparent: false,
        webPreferences: { nodeIntegration: true, contextIsolation: false }
      });
      pinWin.loadURL(`data:text/html,<body style="margin:0;background:#000"><img src="data:image/png;base64,${data.buffer}" style="width:100%;height:100%;object-fit:contain"><script>window.onkeydown=e=>{if(e.key==='Escape')window.close()}</script></body>`);
      break;
    }
  }

  // Add to history in main window
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('show-capture-preview', {
      buffer: data.buffer,
      filename: result.filename,
      savedPath: result.savedPath,
      type: 'region',
      width: result.width,
      height: result.height
    });
  }
}

function openRecordingSelector(type) {
  return new Promise((resolve) => {
    regionWindow = new BrowserWindow({
      fullscreen: true,
      frame: false,
      transparent: true,
      alwaysOnTop: true,
      skipTaskbar: true,
      webPreferences: {
        nodeIntegration: true,
        contextIsolation: false
      }
    });

    regionWindow.loadFile(path.join(__dirname, '../ui/recording-selector.html'));
    regionWindow.setAlwaysOnTop(true, 'screen-saver');

    ipcMain.once('recording-region-selected', async (event, region) => {
      if (regionWindow) {
        regionWindow.close();
        regionWindow = null;
      }
      try {
        const result = type === 'gif'
          ? await captureModule.recordGif(region)
          : await captureModule.recordVideo(region);
        resolve(result);
      } catch (err) {
        console.error('Recording error:', err);
        resolve(null);
      }
    });

    ipcMain.once('recording-cancelled', () => {
      if (regionWindow) {
        regionWindow.close();
        regionWindow = null;
      }
      resolve(null);
    });
  });
}

function openEditor(imageData) {
  editorWindow = new BrowserWindow({
    width: 1100,
    height: 750,
    frame: false,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    },
    backgroundColor: '#0D1117'
  });

  editorWindow.loadFile(path.join(__dirname, '../ui/editor.html'));
  editorWindow.once('ready-to-show', () => {
    editorWindow.webContents.send('load-image', imageData);
  });
}

function openSettings() {
  if (settingsWindow) {
    settingsWindow.show();
    return;
  }
  mainWindow.show();
  mainWindow.webContents.send('navigate', 'settings');
}

function showNotification(title, body) {
  if (config.get('afterCapture.showNotification')) {
    new Notification({ title: `OrbitFrame: ${title}`, body }).show();
  }
}

// ──── IPC Handlers ────

function setupIPC() {
  ipcMain.handle('get-config', () => config.getAll());
  ipcMain.handle('set-config', (event, key, value) => config.set(key, value));
  ipcMain.handle('reset-config', () => config.reset());

  ipcMain.handle('do-capture', (event, type) => doCapture(type));
  ipcMain.handle('open-editor', (event, imageData) => openEditor(imageData));

  ipcMain.handle('upload-file', async (event, filePath, service) => {
    return await uploadModule.upload(filePath, service);
  });

  ipcMain.handle('get-sources', async () => {
    return await desktopCapturer.getSources({ types: ['window', 'screen'] });
  });

  ipcMain.handle('show-save-dialog', async (event, opts) => {
    return await dialog.showSaveDialog(mainWindow, opts);
  });

  ipcMain.handle('show-open-dialog', async (event, opts) => {
    return await dialog.showOpenDialog(mainWindow, opts);
  });

  ipcMain.handle('select-folder', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openDirectory']
    });
    return result.canceled ? null : result.filePaths[0];
  });

  ipcMain.on('minimize-window', (event) => {
    BrowserWindow.fromWebContents(event.sender)?.minimize();
  });

  ipcMain.on('maximize-window', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    win?.isMaximized() ? win.unmaximize() : win?.maximize();
  });

  ipcMain.on('close-window', (event) => {
    BrowserWindow.fromWebContents(event.sender)?.close();
  });

  ipcMain.handle('run-ocr', async (event, imagePath) => {
    const { runOCR } = require('../capture/ocr');
    return await runOCR(imagePath);
  });

  ipcMain.on('show-notification', (event, title, body) => {
    showNotification(title, body);
  });

  ipcMain.handle('save-capture', async (event, buffer, filename) => {
    const savePath = config.get('general.savePath');
    helpers.ensureDir(savePath);
    const fullPath = path.join(savePath, filename);
    fs.writeFileSync(fullPath, Buffer.from(buffer));
    return fullPath;
  });
}

// ──── App Lifecycle ────

app.whenReady().then(() => {
  loadModules();
  createMainWindow();
  createTray();
  registerHotkeys();
  setupIPC();
  setupAfterCaptureIPC();

  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  app.isQuitting = true;
});

// Export for workflow module
module.exports = { showAfterCapturePopup };
