# TikTok Live Overlay + Soundboard

Aplikasi desktop (Electron) untuk streamer satu laptop: tampilkan **komentar TikTok Live besar di atas game** sambil tetap bisa main fullscreen / borderless, dibantu **soundboard** via keybind & HP.

## Fitur

- **Overlay komentar bubble** gaya widget chat: avatar, username, teks chat, 5 pesan terakhir. Bisa **digeser & di-resize** langsung di layar (mode geser), atau lewat **slider X/Y + ukuran**.
- **Posisi & ukuran fleksibel** — preset Tengah / Atas / Bawah + drag bebas + slider Perbesar/Kecilkan tulisan (50–250%).
- **Koneksi TikTok Live** pakai [`tiktok-live-connector`](https://github.com/zerodytrash/TikTok-Live-Connector).
- **Soundboard** dari folder `sounds/` (mp3/wav/ogg/m4a/flac/mp4) via **global keybind** (F1–F9) dan via **HP** (server lokal, buka `http://<IP-laptop>:8080/`).
- **Volume soundboard terpisah** (0–100%) — tidak mengubah volume sistem Windows, jadi OBS aman.
- **Control window normal** (bisa minimize) + tray + hotkey darurat `Ctrl+Shift+O`, `Ctrl+Shift+M`, `Ctrl+Shift+D`, `Ctrl+Shift+Q`.
- Satu instance saja — port 8080 dan hotkey tidak rebutan.

## Cara menjalankan

```bash
npm install
npm run dev
```

Atau double-click **`JALANKAN.bat`**. Untuk jadi installer: `npm run build` → `dist/tiktok-live-overlay Setup 1.0.0.exe`.

> Game sebaiknya **borderless / windowed** biar overlay transparan always-on-top bisa tampil di atasnya. OBS tetap dipakai untuk capture/stream.

## Konfigurasi (`config.json`)

Salin `config.example.json` jadi `config.json` lalu isi username kamu:

```json
{
  "tiktok": { "username": "username-tiktok-kamu-yang-lagi-live" },
  "overlay": { "position": "center", "ttlMs": 6000, "custom": false, "scale": 1 },
  "soundboard": { "key": "F1", "dir": "./sounds", "port": 8080, "volume": 0.5, "map": {} }
}
```

- `tiktok.username` — harus akun yang **sedang live**, kalau tidak `UserOfflineError` itu normal.
- `overlay.position` — `center` / `top` / `bottom` (custom geser disimpan otomatis).
- `soundboard.key` — keybind utama, sisanya lewat `map` (contoh F1–F9 → nama file).
- `soundboard.volume` — 0–1, volume khusus soundboard saja.

## Soundboard

Taruh file di `sounds/` (mapping F1–F9 lewat `map` atau HP), test dari Control / HP (`http://<IP>:8080/`).

## Hotkey

- `Ctrl+Shift+O` — tampil/sembunyikan overlay
- `Ctrl+Shift+M` — minimize/restore Control
- `Ctrl+Shift+D` — keluar Mode Geser tanpa mouse
- `Ctrl+Shift+Q` — quit total
- Kalau stuck: `Ctrl+Shift+Esc` → End Task `electron`.

## Struktur

```
main.js / preload.js / config.json
public/ (overlay + control + soundboard web)
sounds/ (file audio kamu — tidak ikut di repo)
```
