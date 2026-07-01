# MinIO Client (mc) — bundled

Folder ini berisi **MinIO Client** untuk backup job engine `minio` di SyncGuard portable/offline.

## Isi

| File | Keterangan |
|------|------------|
| `mc.exe` | Binary MinIO Client (Windows amd64) |

## Setup

Jalankan dari root project:

```bat
install-mc.bat
```

Script menyalin `mc.exe` dari root project (jika ada) ke `tools/mc/mc.exe`.

Download manual:

https://dl.min.io/client/mc/release/windows-amd64/mc.exe

## Settings

Di SyncGuard → **Settings** → **MinIO** → **mc Path**:

```text
tools/mc/mc.exe
```

Ini adalah default untuk instalasi portable dan offline installer.

`mc.exe` tidak di-commit ke git (ukuran binary). Sertakan saat membangun **SyncGuard-Setup-Offline**.
