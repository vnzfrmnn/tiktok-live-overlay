let api = window.api;
let currentVolume = 0.5;
if (!api) {
  try {
    const { ipcRenderer } = require('electron');
    api = {
      getConfig: () => ipcRenderer.invoke('overlay:get-config'),
      getLanIp: () => ipcRenderer.invoke('overlay:get-lan-ip'),
      onChat: (cb) => ipcRenderer.on('chat', (event, payload) => cb(payload)),
      onTikTokEvent: (cb) => ipcRenderer.on('tiktok:event', (event, payload) => cb(payload)),
      onStatus: (cb) => ipcRenderer.on('tiktok:status', (event, status) => cb(status)),
      onSoundPlay: (cb) => ipcRenderer.on('sound:play', (event, payload) => cb(payload)),
      onPosition: (cb) => ipcRenderer.on('overlay:position', (event, payload) => cb(payload)),
      onVisibility: (cb) => ipcRenderer.on('overlay:visibility', (event, payload) => cb(payload)),
      onSoundboardInfo: (cb) => ipcRenderer.on('soundboard:info', (event, payload) => cb(payload)),
      onVolume: (cb) => ipcRenderer.on('sound:volume', (event, payload) => cb(payload)),
      onBind: (cb) => ipcRenderer.on('soundboard:bind', (event, payload) => cb(payload)),
      toggleOverlay: () => ipcRenderer.invoke('control:toggle-overlay'),
      quit: () => ipcRenderer.invoke('control:quit'),
      setPosition: (pos) => ipcRenderer.invoke('control:set-position', pos),
      setVolume: (v) => ipcRenderer.invoke('control:set-volume', v),
      setBind: (data) => ipcRenderer.invoke('control:set-bind', data),
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
let notifyAudio = null;
let notifyEnabled = localStorage.getItem('notifyEnabled') !== '0';
let lastNotifyAt = 0;
let lastNotifyKey = '';

function beepNotify() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.frequency.value = 880;
    gain.gain.value = Math.max(0, Math.min(1, currentVolume || 0.5)) * 0.25;
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.25);
    osc.start();
    osc.stop(ctx.currentTime + 0.25);
    osc.onended = () => ctx.close();
  } catch (e) {}
}

function playNotify() {
  if (!notifyEnabled) return;
  const now = Date.now();
  if (now - lastNotifyAt < 700) return;
  lastNotifyAt = now;
  try {
    if (notifyAudio) { notifyAudio.pause(); notifyAudio = null; }
    const port = (config && config.soundboard && config.soundboard.port) || 8080;
    notifyAudio = new Audio(`http://127.0.0.1:${port}/audio/notif.mp3`);
    notifyAudio.volume = currentVolume;
    notifyAudio.onended = () => { notifyAudio = null; };
    notifyAudio.onerror = () => { beepNotify(); notifyAudio = null; };
    const p = notifyAudio.play();
    if (p && p.catch) p.catch(() => { beepNotify(); });
  } catch (e) {
    beepNotify();
  }
}

