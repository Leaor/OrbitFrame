const { ipcRenderer } = require('electron');

// ──── State ────
let currentPage = 'home';
let captureHistory = [];
let editorState = {
  tool: 'select',
  color: '#FF4D6A',
  strokeWidth: 3,
  image: null,
  shapes: [],
  undoStack: [],
  redoStack: [],
  drawing: false,
  startX: 0,
  startY: 0
};

// ──── Navigation ────

document.querySelectorAll('.sidebar-item[data-page]').forEach(item => {
  item.addEventListener('click', () => navigateTo(item.dataset.page));
});

function navigateTo(page) {
  currentPage = page;
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.getElementById(`page-${page}`)?.classList.add('active');
  document.querySelectorAll('.sidebar-item').forEach(i => i.classList.remove('active'));
  document.querySelector(`.sidebar-item[data-page="${page}"]`)?.classList.add('active');
}

ipcRenderer.on('navigate', (event, page) => navigateTo(page));

// ──── Config Loading ────

async function loadConfig() {
  const cfg = await ipcRenderer.invoke('get-config');

  // Theme
  document.documentElement.setAttribute('data-theme', cfg.general.theme);
  document.getElementById('setting-theme').value = cfg.general.theme;

  // General
  document.getElementById('save-path-display').textContent = cfg.general.savePath;
  document.getElementById('setting-format').value = cfg.general.imageFormat;
  document.getElementById('setting-quality').value = cfg.general.imageQuality;
  document.getElementById('setting-startup').checked = cfg.general.startWithWindows;
  document.getElementById('setting-minimized').checked = cfg.general.startMinimized;

  // After Capture — Workflow Pipeline
  const popupEl = document.getElementById('setting-popup');
  if (popupEl) popupEl.checked = cfg.afterCapture.showPopup !== false;
  document.getElementById('setting-notification').checked = cfg.afterCapture.showNotification;

  // Load workflow presets
  const activeWorkflow = cfg.afterCapture.activeWorkflow || 'quick-copy';
  selectWorkflow(activeWorkflow, false);

  // Recording
  document.getElementById('setting-videofps').value = cfg.general.videoFps;
  document.getElementById('setting-giffps').value = cfg.general.gifFps;
  document.getElementById('setting-sysaudio').checked = cfg.recording.includeSystemAudio;
  document.getElementById('setting-mic').checked = cfg.recording.includeMicrophone;
  document.getElementById('setting-countdown').value = cfg.recording.countdown;

  // Upload
  document.getElementById('upload-service').value = cfg.upload.defaultService;
  document.getElementById('imgur-clientid').value = cfg.upload.imgur.clientId;
  document.getElementById('imgur-anonymous').checked = cfg.upload.imgur.anonymous;
  document.getElementById('custom-url').value = cfg.upload.custom.url;
  document.getElementById('custom-method').value = cfg.upload.custom.method;
  document.getElementById('custom-field').value = cfg.upload.custom.fieldName;
  document.getElementById('custom-urlpath').value = cfg.upload.custom.responseUrlPath;
  document.getElementById('custom-headers').value = JSON.stringify(cfg.upload.custom.headers, null, 2);
  document.getElementById('local-server').checked = cfg.upload.local.serverEnabled;
  document.getElementById('local-port').value = cfg.upload.local.port;

  showUploadSection(cfg.upload.defaultService);
  loadHotkeyList(cfg.hotkeys);
  updateHotkeyDisplay(cfg.hotkeys);

  // Load history from localStorage
  try {
    captureHistory = JSON.parse(localStorage.getItem('orbframe-history') || '[]');
    renderHistory();
  } catch {}

  loadAnalyzeSettings();
}

async function updateSetting(key, value) {
  await ipcRenderer.invoke('set-config', key, value);
  showToast('Setting updated', 'success');
}

function setTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  updateSetting('general.theme', theme);
}

async function selectSavePath() {
  const folder = await ipcRenderer.invoke('select-folder');
  if (folder) {
    updateSetting('general.savePath', folder);
    document.getElementById('save-path-display').textContent = folder;
  }
}

async function resetSettings() {
  if (confirm('Reset all settings to defaults?')) {
    await ipcRenderer.invoke('reset-config');
    loadConfig();
    showToast('Settings reset to defaults', 'info');
  }
}

// ──── Upload Section Toggle ────

