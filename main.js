const { app, BrowserWindow, Menu, ipcMain, globalShortcut, screen, Tray, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');
const http = require('http');
const os = require('os');
const { spawn } = require('child_process');

const CONFIG_PATH = path.join(__dirname, 'config.json');

const DEFAULT_CONFIG = {
  tiktok: { username: '' },
  overlay: { position: 'center', ttlMs: 6000, custom: false, x: 80, y: 120, scale: 1, width: 340, height: null },
  soundboard: { key: 'F1', dir: path.join(__dirname, 'sounds'), port: 8080, volume: 0.5, map: {} },
};

let config = { ...DEFAULT_CONFIG };
let overlayWin = null;
let controlWin = null;
let tray = null;
let tiktokConnection = null;
let soundboardServer = null;
let overlayVisible = true;
let lastStatus = null;

function loadConfig() {
  try {
    const raw = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    config = {
      tiktok: { ...DEFAULT_CONFIG.tiktok, ...(raw.tiktok || {}) },
      overlay: { ...DEFAULT_CONFIG.overlay, ...(raw.overlay || {}) },
      soundboard: { ...DEFAULT_CONFIG.soundboard, ...(raw.soundboard || {}) },
    };
    // Ensure map exists
    if (!config.soundboard.map) config.soundboard.map = {};
    config.soundboard.port = config.soundboard.port || 8080;
  } catch (e) {
    console.error('[overlay] Gagal baca config.json, pakai konfigurasi default:', e);
  }
  return config;
}

function saveConfig() {
  try {
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf8');
  } catch (e) {
    console.error('[overlay] Gagal simpan config:', e);
  }
}

function getLanIP() {
  try {
    const nets = os.networkInterfaces();
    for (const name of Object.keys(nets)) {
      for (const net of nets[name]) {
        const isIPv4 = net.family === 'IPv4' || net.family === 4;
        if (isIPv4 && !net.internal) return net.address;
      }
    }
  } catch (e) {}
  return '127.0.0.1';
}

// ============================================================
// OVERLAY WINDOW - Fix: tidak boleh ngunci laptop
// - focusable: false => tidak mencuri fokus keyboard/mouse
// - setIgnoreMouseEvents(true) => klik tembus ke game di bawahnya
// - showInactive => muncul tanpa mengambil fokus
// ============================================================
function createOverlayWindow() {
  const display = screen.getPrimaryDisplay();
  const { width, height } = display.workAreaSize;

  overlayWin = new BrowserWindow({
    width,
    height,
    x: 0,
    y: 0,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    movable: false,
    focusable: false, // <-- FIX: tidak curi fokus ketik
    show: false,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: false,
      nodeIntegration: true,
      spellcheck: false,
      sandbox: false,
      autoplayPolicy: 'no-user-gesture-required',
    },
  });

  // Level tertinggi supaya tetap di atas game, tapi tetap tembus klik
  overlayWin.setAlwaysOnTop(true, 'screen-saver');
  overlayWin.setIgnoreMouseEvents(true, { forward: true });

  overlayWin.loadFile(path.join(__dirname, 'public', 'overlay.html'));
  overlayWin.webContents.on('did-finish-load', () => {
    overlayWin.showInactive();
  });
  overlayWin.on('closed', () => {
    overlayWin = null;
  });
}

function toggleOverlay(force) {
  if (!overlayWin) return overlayVisible;
  overlayVisible = typeof force === 'boolean' ? force : !overlayVisible;
  if (overlayVisible) {
    overlayWin.showInactive();
  } else {
    overlayWin.hide();
  }
  return overlayVisible;
}

let dragMode = false;

