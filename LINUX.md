# SyncGuard on Linux

SyncGuard agent dapat dijalankan sebagai service **systemd** di Linux. Mode ini hanya untuk **agent**, bukan hub.

## Prasyarat

- Linux dengan **systemd**
- **Node.js 16+** tersedia di sistem
- `npm install --omit=dev` sudah dijalankan di root project
- `rsync` terpasang jika akan memakai engine rsync
- Akses jaringan ke NAS dan ke target backup lain yang dibutuhkan

## Jalankan manual

```bash
chmod +x scripts/linux/start-agent.sh
PORT=7432 ./scripts/linux/start-agent.sh
```

UI tetap diakses lewat browser:

```text
http://<host-linux>:7432
```

## Install sebagai service

```bash
chmod +x scripts/linux/*.sh
sudo ./scripts/linux/install-agent-service.sh --user syncguard --app-dir /opt/syncguard --port 7432
```

Catatan:

- `--user` wajib diisi dan user harus sudah ada
- service default bernama `syncguard-agent`
- installer akan:
  - generate unit file di `/etc/systemd/system/syncguard-agent.service`
  - `systemctl daemon-reload`
  - `systemctl enable`
  - `systemctl start`

## Operasi service

```bash
./scripts/linux/service-control.sh status
./scripts/linux/service-control.sh restart
./scripts/linux/service-control.sh logs
```

Atau langsung:

```bash
systemctl status syncguard-agent
journalctl -u syncguard-agent -n 200 --no-pager
```

## Update aplikasi

```bash
./scripts/linux/service-control.sh stop
npm install --omit=dev
./scripts/linux/service-control.sh start
```

Jika ada perubahan pada unit file:

```bash
sudo systemctl daemon-reload
./scripts/linux/service-control.sh restart
```

## Uninstall service

```bash
sudo ./scripts/linux/uninstall-agent-service.sh
```

Script uninstall hanya menghapus service `systemd`. File aplikasi, `config/`, dan `logs/` tidak dihapus.

## Catatan kompatibilitas

- Linux mode dirancang untuk **headless server**
- Engine **robocopy** tetap Windows-only
- Untuk rsync di Linux, gunakan binary `rsync` native sistem, bukan `cwRsync`
- Path Windows seperti `C:\...` tidak berlaku pada launcher Linux