function showUploadSection(service) {
  document.querySelectorAll('.upload-section').forEach(s => s.style.display = 'none');
  const el = document.getElementById(`upload-${service}`);
  if (el) el.style.display = 'block';
}

// ──── Hotkeys ────

const hotkeyLabels = {
  fullscreen: 'Fullscreen Capture',
  region: 'Region Capture',
  window: 'Window Capture',
  scrolling: 'Scrolling Capture',
  gif: 'Record GIF',
  video: 'Record Video',
  clipboard: 'Clipboard Capture',
  ocr: 'OCR Extract',
  lastRegion: 'Last Region'
};

function loadHotkeyList(hotkeys) {
  const container = document.getElementById('hotkey-list');
  container.innerHTML = '';

  for (const [action, shortcut] of Object.entries(hotkeys)) {
    const row = document.createElement('div');
    row.className = 'setting-row';
    row.innerHTML = `
      <div class="setting-info">
        <h4>${hotkeyLabels[action] || action}</h4>
      </div>
      <div style="display:flex;gap:8px;align-items:center">
        <input type="text" class="hotkey-input" data-action="${action}" value="${shortcut}" readonly>
        <button class="btn btn-sm" onclick="clearHotkey('${action}')">Clear</button>
      </div>
    `;
    container.appendChild(row);
  }

  // Hotkey recording
  container.querySelectorAll('.hotkey-input').forEach(input => {
    input.addEventListener('click', function() {
      this.classList.add('recording');
      this.value = 'Press keys...';
      this._recording = true;
    });

    input.addEventListener('keydown', function(e) {
      if (!this._recording) return;
      e.preventDefault();
      e.stopPropagation();

      const parts = [];
      if (e.ctrlKey) parts.push('Ctrl');
      if (e.altKey) parts.push('Alt');
      if (e.shiftKey) parts.push('Shift');
      if (e.metaKey) parts.push('Super');

      const key = e.key;
      if (!['Control', 'Alt', 'Shift', 'Meta'].includes(key)) {
        let keyName = key;
        if (key === 'PrintScreen') keyName = 'PrintScreen';
        else if (key === ' ') keyName = 'Space';
        else if (key.length === 1) keyName = key.toUpperCase();

        parts.push(keyName);

        const combo = parts.join('+');
        this.value = combo;
        this.classList.remove('recording');
        this._recording = false;

        const action = this.dataset.action;
        updateSetting(`hotkeys.${action}`, combo);
      }
    });

    input.addEventListener('blur', function() {
      if (this._recording) {
        this.classList.remove('recording');
        this._recording = false;
        // Restore original value
        loadConfig();
      }
    });
  });
}

function clearHotkey(action) {
  updateSetting(`hotkeys.${action}`, '');
  loadConfig();
}

function updateHotkeyDisplay(hotkeys) {
  for (const [action, shortcut] of Object.entries(hotkeys)) {
    const el = document.getElementById(`hk-${action}`);
    if (el) el.textContent = shortcut || '—';
  }
}

// ──── Capture ────

async function doCapture(type) {
  try {
    await ipcRenderer.invoke('do-capture', type);
  } catch (err) {
    showToast(`Capture failed: ${err.message}`, 'error');
  }
}

ipcRenderer.on('show-capture-preview', (event, data) => {
  addToHistory(data);
  showPreviewModal(data);
});

ipcRenderer.on('open-editor', (event, data) => {
  navigateTo('editor');
  loadImageInEditor(data);
});

function addToHistory(data) {
  const entry = {
    id: Date.now(),
    filename: data.filename,
    savedPath: data.savedPath,
    thumbnail: data.buffer ? `data:image/png;base64,${data.buffer}` : null,
    uploadUrl: data.uploadResult?.url,
    type: data.type,
    timestamp: new Date().toISOString()
  };
  captureHistory.unshift(entry);
  if (captureHistory.length > 100) captureHistory = captureHistory.slice(0, 100);
  localStorage.setItem('orbframe-history', JSON.stringify(captureHistory));
  renderHistory();
  renderRecentCaptures();
  document.getElementById('status-captures').textContent = `${captureHistory.length} captures`;
}