function setDragMode(on, focusControl = true) {
  dragMode = Boolean(on);
  if (overlayWin && !overlayWin.isDestroyed()) {
    // GESER ON: terima mouse, GESER OFF: klik tembus ke game
    overlayWin.setIgnoreMouseEvents(!dragMode, { forward: true });
    // FIX: overlay JANGAN ambil fokus keyboard saat mode geser,
    // kalau dia fokus maka semua klik di layar ketutup overlay fullscreen
    try { overlayWin.setFocusable(false); } catch (e) {}
    if (overlayWin.webContents) {
      overlayWin.webContents.send('overlay:drag', { on: dragMode });
    }
  }
  // FIX: Control WAJIB di atas overlay pas mode geser ON,
  // supaya tombol Mode Geser OFF tetap bisa diklik walau overlay fullscreen
  if (controlWin && !controlWin.isDestroyed()) {
    try {
      if (dragMode) {
        controlWin.setAlwaysOnTop(true, 'screen-saver');
        controlWin.show();
        controlWin.focus();
        controlWin.moveTop();
      } else {
        controlWin.setAlwaysOnTop(false);
        if (focusControl) controlWin.focus();
      }
    } catch (e) {}
  }
  return dragMode;
}

// ============================================================
// CONTROL WINDOW - Jendela normal, BISA di-minimize / close
// Ini yang bikin kamu tidak stuck lagi
// ============================================================
function createControlWindow() {
  controlWin = new BrowserWindow({
    width: 460,
    height: 680,
    minWidth: 400,
    minHeight: 500,
    title: 'TikTok Overlay - Control',
    frame: true, // <-- ADA title bar: bisa minimize, maximize, close
    alwaysOnTop: false,
    resizable: true,
    show: true,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: false,
      nodeIntegration: true,
      spellcheck: false,
      sandbox: false,
      autoplayPolicy: 'no-user-gesture-required',
    },
  });

  controlWin.loadFile(path.join(__dirname, 'public', 'control.html'));
  controlWin.on('closed', () => {
    controlWin = null;
  });
  // Minimize ke tray secara tidak langsung: close = hide saja kalau tray ada
  controlWin.on('close', (e) => {
    if (tray && !app.isQuiting) {
      e.preventDefault();
      controlWin.hide();
    }
  });
}

function createTray() {
  try {
    const iconPath = path.join(__dirname, 'assets', 'icon.png');
    let icon;
    if (fs.existsSync(iconPath)) {
      icon = nativeImage.createFromPath(iconPath);
    } else {
      icon = nativeImage.createEmpty();
    }
    tray = new Tray(icon);
    tray.setToolTip('TikTok Live Overlay');
    const menu = Menu.buildFromTemplate([
      { label: 'Tampilkan / Sembunyikan Overlay (Ctrl+Shift+O)', click: () => toggleOverlay() },
      { label: 'Tampilkan Control Panel', click: () => { if (controlWin) controlWin.show(); else createControlWindow(); } },
      { type: 'separator' },
      { label: 'Quit', click: () => app.quit() },
    ]);
    tray.setContextMenu(menu);
    tray.on('click', () => {
      if (controlWin) {
        controlWin.isVisible() ? controlWin.hide() : controlWin.show();
      } else {
        createControlWindow();
      }
    });
  } catch (e) {
    console.warn('[tray] Gagal buat tray:', e.message);
  }
}

function sendTikTokStatus(status) {
  lastStatus = status;
  if (overlayWin && overlayWin.webContents) {
    overlayWin.webContents.send('tiktok:status', status);
  }
  if (controlWin && controlWin.webContents) {
    controlWin.webContents.send('tiktok:status', status);
  }
}

// Statistik live (penonton & total like) + broadcast event TikTok ke Control/HP (SSE)
const tiktokStats = { viewers: 0, likesTotal: 0 };
const sseClients = new Set();

function broadcastTikTok(payload) {
  try {
    if (controlWin && !controlWin.isDestroyed() && controlWin.webContents) controlWin.webContents.send('tiktok:event', payload);
  } catch (e) {}
  if (payload.type === 'gift' || payload.type === 'follow') {
    try {
      if (overlayWin && !overlayWin.isDestroyed() && overlayWin.webContents) overlayWin.webContents.send('tiktok:event', payload);
    } catch (e) {}
  }
  try {
    const line = 'data: ' + JSON.stringify(payload) + '\n\n';
    for (const res of sseClients) { try { res.write(line); } catch (e) { sseClients.delete(res); } }
  } catch (e) {}
}

