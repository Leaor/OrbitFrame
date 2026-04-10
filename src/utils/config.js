const Store = require('electron-store');
const path = require('path');
const { app } = require('electron');

const defaults = {
  general: {
    startWithWindows: false,
    startMinimized: true,
    showTrayIcon: true,
    theme: 'dark', // 'dark' | 'light'
    language: 'en',
    savePath: path.join(app?.getPath('pictures') || '.', 'OrbitFrame'),
    filenamePattern: 'OrbitFrame_{date}_{time}',
    imageFormat: 'png', // png, jpg, webp
    imageQuality: 92,
    videoFormat: 'mp4',
    videoFps: 30,
    gifFps: 15,
    gifWidth: 640
  },
  hotkeys: {
    fullscreen: 'PrintScreen',
    region: 'Ctrl+Shift+A',
    window: 'Alt+PrintScreen',
    scrolling: 'Ctrl+Alt+PrintScreen',
    gif: 'Ctrl+Shift+G',
    video: 'Ctrl+Shift+V',
    clipboard: 'Ctrl+Shift+C',
    ocr: 'Ctrl+Shift+O',
    lastRegion: 'Ctrl+Shift+L'
  },
  afterCapture: {
    action: 'preview', // 'save', 'copy', 'upload', 'edit', 'preview'
    copyToClipboard: true,
    saveToFile: true,
    openEditor: false,
    autoUpload: false,
    showNotification: true,
    showPopup: true,
    activeWorkflow: 'quick-copy',
    workflows: {
      'quick-copy': {
        name: 'Quick Copy',
        icon: 'copy',
        description: 'Copy to clipboard instantly',
        steps: ['copy', 'notify']
      },
      'share-mode': {
        name: 'Share Mode',
        icon: 'upload',
        description: 'Upload and copy shareable link',
        steps: ['save', 'upload', 'copy-url', 'notify']
      },
      'edit-first': {
        name: 'Edit First',
        icon: 'edit',
        description: 'Open editor before saving',
        steps: ['edit', 'save', 'copy']
      },
      'save-only': {
        name: 'Save Only',
        icon: 'save',
        description: 'Save to disk silently',
        steps: ['save', 'notify']
      }
    }
  },
  upload: {
    defaultService: 'local', // 'imgur', 'custom', 'local'
    imgur: {
      clientId: '',
      anonymous: true
    },
    custom: {
      url: '',
      method: 'POST',
      fieldName: 'file',
      headers: {},
      responseUrlPath: 'url'
    },
    local: {
      serverEnabled: false,
      port: 8844,
      baseUrl: 'http://localhost:8844'
    }
  },
  annotation: {
    defaultColor: '#FF4D6A',
    defaultStrokeWidth: 3,
    defaultFontSize: 16,
    blurRadius: 10
  },
  recording: {
    includeSystemAudio: true,
    includeMicrophone: false,
    showCursor: true,
    countdown: 3
  }
};

const store = new Store({
  name: 'orbframe-config',
  defaults
});

module.exports = {
  store,
  defaults,
  get: (key) => store.get(key),
  set: (key, value) => store.set(key, value),
  reset: () => store.clear(),
  getAll: () => store.store
};