function renderHistory() {
  const grid = document.getElementById('history-grid');
  if (captureHistory.length === 0) {
    grid.innerHTML = `
      <div class="empty-state">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
        <h3>No captures in history</h3>
        <p>Your captures will appear here</p>
      </div>`;
    return;
  }

  grid.innerHTML = captureHistory.map(entry => `
    <div class="history-item" onclick="openHistoryItem('${entry.id}')">
      ${entry.thumbnail
        ? `<img src="${entry.thumbnail}" alt="${entry.filename}">`
        : `<div style="height:140px;background:var(--bg-tertiary);display:flex;align-items:center;justify-content:center;color:var(--text-muted)">${entry.type}</div>`
      }
      <div class="info">
        <div class="name">${entry.filename || 'Untitled'}</div>
        <div class="meta">${new Date(entry.timestamp).toLocaleString()}</div>
      </div>
    </div>
  `).join('');
}

function renderRecentCaptures() {
  const container = document.getElementById('recent-captures');
  const recent = captureHistory.slice(0, 6);

  if (recent.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="12" cy="12" r="3"/></svg>
        <h3>No captures yet</h3>
        <p>Use the buttons above or press a hotkey to take your first capture</p>
      </div>`;
    return;
  }

  container.innerHTML = recent.map(entry => `
    <div class="history-item" onclick="openHistoryItem('${entry.id}')">
      ${entry.thumbnail
        ? `<img src="${entry.thumbnail}" alt="${entry.filename}">`
        : `<div style="height:140px;background:var(--bg-tertiary);display:flex;align-items:center;justify-content:center;color:var(--text-muted)">${entry.type}</div>`
      }
      <div class="info">
        <div class="name">${entry.filename || 'Untitled'}</div>
        <div class="meta">${new Date(entry.timestamp).toLocaleString()}</div>
      </div>
    </div>
  `).join('');
}

function openHistoryItem(id) {
  const item = captureHistory.find(h => h.id === parseInt(id));
  if (item) {
    showPreviewModal({ buffer: item.thumbnail?.split(',')[1], filename: item.filename, savedPath: item.savedPath, uploadResult: item.uploadUrl ? { url: item.uploadUrl } : null });
  }
}

function clearHistory() {
  if (confirm('Clear all capture history?')) {
    captureHistory = [];
    localStorage.setItem('orbframe-history', '[]');
    renderHistory();
    renderRecentCaptures();
    document.getElementById('status-captures').textContent = '0 captures';
    showToast('History cleared', 'info');
  }
}

// ──── Preview Modal ────

function showPreviewModal(data) {
  const existing = document.querySelector('.modal-overlay');
  if (existing) existing.remove();

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };

  const imgSrc = data.buffer ? `data:image/png;base64,${data.buffer}` : '';

  overlay.innerHTML = `
    <div class="modal">
      ${imgSrc ? `<img src="${imgSrc}">` : '<p style="padding:40px;color:var(--text-muted)">No preview available</p>'}
      <div style="margin-top:12px;display:flex;gap:8px;align-items:center;flex-wrap:wrap">
        <span style="font-size:12px;color:var(--text-muted)">${data.filename || ''}</span>
        <span style="flex:1"></span>
        ${data.savedPath ? `<button class="btn btn-sm" onclick="require('electron').shell.showItemInFolder('${data.savedPath.replace(/\\/g, '\\\\')}')">Show in Folder</button>` : ''}
        ${data.uploadResult?.url ? `<button class="btn btn-sm" onclick="require('electron').clipboard.writeText('${data.uploadResult.url}');showToast('URL copied!','success')">Copy URL</button>` : ''}
        <button class="btn btn-sm" onclick="navigateTo('editor');this.closest('.modal-overlay').remove()${imgSrc ? `;loadImageInEditor({buffer:'${data.buffer}',filename:'${data.filename}'})` : ''}">Edit</button>
        <button class="btn btn-sm btn-primary" onclick="this.closest('.modal-overlay').remove()">Close</button>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);
}

// ──── Editor ────

const canvas = document.getElementById('editor-canvas');
const ctx = canvas ? canvas.getContext('2d') : null;

document.querySelectorAll('.tool-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tool-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    editorState.tool = btn.dataset.tool;
  });
});

document.getElementById('editor-color')?.addEventListener('input', (e) => {
  editorState.color = e.target.value;
});

document.getElementById('editor-stroke')?.addEventListener('change', (e) => {
  editorState.strokeWidth = parseInt(e.target.value);
});

