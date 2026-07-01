# SyncGuard - NAS Backup Manager

Dashboard berbasis web untuk mengelola backup ke Synology NAS.
Mendukung **Rsync (SSH)** dan **Robocopy (SMB/UNC)**. Agent dapat berjalan lokal di Windows atau headless di Linux.

---

## Quick Start

### 1. Setup portable Windows

Jalankan **`setup-portable.bat`** untuk menginstall Node.js portable ke `tools/node/`, dependency npm, cwRsync, dan shortcut desktop.

Tidak perlu install Node.js di Windows jika `tools/node/` ikut dibawa. Lihat **`PORTABLE.md`**.

### 2. Pilih metode backup

**Opsi A - Robocopy**

- Tidak perlu install tambahan di Windows
- Aktifkan SMB di Synology DSM
- Set SMB Share Path, mis. `\\192.168.1.100\backup`

**Opsi B - Rsync via SSH**

**B1 - WSL**

```bash
wsl --install
wsl sudo apt install rsync
```

Set Rsync Path ke `wsl rsync`.

**B2 - cwRsync**

Download dari https://itefix.net/cwrsync lalu set path ke `C:\cwrsync\bin\rsync.exe`.

### 3. Aktifkan akses NAS

**Robocopy:** aktifkan SMB di Synology DSM.

**Rsync:** aktifkan SSH di Synology DSM.

### 4. Setup kredensial

**Robocopy (SMB):**

```cmd
net use Z: \\192.168.1.100\backup /user:admin password
```

**Rsync (SSH key):**

```bash
ssh-keygen -t ed25519 -C "syncguard-backup"
ssh-copy-id -p 22 admin@192.168.1.100
```

### 5. Jalankan SyncGuard di Windows

Klik dua kali `start.bat`, atau:

```bash
npm start
```

Buka browser di **http://localhost:7432**

### 6. Jalankan agent Linux via systemd

```bash
npm install --omit=dev
chmod +x scripts/linux/*.sh
sudo ./scripts/linux/install-agent-service.sh --user syncguard --app-dir /opt/syncguard --port 7432
```

Panduan lengkap ada di [LINUX.md](LINUX.md).

---

## Konfigurasi

### Settings > Sync Engine

- **Rsync (SSH)**: backup via SSH ke NAS
- **Robocopy (SMB)**: backup via UNC path, native Windows

### Settings > NAS Configuration (Rsync)

- **IP Address**: IP Synology NAS
- **SSH User**: username NAS
- **SSH Port**: default `22`
- **Base Backup Path**: mis. `/volume1/backup`

### Settings > Robocopy Settings

- **SMB Share Path**: mis. `\\192.168.1.100\backup`
- **Robocopy Path**: default `robocopy`
- **Default Options**: `/E /Z /R:3 /W:5 /MT:8 /MIR`

### Settings > Rsync Settings

- **Rsync Path**: `wsl rsync`, `rsync`, atau path ke cwRsync
- **SSH Key Path**: path private key
- **Default Options**: `-avz --progress --delete`

---

## Fitur

- Multiple backup jobs
- Dual engine: Rsync (SSH) dan Robocopy (SMB)
- Real-time progress dan log via WebSocket
- Auto schedule dengan cron
- Test koneksi SSH / SMB ke NAS
- Linux agent service via `systemd`
- Stop backup yang sedang berjalan
- Log history per job
- Exclusion patterns

---

## Struktur File

```text
syncguard/
|-- backend/
|   `-- server.js
|-- frontend/
|   `-- index.html
|-- config/
|   `-- config.json
|-- logs/
|   `-- {jobId}.log
|-- scripts/
|   `-- linux/
|-- package.json
|-- start.bat
|-- LINUX.md
`-- README.md
```

---

## Tips

### Exclude untuk developer

```text
node_modules
.git
.next
dist
build
*.log
*.tmp
Thumbs.db
```

### Rsync options berguna

- `-avz` = archive + verbose + compress
- `--delete` = hapus file di NAS yang sudah tidak ada di lokal
- `--backup` = simpan versi lama
- `--dry-run` = simulasi

### Robocopy options berguna

- `/E` = copy subfolder termasuk yang kosong
- `/MIR` = mirror
- `/Z` = restartable mode
- `/MT:8` = multi-threaded
- `/R:3 /W:5` = retry 3x, tunggu 5 detik
- `/L` = list only

### Exit code Robocopy

SyncGuard menganggap exit code **0-7** sebagai sukses. Exit code `>= 8` dianggap gagal.

### Cron expressions

```text
0 2 * * *     = Setiap hari jam 02:00
0 * * * *     = Setiap jam
0 3 * * 0     = Setiap Minggu jam 03:00
0 4 1 * *     = Setiap tanggal 1 jam 04:00
*/30 * * * *  = Setiap 30 menit
```

---

## Troubleshooting

**rsync not found**

- Pastikan Rsync Path benar
- Di WSL, gunakan `wsl rsync`
- Di Linux native, install `rsync` sistem

**robocopy / SMB access failed**

- Pastikan SMB aktif di Synology DSM
- Cek SMB Share Path, mis. `\\192.168.1.100\backup`
- Test manual: `dir \\192.168.1.100\backup`

**SSH connection failed / spawn ssh-keygen ENOENT**

- Installer offline tidak menyertakan OpenSSH Client — gunakan versi terbaru yang generate key via Node.js (tombol **Generate SSH Key** di UI).
- Restart agent setelah update.

**SSH connection failed**

- Pastikan SSH aktif
- Cek IP dan port
- Test manual: `ssh admin@192.168.1.100`

**Path Windows di WSL**

- Gunakan `/mnt/c/...`, bukan `C:\...`

**Linux service**

- Pastikan Node.js 16+ tersedia
- Jalankan `npm install --omit=dev`
- Cek status: `systemctl status syncguard-agent`
- Cek log: `journalctl -u syncguard-agent -n 200 --no-pager`

---

Port default: **7432**. Bisa diubah dengan env var, mis. `PORT=8080 npm start`.