function extractUsername(event) {
  return event.nickname || event.user?.nickname || event.displayId || event.user?.displayId || event.uniqueId || event.user?.uniqueId || event.user?.displayName || 'Anonim';
}

async function startTikTok() {
  // FIX: kalau username belum diisi, jangan coba connect (biar tidak hang)
  if (!config.tiktok.username || config.tiktok.username === 'YOUR_TIKTOK_USERNAME') {
    sendTikTokStatus({ state: 'not-configured', message: 'Isi username TikTok di Control Panel' });
    return;
  }
  try {
    const mod = await import('tiktok-live-connector');
    const { TikTokLiveConnection, WebcastEvent, ControlEvent } = mod;

    const connection = new TikTokLiveConnection(config.tiktok.username, {});
    tiktokConnection = connection;

    connection.on(WebcastEvent.CHAT, (event) => {
      // TikTok connector v2 kirim proto nested: event.user.nickname / event.content
      // Bukan flattened seperti legacy. Support dua-duanya.
      const username = extractUsername(event);
      const text = event.content || event.comment || event.text || '';
      console.log('[tiktok] CHAT:', username, ':', text);
      const payload = { username, text };
      if (overlayWin && !overlayWin.isDestroyed() && overlayWin.webContents) {
        overlayWin.webContents.send('chat', payload);
      }
      if (controlWin && !controlWin.isDestroyed() && controlWin.webContents) {
        controlWin.webContents.send('chat', payload);
      }
      broadcastTikTok({ type: 'chat', username, text });
    });

    connection.on(WebcastEvent.MEMBER, (event) => {
      if (event.action !== 1) return;
      broadcastTikTok({ type: 'member', user: extractUsername(event) });
    });

    connection.on(WebcastEvent.FOLLOW, (event) => {
      broadcastTikTok({ type: 'follow', user: extractUsername(event) });
    });

    connection.on(WebcastEvent.GIFT, (event) => {
      const count = event.repeatCount || event.comboCount || 1;
      broadcastTikTok({
        type: 'gift',
        user: extractUsername(event),
        gift: (event.gift && event.gift.name) || ('Gift ' + event.giftId),
        count,
        coins: ((event.gift && event.gift.diamondCount) || 0) * count,
      });
    });

    connection.on(WebcastEvent.LIKE, (event) => {
      tiktokStats.likesTotal = Number(event.total) || tiktokStats.likesTotal;
      broadcastTikTok({ type: 'like', user: extractUsername(event), count: event.count || 0, total: tiktokStats.likesTotal });
    });

    connection.on(WebcastEvent.ROOM_USER, (event) => {
      tiktokStats.viewers = Number(event.totalUser) || 0;
      broadcastTikTok({ type: 'stats', viewers: tiktokStats.viewers, likesTotal: tiktokStats.likesTotal });
    });

    connection.on(ControlEvent.ERROR, (payload) => {
      console.error('[tiktok] Error:', payload);
      sendTikTokStatus({ state: 'error', message: String(payload?.info ?? payload) });
    });

    const state = await connection.connect();
    tiktokStats.viewers = 0;
    tiktokStats.likesTotal = 0;
    sendTikTokStatus({ state: 'connected', roomId: state?.roomId });
    console.log('[tiktok] Terhubung ke room:', state?.roomId);
  } catch (e) {
    console.error('[tiktok] Gagal koneksi:', e);
    sendTikTokStatus({ state: 'error', message: String(e?.message ?? e) });
  }
}

const SOUND_EXTENSIONS = ['.mp3', '.wav', '.ogg', '.m4a', '.flac', '.mp4'];

function resolveSoundPath(key) {
  const map = config.soundboard.map || {};
  const custom = map[key];
  if (custom) {
    const p = path.isAbsolute(custom) ? custom : path.join(config.soundboard.dir, custom);
    if (fs.existsSync(p)) return p;
  }
  for (const ext of SOUND_EXTENSIONS) {
    const p = path.join(config.soundboard.dir, `${key}${ext}`);
    if (fs.existsSync(p)) return p;
  }
  return null;
}