function loadImageInEditor(data) {
  document.getElementById('editor-empty').style.display = 'none';
  document.getElementById('editor-workspace').style.display = 'block';

  const img = new Image();
  img.onload = () => {
    editorState.image = img;
    editorState.shapes = [];
    editorState.undoStack = [];
    editorState.redoStack = [];

    // Scale to fit
    const maxW = canvas.parentElement.clientWidth - 40;
    const maxH = window.innerHeight - 200;
    let w = img.width;
    let h = img.height;

    if (w > maxW) { h *= maxW / w; w = maxW; }
    if (h > maxH) { w *= maxH / h; h = maxH; }

    canvas.width = w;
    canvas.height = h;
    editorState.scaleX = img.width / w;
    editorState.scaleY = img.height / h;

    redrawCanvas();
  };

  if (data.buffer) {
    img.src = `data:image/png;base64,${data.buffer}`;
  } else if (data.src) {
    img.src = data.src;
  }
}

async function loadImageForEditor() {
  const result = await ipcRenderer.invoke('show-open-dialog', {
    filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'bmp', 'gif'] }]
  });
  if (!result.canceled && result.filePaths[0]) {
    const fs = require('fs');
    const buf = fs.readFileSync(result.filePaths[0]);
    loadImageInEditor({ buffer: buf.toString('base64'), filename: require('path').basename(result.filePaths[0]) });
  }
}

function redrawCanvas() {
  if (!ctx || !editorState.image) return;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(editorState.image, 0, 0, canvas.width, canvas.height);

  // Draw all shapes
  editorState.shapes.forEach(shape => drawShape(shape));
}

function drawShape(shape) {
  ctx.save();
  ctx.strokeStyle = shape.color;
  ctx.fillStyle = shape.color;
  ctx.lineWidth = shape.strokeWidth;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  switch (shape.type) {
    case 'rect':
      ctx.strokeRect(shape.x, shape.y, shape.w, shape.h);
      break;
    case 'circle': {
      const rx = Math.abs(shape.w) / 2;
      const ry = Math.abs(shape.h) / 2;
      ctx.beginPath();
      ctx.ellipse(shape.x + shape.w / 2, shape.y + shape.h / 2, rx, ry, 0, 0, Math.PI * 2);
      ctx.stroke();
      break;
    }
    case 'line':
      ctx.beginPath();
      ctx.moveTo(shape.x, shape.y);
      ctx.lineTo(shape.x + shape.w, shape.y + shape.h);
      ctx.stroke();
      break;
    case 'arrow': {
      const ex = shape.x + shape.w;
      const ey = shape.y + shape.h;
      ctx.beginPath();
      ctx.moveTo(shape.x, shape.y);
      ctx.lineTo(ex, ey);
      ctx.stroke();
      // Arrowhead
      const angle = Math.atan2(shape.h, shape.w);
      const headLen = 15;
      ctx.beginPath();
      ctx.moveTo(ex, ey);
      ctx.lineTo(ex - headLen * Math.cos(angle - Math.PI / 6), ey - headLen * Math.sin(angle - Math.PI / 6));
      ctx.moveTo(ex, ey);
      ctx.lineTo(ex - headLen * Math.cos(angle + Math.PI / 6), ey - headLen * Math.sin(angle + Math.PI / 6));
      ctx.stroke();
      break;
    }
    case 'pencil':
      if (shape.points && shape.points.length > 1) {
        ctx.beginPath();
        ctx.moveTo(shape.points[0].x, shape.points[0].y);
        for (let i = 1; i < shape.points.length; i++) {
          ctx.lineTo(shape.points[i].x, shape.points[i].y);
        }
        ctx.stroke();
      }
      break;
    case 'text':
      ctx.font = `${shape.fontSize || 16}px 'Segoe UI', sans-serif`;
      ctx.fillText(shape.text, shape.x, shape.y);
      break;
    case 'highlight':
      ctx.globalAlpha = 0.3;
      ctx.fillStyle = shape.color;
      ctx.fillRect(shape.x, shape.y, shape.w, shape.h);
      ctx.globalAlpha = 1;
      break;
    case 'blur':
      // Simulate blur with pixelation
      const bx = Math.min(shape.x, shape.x + shape.w);
      const by = Math.min(shape.y, shape.y + shape.h);
      const bw = Math.abs(shape.w);
      const bh = Math.abs(shape.h);
      if (bw > 0 && bh > 0) {
        const imgData = ctx.getImageData(bx, by, bw, bh);
        const pixelSize = 10;
        for (let py = 0; py < bh; py += pixelSize) {
          for (let px = 0; px < bw; px += pixelSize) {
            const i = (py * bw + px) * 4;
            const r = imgData.data[i];
            const g = imgData.data[i + 1];
            const b = imgData.data[i + 2];
            ctx.fillStyle = `rgb(${r},${g},${b})`;
            ctx.fillRect(bx + px, by + py, pixelSize, pixelSize);
          }
        }
      }
      break;
  }
  ctx.restore();
}

