let api = window.api;
if (!api) {
  try {
    const { ipcRenderer } = require('electron');
    api = {
      getConfig: () => ipcRenderer.invoke('overlay:get-config'),
      onChat: (cb) => ipcRenderer.on('chat', (event, payload) => cb(payload)),
      onStatus: (cb) => ipcRenderer.on('tiktok:status', (event, status) => cb(status)),
      onPosition: (cb) => ipcRenderer.on('overlay:position', (event, payload) => cb(payload)),
      onSoundPlay: (cb) => ipcRenderer.on('sound:play', (event, payload) => cb(payload)),
      onDrag: (cb) => ipcRenderer.on('overlay:drag', (event, payload) => cb(payload)),
      onXY: (cb) => ipcRenderer.on('overlay:xy', (event, payload) => cb(payload)),
      onScale: (cb) => ipcRenderer.on('overlay:scale', (event, payload) => cb(payload)),
      onSize: (cb) => ipcRenderer.on('overlay:size', (event, payload) => cb(payload)),
      setXY: (xy) => ipcRenderer.invoke('control:set-xy', xy),
      setScale: (s) => ipcRenderer.invoke('control:set-scale', s),
      setSize: (sz) => ipcRenderer.invoke('control:set-size', sz),
    };
  } catch (e) {
    console.error('[overlay] api tidak tersedia:', e);
  }
}

let config = null;
const MAX_MESSAGES = 5;
let dragMode = false;

function applyPosition(position) {
  const box = document.getElementById('chat-box');
  document.body.classList.remove('custom-pos');
  document.body.className = (document.body.className.replace(/position-\w+/g, '').trim() + ' position-' + (position || 'center')).trim();
  if (box) {
    box.style.left = '';
    box.style.top = '';
  }
}

function applyXY(x, y) {
  const box = document.getElementById('chat-box');
  if (!box) return;
  document.body.classList.add('custom-pos');
  box.style.left = Math.max(0, Number(x) || 0) + 'px';
  box.style.top = Math.max(0, Number(y) || 0) + 'px';
}

function setDragMode(on) {
  dragMode = Boolean(on);
  document.body.classList.toggle('drag-mode', dragMode);
}

function applyScale(s) {
  const scale = Math.max(0.5, Math.min(2.5, Number(s) || 1));
  document.documentElement.style.setProperty('--s', scale);
}

function applySize(width, height) {
  const box = document.getElementById('chat-box');
  if (!box) return;
  if (width) box.style.width = Math.max(200, Math.min(1200, Number(width) || 340)) + 'px';
  else box.style.width = '';
  if (height) box.style.height = Math.max(120, Math.min(1000, Number(height) || 0)) + 'px';
  else box.style.height = '';
}

function getCurrentSize() {
  const box = document.getElementById('chat-box');
  if (!box) return { width: 340, height: 0 };
  return { width: box.offsetWidth || 340, height: box.offsetHeight || 0 };
}

