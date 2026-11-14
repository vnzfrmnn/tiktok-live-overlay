let api = window.api;
if (!api) {
  try {
    const { ipcRenderer } = require('electron');
    api = {
      getConfig: () => ipcRenderer.invoke('overlay:get-config'),
      onChat: (cb) => ipcRenderer.on('chat', (event, payload) => cb(payload)),
      onTikTokEvent: (cb) => ipcRenderer.on('tiktok:event', (event, payload) => cb(payload)),
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
const MAX_HISTORY = 30;
let history = [];
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
  renderHistory();
}

function applySize(width, height) {
  const box = document.getElementById('chat-box');
  if (!box) return;
  if (width) box.style.width = Math.max(200, Math.min(1200, Number(width) || 340)) + 'px';
  else box.style.width = '';
  if (height) box.style.height = Math.max(120, Math.min(1000, Number(height) || 0)) + 'px';
  else box.style.height = '';
  renderHistory();
}

function getCurrentSize() {
  const box = document.getElementById('chat-box');
  if (!box) return { width: 340, height: 0 };
  return { width: box.offsetWidth || 340, height: box.offsetHeight || 0 };
}

function escapeHtml(s) {
  return String(s || '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[c]));
}

function getScale() {
  return Number(document.documentElement.style.getPropertyValue('--s')) || 1;
}

function getCapacity() {
  const box = document.getElementById('chat-box');
  const h = box ? box.clientHeight : 0;
  if (!h) return 5;
  // tinggi rata-rata 1 chat ~ 90px * scale
  const per = 90 * getScale();
  return Math.max(1, Math.min(MAX_HISTORY, Math.floor(h / per)));
}

function renderHistory() {
  const box = document.getElementById('chat-list');
  if (!box) return;
  const cap = getCapacity();
  const visible = history.slice(-cap);
  box.innerHTML = '';
  visible.forEach((entry, idx) => {
    const kind = (entry && entry.kind) || 'chat';
    const oldCls = idx < visible.length - 2 ? ' old' : '';
    const item = document.createElement('div');

    // Baris event datar (gift / follow) — bukan bubble chat
    if (kind === 'gift' || kind === 'follow') {
      item.className = 'event-item ' + kind + '-row' + oldCls;
      const name = escapeHtml(String(entry.username || 'Anonim').replace(/^@/, ''));
      if (kind === 'gift') {
        const count = Number(entry.count) || 1;
        const coins = Number(entry.coins) > 0 ? ` · ${escapeHtml(String(entry.coins))} coin` : '';
        item.innerHTML = `<span class="event-icon">🎁</span>
          <span class="event-text"><b>@${name}</b> kirim ${escapeHtml(entry.gift || 'gift')} ×${escapeHtml(String(count))}${coins}</span>`;
      } else {
        item.innerHTML = `<span class="event-icon">❤</span>
          <span class="event-text"><b>@${name}</b> mulai follow kamu</span>`;
      }
      box.appendChild(item);
      return;
    }

    // Bubble chat — tampil seperti sebelumnya
    item.className = 'chat-item' + oldCls;
    const initial = (entry.username || '?').replace(/^@/, '').charAt(0) || '?';
    item.innerHTML = `<div class="avatar">${escapeHtml(initial)}</div>
      <div class="bubble-wrap">
        <span class="username">${escapeHtml('@' + entry.username.replace(/^@/, ''))}</span>
        <div class="text">${escapeHtml(entry.text)}</div>
      </div>`;
    box.appendChild(item);
  });
}

function pushEntry(entry) {
  history.push(entry);
  if (history.length > MAX_HISTORY) history = history.slice(-MAX_HISTORY);
  renderHistory();
}

function addChat(msg) {
  const username = msg.username || 'Anonim';
  const text = msg.text || '';
  if (!text) return;
  pushEntry({ username, text });
}

// TikTok kadang kirim ulang event setelah websocket nyambung lagi.
// Cek entri terakhir: follow sama user dalam 60 detik, gift sama dalam 3 detik.
function isDuplicateEvent(kind, entry) {
  const last = history[history.length - 1];
  if (!last || (last.kind || 'chat') !== kind) return false;
  const age = Date.now() - (last.ts || 0);
  if (kind === 'follow') {
    return String(last.username) === String(entry.username) && age <= 60000;
  }
  if (kind === 'gift') {
    return String(last.username) === String(entry.username) &&
      String(last.gift) === String(entry.gift) &&
      Number(last.count) === Number(entry.count) &&
      age <= 3000;
  }
  return false;
}

function addGift(payload) {
  const entry = {
    kind: 'gift',
    username: payload.user || 'Anonim',
    gift: payload.gift || 'gift',
    count: Number(payload.count) || 1,
    coins: Number(payload.coins) || 0,
    ts: Date.now(),
  };
  if (isDuplicateEvent('gift', entry)) return;
  pushEntry(entry);
}

function addFollow(payload) {
  const entry = {
    kind: 'follow',
    username: payload.user || 'Anonim',
    ts: Date.now(),
  };
  if (isDuplicateEvent('follow', entry)) return;
  pushEntry(entry);
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

  if (api.onTikTokEvent) {
    api.onTikTokEvent((payload) => {
      if (!payload || !payload.type) return;
      // 'chat' dilewati di sini — chat sudah masuk lewat kanal 'chat' (api.onChat)
      if (payload.type === 'gift') addGift(payload);
      else if (payload.type === 'follow') addFollow(payload);
    });
  }

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