// Canvas mouse handlers
if (canvas) {
  canvas.addEventListener('mousedown', (e) => {
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    if (editorState.tool === 'text') {
      const text = prompt('Enter text:');
      if (text) {
        editorState.shapes.push({
          type: 'text', x, y, text,
          color: editorState.color,
          strokeWidth: editorState.strokeWidth,
          fontSize: 16
        });
        editorState.undoStack.push([...editorState.shapes]);
        redrawCanvas();
      }
      return;
    }

    if (editorState.tool === 'select') return;

    editorState.drawing = true;
    editorState.startX = x;
    editorState.startY = y;

    if (editorState.tool === 'pencil') {
      editorState.currentShape = {
        type: 'pencil',
        points: [{ x, y }],
        color: editorState.color,
        strokeWidth: editorState.strokeWidth
      };
    }
  });

  canvas.addEventListener('mousemove', (e) => {
    if (!editorState.drawing) return;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    if (editorState.tool === 'pencil' && editorState.currentShape) {
      editorState.currentShape.points.push({ x, y });
      redrawCanvas();
      drawShape(editorState.currentShape);
      return;
    }

    // Preview shape
    redrawCanvas();
    const previewShape = {
      type: editorState.tool,
      x: editorState.startX,
      y: editorState.startY,
      w: x - editorState.startX,
      h: y - editorState.startY,
      color: editorState.color,
      strokeWidth: editorState.strokeWidth
    };
    drawShape(previewShape);
  });

  canvas.addEventListener('mouseup', (e) => {
    if (!editorState.drawing) return;
    editorState.drawing = false;

    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    if (editorState.tool === 'pencil' && editorState.currentShape) {
      editorState.shapes.push(editorState.currentShape);
      editorState.currentShape = null;
    } else {
      editorState.shapes.push({
        type: editorState.tool,
        x: editorState.startX,
        y: editorState.startY,
        w: x - editorState.startX,
        h: y - editorState.startY,
        color: editorState.color,
        strokeWidth: editorState.strokeWidth
      });
    }

    editorState.undoStack.push(JSON.parse(JSON.stringify(editorState.shapes)));
    editorState.redoStack = [];
    redrawCanvas();
  });
}

function editorUndo() {
  if (editorState.shapes.length === 0) return;
  editorState.redoStack.push(editorState.shapes.pop());
  redrawCanvas();
}

function editorRedo() {
  if (editorState.redoStack.length === 0) return;
  editorState.shapes.push(editorState.redoStack.pop());
  redrawCanvas();
}

function editorClear() {
  editorState.redoStack.push(...editorState.shapes);
  editorState.shapes = [];
  redrawCanvas();
}

function editorCopy() {
  if (!canvas) return;
  canvas.toBlob(blob => {
    const item = new ClipboardItem({ 'image/png': blob });
    navigator.clipboard.write([item]);
    showToast('Copied to clipboard', 'success');
  });
}

async function editorSave() {
  if (!canvas) return;
  const result = await ipcRenderer.invoke('show-save-dialog', {
    defaultPath: editorState.filename || 'OrbitFrame_edited.png',
    filters: [{ name: 'PNG Image', extensions: ['png'] }, { name: 'JPEG Image', extensions: ['jpg'] }]
  });
  if (!result.canceled && result.filePath) {
    const dataUrl = canvas.toDataURL('image/png');
    const base64 = dataUrl.split(',')[1];
    const buffer = Buffer.from(base64, 'base64');
    require('fs').writeFileSync(result.filePath, buffer);
    showToast(`Saved to ${result.filePath}`, 'success');
  }
}

// ──── Toast Notifications ────

