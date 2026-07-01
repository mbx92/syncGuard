# SyncGuard Portable

SyncGuard bisa dijalankan sebagai aplikasi **self-contained** — cukup copy seluruh folder.

## Persyaratan

- **Tidak perlu install Node.js di Windows** — Node.js LTS bundled di `tools/node/`
- **Internet sekali** — untuk `setup-portable.bat` atau `install-node.bat` (download Node + npm install)

## Setup pertama

1. Jalankan **`setup-portable.bat`**
2. Wizard: Node portable, npm install, cwRsync, shortcut Desktop, Startup opsional

Atau manual:

```bat
install-node.bat
npm install --omit=dev
install-cwrsync.bat
```

## Menjalankan

| Cara | Keterangan |
|------|------------|
| **`SyncGuard.exe`** | Double-click — icon HD dari resource EXE |
| **`SyncGuard.vbs`** | Launcher lama (fallback) |
| **`start.bat`** | Mode konsol (debug) |
| **`SyncGuard-Stop.vbs`** | Hentikan server |

## Startup Windows

- **`install-startup.bat`** — jalan otomatis saat login
- **`remove-startup.bat`** — hapus dari startup

## Portable

```
tools/node/   ← Node.js LTS bundled (~30 MB)
tools/cwrsync/← rsync for Windows
tools/mc/     ← MinIO Client (mc.exe)
config/       ← settings & password (lokal)
logs/         ← backup logs + syncguard-server.log
node_modules/
```

Copy folder ke USB atau PC lain — **tanpa install Node.js** di PC tujuan (asalkan `tools/node/` ikut ter-copy).

**MinIO:** jalankan `install-mc.bat` sekali jika `tools/mc/mc.exe` belum ada (atau letakkan `mc.exe` di root project sebelum setup).

**Jangan copy** folder `hub/` ke portable agent — hub hanya di server pusat. Lihat [`HUB.md`](HUB.md).

## Node.js: bundled vs sistem

| Prioritas | Sumber |
|-----------|--------|
| 1 | `tools/node/node.exe` |
| 2 | Node.js di PATH (fallback dev) |
