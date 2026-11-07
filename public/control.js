let api = window.api;
let currentVolume = 0.5;
if (!api) {
  try {
    const { ipcRenderer } = require('electron');
    api = {
      getConfig: () => ipcRenderer.invoke('overlay:get-config'),
      getLanIp: () => ipcRenderer.invoke('overlay:get-lan-ip'),
      onChat: (cb) => ipcRenderer.on('chat', (event, payload) => cb(payload)),
      onStatus: (cb) => ipcRenderer.on('tiktok:status', (event, status) => cb(status)),
      onSoundPlay: (cb) => ipcRenderer.on('sound:play', (event, payload) => cb(payload)),
      onPosition: (cb) => ipcRenderer.on('overlay:position', (event, payload) => cb(payload)),
      onVisibility: (cb) => ipcRenderer.on('overlay:visibility', (event, payload) => cb(payload)),
      onSoundboardInfo: (cb) => ipcRenderer.on('soundboard:info', (event, payload) => cb(payload)),
      onVolume: (cb) => ipcRenderer.on('sound:volume', (event, payload) => cb(payload)),
      toggleOverlay: () => ipcRenderer.invoke('control:toggle-overlay'),
      quit: () => ipcRenderer.invoke('control:quit'),
      setPosition: (pos) => ipcRenderer.invoke('control:set-position', pos),
      setVolume: (v) => ipcRenderer.invoke('control:set-volume', v),
      setXY: (xy) => ipcRenderer.invoke('control:set-xy', xy),
      setDrag: (on) => ipcRenderer.invoke('control:set-drag', on),
      getDrag: () => ipcRenderer.invoke('control:get-drag'),
      onDrag: (cb) => ipcRenderer.on('overlay:drag', (e, p) => cb(p)),
      onXY: (cb) => ipcRenderer.on('overlay:xy', (e, p) => cb(p)),
      setScale: (s) => ipcRenderer.invoke('control:set-scale', s),
      onScale: (cb) => ipcRenderer.on('overlay:scale', (e, p) => cb(p)),
      setUsername: (u) => ipcRenderer.invoke('control:set-username', u),
      playKey: (k) => ipcRenderer.invoke('control:play-key', k),
      reconnect: () => ipcRenderer.invoke('control:reconnect'),
    };
    console.log('[control] pakai fallback require (preload gagal)');
  } catch (e) {
    console.error('[control] api tidak tersedia:', e);
  }
}

let config = null;
let audioEl = null;

async function init() {
  if (!api) {
    const el = document.getElementById('status');
    if (el) el.textContent = 'Status: ❌ api tidak tersedia (preload gagal)';
    return;
  }
  try {
    config = await api.getConfig();
  } catch (e) {
    console.error(e);
    config = { tiktok: {}, soundboard: { map: {} } };
  }
  if (config && config.soundboard && config.soundboard.volume != null) {
    currentVolume = Number(config.soundboard.volume);
  }
  const volSlider0 = document.getElementById('volSlider');
  const volVal0 = document.getElementById('volVal');
  if (volSlider0) volSlider0.value = Math.round(currentVolume * 100);
  if (volVal0) volVal0.textContent = Math.round(currentVolume * 100);
  const usernameEl = document.getElementById('username');
  if (usernameEl && config.tiktok.username) {
    usernameEl.value = config.tiktok.username === 'YOUR_TIKTOK_USERNAME' ? '' : config.tiktok.username;
  }
  try {
    const lan = await api.getLanIp();
    updateHpUrl(lan.ip, lan.port);
  } catch (e) {
    console.error(e);
    updateHpUrl('192.168.x.x', 8080);
  }
  renderSoundList();
}

function updateHpUrl(ip, port) {
  const el = document.getElementById('hpUrl');
  if (el) el.textContent = `http://${ip}:${port}/`;
}