function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = `
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      ${type === 'success' ? '<polyline points="20 6 9 17 4 12"/>' :
        type === 'error' ? '<circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/>' :
        '<circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/>'}
    </svg>
    <span>${message}</span>
  `;
  container.appendChild(toast);
  setTimeout(() => { toast.style.opacity = '0'; setTimeout(() => toast.remove(), 300); }, 3000);
}

// ──── Search ────

document.getElementById('history-search')?.addEventListener('input', (e) => {
  const q = e.target.value.toLowerCase();
  const filtered = captureHistory.filter(h =>
    (h.filename || '').toLowerCase().includes(q) ||
    (h.type || '').toLowerCase().includes(q)
  );
  const grid = document.getElementById('history-grid');
  if (filtered.length === 0) {
    grid.innerHTML = '<div class="empty-state"><h3>No matches</h3></div>';
    return;
  }
  grid.innerHTML = filtered.map(entry => `
    <div class="history-item" onclick="openHistoryItem('${entry.id}')">
      ${entry.thumbnail
        ? `<img src="${entry.thumbnail}" alt="${entry.filename}">`
        : `<div style="height:140px;background:var(--bg-tertiary);display:flex;align-items:center;justify-content:center;color:var(--text-muted)">${entry.type}</div>`
      }
      <div class="info">
        <div class="name">${entry.filename || 'Untitled'}</div>
        <div class="meta">${new Date(entry.timestamp).toLocaleString()}</div>
      </div>
    </div>
  `).join('');
});

// ──── Workflow Pipeline ────

const workflowDefinitions = {
  'quick-copy': {
    name: 'Quick Copy',
    steps: ['copy', 'notify']
  },
  'share-mode': {
    name: 'Share Mode',
    steps: ['save', 'upload', 'copy-url', 'notify']
  },
  'edit-first': {
    name: 'Edit First',
    steps: ['edit', 'save', 'copy']
  },
  'save-only': {
    name: 'Save Only',
    steps: ['save', 'notify']
  }
};

const stepIcons = {
  'capture': `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z"/><circle cx="12" cy="13" r="4"/></svg>`,
  'copy': `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>`,
  'save': `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 21H5a2 2 0 01-2-2V5a2 2 0 012-2h11l5 5v11a2 2 0 01-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>`,
  'upload': `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>`,
  'copy-url': `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71"/></svg>`,
  'edit': `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 013 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>`,
  'notify': `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 01-3.46 0"/></svg>`
};

const stepLabels = {
  'capture': 'Capture',
  'copy': 'Copy',
  'save': 'Save',
  'upload': 'Upload',
  'copy-url': 'Copy URL',
  'edit': 'Edit',
  'notify': 'Notify'
};

