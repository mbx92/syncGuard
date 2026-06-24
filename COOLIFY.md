# Deploy SyncGuard Hub ke Coolify

Panduan men-deploy **SyncGuard Hub** (dashboard pusat + agent API + PostgreSQL backup jobs) ke [Coolify](https://coolify.io). Agent portable tetap di Windows; hub berjalan di server Linux (VPS / Coolify host).

## Yang didukung di container

| Fitur | Status |
|-------|--------|
| Dashboard Vue (agent monitoring) | Ya |
| Agent register / heartbeat / remote control | Ya |
| Log retention & purge | Ya |
| Hub PostgreSQL backup jobs (`pg_dump`) | Ya — `postgresql-client` sudah di image |
| Persistent data (`/data`) | Ya — agents, runs, postgres dumps |
| Health check Coolify | `GET /api/v1/health` |

## Persyaratan Coolify

- Resource type: **Dockerfile** atau **Docker Compose**
- Port container: **7443** (atau set `PORT` env — Coolify proxy ke domain Anda)
- Volume persistent: mount **`/data`**

## Opsi A — Dockerfile (disarankan)

1. Di Coolify → **New Resource** → **Application** → Git repo `syncguard`
2. **Build Pack:** Dockerfile  
   **Dockerfile location:** `docker/hub/Dockerfile`  
   **Build context:** root repo
3. **Port:** `7443`
4. **Volume:**  
   - Mount path: `/data`  
   - (Coolify: Persistent Storage → `/data`)
5. **Environment variables:**

| Variable | Wajib | Contoh |
|----------|-------|--------|
| `HUB_ADMIN_TOKEN` | Ya | `ganti-dengan-token-kuat` |
| `HUB_PUBLIC_URL` | Disarankan | `https://hub.domain.com` |
| `PORT` | Opsional | `7443` (Coolify sering set otomatis) |
| `HUB_DATA_DIR` | Opsional | `/data` (default) |

6. Deploy → buka URL Coolify → login dengan `HUB_ADMIN_TOKEN`

## Opsi B — Docker Compose

File: [`docker/coolify/docker-compose.yml`](docker/coolify/docker-compose.yml)

```bash
cd docker/coolify
HUB_ADMIN_TOKEN=secret HUB_PUBLIC_URL=https://hub.example.com docker compose up -d --build
```

Di Coolify: import compose file, set env `HUB_ADMIN_TOKEN`, mount volume `syncguard_hub_data`.

## Setelah deploy

1. **Login hub** — token = `HUB_ADMIN_TOKEN`
2. **Settings → Public URL** — isi URL publik (sama dengan `HUB_PUBLIC_URL`) agar agent portable bisa connect
3. **Settings → Daftar agent** — buat agent, salin `apiKey`
4. Di **portable Windows** → Settings → SyncGuard Hub:
   - URL: `https://hub.domain.com` (bukan localhost)
   - Agent ID + API Key dari hub

## Agent → Hub di internet

- Coolify + reverse proxy TLS → agent pakai **HTTPS**
- Buka port outbound dari PC agent ke URL hub
- Set `HUB_PUBLIC_URL` ke URL yang bisa di-resolve agent

## PostgreSQL backup di hub

- Job PostgreSQL di **Hub → Settings** memakai `pg_dump` di container
- Dump disimpan di `/data/postgres-dumps/`
- Target DB bisa host di luar container (IP LAN/VPN) — pastikan network Coolify bisa reach DB

## Troubleshooting

| Gejala | Solusi |
|--------|--------|
| Login gagal | Pastikan `HUB_ADMIN_TOKEN` di Coolify = token yang Anda ketik |
| Agent offline | Cek `HUB_PUBLIC_URL`, firewall, apiKey/agentId cocok |
| Data hilang setelah redeploy | Mount volume `/data` wajib |
| `pg_dump not found` | Rebuild image — client PostgreSQL sudah di Dockerfile |

## Build lokal (uji sebelum Coolify)

### Opsi cepat (Windows)

```bat
start-hub-docker.bat
```

Stop: `stop-hub-docker.bat`

### Docker Compose (manual)

```bash
# dari root repo
docker compose -f docker/local/docker-compose.yml --env-file docker/local/.env.example up -d --build
```

Salin `docker/local/.env.example` → `docker/local/.env` untuk ubah token.

| Setting | Default lokal |
|---------|----------------|
| URL | http://localhost:7443 |
| Token | `Admin123!` (`HUB_ADMIN_TOKEN`) |
| Data | volume Docker `syncguard_hub_data` → `/data` |

### Build manual

```bash
docker build -f docker/hub/Dockerfile -t syncguard-hub .
docker run --rm -p 7443:7443 -e HUB_ADMIN_TOKEN=Admin123! -e HUB_PUBLIC_URL=http://localhost:7443 -v syncguard_data:/data syncguard-hub
```

Buka http://localhost:7443
