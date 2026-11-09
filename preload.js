const { contextBridge, ipcRenderer } = require('electron');

function buildApi() {
  return {
    getConfig: () => ipcRenderer.invoke('overlay:get-config'),
    getLanIp: () => ipcRenderer.invoke('overlay:get-lan-ip'),
    onChat: (cb) => ipcRenderer.on('chat', (event, payload) => cb(payload)),
    onStatus: (cb) => ipcRenderer.on('tiktok:status', (event, status) => cb(status)),
    onSoundPlay: (cb) => ipcRenderer.on('sound:play', (event, payload) => cb(payload)),
    onPosition: (cb) => ipcRenderer.on('overlay:position', (event, payload) => cb(payload)),
    onVisibility: (cb) => ipcRenderer.on('overlay:visibility', (event, payload) => cb(payload)),
    onSoundboardInfo: (cb) => ipcRenderer.on('soundboard:info', (event, payload) => cb(payload)),
    onDrag: (cb) => ipcRenderer.on('overlay:drag', (event, payload) => cb(payload)),
    onXY: (cb) => ipcRenderer.on('overlay:xy', (event, payload) => cb(payload)),
    onScale: (cb) => ipcRenderer.on('overlay:scale', (event, payload) => cb(payload)),
    onSize: (cb) => ipcRenderer.on('overlay:size', (event, payload) => cb(payload)),
    onVolume: (cb) => ipcRenderer.on('sound:volume', (event, payload) => cb(payload)),
    onBind: (cb) => ipcRenderer.on('soundboard:bind', (event, payload) => cb(payload)),
    toggleOverlay: () => ipcRenderer.invoke('control:toggle-overlay'),
    quit: () => ipcRenderer.invoke('control:quit'),
    setPosition: (pos) => ipcRenderer.invoke('control:set-position', pos),
    setXY: (xy) => ipcRenderer.invoke('control:set-xy', xy),
    setDrag: (on) => ipcRenderer.invoke('control:set-drag', on),
    getDrag: () => ipcRenderer.invoke('control:get-drag'),
    setScale: (s) => ipcRenderer.invoke('control:set-scale', s),
    setSize: (sz) => ipcRenderer.invoke('control:set-size', sz),
    setVolume: (v) => ipcRenderer.invoke('control:set-volume', v),
    setBind: (data) => ipcRenderer.invoke('control:set-bind', data),
    setUsername: (u) => ipcRenderer.invoke('control:set-username', u),
    playKey: (k) => ipcRenderer.invoke('control:play-key', k),
    reconnect: () => ipcRenderer.invoke('control:reconnect'),
  };
}

try {
  contextBridge.exposeInMainWorld('api', buildApi());
} catch (e) {
  console.error('[preload] expose gagal:', e);
  window.api = buildApi();
}