function renderSoundList() {
  const container = document.getElementById('soundList');
  if (!container) return;
  const map = (config && config.soundboard && config.soundboard.map) || {};
  container.innerHTML = '';
  Object.entries(map).forEach(([key, file]) => {
    const btn = document.createElement('button');
    btn.textContent = `${key}: ${file}`;
    btn.title = `Test ${key}`;
    btn.addEventListener('click', () => api.playKey(key));
    container.appendChild(btn);
  });
}

function toFileUrl(p) {
  const parts = String(p).replace(/\\/g, '/').split('/');
  return 'file:///' + parts.map((seg) => encodeURIComponent(seg)).join('/');
}

function playUrl(url) {
  return new Promise((resolve) => {
    try {
      if (audioEl) { audioEl.pause(); audioEl = null; }
      audioEl = new Audio(url);
      audioEl.volume = 1;
      audioEl.onended = () => resolve(true);
      audioEl.onerror = () => resolve(false);
      audioEl.play().then(() => {}).catch(() => resolve(false));
      setTimeout(() => resolve(true), 3000);
    } catch (e) {
      console.error(e);
      resolve(false);
    }
  });
}

if (api) {
  api.onStatus((status) => {
    const el = document.getElementById('status');
    if (!el) return;
    el.textContent = 'Status: ' + (status.state || status.message || 'unknown');
  });

  api.onSoundboardInfo((info) => {
    updateHpUrl(info.ip, info.port);
  });

  api.onVisibility((payload) => {
    const btn = document.getElementById('toggleOverlay');
    if (btn) btn.textContent = payload.visible ? 'Sembunyikan Overlay' : 'Tampilkan Overlay';
  });

  api.onChat((msg) => {
    const el = document.getElementById('lastChat');
    if (el) el.textContent = `💬 @${msg.username || 'Anonim'}: ${msg.text || ''}`;
    console.log('[control] CHAT:', msg);
  });

  function playUrlLocal(url) {
    return new Promise((resolve) => {
      try {
        if (audioEl) { audioEl.pause(); audioEl = null; }
        audioEl = new Audio(url);
        audioEl.volume = currentVolume;
        audioEl.onended = () => resolve(true);
        audioEl.onerror = () => resolve(false);
        audioEl.play().then(() => {}).catch(() => resolve(false));
      } catch (e) { resolve(false); }
    });
  }

  api.onSoundPlay(async (payload) => {
    const key = (payload && payload.key) ? payload.key : 'sound';
    const el = document.getElementById('status');
    if (el) el.textContent = `🔊 Playing: ${key}`;
    console.log('[audio] play:', key);
    // Backup: coba putar via HTTP di Control juga (klik tombol = user gesture, jadi pasti diizinkan)
    // Sistem Windows tetap yang utama di main, ini cadangan kalau sistem gagal.
    if (payload && payload.url) {
      await playUrlLocal(payload.url);
    }
  });

  document.getElementById('saveUsername').addEventListener('click', async () => {
    const v = document.getElementById('username').value.trim();
    const el = document.getElementById('status');
    if (el) el.textContent = 'Menyimpan & menghubungkan ke ' + v + '...';
    config = await api.setUsername(v);
    if (el) el.textContent = 'Username tersimpan: ' + (v || '(kosong)');
  });

  document.getElementById('reconnect').addEventListener('click', async () => {
    const el = document.getElementById('status');
    if (el) el.textContent = 'Reconnecting...';
    await api.reconnect();
  });

  document.querySelectorAll('[data-pos]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      config = await api.setPosition(btn.dataset.pos);
      alert('Posisi: ' + btn.dataset.pos);
    });
  });

  document.getElementById('toggleOverlay').addEventListener('click', async () => {
    const vis = await api.toggleOverlay();
    document.getElementById('toggleOverlay').textContent = vis ? 'Sembunyikan Overlay' : 'Tampilkan Overlay';
  });

  document.getElementById('quitBtn').addEventListener('click', async () => {
    await api.quit();
  });

  // Mode geser
  let dragOn = false;
  const dragBtn = document.getElementById('toggleDrag');
  function updateDragBtn() {
    if (dragBtn) dragBtn.textContent = dragOn ? '🖐️ Mode Geser: ON — klik lagi buat kunci' : '🖐️ Mode Geser: OFF — klik ON lalu seret bubble chat di layar';
  }
  if (dragBtn) {
    dragBtn.addEventListener('click', async () => {
      dragOn = !dragOn;
      try { await api.setDrag(dragOn); } catch (e) {}
      updateDragBtn();
    });
  }
  if (api.onDrag) {
    api.onDrag((payload) => {
      dragOn = Boolean(payload && payload.on);
      updateDragBtn();
    });
  }

  // Slider X/Y manual
  const xSlider = document.getElementById('xSlider');
  const ySlider = document.getElementById('ySlider');
  const xVal = document.getElementById('xVal');
  const yVal = document.getElementById('yVal');
  function pushXY() {
    const x = Number(xSlider.value);
    const y = Number(ySlider.value);
    if (xVal) xVal.textContent = x;
    if (yVal) yVal.textContent = y;
    if (api.setXY) api.setXY({ x, y }).catch(() => {});
  }
  if (xSlider) xSlider.addEventListener('input', pushXY);
  if (ySlider) ySlider.addEventListener('input', pushXY);
  if (api.onXY) {
    api.onXY((payload) => {
      if (payload && payload.custom) {
        if (xSlider) xSlider.value = payload.x;
        if (ySlider) ySlider.value = payload.y;
        if (xVal) xVal.textContent = payload.x;
        if (yVal) yVal.textContent = payload.y;
      }
    });
  }

  // Slider Ukuran
  const scaleSlider = document.getElementById('scaleSlider');
  const scaleVal = document.getElementById('scaleVal');
  function pushScale() {
    const pct = Number(scaleSlider.value);
    if (scaleVal) scaleVal.textContent = pct;
    if (api.setScale) api.setScale(pct / 100).catch(() => {});
  }
  if (scaleSlider) scaleSlider.addEventListener('input', pushScale);
  if (api.onScale) {
    api.onScale((payload) => {
      const pct = Math.round((Number(payload && payload.scale) || 1) * 100);
      if (scaleSlider) scaleSlider.value = pct;
      if (scaleVal) scaleVal.textContent = pct;
    });
  }

  const volSlider = document.getElementById('volSlider');
  const volVal = document.getElementById('volVal');
  function pushVolume() {
    const pct = Number(volSlider.value);
    currentVolume = pct / 100;
    if (volVal) volVal.textContent = pct;
    if (audioEl) audioEl.volume = currentVolume;
    if (api.setVolume) api.setVolume(currentVolume).catch(() => {});
  }
  if (volSlider) volSlider.addEventListener('input', pushVolume);
  if (api.onVolume) {
    api.onVolume((payload) => {
      currentVolume = Number(payload && payload.volume) || 0;
      const pct = Math.round(currentVolume * 100);
      if (volSlider) volSlider.value = pct;
      if (volVal) volVal.textContent = pct;
      if (audioEl) audioEl.volume = currentVolume;
    });
  }
  updateDragBtn();

  const resetBtn = document.getElementById('resetSize');
  if (resetBtn) {
    resetBtn.addEventListener('click', async () => {
      try {
        if (api.setPosition) await api.setPosition('center');
        if (api.setXY) await api.setXY({ x: 80, y: 120 });
        if (api.setSize) await api.setSize({ width: 340, height: null });
        if (api.setScale) await api.setScale(1);
        if (scaleSlider) scaleSlider.value = 100;
        if (scaleVal) scaleVal.textContent = 100;
        if (xSlider) xSlider.value = 80;
        if (ySlider) ySlider.value = 120;
        if (xVal) xVal.textContent = 80;
        if (yVal) yVal.textContent = 120;
      } catch (e) {}
    });
  }
}

init();