const arrowSvg = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>`;

function selectWorkflow(workflowId, save = true) {
  // Update active preset card
  document.querySelectorAll('.workflow-preset').forEach(el => {
    el.classList.toggle('active', el.dataset.workflow === workflowId);
  });

  // Render pipeline
  const workflow = workflowDefinitions[workflowId];
  if (workflow) {
    renderPipeline(workflow.steps);
  }

  // Persist
  if (save) {
    updateSetting('afterCapture.activeWorkflow', workflowId);
  }
}

function renderPipeline(steps) {
  const flow = document.getElementById('pipeline-flow');
  if (!flow) return;

  let html = '';

  // Source step (always "Capture")
  html += `<div class="pipeline-step source">${stepIcons['capture']} Capture</div>`;

  steps.forEach(stepId => {
    html += `<div class="pipeline-arrow">${arrowSvg}</div>`;
    html += `<div class="pipeline-step active">${stepIcons[stepId] || ''} ${stepLabels[stepId] || stepId}</div>`;
  });

  flow.innerHTML = html;
}

// ──── Analyze Image ────

let analyzeImageData = null;

function loadAnalyzeSettings() {
  const enabled = localStorage.getItem('orbframe-analyze-enabled') === 'true';
  const provider = localStorage.getItem('orbframe-analyze-provider') || 'openai';
  const apiKey = localStorage.getItem('orbframe-analyze-apiKey') || '';

  const toggle = document.getElementById('setting-analyze-enabled');
  const providerSel = document.getElementById('setting-analyze-provider');
  const keyInput = document.getElementById('setting-analyze-apikey');
  const settingsPanel = document.getElementById('analyze-settings');

  if (toggle) toggle.checked = enabled;
  if (providerSel) providerSel.value = provider;
  if (keyInput) keyInput.value = apiKey;
  if (settingsPanel) settingsPanel.style.display = enabled ? 'block' : 'none';

  const disabledMsg = document.getElementById('analyze-disabled-msg');
  const workspace = document.getElementById('analyze-workspace');
  if (disabledMsg) disabledMsg.style.display = enabled ? 'none' : 'block';
  if (workspace) workspace.style.display = enabled ? 'block' : 'none';

  updateAnalyzeKeyPlaceholder();
  updateAnalyzeProviderBadge();
}

function toggleAnalyzeImage(enabled) {
  localStorage.setItem('orbframe-analyze-enabled', enabled);
  document.getElementById('analyze-settings').style.display = enabled ? 'block' : 'none';
  const disabledMsg = document.getElementById('analyze-disabled-msg');
  const workspace = document.getElementById('analyze-workspace');
  if (disabledMsg) disabledMsg.style.display = enabled ? 'none' : 'block';
  if (workspace) workspace.style.display = enabled ? 'block' : 'none';
  showToast(enabled ? 'Analyze Image enabled' : 'Analyze Image disabled', 'success');
}

function updateAnalyzeSetting(key, value) {
  localStorage.setItem(`orbframe-analyze-${key}`, value);
  if (key === 'provider') {
    updateAnalyzeKeyPlaceholder();
    updateAnalyzeProviderBadge();
  }
  showToast('Setting updated', 'success');
}

function updateAnalyzeKeyPlaceholder() {
  const provider = localStorage.getItem('orbframe-analyze-provider') || 'openai';
  const hint = document.getElementById('analyze-key-hint');
  const input = document.getElementById('setting-analyze-apikey');
  if (hint) hint.textContent = provider === 'openai' ? 'Your OpenAI API key' : 'Your Google Gemini API key';
  if (input) input.placeholder = provider === 'openai' ? 'sk-...' : 'AIza...';
}

function updateAnalyzeProviderBadge() {
  const provider = localStorage.getItem('orbframe-analyze-provider') || 'openai';
  const badge = document.getElementById('analyze-provider-badge');
  if (badge) badge.textContent = provider === 'openai' ? 'Using: OpenAI gpt-4o' : 'Using: Gemini 1.5 Flash';
}

async function testAnalyzeKey() {
  const provider = localStorage.getItem('orbframe-analyze-provider') || 'openai';
  const apiKey = document.getElementById('setting-analyze-apikey').value;

  if (!apiKey) {
    showToast('Please enter an API key first', 'error');
    return;
  }

  const btn = document.getElementById('test-key-btn');
  btn.textContent = 'Testing...';
  btn.disabled = true;

  try {
    if (provider === 'openai') {
      const res = await fetch('https://api.openai.com/v1/models/gpt-4o', {
        headers: { 'Authorization': `Bearer ${apiKey}` }
      });
      if (!res.ok) throw { status: res.status };
    } else {
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash?key=${encodeURIComponent(apiKey)}`);
      if (!res.ok) throw { status: res.status };
    }
    showToast('API key is valid!', 'success');
  } catch (err) {
    const msg = err.status === 401 || err.status === 403 ? 'Invalid or expired API key' :
                err.status === 429 ? 'Rate limit exceeded — try again later' :
                'Connection failed — check your network';
    showToast(msg, 'error');
  } finally {
    btn.textContent = 'Test Key';
    btn.disabled = false;
  }
}

function handleAnalyzeImageSelect(input) {
  const file = input.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = () => {
    const img = new Image();
    img.onload = () => {
      const maxDim = 1024;
      let w = img.width, h = img.height;
      if (w > maxDim || h > maxDim) {
        if (w > h) { h = Math.round(h * (maxDim / w)); w = maxDim; }
        else { w = Math.round(w * (maxDim / h)); h = maxDim; }
      }

      const c = document.createElement('canvas');
      c.width = w;
      c.height = h;
      c.getContext('2d').drawImage(img, 0, 0, w, h);

      const mimeType = file.type === 'image/webp' ? 'image/webp' :
                       file.type === 'image/png' ? 'image/png' : 'image/jpeg';
      const dataUrl = c.toDataURL(mimeType, mimeType === 'image/png' ? undefined : 0.9);
      analyzeImageData = { base64: dataUrl.split(',')[1], mimeType };

      document.getElementById('analyze-preview-img').src = dataUrl;
      document.getElementById('analyze-dropzone-content').style.display = 'none';
      document.getElementById('analyze-preview-container').style.display = 'flex';
    };
    img.src = reader.result;
  };
  reader.readAsDataURL(file);
}