function playSoundSystem(soundPath) {
  // Main-process playback (bypass Electron autoplay/block).
  // Urutan: WMPlayer (hidden) -> fallback buka di default player Windows (pasti bunyi).
  const escaped = String(soundPath).replace(/'/g, "''");
  const ps = `$log = ''; try { $p = New-Object -ComObject WMPLayer3; $p.URL = '${escaped}'; $p.controls.play(); Start-Sleep -Seconds 6; $p.close(); Write-Host '[soundboard] WMPlayer OK' } catch { Write-Host '[soundboard] WMPlayer gagal, fallback Start-Process'; Start-Process '${escaped}' }`;
  const child = spawn('powershell', ['-NoProfile', '-NonInteractive', '-Command', ps], { detached: false, stdio: 'pipe', windowsHide: true });
  let out = '';
  if (child.stdout) child.stdout.on('data', (d) => { out += d; });
  if (child.stderr) child.stderr.on('data', (d) => { out += d; });
  child.on('error', (e) => console.warn('[soundboard] system play spawn gagal:', e.message));
  child.on('close', () => { if (out) console.log(out.trim()); });
}

function playSoundByKey(key) {
  const soundPath = resolveSoundPath(key);
  if (soundPath) {
    const port = config.soundboard.port || 8080;
    const url = `http://127.0.0.1:${port}/audio/${encodeURIComponent(path.basename(soundPath))}`;
    console.log(`[soundboard] Playing ${key} -> ${soundPath} (url: ${url})`);
    // FIX double suara: hanya SATU pemutar (renderer Control). Pemutar PowerShell dimatikan
    // karena WMPlayer gagal -> fallback Start-Process malah loop + dobel.
    const payload = { key, path: soundPath, url };
    if (controlWin && controlWin.webContents && !controlWin.isDestroyed()) {
      controlWin.webContents.send('sound:play', payload);
    }
    if (overlayWin && overlayWin.webContents && !overlayWin.isDestroyed()) {
      overlayWin.webContents.send('sound:play', payload);
    }
  } else {
    console.warn(`[soundboard] File untuk key "${key}" tidak ditemukan di ${config.soundboard.dir}`);
  }
}

// FIX: daftarkan SEMUA key di map (F1-F9), bukan cuma satu
// Pisahkan hotkey soundboard vs hotkey darurat, biar bisa di-re-register tanpa dobel
let soundKeys = [];

function registerSoundKeys() {
  // Lepas dulu key soundboard lama (jangan lepas hotkey darurat Ctrl+Shift+D dll)
  soundKeys.forEach((k) => { try { globalShortcut.unregister(k); } catch (e) {} });
  soundKeys = [];
  const map = config.soundboard.map || {};
  const keys = Object.keys(map);
  if (config.soundboard.key && !keys.includes(config.soundboard.key)) {
    keys.push(config.soundboard.key);
  }
  keys.forEach((key) => {
    try {
      const registered = globalShortcut.register(key, () => playSoundByKey(key));
      if (registered) soundKeys.push(key);
      else console.warn(`[soundboard] Gagal mendaftarkan global keybind: ${key} (mungkin sudah dipakai app lain)`);
    } catch (e) {
      console.warn(`[soundboard] Error daftar keybind ${key}:`, e.message);
    }
  });
  console.log('[soundboard] Keybind aktif:', soundKeys.join(', ') || '(tidak ada)');
}

function registerSoundboard() {
  registerSoundKeys();

  // HOTKEY DARURAT biar tidak stuck lagi
  globalShortcut.register('CommandOrControl+Shift+O', () => {
    const vis = toggleOverlay();
    console.log('[hotkey] Overlay toggled:', vis);
    if (controlWin && controlWin.webContents) {
      controlWin.webContents.send('overlay:visibility', { visible: vis });
    }
  });
  globalShortcut.register('CommandOrControl+Shift+M', () => {
    if (controlWin) {
      controlWin.isMinimized() ? controlWin.restore() : controlWin.minimize();
    }
  });
  // FIX: tombol keyboard buat keluar mode geser TANPA mouse
  // (overlay fullscreen nutup mouse pas mode geser ON)
  globalShortcut.register('CommandOrControl+Shift+D', () => {
    const now = setDragMode(false);
    console.log('[hotkey] Mode geser OFF via Ctrl+Shift+D');
    if (controlWin && controlWin.webContents) {
      controlWin.webContents.send('overlay:drag', { on: now });
    }
  });
  globalShortcut.register('CommandOrControl+Shift+Q', () => {
    app.quit();
  });
}

function setSoundKey(file, key) {
  if (!file) return { ok: false, error: 'File tidak valid' };
  // Keybind bebas: 1-60 karakter, tanpa spasi, tidak diawali/diakhiri '+',
  // dan setiap segmen yang dipisah '+' harus terisi (mis. 'Control+Shift+F9', 'Q', 'F5').
  if (typeof key !== 'string' || key.length < 1 || key.length > 60 || /\s/.test(key) || !/^([^+]+)(\+[^+]+)*$/.test(key)) {
    return { ok: false, error: 'Keybind tidak valid' };
  }
  if (!config.soundboard.map) config.soundboard.map = {};
  // Konflik: key sudah dipakai file lain -> tolak (tidak auto-move untuk key bebas)
  const existing = config.soundboard.map[key];
  if (existing && existing !== file) {
    return { ok: false, error: 'Keybind ' + key + ' sudah dipakai file ' + existing };
  }
  // hapus mapping lama untuk file ini
  for (const k of Object.keys(config.soundboard.map)) {
    if (config.soundboard.map[k] === file) delete config.soundboard.map[k];
  }
  config.soundboard.map[key] = file;
  config.soundboard.key = key;
  saveConfig();
  registerSoundKeys();
  const payload = { file, key };
  if (controlWin && controlWin.webContents) {
    controlWin.webContents.send('soundboard:bind', payload);
  }
  return { ok: true, ...payload };
}

function startSoundboardServer() {
  if (soundboardServer) return soundboardServer;
  const port = config.soundboard.port || 8080;
  const MIME = { '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ogg': 'audio/ogg', '.m4a': 'audio/mp4', '.flac': 'audio/flac', '.mp4': 'audio/mp4' };
  const server = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://localhost');
    if (req.method === 'GET' && (u.pathname === '/' || u.pathname === '/index.html')) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(fs.readFileSync(path.join(__dirname, 'public', 'soundboard.html'), 'utf8'));
    } else if (req.method === 'GET' && (u.pathname === '/chat' || u.pathname === '/chat.html')) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(fs.readFileSync(path.join(__dirname, 'public', 'chat.html'), 'utf8'));
    } else if (req.method === 'GET' && u.pathname === '/events') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
      res.write(':ok\n\n');
      sseClients.add(res);
      req.on('close', () => sseClients.delete(res));
    } else if (req.method === 'GET' && u.pathname === '/stats') {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ viewers: tiktokStats.viewers, likesTotal: tiktokStats.likesTotal }));
    } else if (req.method === 'GET' && u.pathname === '/sounds') {
      try {
        const map = config.soundboard.map || {};
        const reverse = {};
        for (const [k, f] of Object.entries(map)) reverse[f] = k;
        const files = fs
          .readdirSync(config.soundboard.dir)
          .filter((f) => SOUND_EXTENSIONS.includes(path.extname(f).toLowerCase()))
          .map((f) => ({ name: f, key: path.basename(f, path.extname(f)), bindKey: reverse[f] || '' }));
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify(files));
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: String(e) }));
      }
    } else if (req.method === 'POST' && u.pathname === '/bind') {
      let body = '';
      req.on('data', (c) => { body += c; if (body.length > 5000) req.destroy(); });
      req.on('end', () => {
        try {
          const data = JSON.parse(body || '{}');
          const result = setSoundKey(data.file, data.key);
          res.writeHead(result.ok ? 200 : 400, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify(result));
        } catch (e) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: String(e) }));
        }
      });
    } else if (req.method === 'GET' && u.pathname.startsWith('/sound/')) {
      const key = decodeURIComponent(u.pathname.slice('/sound/'.length).split('?')[0]);
      const p = resolveSoundPath(key);
      if (!p) {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        return res.end('Sound not found');
      }
      playSoundByKey(key);
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: true }));
    } else if (req.method === 'GET' && u.pathname.startsWith('/audio/')) {
      try {
        const fileName = decodeURIComponent(u.pathname.slice('/audio/'.length).split('?')[0]);
        const safePath = path.join(config.soundboard.dir, path.basename(fileName));
        if (!safePath.startsWith(path.resolve(config.soundboard.dir))) {
          res.writeHead(403); return res.end('Forbidden');
        }
        if (!fs.existsSync(safePath)) {
          res.writeHead(404); return res.end('Not Found');
        }
        const ext = path.extname(safePath).toLowerCase();
        res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Accept-Ranges': 'bytes' });
        fs.createReadStream(safePath).pipe(res);
      } catch (e) {
        res.writeHead(500); res.end(String(e));
      }
    } else {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not Found');
    }
  });
  soundboardServer = server;
  server.on('error', (err) => {
    if (err && err.code === 'EADDRINUSE') {
      console.error(`[soundboard] Port ${port} dipakai app lain. Mungkin app lama belum ditutup.`);
      console.error('Tutup app lama dulu: Task Manager -> End Task "electron" / "TikTok Live Overlay"');
      const msg = `Port ${port} sudah dipakai!\n\nApp lama mungkin belum ditutup.\nBuka Task Manager (Ctrl+Shift+Esc) -> End Task "electron" -> jalankan lagi.`;
      const { dialog } = require('electron');
      dialog.showErrorBox('Port sudah dipakai', msg);
    } else {
      console.error('[soundboard] Server error:', err);
    }
  });
  server.listen(port, '0.0.0.0', () => {
    const ip = getLanIP();
    console.log(`[soundboard] Server berjalan di http://${ip}:${port}/ (HP buka alamat ini)`);
    if (controlWin && controlWin.webContents) {
      controlWin.webContents.send('soundboard:info', { ip, port });
    }
  });
  return server;
}

