# SyncGuard — Dokumentasi Sistem

**Versi:** 1.0.0  
**SyncGuard** adalah manajer backup berbasis web untuk Windows (portable) dan Linux (headless), dengan dashboard pusat opsional (**SyncGuard Hub**).

---

## Daftar Isi

1. [Ringkasan](#ringkasan)
2. [Arsitektur](#arsitektur)
3. [Komponen](#komponen)
4. [Instalasi](#instalasi)
5. [Menjalankan Aplikasi](#menjalankan-aplikasi)
6. [Konfigurasi Agent](#konfigurasi-agent)
7. [Jenis Job](#jenis-job)
8. [Engine Sinkronisasi](#engine-sinkronisasi)
9. [Penjadwalan (Cron)](#penjadwalan-cron)
10. [SyncGuard Hub](#syncguard-hub)
11. [API Reference](#api-reference)
12. [Struktur Direktori](#struktur-direktori)
13. [Keamanan](#keamanan)
14. [Troubleshooting](#troubleshooting)
15. [Dokumen Terkait](#dokumen-terkait)

---

## Ringkasan

SyncGuard memungkinkan Anda:

- Menjalankan **banyak job backup** dari satu dashboard web
- Memilih **engine**: Rsync (SSH ke Synology/NAS), Robocopy (SMB/UNC), atau MinIO (S3-compatible)
- Backup **folder** atau **PostgreSQL** (`pg_dump` + upload)
- Menjadwalkan backup dengan **cron** atau menjalankan manual (**Run Now**)
- Memantau progress dan log **real-time** via WebSocket
- Mengelola banyak agent Windows/Linux dari **Hub** terpusat

| Komponen | Port default | URL |
|----------|--------------|-----|
| Agent (lokal) | 7432 | http://localhost:7432 |
| Hub (pusat) | 7443 | http://localhost:7443 |

---

## Arsitektur

```text
┌─────────────────────────────────────────────────────────────────┐
│                     SyncGuard Hub (opsional)                    │
│  Vue 3 Dashboard · Agent registry · Log retention · PG/MinIO    │
│                         :7443                                   │
└────────────────────────────▲────────────────────────────────────┘
                             │ HTTPS / HTTP
                             │ register · heartbeat · logs · commands
┌────────────────────────────┴────────────────────────────────────┐
│                    SyncGuard Agent (per server)                   │
│  Express + WebSocket · node-cron · config/config.json           │
│                         :7432                                     │
└──────┬──────────────┬──────────────┬─────────────────────────────┘
       │              │              │
   Rsync/SSH      Robocopy/SMB      MinIO (mc)
       │              │              │
       ▼              ▼              ▼
   Synology NAS   UNC Share      S3 / MinIO bucket
```

**Alur job backup:**

1. Trigger: cron terjadwal, tombol **Run Now**, atau perintah remote dari Hub
2. Validasi: engine, kredensial SSH/SMB/MinIO, binary (`rsync`, `pg_dump`, `mc`)
3. Eksekusi:
   - **Filesystem** → langsung sync folder sumber
   - **PostgreSQL** → fase `dump` (`pg_dump`) lalu fase `sync` (rsync/MinIO)
4. Log ditulis ke `logs/{jobId}.log` dan di-broadcast via WebSocket
5. Jika Hub aktif → status, run summary, dan log (terbatas) dikirim ke pusat

---

## Komponen

### Agent (`backend/`)

| Modul | Fungsi |
|-------|--------|
| `server.js` | HTTP API, WebSocket, cron scheduler, orchestrasi job |
| `rsync-util.js` | Build argumen rsync, deteksi binary, test SSH |
| `ssh.js` | Generate/deploy SSH key, koneksi Synology |
| `postgres-util.js` | `pg_dump`, retention dump lokal, deteksi binary |
| `minio-util.js` | Upload/mirror via MinIO Client (`mc`) |
| `agent-hub.js` | Koneksi ke Hub: register, heartbeat, push log |
| `log-rotate.js` | Rotasi log per job (ukuran & retensi) |
| `log-purge.js` | Purge log lama sesuai kebijakan Hub |
| `lifecycle.js` | Graceful shutdown |

### Frontend Agent (`frontend/index.html`)

Single-page dashboard: daftar job, settings NAS/MinIO/Hub, modal job, log viewer, tema gelap/terang.

### Hub (`hub/`)

| Modul | Fungsi |
|-------|--------|
| `server.js` | API admin + agent, serve UI Vue |
| `store.js` | Persistensi JSON di `hub/data/` |
| `auth.js` | Admin token & agent API key |
| `log-policy.js` | Retensi run/log, rate limit ingest |
| `hub-postgres.js` | Job PostgreSQL di sisi server hub |
| `hub-minio.js` | Job MinIO di sisi server hub |
| `web/` | Vue 3 + Tailwind 4 + DaisyUI 5 |

---

## Instalasi

### Windows Portable (disarankan)

1. Jalankan **`setup-portable.bat`**
   - Node.js LTS → `tools/node/`
   - `npm install --omit=dev`
   - cwRsync → `tools/cwrsync/`
   - Shortcut desktop (opsional)
2. Buka **http://localhost:7432**

Tidak perlu install Node.js di Windows jika folder `tools/node/` ikut di-copy.  
Detail: [`PORTABLE.md`](../PORTABLE.md)

### Windows — alternatif manual

```bat
install-node.bat
npm install --omit=dev
install-cwrsync.bat
start.bat
```

### Linux (systemd)

```bash
npm install --omit=dev
chmod +x scripts/linux/*.sh
sudo ./scripts/linux/install-agent-service.sh --user syncguard --app-dir /opt/syncguard --port 7432
```

Detail: [`LINUX.md`](../LINUX.md)

### Hub — lokal

```bat
npm run hub:install
npm run hub:build
npm run hub
```

Atau: `start-hub.bat` / `start-hub-docker.bat`

Detail: [`HUB.md`](../HUB.md), [`COOLIFY.md`](../COOLIFY.md)

---

## Menjalankan Aplikasi

### Agent Windows

| Cara | Keterangan |
|------|------------|
| `SyncGuard.exe` | Launcher dengan icon (setelah build) |
| `SyncGuard.vbs` | Start hidden |
| `start.bat` | Mode konsol (debug) |
| `SyncGuard-Stop.vbs` / `stop.bat` | Hentikan server |
| `install-startup.bat` | Autostart saat login Windows |

### Agent Linux

```bash
PORT=7432 ./scripts/linux/start-agent.sh
# atau
systemctl start syncguard-agent
```

### Hub

```bat
start-hub.bat          # native Node
start-hub-docker.bat   # Docker Compose lokal
```

Port dapat diubah dengan environment variable `PORT`.

---

## Konfigurasi Agent

Konfigurasi disimpan di **`config/config.json`** (tidak di-commit ke git).

### Struktur utama

```json
{
  "nas": {
    "ip": "10.10.10.111",
    "user": "cwrsync",
    "port": 2222,
    "basePath": "/volume1/rsyncDir",
    "password": "..."
  },
  "settings": {
    "syncEngine": "rsync",
    "rsyncPath": "tools/cwrsync/bin/rsync.exe",
    "pgDumpPath": "pg_dump",
    "mcPath": "tools/mc/mc.exe",
    "sshKeyDeployed": true,
    "defaultOptions": "-avz --progress --delete",
    "robocopyPath": "robocopy",
    "robocopyDefaultOptions": "/E /Z /R:3 /W:5 /MT:8 /MIR",
    "smbShare": "\\\\NAS\\backup",
    "smbPassword": ""
  },
  "minio": {
    "endpoint": "https://minio.example.com",
    "bucket": "syncguard",
    "prefix": "syncguard",
    "accessKey": "...",
    "secretKeyEncrypted": "..."
  },
  "hub": {
    "enabled": false,
    "url": "http://hub-server:7443",
    "agentId": "server-prod-01",
    "apiKey": "...",
    "heartbeatIntervalSec": 30,
    "logPushMode": "summary",
    "localLogMaxMbPerJob": 10,
    "localLogKeepRotations": 3
  },
  "nasProfiles": [],
  "jobs": []
}
```

### Settings → NAS (Rsync/SSH)

| Field | Keterangan |
|-------|------------|
| IP Address | IP Synology atau NAS |
| SSH User | User SSH (mis. `cwrsync`) |
| SSH Port | Default Synology sering `22` atau custom `2222` |
| Base Backup Path | Path di NAS, mis. `/volume1/backup` |
| Password | Password SSH — wajib sebelum deploy key |

**Deploy SSH Key:**

1. Isi password NAS → **Save NAS Config**
2. **Generate SSH Key** (jika belum ada)
3. **Deploy SSH Key ke NAS**
4. Setelah ganti password Synology: isi password baru → Save → Deploy ulang

Key disimpan di `config/keys/syncguard_ed25519`. Backup rsync **memerlukan SSH key yang valid** (password-only tidak andal di Windows/cwRsync).

### NAS Profiles (multi-NAS)

Anda dapat mendefinisikan beberapa profil NAS (`nasProfiles`) dan mengaitkannya per job via `nasProfileId`. Job dengan profil sendiri tidak memakai validasi SSH global.

### Settings → Robocopy (SMB)

| Field | Keterangan |
|-------|------------|
| SMB Share Path | UNC path, mis. `\\192.168.1.100\backup` |
| Robocopy Path | Default `robocopy` |
| Default Options | `/E /Z /R:3 /W:5 /MT:8 /MIR` |

Exit code Robocopy **0–7** = sukses; **≥ 8** = gagal.

### Settings → MinIO

| Field | Keterangan |
|-------|------------|
| Endpoint | URL MinIO/S3, mis. `https://minio.example.com` |
| Bucket Name | **Wajib** — nama bucket tujuan |
| Prefix | Folder awal di bucket (default `syncguard`) |
| Access Key / Secret Key | Kredensial MinIO |

Klik **Save MinIO Config** sebelum menjalankan job MinIO.  
Path upload: `s3://{bucket}/{prefix}/{nama-job}/{file}`

Binary **MinIO Client (`mc`)** — bundled di `tools/mc/mc.exe` (installer offline). Jalankan `install-mc.bat` jika belum ada, atau set path manual di settings.

### Settings → SyncGuard Hub

| Field | Keterangan |
|-------|------------|
| Enabled | Aktifkan koneksi ke Hub |
| Hub URL | URL publik hub (bukan `localhost` jika agent di mesin lain) |
| Agent ID | ID unik agent (harus cocok dengan daftar di Hub) |
| API Key | Dari Hub → Settings → Daftar agent |

---

## Jenis Job

### Filesystem (folder sync)

| Field | Keterangan |
|-------|------------|
| Name | Nama job (ditampilkan di UI & path tujuan) |
| Source Path | Folder lokal yang di-backup |
| Dest Path | Opsional — override path di NAS/SMB |
| Schedule | Cron atau `manual` |
| Sync Engine | `rsync`, `robocopy`, atau `minio` |
| Exclusions | Pola file/folder yang di-skip |
| Options | Flag rsync/robocopy per job |

**Tujuan default:**

- Rsync: `{basePath}/{nama-job}/`
- Robocopy: `{smbShare}\{nama-job}`
- MinIO: `s3://{bucket}/{prefix}/{nama-job}/`

### PostgreSQL

| Field | Keterangan |
|-------|------------|
| Host / Port / Database | Koneksi PostgreSQL |
| Username / Password | Kredensial DB |
| Pg Dump Path | Path ke `pg_dump.exe` jika tidak di PATH |
| Retention Count | Jumlah dump lokal yang dipertahankan (default 3) |
| File prefix | Pola nama file dump (mis. `kostMan_prod`) |

**Alur:**

1. `pg_dump` → file ber-timestamp di folder dump lokal (mis. `dbbackup/`)
2. Upload/sync ke NAS (rsync) atau MinIO (`mc cp`)

Setiap run **membuat file baru** — file lama di NAS **tidak** menghalangi run manual.

Job terjadwal dan **Run Now** **tidak saling memblokir**.

---

## Engine Sinkronisasi

| Engine | Platform | Target | Catatan |
|--------|----------|--------|---------|
| **rsync** | Windows/Linux | NAS via SSH | cwRsync/WSL/native rsync; butuh SSH key |
| **robocopy** | Windows only | SMB/UNC | Native Windows, tidak perlu SSH |
| **minio** | Windows/Linux | S3/MinIO | Via `mc mirror` atau `mc cp` |

### Opsi Rsync berguna

```text
-avz              archive + verbose + compress
--delete          hapus file di NAS yang sudah tidak ada di lokal
--backup          simpan versi lama
--dry-run         simulasi tanpa menulis
```

### Opsi Robocopy berguna

```text
/E                copy subfolder termasuk kosong
/MIR              mirror (hati-hati: hapus di tujuan)
/Z                restartable mode
/MT:8             multi-threaded
/R:3 /W:5         retry 3x, tunggu 5 detik
/L                list only (dry run)
```

### MinIO

- Job folder: upload per file dengan **normalisasi nama path** (`mc cp`) — karakter `#`, spasi, dll. diganti otomatis
- Job PostgreSQL: `mc cp` file dump tunggal
- Setelah upload, sistem memverifikasi object dengan `mc stat`

---

## Penjadwalan (Cron)

Format cron standar (5 field):

```text
┌───────────── menit (0-59)
│ ┌─────────── jam (0-23)
│ │ ┌───────── tanggal (1-31)
│ │ │ ┌─────── bulan (1-12)
│ │ │ │ ┌───── hari minggu (0-7, 0=Min)
│ │ │ │ │
* * * * *
```

| Expression | Arti |
|------------|------|
| `0 2 * * *` | Setiap hari jam 02:00 |
| `0 * * * *` | Setiap jam |
| `0 3 * * 0` | Setiap Minggu jam 03:00 |
| `0 4 1 * *` | Tanggal 1 setiap bulan jam 04:00 |
| `*/30 * * * *` | Setiap 30 menit |
| `manual` | Hanya via Run Now |

Job terjadwal **tetap bisa** dijalankan manual kapan saja.

---

## SyncGuard Hub

Hub adalah dashboard pusat untuk:

- Memantau status banyak agent (online/offline, ringkasan job)
- Melihat history run dan log (dengan retensi & rate limit)
- Mengirim perintah remote ke agent (run job, purge log)
- Menjalankan job PostgreSQL/MinIO **di server hub** (Docker/Coolify)

### Menjalankan Hub

```bat
npm run hub:install && npm run hub:build && npm run hub
```

Login dengan **admin token** dari `hub/config.json` → `adminToken` atau env `HUB_ADMIN_TOKEN`.

### Mendaftarkan Agent

1. Hub → **Settings** → buat agent → salin **API Key**
2. Di agent → **Settings** → **SyncGuard Hub**:
   - Enabled ✓
   - Hub URL: `http://IP-SERVER:7443` atau HTTPS publik
   - Agent ID + API Key
3. Simpan & restart agent

Agent juga bisa **self-enroll** saat pertama connect (API key otomatis disimpan).

### Deploy production (Coolify/Docker)

- Image: `docker/hub/Dockerfile`
- Volume persistent: **`/data`**
- Env: `HUB_ADMIN_TOKEN`, `HUB_PUBLIC_URL`
- Health check: `GET /api/v1/health`

Detail: [`COOLIFY.md`](../COOLIFY.md)

### Retensi log Hub (default)

| Setting | Default |
|---------|---------|
| runsDays | 90 hari |
| logTailLinesPerRun | 200 baris |
| logTailRunsKept | 50 run |
| maxDbSizeMb | 500 MB |
| maxLinesPerMinutePerAgent | 120 |

---

## API Reference

### Agent API (port 7432)

Semua endpoint JSON kecuali static frontend.

| Method | Path | Keterangan |
|--------|------|------------|
| GET | `/api/config` | Baca konfigurasi (password disanitize) |
| POST | `/api/config` | Simpan konfigurasi |
| GET | `/api/status` | Status semua job + destination |
| POST | `/api/jobs` | Buat job |
| PUT | `/api/jobs/:id` | Update job |
| DELETE | `/api/jobs/:id` | Hapus job |
| POST | `/api/jobs/:id/run` | Jalankan job |
| POST | `/api/jobs/:id/stop` | Hentikan job |
| GET | `/api/jobs/:id/log` | Baca log job |
| GET/POST | `/api/test-connection` | Test NAS (SSH/SMB) |
| POST | `/api/postgres/test` | Test koneksi PostgreSQL |
| POST | `/api/minio/test` | Test koneksi MinIO |
| GET | `/api/ssh/status` | Status SSH key |
| POST | `/api/ssh/generate-key` | Generate key pair |
| POST | `/api/ssh/deploy-key` | Deploy public key ke NAS |
| GET | `/api/rsync/status` | Status binary rsync |
| GET | `/api/hub/status` | Status koneksi Hub |
| GET | `/api/server-info` | Info server (hostname, platform) |

**WebSocket** (same port): event `job_status`, `job_log`, `jobs_updated`.

### Hub API (port 7443)

**Agent** (header `Authorization: Bearer {apiKey}`):

| Method | Path | Keterangan |
|--------|------|------------|
| POST | `/api/v1/agents/register` | Register / re-register |
| POST | `/api/v1/agents/heartbeat` | Heartbeat |
| POST | `/api/v1/agents/events` | Push events |
| POST | `/api/v1/agents/runs` | Laporkan hasil run |
| POST | `/api/v1/agents/logs` | Push baris log |
| GET | `/api/v1/agents/commands` | Poll perintah pending |
| POST | `/api/v1/agents/commands/:id/ack` | Ack perintah |

**Admin** (header `X-Admin-Token: {token}`):

| Method | Path | Keterangan |
|--------|------|------------|
| GET | `/api/v1/health` | Health check (publik) |
| GET | `/api/v1/agents` | Daftar agent |
| GET | `/api/v1/agents/:id` | Detail agent |
| POST | `/api/v1/agents/:id/commands` | Kirim perintah remote |
| GET/POST | `/api/v1/hub/postgres/*` | Job PG di hub |
| GET/POST | `/api/v1/hub/minio/*` | Job MinIO di hub |
| GET/POST | `/api/v1/config` | Konfigurasi hub |

---

## Struktur Direktori

```text
syncguard/
├── backend/              # Agent server & modul utilitas
│   ├── server.js
│   ├── ssh.js
│   ├── rsync-util.js
│   ├── postgres-util.js
│   ├── minio-util.js
│   ├── agent-hub.js
│   └── tools/
├── frontend/
│   └── index.html        # Dashboard agent
├── hub/                  # Hub server + Vue UI (tidak di-copy ke USB portable)
│   ├── server.js
│   ├── web/              # Sumber Vue
│   ├── public/           # Build output UI
│   ├── data/             # Store JSON hub
│   └── config.json
├── config/
│   ├── config.json       # Konfigurasi agent (lokal, gitignored)
│   └── keys/             # SSH private/public key
├── logs/
│   ├── {jobId}.log       # Log per job
│   └── syncguard-server.log
├── tools/
│   ├── node/             # Node.js portable (Windows)
│   ├── cwrsync/          # cwRsync portable
│   └── mc/               # MinIO Client (mc.exe)
├── docker/
│   ├── hub/Dockerfile
│   ├── local/            # Compose lokal
│   └── coolify/          # Compose production
├── scripts/              # Installer, launcher, Linux service
├── docs/
│   ├── DOCUMENTATION.md  # Dokumen ini
│   └── index.html        # Versi HTML
├── mc.exe                # Sumber mc untuk install-mc.bat (opsional)
├── install-mc.bat
├── package.json
├── start.bat
├── setup-portable.bat
├── README.md
├── PORTABLE.md
├── HUB.md
├── COOLIFY.md
└── LINUX.md
```

---

## Keamanan

- **Password NAS/DB/MinIO** disimpan di `config/config.json` — jangan commit ke git
- **SSH private key** di `config/keys/` — backup aman, restrict permission
- **Hub admin token** — ganti default `Admin123!` di production
- **Agent API key** — unik per agent, rotate jika bocor
- Gunakan **HTTPS** untuk Hub di internet (Coolify reverse proxy TLS)
- Synology: home directory user SSH sebaiknya **`755`**, bukan `777` (OpenSSH menolak pubkey auth)

---

## Troubleshooting

### Rsync tidak ditemukan

- Set **Rsync Path** ke `tools/cwrsync/bin/rsync.exe` atau jalankan `install-cwrsync.bat`
- WSL: gunakan `wsl rsync`
- Linux: `sudo apt install rsync`

### SSH connection failed / spawn ssh-keygen ENOENT

- **Penyebab:** Installer offline tidak menyertakan OpenSSH Client Windows; versi lama memanggil `ssh-keygen` dari PATH.
- **Perbaikan (v1.0+):** Generate SSH Key memakai **Node.js crypto** bawaan — tidak perlu `ssh-keygen` terinstall.
- Restart agent setelah update kode, lalu klik **Generate SSH Key** lagi.
- Opsional: `ssh-keygen` dari `C:\Windows\System32\OpenSSH\` atau cwRsync tetap dipakai sebagai fallback.

### SSH connection failed / Permission denied

- Pastikan SSH aktif di Synology DSM
- Setelah ganti password: Save password baru → **Deploy SSH Key** ulang
- Test manual: `ssh -p PORT user@IP`
- Pastikan `sshKeyDeployed: true` dan key valid

### Job PostgreSQL gagal di Run Now

- Cek path **Pg Dump Path** (`pg_dump.exe`)
- Job PG butuh waktu — tunggu toast selesai, jangan double-click
- Dua job dengan nama sama ditampilkan sebagai `Nama (engine, tipe)` di UI

### MinIO sukses tapi file tidak ada

- Pastikan **Bucket Name** sudah diisi dan **Save MinIO Config**
- Cek log untuk URI `s3://bucket/prefix/...`
- Verifikasi di MinIO Console

### Robocopy / SMB gagal

- Aktifkan SMB di Synology
- Test: `dir \\IP\share`
- Map drive manual jika perlu: `net use Z: \\IP\share /user:...`

### Agent Hub offline

- Hub URL harus reachable dari PC agent (bukan `localhost` jika hub di server lain)
- Agent ID dan API Key harus cocok dengan daftar di Hub
- Cek firewall outbound ke port 7443/443

### Log terlalu besar

- Atur `localLogMaxMbPerJob` dan `localLogKeepRotations` di config hub agent
- Rotasi otomatis via `log-rotate.js`

### Linux service

```bash
systemctl status syncguard-agent
journalctl -u syncguard-agent -n 200 --no-pager
```

---

## Dokumen Terkait

| File | Isi |
|------|-----|
| [`README.md`](../README.md) | Quick start & tips singkat |
| [`PORTABLE.md`](../PORTABLE.md) | Mode portable Windows |
| [`HUB.md`](../HUB.md) | Hub lokal & registrasi agent |
| [`COOLIFY.md`](../COOLIFY.md) | Deploy Hub ke Docker/Coolify |
| [`LINUX.md`](../LINUX.md) | Agent Linux systemd |
| [`docs/index.html`](index.html) | Versi HTML dokumentasi ini |

---

*Dokumentasi ini mengacu pada SyncGuard v1.0.0. Perbarui jika ada perubahan signifikan pada kode.*