async function init() {
  if (!api) {
    const el = document.getElementById('status');
    if (el) el.textContent = 'Status: api tidak tersedia (preload gagal)';
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

// Bangun string accelerator Electron dari KeyboardEvent.
// Return null kalau cuma modifier atau tombol yang tidak dikenal.
function acceleratorFromEvent(e) {
  if (['Shift', 'Control', 'Alt', 'Meta'].includes(e.key)) return null;
  const parts = [];
  if (e.ctrlKey) parts.push('Control');
  if (e.altKey) parts.push('Alt');
  if (e.shiftKey) parts.push('Shift');
  if (e.metaKey) parts.push('Super');
  const code = e.code;
  let k = null;
  const named = {
    Space: 'Space', Enter: 'Return', NumpadEnter: 'Return', Escape: 'Esc',
    ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right',
    Backspace: 'Backspace', Delete: 'Delete', Insert: 'Insert', Home: 'Home',
    End: 'End', PageUp: 'PageUp', PageDown: 'PageDown', Tab: 'Tab', CapsLock: 'CapsLock',
    NumpadAdd: 'numadd', NumpadSubtract: 'numsub', NumpadMultiply: 'nummult',
    NumpadDivide: 'numdiv', NumpadDecimal: 'numdec',
    Minus: '-', Equal: '=', BracketLeft: '[', BracketRight: ']', Semicolon: ';',
    Quote: "'", Backquote: '`', Comma: ',', Period: '.', Slash: '/', Backslash: '\\'
  };
  if (named[code]) k = named[code];
  else if (/^Key[A-Z]$/.test(code)) k = code.slice(3);
  else if (/^Digit[0-9]$/.test(code)) k = code.slice(5);
  else if (/^F([1-9]|1[0-9]|2[0-4])$/.test(code)) k = code;
  else if (/^Numpad[0-9]$/.test(code)) k = 'num' + code.slice(6);
  if (!k) return null;
  return [...parts, k].join('+');
}

let cancelCapture = null; // buat mematikan mode capture kalau list re-render

function renderSoundList() {
  const container = document.getElementById('soundList');
  if (!container) return;
  if (cancelCapture) { cancelCapture(); cancelCapture = null; }
  const map = (config && config.soundboard && config.soundboard.map) || {};
  const reverse = {};
  for (const [k, f] of Object.entries(map)) reverse[f] = k;
  container.innerHTML = '';
  const files = Object.values(map);

  files.forEach((file) => {
    const current = reverse[file] || '';
    const item = document.createElement('div');
    item.className = 'sound-item';

    const row = document.createElement('div');
    row.className = 'sound-row';

    const name = document.createElement('span');
    name.className = 'sound-name';
    name.textContent = file;
    name.title = file;

    const bindBtn = document.createElement('button');
    bindBtn.className = 'btn bind-btn';
    bindBtn.textContent = current || 'Atur tombol';
    bindBtn.title = current ? 'Keybind: ' + current : 'Belum ada keybind — klik buat atur';

    const playBtn = document.createElement('button');
    playBtn.className = 'btn play-btn';
    playBtn.textContent = 'Putar';
    playBtn.title = 'Tes ' + file;
    playBtn.addEventListener('click', () => api.playKey(reverse[file] || file));

    const err = document.createElement('div');
    err.className = 'bind-err';

    async function applyBind(key) {
      bindBtn.disabled = true;
      bindBtn.textContent = 'Menyimpan…';
      try {
        const res = await api.setBind({ file, key });
        if (res && res.ok === false) {
          err.textContent = res.error || 'Gagal menyimpan keybind.';
          bindBtn.disabled = false;
          bindBtn.textContent = current || 'Atur tombol';
          return;
        }
        const fresh = await api.getConfig();
        if (fresh) config = fresh;
        renderSoundList();
      } catch (e) {
        console.error('[control] setBind gagal:', e);
        err.textContent = 'Gagal menyimpan keybind.';
        bindBtn.disabled = false;
        bindBtn.textContent = current || 'Atur tombol';
      }
    }

    bindBtn.addEventListener('click', () => {
      if (cancelCapture) cancelCapture();
      err.textContent = '';
      bindBtn.classList.add('capturing');
      bindBtn.textContent = 'Tekan tombol…';

      function stopCapture() {
        document.removeEventListener('keydown', onKey, true);
        cancelCapture = null;
        bindBtn.classList.remove('capturing');
        if (!bindBtn.disabled) bindBtn.textContent = current || 'Atur tombol';
      }

      function onKey(ev) {
        ev.preventDefault();
        ev.stopPropagation();
        if (ev.key === 'Escape') { stopCapture(); return; }
        const acc = acceleratorFromEvent(ev);
        if (!acc) return; // modifier doang — tetap nunggu
        document.removeEventListener('keydown', onKey, true);
        cancelCapture = null;
        bindBtn.classList.remove('capturing');
        applyBind(acc);
      }

      cancelCapture = stopCapture;
      document.addEventListener('keydown', onKey, true);
    });

    row.appendChild(name);
    row.appendChild(bindBtn);
    row.appendChild(playBtn);
    item.appendChild(row);
    item.appendChild(err);
    container.appendChild(item);
  });

  if (!files.length) {
    container.innerHTML = '<p class="small">Belum ada mapping. Isi map di config.json atau ganti dari web HP.</p>';
  }
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
    // Notif suara, tapi jangan dobel kalau pesan sama persis dalam 2 detik
    const key = (msg.username || '') + '|' + (msg.text || '');
    if (key !== lastNotifyKey || Date.now() - lastNotifyAt > 2000) {
      lastNotifyKey = key;
      playNotify();
    }
  });

  // Strip statistik + baris event terakhir
  function fmtStat(n) {
    const v = Number(n);
    return Number.isFinite(v) ? v.toLocaleString('id-ID') : '0';
  }
  function setStat(id, n) {
    const el = document.getElementById(id);
    if (el) el.textContent = fmtStat(n);
  }
  function setLastEvent(text) {
    const el = document.getElementById('lastEvent');
    if (el) el.textContent = text;
  }
  if (api.onTikTokEvent) {
    api.onTikTokEvent((p) => {
      if (!p || !p.type) return;
      if (p.type === 'stats') {
        setStat('viewersVal', p.viewers);
        setStat('likesVal', p.likesTotal);
      } else if (p.type === 'like') {
        if (p.total != null) setStat('likesVal', p.total);
        if (p.count) setLastEvent(`${p.user || 'Seseorang'} tap ❤ ×${p.count}`);
      } else if (p.type === 'gift') {
        const n = Number(p.count) || 1;
        const coins = p.coins != null ? ` (${p.coins} coin)` : '';
        setLastEvent(`${p.user || 'Seseorang'} kirim ${p.gift || 'gift'} ×${n}${coins}`);
      } else if (p.type === 'member') {
        setLastEvent(`${p.user || 'Seseorang'} bergabung`);
      }
    });
  }

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
    if (el) el.textContent = `Playing: ${key}`;
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
    if (dragBtn) dragBtn.textContent = dragOn ? 'Mode Geser: ON — klik lagi buat kunci' : 'Mode Geser: OFF — klik ON lalu seret bubble chat di layar';
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
  if (api.onBind) {
    api.onBind(() => { api.getConfig().then((c) => { config = c; renderSoundList(); }).catch(() => {}); });
  }
  updateDragBtn();

  const notifyToggle = document.getElementById('notifyToggle');
  if (notifyToggle) {
    notifyToggle.checked = notifyEnabled;
    notifyToggle.addEventListener('change', () => {
      notifyEnabled = notifyToggle.checked;
      localStorage.setItem('notifyEnabled', notifyEnabled ? '1' : '0');
    });
  }

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