function stopSoundboardServer() {
  if (soundboardServer) {
    try { soundboardServer.close(); } catch (e) {}
    soundboardServer = null;
  }
}

app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
app.isQuiting = false;

// Single instance: cegah buka 2x -> port 8080 rebutan + hotkey rebutan
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  console.log('[app] Sudah ada instance lain yang jalan, keluar.');
  app.quit();
} else {
  app.on('second-instance', () => {
    if (controlWin) {
      if (controlWin.isMinimized()) controlWin.restore();
      controlWin.show();
      controlWin.focus();
    }
  });
}

app.whenReady().then(() => {
  config = loadConfig();

  // Daftarkan SEMUA handler DULU sebelum bikin window, biar tidak race condition
  ipcMain.handle('overlay:get-config', () => config);
  ipcMain.handle('overlay:get-lan-ip', () => ({ ip: getLanIP(), port: config.soundboard.port || 8080 }));
  ipcMain.handle('control:toggle-overlay', () => toggleOverlay());
  ipcMain.handle('control:quit', () => { app.isQuiting = true; app.quit(); });
  ipcMain.handle('control:set-position', (e, pos) => {
    config.overlay.position = pos;
    config.overlay.custom = false;
    saveConfig();
    if (overlayWin && overlayWin.webContents) {
      overlayWin.webContents.send('overlay:position', { position: pos });
    }
    return config;
  });
  ipcMain.handle('control:set-xy', (e, xy) => {
    const x = Math.max(0, Math.min(4000, Number(xy && xy.x) || 0));
    const y = Math.max(0, Math.min(4000, Number(xy && xy.y) || 0));
    config.overlay.x = x;
    config.overlay.y = y;
    config.overlay.custom = true;
    saveConfig();
    if (overlayWin && overlayWin.webContents) {
      overlayWin.webContents.send('overlay:xy', { x, y, custom: true });
    }
    return config;
  });
  ipcMain.handle('control:set-drag', (e, on) => setDragMode(on));
  ipcMain.handle('control:get-drag', () => dragMode);
  ipcMain.handle('control:set-scale', (e, scale) => {
    const s = Math.max(0.5, Math.min(2.5, Number(scale) || 1));
    config.overlay.scale = s;
    saveConfig();
    if (overlayWin && overlayWin.webContents) {
      overlayWin.webContents.send('overlay:scale', { scale: s });
    }
    return config;
  });
  ipcMain.handle('control:set-size', (e, size) => {
    const w = Math.max(200, Math.min(1200, Number(size && size.width) || 340));
    const h = size && size.height != null ? Math.max(120, Math.min(1000, Number(size.height) || 0)) : null;
    config.overlay.width = w;
    config.overlay.height = h;
    saveConfig();
    if (overlayWin && overlayWin.webContents) {
      overlayWin.webContents.send('overlay:size', { width: w, height: h });
    }
    return config;
  });
  ipcMain.handle('control:set-volume', (e, vol) => {
    const v = Math.max(0, Math.min(1, Number(vol) || 0));
    config.soundboard.volume = v;
    saveConfig();
    if (controlWin && controlWin.webContents) {
      controlWin.webContents.send('sound:volume', { volume: v });
    }
    if (overlayWin && overlayWin.webContents) {
      overlayWin.webContents.send('sound:volume', { volume: v });
    }
    return config;
  });
  ipcMain.handle('control:set-bind', (e, data) => {
    return setSoundKey(data && data.file, data && data.key);
  });
  ipcMain.handle('control:set-username', async (e, username) => {
    config.tiktok.username = (username || '').trim();
    saveConfig();
    console.log('[tiktok] Username disimpan:', config.tiktok.username);
    // FIX: Simpan langsung reconnect, jadi tidak perlu klik Reconnect manual
    if (tiktokConnection) {
      try { tiktokConnection.disconnect(); } catch (err) {}
      tiktokConnection = null;
    }
    sendTikTokStatus({ state: 'connecting', message: `Menghubungkan ke ${config.tiktok.username}...` });
    startTikTok();
    return config;
  });
  ipcMain.handle('control:play-key', (e, key) => {
    playSoundByKey(key);
    return { ok: true };
  });
  ipcMain.handle('control:reconnect', () => {
    if (tiktokConnection) {
      try { tiktokConnection.disconnect(); } catch (e) {}
      tiktokConnection = null;
    }
    startTikTok();
    return { ok: true };
  });

  const menu = Menu.buildFromTemplate([
    { label: 'TikTok Live Overlay', submenu: [{ role: 'quit' }] },
  ]);
  Menu.setApplicationMenu(menu);

  createOverlayWindow();
  createControlWindow();
  createTray();

  // Kirim ulang status terakhir begitu Control selesai load
  if (controlWin && controlWin.webContents) {
    controlWin.webContents.on('did-finish-load', () => {
      if (lastStatus) controlWin.webContents.send('tiktok:status', lastStatus);
      controlWin.webContents.send('soundboard:info', { ip: getLanIP(), port: config.soundboard.port || 8080 });
      if (overlayWin && overlayWin.webContents) {
        // kirim posisi custom ke overlay yang baru load
        if (config.overlay.custom) {
          overlayWin.webContents.send('overlay:xy', { x: config.overlay.x, y: config.overlay.y, custom: true });
        } else {
          overlayWin.webContents.send('overlay:position', { position: config.overlay.position });
        }
        if (dragMode) overlayWin.webContents.send('overlay:drag', { on: true });
      }
    });
  }

  // FIX: jangan await TikTok di sini, biar UI + soundboard langsung jalan
  // walau TikTok belum live / username salah
  startTikTok();
  registerSoundboard();
  startSoundboardServer();
});

app.on('will-quit', () => {
  try {
    globalShortcut.unregisterAll();
  } catch (e) {}
  if (tiktokConnection) {
    try { tiktokConnection.disconnect(); } catch (e) {}
  }
  stopSoundboardServer();
});

app.on('window-all-closed', () => {
  // FIX: jangan langsung quit, tray masih butuh jalan
  // Hanya quit kalau di macOS (sesuai standar Electron)
  if (process.platform === 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (!controlWin) createControlWindow();
  else controlWin.show();
});