function clearAnalyzeImage() {
  analyzeImageData = null;
  document.getElementById('analyze-file-input').value = '';
  document.getElementById('analyze-dropzone-content').style.display = '';
  document.getElementById('analyze-preview-container').style.display = 'none';
  document.getElementById('analyze-result-card').style.display = 'none';
}

async function analyzeImage({ provider, apiKey, imageBase64, mimeType, prompt }) {
  if (provider === 'openai') {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: 'gpt-4o',
        messages: [{
          role: 'user',
          content: [
            { type: 'text', text: prompt },
            { type: 'image_url', image_url: { url: `data:${mimeType};base64,${imageBase64}` } }
          ]
        }],
        max_tokens: 1024
      })
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw { status: res.status, message: err.error?.message || res.statusText };
    }
    const data = await res.json();
    const text = data.choices?.[0]?.message?.content;
    if (!text) throw { status: 0, message: 'Provider returned an empty response' };
    return text;
  }

  if (provider === 'gemini') {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${encodeURIComponent(apiKey)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{
          parts: [
            { text: prompt },
            { inline_data: { mime_type: mimeType, data: imageBase64 } }
          ]
        }]
      })
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw { status: res.status, message: err.error?.message || res.statusText };
    }
    const data = await res.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) throw { status: 0, message: 'Provider returned an empty response' };
    return text;
  }

  throw { status: 0, message: `Unknown provider: ${provider}` };
}

function formatAnalyzeError(err) {
  if (!err.status && !err.message) return 'Network error — check your internet connection';
  if (err.status === 401 || err.status === 403) return 'Invalid or expired API key — update your key in Settings';
  if (err.status === 429) return 'Rate limit exceeded — please wait and try again';
  if (err.status === 413) return 'Image too large — try a smaller image';
  return err.message || 'An unexpected error occurred';
}

async function submitAnalyzeImage() {
  if (!analyzeImageData) {
    showToast('Please upload an image first', 'error');
    return;
  }

  const provider = localStorage.getItem('orbframe-analyze-provider') || 'openai';
  const apiKey = localStorage.getItem('orbframe-analyze-apiKey') || '';

  if (!apiKey) {
    showToast('Please set your API key in Settings', 'error');
    return;
  }

  const prompt = document.getElementById('analyze-prompt').value.trim() || 'Describe this image in detail.';
  const btn = document.getElementById('analyze-submit-btn');
  btn.disabled = true;
  btn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="spin"><path d="M21 12a9 9 0 11-6.219-8.56"/></svg> Analyzing...';

  try {
    const result = await analyzeImage({
      provider, apiKey,
      imageBase64: analyzeImageData.base64,
      mimeType: analyzeImageData.mimeType,
      prompt
    });
    document.getElementById('analyze-result').textContent = result;
    document.getElementById('analyze-result-card').style.display = 'block';
    showToast('Analysis complete', 'success');
  } catch (err) {
    showToast(formatAnalyzeError(err), 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg> Analyze';
  }
}

// Drag & drop for analyze dropzone
const analyzeDropzone = document.getElementById('analyze-dropzone');
if (analyzeDropzone) {
  analyzeDropzone.addEventListener('dragover', (e) => {
    e.preventDefault();
    analyzeDropzone.classList.add('dragover');
  });
  analyzeDropzone.addEventListener('dragleave', () => {
    analyzeDropzone.classList.remove('dragover');
  });
  analyzeDropzone.addEventListener('drop', (e) => {
    e.preventDefault();
    analyzeDropzone.classList.remove('dragover');
    const file = e.dataTransfer.files[0];
    if (file && file.type.startsWith('image/')) {
      const input = document.getElementById('analyze-file-input');
      const dt = new DataTransfer();
      dt.items.add(file);
      input.files = dt.files;
      handleAnalyzeImageSelect(input);
    }
  });
}

// ──── Init ────

loadConfig();
renderRecentCaptures();
document.getElementById('status-captures').textContent = `${captureHistory.length} captures`;
