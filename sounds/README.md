# Soundboard

Tempat menyimpan file musik/suara untuk soundboard.

## Cara pakai

1. Masukkan file suara Anda ke folder ini.
2. Format yang didukung: `.mp3`, `.wav`, `.ogg`, `.m4a`, `.flac`, `.mp4`.
3. Hubungkan file dengan keybind di `config.json` → `soundboard.key`.

Contoh:
- Keybind `F1` → file `sounds/F1.mp3`
- Keybind `F2` → file `sounds/F2.mp3`

Atau gunakan fitur `soundboard.map` di `config.json` untuk memetakan keybind ke file
nama lain, misal:

```json
{
  "soundboard": {
    "key": "F1",
    "dir": "./sounds",
    "map": {
      "F1": "bruh.mp3"
    }
  }
}
```

## Catatan

- Keybind harus terdaftar di global shortcut (diperbolehkan Electron).
- Keybind mengacu ke aplikasi ini (harus jalan saat sound diputar).
- File harus absolute atau relatif ke folder `sounds/`.