function escapeHtml(s) {
  return String(s || '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[c]));
}

function addChat(msg) {
  const box = document.getElementById('chat-list');
  if (!box) return;
  const username = msg.username || 'Anonim';
  const text = msg.text || '';
  if (!text) return;

  const item = document.createElement('div');
  item.className = 'chat-item';
  const initial = (username || '?').replace(/^@/, '').charAt(0) || '?';
  item.innerHTML = `<div class="avatar">${escapeHtml(initial)}</div>
    <div class="bubble-wrap">
      <span class="username">${escapeHtml('@' + username.replace(/^@/, ''))}</span>
      <div class="text">${escapeHtml(text)}</div>
    </div>`;

  box.appendChild(item);

  while (box.children.length > MAX_MESSAGES) {
    box.removeChild(box.firstChild);
  }
  Array.from(box.children).forEach((el, idx) => {
    el.classList.toggle('old', idx < box.children.length - 2);
  });
}

// Drag: tahan & geser #chat-box saat drag-mode ON
(function enableDrag() {
  const box = document.getElementById('chat-box');
  if (!box) return;
  let dragging = false;
  let offsetX = 0;
  let offsetY = 0;

  box.addEventListener('mousedown', (e) => {
    if (!dragMode) return;
    dragging = true;
    const rect = box.getBoundingClientRect();
    offsetX = e.clientX - rect.left;
    offsetY = e.clientY - rect.top;
  });

  window.addEventListener('mousemove', (e) => {
    if (!dragging || !dragMode) return;
    const x = Math.max(0, e.clientX - offsetX);
    const y = Math.max(0, e.clientY - offsetY);
    applyXY(x, y);
    // simpan live ke Control
    if (api && api.setXY) api.setXY({ x, y }).catch(() => {});
  });

  window.addEventListener('mouseup', () => {
    dragging = false;
  });
})();

// Resize BENAR-BENARAN: tepi kanan = lebar saja, tepi bawah = tinggi saja, sudut = keduanya
(function enableResize() {
  const box = document.getElementById('chat-box');
  if (!box) return;
  let resizing = false;
  let mode = '';
  let startX = 0;
  let startY = 0;
  let startW = 340;
  let startH = 0;

  const handles = box.querySelectorAll('.resize-handle');
  handles.forEach((h) => {
    h.addEventListener('mousedown', (e) => {
      if (!dragMode) return;
      e.stopPropagation();
      resizing = true;
      mode = h.classList.contains('se') ? 'se' : h.classList.contains('e') ? 'e' : 's';
      startX = e.clientX;
      startY = e.clientY;
      const size = getCurrentSize();
      startW = size.width;
      startH = size.height;
    });
  });

  window.addEventListener('mousemove', (e) => {
    if (!resizing || !dragMode) return;
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    let newW = startW;
    let newH = startH;
    if (mode === 'e' || mode === 'se') newW = Math.max(200, Math.min(1200, startW + dx));
    if (mode === 's' || mode === 'se') newH = Math.max(150, Math.min(1000, startH + dy));
    applySize(newW, newH || null);
    if (api && api.setSize) api.setSize({ width: newW, height: newH || null }).catch(() => {});
  });

  window.addEventListener('mouseup', () => {
    resizing = false;
  });
})();

if (api) {
  api.getConfig().then((cfg) => {
    config = cfg || {};
    const ov = (cfg && cfg.overlay) || {};
    applyScale(ov.scale);
    applySize(ov.width, ov.height);
    if (ov.custom) {
      applyXY(ov.x, ov.y);
    } else {
      applyPosition(ov.position);
    }
  }).catch((e) => console.error(e));

  api.onChat((msg) => {
    addChat(msg);
  });

  api.onStatus((status) => {
    const statusEl = document.getElementById('status');
    if (!statusEl) return;
    if (!status || !status.state || status.state === 'connected') {
      statusEl.style.display = 'none';
      return;
    }
    statusEl.textContent = status.message ? `${status.state}: ${status.message}` : status.state;
    statusEl.style.display = 'block';
  });

  api.onPosition((payload) => {
    applyPosition(payload && payload.position ? payload.position : 'center');
  });

  if (api.onXY) {
    api.onXY((payload) => {
      if (payload && payload.custom) applyXY(payload.x, payload.y);
      else applyPosition(payload && payload.position);
    });
  }

  if (api.onDrag) {
    api.onDrag((payload) => {
      setDragMode(payload && payload.on);
    });
  }

  if (api.onScale) {
    api.onScale((payload) => {
      applyScale(payload && payload.scale);
    });
  }

  if (api.onSize) {
    api.onSize((payload) => {
      applySize(payload && payload.width, payload && payload.height);
    });
  }

  api.onSoundPlay(async (payload) => {
    const key = (payload && payload.key) ? payload.key : 'sound';
    console.log('[audio] system playback:', key);
  });
}
