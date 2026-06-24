# SyncGuard Hub — Central Dashboard

Aplikasi pusat untuk memantau banyak agent (portable SyncGuard) dari satu dashboard.

## Menjalankan

```bat
npm run hub:install
npm run hub:build
npm run hub
```

Atau double-click `start-hub.bat` (build UI otomatis jika belum ada).

- **URL:** http://localhost:7443
- **Admin token (login dashboard):** [`hub/config.json`](hub/config.json) → `adminToken` — **bukan** apiKey agent
- **Public URL untuk bundle agent:** set di [`hub/config.json`](hub/config.json) → `publicUrl` atau lewat Hub → **Settings**. Gunakan URL/IP yang bisa diakses dari server target, jangan `localhost`.
- **API Key agent:** Hub → **Settings** → tabel "Daftar agent & API Key" → tombol Salin

## Development UI

Terminal 1: `npm run hub`  
Terminal 2: `npm run hub:dev` → http://localhost:5173 (proxy API ke :7443)

## Mendaftarkan agent

1. Buka Hub → **Settings** → buat agent (dapat `apiKey`) atau hapus agent lama (tombol **Hapus**)
2. Di portable agent → **Settings** → **SyncGuard Hub**:
   - Enabled ✓
   - Hub URL: `http://<server-ip>:7443`
   - Agent ID: sama dengan langkah 1
   - API Key: paste dari hub
3. Simpan & restart SyncGuard

Agent juga bisa **self-enroll** saat pertama connect (tanpa apiKey) — key otomatis disimpan di `config.json`.

## Struktur

- `hub/server.js` — API
- `hub/web/` — Vue 3 + Tailwind 4 + DaisyUI 5 (theme `syncguard-hub`)
- `hub/public/` — build output (jangan edit manual)
- `hub/data/` — data store JSON

Folder `hub/` **tidak** perlu di-copy ke USB portable — lihat [`PORTABLE.md`](PORTABLE.md).

## Deploy ke Coolify / Docker

Lihat [`COOLIFY.md`](../COOLIFY.md) — image production dengan volume `/data`, env `HUB_ADMIN_TOKEN`, dan dukungan penuh fitur hub (agent + PostgreSQL backup).
