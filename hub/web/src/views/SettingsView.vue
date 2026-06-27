<script setup>
import { ref, onMounted } from 'vue';
import AppLayout from '../components/AppLayout.vue';
import { useHubApi } from '../composables/useHubApi';
import { useAdminAuth } from '../composables/useAdminAuth';
import { useTheme } from '../composables/useTheme';

const { api, error } = useHubApi();
const { token, setToken } = useAdminAuth();
const { isLight, toggleTheme } = useTheme();
const hubConfig = ref(null);
const agents = ref([]);
const newAgentId = ref('');
const newHostname = ref('');
const createdAgent = ref(null);
const audit = ref([]);
const copiedId = ref('');
const deleteTarget = ref(null);
const deleting = ref(false);
const hubPostgresJobs = ref([]);
const hubPostgresRuns = ref([]);
const hubPostgresLogs = ref([]);
const selectedHubPostgresJobId = ref('');
const hubPostgresDraft = ref({
  id: '',
  name: '',
  description: '',
  schedule: 'manual',
  destPath: '',
  postgres: {
    host: '',
    port: '5432',
    database: '',
    username: '',
    password: '',
    pgDumpPath: '',
    dumpFormat: 'custom',
    retentionCount: '3',
    extraOptions: ''
  }
});
const hubPostgresBusy = ref(false);
const hubPostgresTestBusy = ref(false);
const hubPostgresTestError = ref('');
const hubPostgresTestSuccess = ref('');
const deletingHubPostgresJobId = ref('');

// ── Hub MinIO jobs ─────────────────────────────────────────────────────────
const hubMinioJobs = ref([]);
const hubMinioRuns = ref([]);
const hubMinioLogs = ref([]);
const selectedHubMinioJobId = ref('');
const hubMinioDraft = ref({
  id: '',
  name: '',
  description: '',
  schedule: 'manual',
  destType: 'folder',
  sourceDir: '',
  minio: {
    endpoint: '',
    bucket: '',
    prefix: 'syncguard',
    accessKey: '',
    secretKey: '',
    mcPath: 'mc'
  },
  postgres: {
    host: '',
    port: '5432',
    database: '',
    username: '',
    password: '',
    pgDumpPath: 'pg_dump',
    dumpFormat: 'custom',
    retentionCount: '3',
    extraOptions: ''
  }
});
const hubMinioBusy = ref(false);
const hubMinioTestBusy = ref(false);
const hubMinioTestError = ref('');
const hubMinioTestSuccess = ref('');
const deletingHubMinioJobId = ref('');

const tokenDraft = ref('');
const tokenError = ref('');
const tokenBusy = ref(false);
const publicUrlDraft = ref('');
const publicUrlBusy = ref(false);

async function load() {
  error.value = null;
  try {
    hubConfig.value = await api('/config');
    publicUrlDraft.value = hubConfig.value?.publicUrl || '';
  } catch {
    try {
      hubConfig.value = await api('/hub/config');
      publicUrlDraft.value = hubConfig.value?.publicUrl || '';
    } catch {
      hubConfig.value = { retention: {}, ingest: {} };
      publicUrlDraft.value = '';
    }
  }
  try {
    const list = await api('/agents');
    agents.value = list.agents || [];
  } catch {
    agents.value = [];
  }
  try {
    const auditResult = await api('/audit');
    audit.value = auditResult.audit || [];
  } catch {
    audit.value = [];
  }
  try {
    const jobsResult = await api('/hub/postgres/jobs');
    hubPostgresJobs.value = jobsResult.jobs || [];
  } catch {
    hubPostgresJobs.value = [];
  }
  try {
    const runsResult = await api('/hub/postgres/runs');
    hubPostgresRuns.value = runsResult.runs || [];
  } catch {
    hubPostgresRuns.value = [];
  }
  if (selectedHubPostgresJobId.value) {
    await loadHubPostgresLogs(selectedHubPostgresJobId.value);
  }
  try {
    const mResult = await api('/hub/minio/jobs');
    hubMinioJobs.value = mResult.jobs || [];
  } catch {
    hubMinioJobs.value = [];
  }
  try {
    const mRunsResult = await api('/hub/minio/runs');
    hubMinioRuns.value = mRunsResult.runs || [];
  } catch {
    hubMinioRuns.value = [];
  }
  if (selectedHubMinioJobId.value) {
    await loadHubMinioLogs(selectedHubMinioJobId.value);
  }
}

async function addAgent() {
  if (!newAgentId.value.trim()) return;
  createdAgent.value = await api('/agents', {
    method: 'POST',
    body: {
      agentId: newAgentId.value.trim(),
      hostname: newHostname.value.trim() || undefined
    }
  });
  newAgentId.value = '';
  newHostname.value = '';
  await load();
}

async function savePublicUrl() {
  publicUrlBusy.value = true;
  try {
    const result = await api('/config', {
      method: 'POST',
      body: { publicUrl: publicUrlDraft.value.trim() }
    });
    hubConfig.value = result.config || hubConfig.value;
    publicUrlDraft.value = hubConfig.value?.publicUrl || '';
  } finally {
    publicUrlBusy.value = false;
  }
}

async function copyKey(text, id) {
  try {
    await navigator.clipboard.writeText(text);
    copiedId.value = id;
    setTimeout(() => {
      copiedId.value = '';
    }, 2000);
  } catch {
    prompt('Salin apiKey:', text);
  }
}

function openDelete(agent) {
  deleteTarget.value = agent;
  document.getElementById('delete_agent_modal')?.showModal();
}

function closeDeleteModal() {
  document.getElementById('delete_agent_modal')?.close();
  deleteTarget.value = null;
}

async function confirmDelete() {
  if (!deleteTarget.value) return;
  deleting.value = true;
  try {
    await api(`/agents/${encodeURIComponent(deleteTarget.value.agentId)}`, {
      method: 'DELETE'
    });
    closeDeleteModal();
    createdAgent.value = null;
    await load();
  } finally {
    deleting.value = false;
  }
}

function resetHubPostgresDraft() {
  hubPostgresDraft.value = {
    id: '',
    name: '',
    description: '',
    schedule: 'manual',
    destPath: '',
    postgres: {
      host: '',
      port: '5432',
      database: '',
      username: '',
      password: '',
      pgDumpPath: '',
      dumpFormat: 'custom',
      retentionCount: '3',
      extraOptions: ''
    }
  };
}

function openHubPostgresModal(job = null) {
  hubPostgresTestError.value = '';
  hubPostgresTestSuccess.value = '';
  if (!job) {
    resetHubPostgresDraft();
  } else {
    hubPostgresDraft.value = {
      id: job.id,
      name: job.name || '',
      description: job.description || '',
      schedule: job.schedule || 'manual',
      destPath: job.destPath || '',
      postgres: {
        host: job.postgres?.host || '',
        port: String(job.postgres?.port || 5432),
        database: job.postgres?.database || '',
        username: job.postgres?.username || '',
        password: '',
        pgDumpPath: job.postgres?.pgDumpPath || '',
        dumpFormat: job.postgres?.dumpFormat || 'custom',
        retentionCount: String(job.postgres?.retentionCount || 3),
        extraOptions: job.postgres?.extraOptions || ''
      }
    };
  }
  document.getElementById('hub_postgres_modal')?.showModal();
}

function closeHubPostgresModal() {
  document.getElementById('hub_postgres_modal')?.close();
  hubPostgresTestError.value = '';
  hubPostgresTestSuccess.value = '';
  hubPostgresBusy.value = false;
}

function openDeleteHubPostgresJob(jobId) {
  deletingHubPostgresJobId.value = jobId;
  document.getElementById('delete_hub_postgres_job_modal')?.showModal();
}

function closeDeleteHubPostgresJob() {
  deletingHubPostgresJobId.value = '';
  document.getElementById('delete_hub_postgres_job_modal')?.close();
}

async function saveHubPostgresJob() {
  hubPostgresBusy.value = true;
  try {
    const payload = {
      name: hubPostgresDraft.value.name,
      description: hubPostgresDraft.value.description,
      schedule: hubPostgresDraft.value.schedule,
      destPath: hubPostgresDraft.value.destPath,
      postgres: { ...hubPostgresDraft.value.postgres }
    };
    if (hubPostgresDraft.value.id) {
      await api(`/hub/postgres/jobs/${hubPostgresDraft.value.id}`, { method: 'PUT', body: payload });
    } else {
      await api('/hub/postgres/jobs', { method: 'POST', body: payload });
    }
    closeHubPostgresModal();
    await load();
  } finally {
    hubPostgresBusy.value = false;
  }
}

async function testHubPostgresJob() {
  hubPostgresTestBusy.value = true;
  hubPostgresTestError.value = '';
  hubPostgresTestSuccess.value = '';
  try {
    const payload = {
      id: hubPostgresDraft.value.id || undefined,
      name: hubPostgresDraft.value.name,
      description: hubPostgresDraft.value.description,
      schedule: hubPostgresDraft.value.schedule,
      destPath: hubPostgresDraft.value.destPath,
      postgres: { ...hubPostgresDraft.value.postgres }
    };
    const result = await api('/hub/postgres/test', { method: 'POST', body: payload });
    hubPostgresTestSuccess.value = result.version
      ? `Koneksi PostgreSQL berhasil. ${result.version}`
      : 'Koneksi PostgreSQL berhasil.';
  } catch (err) {
    hubPostgresTestError.value = err.message || 'Koneksi PostgreSQL gagal.';
  } finally {
    hubPostgresTestBusy.value = false;
  }
}

async function runHubPostgresJob(jobId) {
  await api(`/hub/postgres/jobs/${jobId}/run`, { method: 'POST' });
  selectedHubPostgresJobId.value = jobId;
  await load();
  await loadHubPostgresLogs(jobId);
}

async function stopHubPostgresJob(jobId) {
  await api(`/hub/postgres/jobs/${jobId}/stop`, { method: 'POST' });
  await load();
}

async function confirmDeleteHubPostgresJob() {
  if (!deletingHubPostgresJobId.value) return;
  await api(`/hub/postgres/jobs/${deletingHubPostgresJobId.value}`, { method: 'DELETE' });
  closeDeleteHubPostgresJob();
  if (selectedHubPostgresJobId.value === deletingHubPostgresJobId.value) {
    selectedHubPostgresJobId.value = '';
    hubPostgresLogs.value = [];
  }
  await load();
}

async function loadHubPostgresLogs(jobId) {
  selectedHubPostgresJobId.value = jobId;
  try {
    const result = await api(`/hub/postgres/logs?jobId=${encodeURIComponent(jobId)}&last=200`);
    hubPostgresLogs.value = result.lines || [];
  } catch {
    hubPostgresLogs.value = [];
  }
}

function resetHubMinioDraft() {
  hubMinioDraft.value = {
    id: '',
    name: '',
    description: '',
    schedule: 'manual',
    destType: 'folder',
    sourceDir: '',
    minio: { endpoint: '', bucket: '', prefix: 'syncguard', accessKey: '', secretKey: '', mcPath: 'mc' },
    postgres: { host: '', port: '5432', database: '', username: '', password: '', pgDumpPath: 'pg_dump', dumpFormat: 'custom', retentionCount: '3', extraOptions: '' }
  };
}

function openHubMinioModal(job = null) {
  hubMinioTestError.value = '';
  hubMinioTestSuccess.value = '';
  if (!job) {
    resetHubMinioDraft();
  } else {
    hubMinioDraft.value = {
      id: job.id,
      name: job.name || '',
      description: job.description || '',
      schedule: job.schedule || 'manual',
      destType: job.destType || 'folder',
      sourceDir: job.sourceDir || '',
      minio: {
        endpoint: job.minio?.endpoint || '',
        bucket: job.minio?.bucket || '',
        prefix: job.minio?.prefix !== undefined ? job.minio.prefix : 'syncguard',
        accessKey: job.minio?.accessKey || '',
        secretKey: '',
        mcPath: job.minio?.mcPath || 'mc'
      },
      postgres: {
        host: job.postgres?.host || '',
        port: String(job.postgres?.port || 5432),
        database: job.postgres?.database || '',
        username: job.postgres?.username || '',
        password: '',
        pgDumpPath: job.postgres?.pgDumpPath || 'pg_dump',
        dumpFormat: job.postgres?.dumpFormat || 'custom',
        retentionCount: String(job.postgres?.retentionCount || 3),
        extraOptions: job.postgres?.extraOptions || ''
      }
    };
  }
  document.getElementById('hub_minio_modal')?.showModal();
}

function closeHubMinioModal() {
  document.getElementById('hub_minio_modal')?.close();
  hubMinioTestError.value = '';
  hubMinioTestSuccess.value = '';
  hubMinioBusy.value = false;
}

function openDeleteHubMinioJob(jobId) {
  deletingHubMinioJobId.value = jobId;
  document.getElementById('delete_hub_minio_job_modal')?.showModal();
}

function closeDeleteHubMinioJob() {
  deletingHubMinioJobId.value = '';
  document.getElementById('delete_hub_minio_job_modal')?.close();
}

async function saveHubMinioJob() {
  hubMinioBusy.value = true;
  try {
    const d = hubMinioDraft.value;
    const payload = {
      name: d.name,
      description: d.description,
      schedule: d.schedule,
      destType: d.destType,
      sourceDir: d.sourceDir,
      minio: { ...d.minio },
      postgres: { ...d.postgres }
    };
    if (d.id) {
      await api(`/hub/minio/jobs/${d.id}`, { method: 'PUT', body: payload });
    } else {
      await api('/hub/minio/jobs', { method: 'POST', body: payload });
    }
    closeHubMinioModal();
    await load();
  } finally {
    hubMinioBusy.value = false;
  }
}

async function testHubMinioJob() {
  hubMinioTestBusy.value = true;
  hubMinioTestError.value = '';
  hubMinioTestSuccess.value = '';
  try {
    const d = hubMinioDraft.value;
    const payload = {
      id: d.id || undefined,
      name: d.name,
      destType: d.destType,
      sourceDir: d.sourceDir,
      minio: { ...d.minio },
      postgres: { ...d.postgres }
    };
    const result = await api('/hub/minio/test', { method: 'POST', body: payload });
    hubMinioTestSuccess.value = result.version
      ? `Koneksi MinIO berhasil — mc ${result.version}`
      : 'Koneksi MinIO berhasil.';
  } catch (err) {
    hubMinioTestError.value = err.message || 'Koneksi MinIO gagal.';
  } finally {
    hubMinioTestBusy.value = false;
  }
}

async function runHubMinioJob(jobId) {
  await api(`/hub/minio/jobs/${jobId}/run`, { method: 'POST' });
  selectedHubMinioJobId.value = jobId;
  await load();
  await loadHubMinioLogs(jobId);
}

async function stopHubMinioJob(jobId) {
  await api(`/hub/minio/jobs/${jobId}/stop`, { method: 'POST' });
  await load();
}

async function confirmDeleteHubMinioJob() {
  if (!deletingHubMinioJobId.value) return;
  await api(`/hub/minio/jobs/${deletingHubMinioJobId.value}`, { method: 'DELETE' });
  closeDeleteHubMinioJob();
  if (selectedHubMinioJobId.value === deletingHubMinioJobId.value) {
    selectedHubMinioJobId.value = '';
    hubMinioLogs.value = [];
  }
  await load();
}

async function loadHubMinioLogs(jobId) {
  selectedHubMinioJobId.value = jobId;
  try {
    const result = await api(`/hub/minio/logs?jobId=${encodeURIComponent(jobId)}&last=200`);
    hubMinioLogs.value = result.lines || [];
  } catch {
    hubMinioLogs.value = [];
  }
}

function openTokenModal() {
  tokenDraft.value = token.value;
  tokenError.value = '';
  document.getElementById('update_token_modal')?.showModal();
}

function closeTokenModal() {
  document.getElementById('update_token_modal')?.close();
  tokenError.value = '';
  tokenBusy.value = false;
}

async function confirmTokenUpdate() {
  const nextToken = tokenDraft.value.trim();
  if (!nextToken) {
    tokenError.value = 'Token login wajib diisi.';
    return;
  }

  tokenBusy.value = true;
  tokenError.value = '';
  try {
    const res = await fetch('/api/v1/agents', {
      headers: {
        'Content-Type': 'application/json',
        'X-Admin-Token': nextToken
      }
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      tokenError.value = data.error || 'Token admin tidak valid.';
      return;
    }
    setToken(nextToken);
    closeTokenModal();
    await load();
  } catch {
    tokenError.value = 'Tidak dapat memverifikasi token ke hub.';
  } finally {
    tokenBusy.value = false;
  }
}

onMounted(load);
</script>

<template>
  <AppLayout
    title="Settings"
    subtitle="Kelola registrasi agent, salin akses, dan cek kebijakan retensi hub."
  >
    <template #hero-actions>
      <button type="button" class="btn btn-ghost btn-square" :title="isLight ? 'Aktifkan dark mode' : 'Aktifkan light mode'" @click="toggleTheme">
        <svg v-if="isLight" xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8" d="M21 12.79A9 9 0 1111.21 3a7 7 0 009.79 9.79z" />
        </svg>
        <svg v-else xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8" d="M12 3v2.25M12 18.75V21M4.97 4.97l1.59 1.59M17.44 17.44l1.59 1.59M3 12h2.25M18.75 12H21M4.97 19.03l1.59-1.59M17.44 6.56l1.59-1.59M15.75 12a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0z" />
        </svg>
      </button>
      <button type="button" class="btn btn-ghost btn-square" title="Update token login" @click="openTokenModal">
        <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8" d="M16.5 10.5V7.875a4.5 4.5 0 10-9 0V10.5m-.75 0h10.5A1.5 1.5 0 0118.75 12v6A1.5 1.5 0 0117.25 19.5H6.75A1.5 1.5 0 015.25 18v-6a1.5 1.5 0 011.5-1.5z" />
        </svg>
      </button>
      <button type="button" class="btn btn-primary" @click="load">Refresh settings</button>
    </template>

    <div v-if="error" class="alert alert-error">
      <span>{{ error }}</span>
    </div>

    <section class="stats-grid settings-stats-grid">
      <article class="metric-card" style="--metric-color: var(--color-primary)">
        <div class="metric-label">Agent terdaftar</div>
        <div class="metric-value">{{ agents.length }}</div>
        <div class="metric-note">Gunakan daftar ini untuk membagikan API key per agent.</div>
      </article>

      <article class="metric-card" style="--metric-color: var(--color-success)">
        <div class="metric-label">Retensi runs</div>
        <div class="metric-value text-success">{{ hubConfig?.retention?.runsDays ?? '-' }}</div>
        <div class="metric-note">Hari penyimpanan riwayat backup di hub.</div>
      </article>

      <article class="metric-card" style="--metric-color: var(--color-info)">
        <div class="metric-label">Batas ingest</div>
        <div class="metric-value text-info">{{ hubConfig?.ingest?.maxLinesPerMinutePerAgent ?? '-' }}</div>
        <div class="metric-note">Baris log per menit untuk setiap agent.</div>
      </article>

      <article class="metric-card" style="--metric-color: var(--color-warning)">
        <div class="metric-label">Hub PostgreSQL jobs</div>
        <div class="metric-value text-warning">{{ hubPostgresJobs.length }}</div>
        <div class="metric-note">Backup SQL yang dijalankan langsung dari server hub.</div>
      </article>

      <article class="metric-card" style="--metric-color: var(--color-secondary)">
        <div class="metric-label">Hub MinIO jobs</div>
        <div class="metric-value" style="color:var(--color-secondary)">{{ hubMinioJobs.length }}</div>
        <div class="metric-note">Backup ke MinIO/S3 dari server hub.</div>
      </article>
    </section>

    <section class="surface-card">
      <div class="p-5 md:p-6">
        <div class="section-head">
          <div>
            <h2 class="section-title">Public hub URL</h2>
            <p class="section-copy">URL publik hub untuk diisi di konfigurasi agent. Isi dengan URL yang benar-benar bisa diakses dari server tujuan, bukan `localhost`.</p>
          </div>
        </div>

        <div class="grid gap-3 md:grid-cols-[1.3fr_auto]">
          <input v-model="publicUrlDraft" class="input input-bordered w-full font-mono" placeholder="http://10.10.10.5:7443 atau https://hub.example.com" />
          <button type="button" class="btn btn-primary" :disabled="publicUrlBusy" @click="savePublicUrl">
            <span v-if="publicUrlBusy" class="loading loading-spinner loading-xs" />
            Simpan URL
          </button>
        </div>

        <div class="mt-3 text-sm text-base-content/65">
          URL aktif untuk bundle agent:
          <code class="font-mono">{{ hubConfig?.publicUrl || 'fallback ke URL browser saat ini' }}</code>
        </div>
      </div>
    </section>

    <section class="surface-card">
      <div class="p-5 md:p-6">
        <div class="section-head">
          <div>
            <h2 class="section-title">Registrasi agent baru</h2>
            <p class="section-copy">Buat identitas agent dan salin API key ke portable agent yang sesuai.</p>
          </div>
        </div>

        <div class="grid gap-3 md:grid-cols-[1.1fr_1.1fr_auto]">
          <input v-model="newAgentId" class="input input-bordered font-mono w-full" placeholder="agentId, contoh: dbserver" />
          <input v-model="newHostname" class="input input-bordered w-full" placeholder="Hostname opsional" />
          <button type="button" class="btn btn-primary" @click="addAgent">Buat agent</button>
        </div>

        <div v-if="createdAgent?.apiKey" class="alert alert-success mt-4">
          <div class="text-sm">
            <div><strong>agentId:</strong> {{ createdAgent.agentId }}</div>
            <div class="mt-1 break-all font-mono"><strong>apiKey:</strong> {{ createdAgent.apiKey }}</div>
          </div>
        </div>
      </div>
    </section>

    <section class="surface-card">
      <div class="p-5 md:p-6">
        <div class="section-head">
          <div>
            <h2 class="section-title">Daftar agent dan API key</h2>
            <p class="section-copy">Pastikan `agentId` dan `apiKey` yang dipasang di portable agent sesuai persis.</p>
          </div>
        </div>

        <div class="data-table overflow-x-auto">
          <table class="table">
            <thead>
              <tr>
                <th>Agent</th>
                <th>Status</th>
                <th>API key</th>
                <th class="text-right">Aksi</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="agent in agents" :key="agent.agentId">
                <td>
                  <div class="font-semibold">{{ agent.hostname || agent.agentId }}</div>
                  <div class="mono-soft mt-1">{{ agent.agentId }}</div>
                </td>
                <td>
                  <span class="badge badge-status" :class="agent.online ? 'badge-success' : 'badge-ghost'">
                    {{ agent.online ? 'Online' : 'Offline' }}
                  </span>
                </td>
                <td class="max-w-xs">
                  <code class="font-mono text-xs break-all">{{ agent.apiKey }}</code>
                </td>
                <td>
                  <div class="flex flex-wrap justify-end gap-2">
                    <button type="button" class="btn btn-ghost btn-sm" @click="copyKey(agent.apiKey, agent.agentId)">
                      {{ copiedId === agent.agentId ? 'Tersalin' : 'Salin key' }}
                    </button>

                    <button type="button" class="btn btn-outline btn-error btn-sm" @click="openDelete(agent)">
                      Hapus
                    </button>
                  </div>
                </td>
              </tr>
              <tr v-if="!agents.length">
                <td colspan="4" class="text-center text-base-content/55">
                  Belum ada agent. Buat agent baru dari form di atas atau biarkan portable agent melakukan self-enroll.
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </section>

    <section class="surface-card">
      <div class="p-5 md:p-6">
        <div class="section-head">
          <div>
            <h2 class="section-title">Hub PostgreSQL jobs</h2>
            <p class="section-copy">Backup SQL dijalankan langsung dari hub tanpa agent, lalu disalin ke path tujuan yang bisa dijangkau server hub.</p>
          </div>
          <button type="button" class="btn btn-primary" @click="openHubPostgresModal()">Tambah job SQL</button>
        </div>

        <div class="data-table overflow-x-auto">
          <table class="table">
            <thead>
              <tr>
                <th>Job</th>
                <th>Database</th>
                <th>Tujuan</th>
                <th>Hasil terakhir</th>
                <th class="text-right">Aksi</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="job in hubPostgresJobs" :key="job.id">
                <td>
                  <div class="font-semibold">{{ job.name }}</div>
                  <div class="mono-soft mt-1">{{ job.schedule || 'manual' }}</div>
                </td>
                <td>
                  <div>{{ job.postgres?.database || '-' }}</div>
                  <div class="mono-soft mt-1">{{ job.postgres?.host || '-' }}:{{ job.postgres?.port || 5432 }}</div>
                </td>
                <td class="max-w-xs">
                  <code class="font-mono text-xs break-all">{{ job.destPath || '-' }}</code>
                </td>
                <td>
                  <span class="badge badge-status" :class="/success/i.test(job.lastResult || '') ? 'badge-success' : (/fail|error|running/i.test(job.lastResult || '') ? 'badge-warning' : 'badge-ghost')">
                    {{ job.lastResult || (job.status || 'idle') }}
                  </span>
                </td>
                <td>
                  <div class="flex flex-wrap justify-end gap-2">
                    <button type="button" class="btn btn-primary btn-sm" @click="runHubPostgresJob(job.id)">Run</button>
                    <button type="button" class="btn btn-ghost btn-sm" @click="stopHubPostgresJob(job.id)">Stop</button>
                    <button type="button" class="btn btn-outline btn-sm" @click="loadHubPostgresLogs(job.id)">Log</button>
                    <button type="button" class="btn btn-outline btn-sm" @click="openHubPostgresModal(job)">Edit</button>
                    <button type="button" class="btn btn-outline btn-error btn-sm" @click="openDeleteHubPostgresJob(job.id)">Hapus</button>
                  </div>
                </td>
              </tr>
              <tr v-if="!hubPostgresJobs.length">
                <td colspan="5" class="text-center text-base-content/55">Belum ada hub PostgreSQL job.</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </section>

    <!-- ══ Hub MinIO Jobs section ══ -->
    <section class="surface-card">
      <div class="p-5 md:p-6">
        <div class="section-head">
          <div>
            <h2 class="section-title">Hub MinIO / S3 jobs</h2>
            <p class="section-copy">Backup folder atau PostgreSQL langsung dari server hub ke MinIO / S3-compatible storage.</p>
          </div>
          <button type="button" class="btn btn-primary btn-sm" @click="openHubMinioModal()">+ Tambah job</button>
        </div>

        <div class="data-table overflow-x-auto">
          <table class="table">
            <thead>
              <tr>
                <th>Nama</th>
                <th>Tipe</th>
                <th>Schedule</th>
                <th>Status terakhir</th>
                <th class="text-right">Aksi</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="job in hubMinioJobs" :key="job.id">
                <td>
                  <div class="font-medium">{{ job.name }}</div>
                  <div class="mono-soft mt-1 text-xs">{{ job.minio?.endpoint }}</div>
                </td>
                <td>
                  <span class="badge badge-ghost">{{ job.destType || 'folder' }}</span>
                </td>
                <td class="text-sm">{{ job.schedule === 'manual' ? 'Manual' : job.schedule }}</td>
                <td>
                  <span class="badge badge-status" :class="/success/i.test(job.lastResult || '') ? 'badge-success' : (/fail|error|running/i.test(job.lastResult || '') ? 'badge-warning' : 'badge-ghost')">
                    {{ job.lastResult || (job.status || 'idle') }}
                  </span>
                </td>
                <td>
                  <div class="flex flex-wrap justify-end gap-2">
                    <button type="button" class="btn btn-primary btn-sm" @click="runHubMinioJob(job.id)">Run</button>
                    <button type="button" class="btn btn-ghost btn-sm" @click="stopHubMinioJob(job.id)">Stop</button>
                    <button type="button" class="btn btn-outline btn-sm" @click="loadHubMinioLogs(job.id)">Log</button>
                    <button type="button" class="btn btn-outline btn-sm" @click="openHubMinioModal(job)">Edit</button>
                    <button type="button" class="btn btn-outline btn-error btn-sm" @click="openDeleteHubMinioJob(job.id)">Hapus</button>
                  </div>
                </td>
              </tr>
              <tr v-if="!hubMinioJobs.length">
                <td colspan="5" class="text-center text-base-content/55">Belum ada hub MinIO job.</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </section>

    <section class="grid gap-4 xl:grid-cols-[0.95fr_1.05fr]">
      <article class="surface-card">
        <div class="p-5 md:p-6">
          <div class="section-head">
            <div>
              <h2 class="section-title">Kebijakan retensi</h2>
              <p class="section-copy">Nilai ini diambil dari konfigurasi hub aktif.</p>
            </div>
          </div>

          <div class="space-y-3 text-sm">
            <div class="rounded-2xl bg-base-100/55 p-4">
              <div class="text-base-content/60">Runs disimpan</div>
              <div class="mt-1 text-lg font-semibold">{{ hubConfig?.retention?.runsDays ?? '-' }} hari</div>
            </div>
            <div class="rounded-2xl bg-base-100/55 p-4">
              <div class="text-base-content/60">Log tail per run</div>
              <div class="mt-1 text-lg font-semibold">{{ hubConfig?.retention?.logTailLinesPerRun ?? '-' }} baris</div>
            </div>
            <div class="rounded-2xl bg-base-100/55 p-4">
              <div class="text-base-content/60">Rate ingest</div>
              <div class="mt-1 text-lg font-semibold">{{ hubConfig?.ingest?.maxLinesPerMinutePerAgent ?? '-' }} baris/menit</div>
            </div>
          </div>

          <p class="mt-4 text-sm text-base-content/65">
            Ubah file <code class="font-mono">hub/config.json</code>, lalu restart hub untuk menerapkan perubahan.
          </p>
        </div>
      </article>

      <article class="surface-card">
        <div class="p-5 md:p-6">
          <div class="section-head">
            <div>
              <h2 class="section-title">Runs hub PostgreSQL</h2>
              <p class="section-copy">Riwayat backup SQL yang dijalankan langsung dari hub.</p>
            </div>
          </div>

          <div class="data-table overflow-x-auto">
            <table class="table">
              <thead>
                <tr>
                  <th>Waktu</th>
                  <th>Job</th>
                  <th>Durasi</th>
                  <th>Hasil</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="run in hubPostgresRuns.slice(0, 20)" :key="run.id">
                  <td class="text-sm">{{ new Date(run.startedAt).toLocaleString('id-ID') }}</td>
                  <td>
                    <div>{{ run.jobName || run.jobId }}</div>
                    <div class="mono-soft mt-1">{{ run.jobId }}</div>
                  </td>
                  <td>{{ run.durationSec != null ? `${run.durationSec}s` : '-' }}</td>
                  <td>
                    <span class="badge badge-status" :class="/success/i.test(run.result || '') ? 'badge-success' : (/fail|error|running/i.test(run.result || '') ? 'badge-warning' : 'badge-ghost')">
                      {{ run.result || '-' }}
                    </span>
                  </td>
                </tr>
                <tr v-if="!hubPostgresRuns.length">
                  <td colspan="4" class="text-center text-base-content/55">Riwayat hub PostgreSQL masih kosong.</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </article>
    </section>

    <section class="grid gap-4 xl:grid-cols-[0.95fr_1.05fr] mt-4">
      <article class="surface-card">
        <div class="p-5 md:p-6">
          <div class="section-head">
            <div>
              <h2 class="section-title">Audit log</h2>
              <p class="section-copy">Jejak perubahan penting di sisi hub.</p>
            </div>
          </div>

          <div class="data-table overflow-x-auto">
            <table class="table">
              <thead>
                <tr>
                  <th>Waktu</th>
                  <th>Aksi</th>
                  <th>Agent</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="row in audit" :key="row.id">
                  <td class="text-sm">{{ new Date(row.at).toLocaleString('id-ID') }}</td>
                  <td>{{ row.action }}</td>
                  <td class="font-mono text-xs">{{ row.agentId || '-' }}</td>
                </tr>
                <tr v-if="!audit.length">
                  <td colspan="3" class="text-center text-base-content/55">Audit log masih kosong.</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </article>

      <article class="surface-card">
        <div class="p-5 md:p-6">
          <div class="section-head">
            <div>
              <h2 class="section-title">Log hub PostgreSQL</h2>
              <p class="section-copy">Menampilkan tail log untuk job yang dipilih.</p>
            </div>
            <div v-if="selectedHubPostgresJobId" class="badge badge-outline">{{ selectedHubPostgresJobId }}</div>
          </div>

          <pre class="log-console max-h-96 overflow-auto whitespace-pre-wrap">{{ hubPostgresLogs.join('\n') || '(pilih job SQL untuk melihat log)' }}</pre>
        </div>
      </article>
    </section>

    <!-- ══ Hub MinIO runs & logs ══ -->
    <section class="grid gap-4 xl:grid-cols-[0.95fr_1.05fr] mt-4">
      <article class="surface-card">
        <div class="p-5 md:p-6">
          <div class="section-head">
            <div>
              <h2 class="section-title">Runs hub MinIO</h2>
              <p class="section-copy">Riwayat backup MinIO yang dijalankan langsung dari hub.</p>
            </div>
          </div>

          <div class="data-table overflow-x-auto">
            <table class="table">
              <thead>
                <tr>
                  <th>Waktu</th>
                  <th>Job</th>
                  <th>Durasi</th>
                  <th>Hasil</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="run in hubMinioRuns.slice(0, 20)" :key="run.id">
                  <td class="text-sm">{{ new Date(run.startedAt).toLocaleString('id-ID') }}</td>
                  <td>
                    <div>{{ run.jobName || run.jobId }}</div>
                    <div class="mono-soft mt-1">{{ run.jobId }}</div>
                  </td>
                  <td>{{ run.durationSec != null ? `${run.durationSec}s` : '-' }}</td>
                  <td>
                    <span class="badge badge-status" :class="/success/i.test(run.result || '') ? 'badge-success' : (/fail|error|running/i.test(run.result || '') ? 'badge-warning' : 'badge-ghost')">
                      {{ run.result || '-' }}
                    </span>
                  </td>
                </tr>
                <tr v-if="!hubMinioRuns.length">
                  <td colspan="4" class="text-center text-base-content/55">Riwayat hub MinIO masih kosong.</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </article>

      <article class="surface-card">
        <div class="p-5 md:p-6">
          <div class="section-head">
            <div>
              <h2 class="section-title">Log hub MinIO</h2>
              <p class="section-copy">Menampilkan tail log untuk job MinIO yang dipilih.</p>
            </div>
            <div v-if="selectedHubMinioJobId" class="badge badge-outline">{{ selectedHubMinioJobId }}</div>
          </div>

          <pre class="log-console max-h-96 overflow-auto whitespace-pre-wrap">{{ hubMinioLogs.join('\n') || '(klik Log pada job MinIO untuk melihat log)' }}</pre>
        </div>
      </article>
    </section>

    <dialog id="delete_agent_modal" class="modal">
      <div class="modal-box">
        <h3 class="text-lg font-bold">Hapus agent?</h3>
        <p v-if="deleteTarget" class="py-3 text-sm text-base-content/75">
          Data hub untuk <code class="font-mono">{{ deleteTarget.agentId }}</code> akan dihapus permanen:
          runs, event, log cache, dan command queue. Portable agent di komputer asal tidak ikut terhapus.
        </p>
        <div class="modal-action">
          <form method="dialog">
            <button type="button" class="btn btn-ghost" @click="closeDeleteModal">Batal</button>
          </form>
          <button type="button" class="btn btn-error" :disabled="deleting" @click="confirmDelete">
            <span v-if="deleting" class="loading loading-spinner loading-xs" />
            Hapus agent
          </button>
        </div>
      </div>
      <form method="dialog" class="modal-backdrop"><button @click="closeDeleteModal">close</button></form>
    </dialog>

    <dialog id="update_token_modal" class="modal">
      <div class="modal-box">
        <h3 class="text-lg font-bold">Update token login</h3>
        <p class="py-2 text-sm text-base-content/70">
          Simpan token admin baru untuk sesi browser ini. Token akan diverifikasi dulu ke hub sebelum dipakai.
        </p>

        <label class="form-control mt-3">
          <span class="label-text mb-2 font-medium">Admin token</span>
          <input
            v-model="tokenDraft"
            type="password"
            class="input input-bordered w-full font-mono"
            placeholder="syncguard-admin-..."
            :disabled="tokenBusy"
            @keyup.enter="confirmTokenUpdate"
          />
        </label>

        <div v-if="tokenError" class="alert alert-error mt-4">
          <span>{{ tokenError }}</span>
        </div>

        <div class="modal-action">
          <form method="dialog">
            <button type="button" class="btn btn-ghost" @click="closeTokenModal">Batal</button>
          </form>
          <button type="button" class="btn btn-primary" :disabled="tokenBusy" @click="confirmTokenUpdate">
            <span v-if="tokenBusy" class="loading loading-spinner loading-xs" />
            Simpan token
          </button>
        </div>
      </div>
      <form method="dialog" class="modal-backdrop"><button @click="closeTokenModal">close</button></form>
    </dialog>

    <dialog id="hub_postgres_modal" class="modal">
      <div class="modal-box max-w-3xl hub-postgres-form">
        <h3 class="text-lg font-bold">{{ hubPostgresDraft.id ? 'Edit hub PostgreSQL job' : 'Tambah hub PostgreSQL job' }}</h3>
        <div class="grid gap-3 md:grid-cols-2 mt-4">
          <label class="form-control">
            <span class="label-text mb-2 font-medium">Nama job</span>
            <input v-model="hubPostgresDraft.name" class="input input-bordered w-full" placeholder="Backup ERP Production" />
          </label>
          <label class="form-control">
            <span class="label-text mb-2 font-medium">Schedule</span>
            <select v-model="hubPostgresDraft.schedule" class="select select-bordered w-full">
              <option value="manual">Manual</option>
              <option value="0 * * * *">Setiap jam</option>
              <option value="0 2 * * *">Setiap hari 02:00</option>
              <option value="0 3 * * 0">Mingguan</option>
            </select>
          </label>
          <label class="form-control md:col-span-2">
            <span class="label-text mb-2 font-medium">Description</span>
            <input v-model="hubPostgresDraft.description" class="input input-bordered w-full" placeholder="Opsional" />
          </label>
          <label class="form-control">
            <span class="label-text mb-2 font-medium">Host</span>
            <input v-model="hubPostgresDraft.postgres.host" class="input input-bordered w-full font-mono" placeholder="127.0.0.1" />
          </label>
          <label class="form-control">
            <span class="label-text mb-2 font-medium">Port</span>
            <input v-model="hubPostgresDraft.postgres.port" class="input input-bordered w-full font-mono" placeholder="5432" />
          </label>
          <label class="form-control">
            <span class="label-text mb-2 font-medium">Database</span>
            <input v-model="hubPostgresDraft.postgres.database" class="input input-bordered w-full font-mono" placeholder="appdb" />
          </label>
          <label class="form-control">
            <span class="label-text mb-2 font-medium">Username</span>
            <input v-model="hubPostgresDraft.postgres.username" class="input input-bordered w-full font-mono" placeholder="postgres" />
          </label>
          <label class="form-control">
            <span class="label-text mb-2 font-medium">Password</span>
            <input v-model="hubPostgresDraft.postgres.password" type="password" class="input input-bordered w-full" :placeholder="hubPostgresDraft.id ? 'Kosongkan jika tidak ganti password' : 'Isi password PostgreSQL'" />
          </label>
          <label class="form-control">
            <span class="label-text mb-2 font-medium">pg_dump path</span>
            <input v-model="hubPostgresDraft.postgres.pgDumpPath" class="input input-bordered w-full font-mono" placeholder="pg_dump" />
          </label>
          <label class="form-control">
            <span class="label-text mb-2 font-medium">Dump format</span>
            <select v-model="hubPostgresDraft.postgres.dumpFormat" class="select select-bordered w-full">
              <option value="custom">Custom dump (.dump)</option>
              <option value="plain">Plain SQL (.sql)</option>
            </select>
          </label>
          <label class="form-control">
            <span class="label-text mb-2 font-medium">Retention staging</span>
            <input v-model="hubPostgresDraft.postgres.retentionCount" class="input input-bordered w-full font-mono" placeholder="3" />
          </label>
          <label class="form-control md:col-span-2">
            <span class="label-text mb-2 font-medium">Extra pg_dump options</span>
            <input v-model="hubPostgresDraft.postgres.extraOptions" class="input input-bordered w-full font-mono" placeholder="--clean --if-exists" />
          </label>
          <label class="form-control md:col-span-2">
            <span class="label-text mb-2 font-medium">Destination path</span>
            <input v-model="hubPostgresDraft.destPath" class="input input-bordered w-full font-mono" placeholder="\\\\nas\\backup\\sql atau /mnt/nas/sql" />
          </label>
        </div>

        <div v-if="hubPostgresTestError" class="alert alert-error mt-4">
          <span>{{ hubPostgresTestError }}</span>
        </div>
        <div v-if="hubPostgresTestSuccess" class="alert alert-success mt-4">
          <span>{{ hubPostgresTestSuccess }}</span>
        </div>

        <div class="modal-action">
          <button type="button" class="btn btn-ghost" @click="closeHubPostgresModal">Batal</button>
          <button type="button" class="btn btn-outline" :disabled="hubPostgresTestBusy" @click="testHubPostgresJob">
            <span v-if="hubPostgresTestBusy" class="loading loading-spinner loading-xs" />
            Test koneksi
          </button>
          <button type="button" class="btn btn-primary" :disabled="hubPostgresBusy" @click="saveHubPostgresJob">
            <span v-if="hubPostgresBusy" class="loading loading-spinner loading-xs" />
            Simpan job
          </button>
        </div>
      </div>
      <form method="dialog" class="modal-backdrop"><button @click="closeHubPostgresModal">close</button></form>
    </dialog>

    <dialog id="delete_hub_postgres_job_modal" class="modal">
      <div class="modal-box">
        <h3 class="text-lg font-bold">Hapus hub PostgreSQL job?</h3>
        <p class="py-3 text-sm text-base-content/75">
          Job SQL di hub, riwayat run, dan log tail terkait akan dihapus dari hub.
        </p>
        <div class="modal-action">
          <button type="button" class="btn btn-ghost" @click="closeDeleteHubPostgresJob">Batal</button>
          <button type="button" class="btn btn-error" @click="confirmDeleteHubPostgresJob">Hapus job</button>
        </div>
      </div>
      <form method="dialog" class="modal-backdrop"><button @click="closeDeleteHubPostgresJob">close</button></form>
    </dialog>

    <!-- ══ Hub MinIO modal ══ -->
    <dialog id="hub_minio_modal" class="modal">
      <div class="modal-box max-w-3xl">
        <h3 class="text-lg font-bold">{{ hubMinioDraft.id ? 'Edit hub MinIO job' : 'Tambah hub MinIO job' }}</h3>
        <div class="grid gap-3 md:grid-cols-2 mt-4">
          <label class="form-control">
            <span class="label-text mb-2 font-medium">Nama job</span>
            <input v-model="hubMinioDraft.name" class="input input-bordered w-full" placeholder="Backup ke MinIO" />
          </label>
          <label class="form-control">
            <span class="label-text mb-2 font-medium">Schedule</span>
            <select v-model="hubMinioDraft.schedule" class="select select-bordered w-full">
              <option value="manual">Manual</option>
              <option value="0 * * * *">Setiap jam</option>
              <option value="0 2 * * *">Setiap hari 02:00</option>
              <option value="0 3 * * 0">Mingguan</option>
            </select>
          </label>
          <label class="form-control md:col-span-2">
            <span class="label-text mb-2 font-medium">Description</span>
            <input v-model="hubMinioDraft.description" class="input input-bordered w-full" placeholder="Opsional" />
          </label>
          <label class="form-control md:col-span-2">
            <span class="label-text mb-2 font-medium">Tipe backup</span>
            <select v-model="hubMinioDraft.destType" class="select select-bordered w-full">
              <option value="folder">Folder → MinIO (mirror)</option>
              <option value="postgres">PostgreSQL → MinIO (dump + upload)</option>
            </select>
          </label>

          <!-- Folder source -->
          <label v-if="hubMinioDraft.destType === 'folder'" class="form-control md:col-span-2">
            <span class="label-text mb-2 font-medium">Source directory</span>
            <input v-model="hubMinioDraft.sourceDir" class="input input-bordered w-full font-mono" placeholder="/data/files atau /mnt/share" />
          </label>

          <!-- PostgreSQL fields -->
          <template v-if="hubMinioDraft.destType === 'postgres'">
            <label class="form-control">
              <span class="label-text mb-2 font-medium">Host PostgreSQL</span>
              <input v-model="hubMinioDraft.postgres.host" class="input input-bordered w-full font-mono" placeholder="127.0.0.1" />
            </label>
            <label class="form-control">
              <span class="label-text mb-2 font-medium">Port</span>
              <input v-model="hubMinioDraft.postgres.port" class="input input-bordered w-full font-mono" placeholder="5432" />
            </label>
            <label class="form-control">
              <span class="label-text mb-2 font-medium">Database</span>
              <input v-model="hubMinioDraft.postgres.database" class="input input-bordered w-full font-mono" placeholder="appdb" />
            </label>
            <label class="form-control">
              <span class="label-text mb-2 font-medium">Username</span>
              <input v-model="hubMinioDraft.postgres.username" class="input input-bordered w-full font-mono" placeholder="postgres" />
            </label>
            <label class="form-control">
              <span class="label-text mb-2 font-medium">Password PostgreSQL</span>
              <input v-model="hubMinioDraft.postgres.password" type="password" class="input input-bordered w-full" :placeholder="hubMinioDraft.id ? 'Kosongkan jika tidak ganti' : 'Isi password PostgreSQL'" />
            </label>
            <label class="form-control">
              <span class="label-text mb-2 font-medium">pg_dump path</span>
              <input v-model="hubMinioDraft.postgres.pgDumpPath" class="input input-bordered w-full font-mono" placeholder="pg_dump" />
            </label>
            <label class="form-control">
              <span class="label-text mb-2 font-medium">Dump format</span>
              <select v-model="hubMinioDraft.postgres.dumpFormat" class="select select-bordered w-full">
                <option value="custom">Custom dump (.dump)</option>
                <option value="plain">Plain SQL (.sql)</option>
              </select>
            </label>
            <label class="form-control">
              <span class="label-text mb-2 font-medium">Retensi staging</span>
              <input v-model="hubMinioDraft.postgres.retentionCount" class="input input-bordered w-full font-mono" placeholder="3" />
            </label>
          </template>

          <!-- MinIO credentials -->
          <div class="divider md:col-span-2 my-1">MinIO / S3 Config</div>
          <label class="form-control md:col-span-2">
            <span class="label-text mb-2 font-medium">Endpoint</span>
            <input v-model="hubMinioDraft.minio.endpoint" class="input input-bordered w-full font-mono" placeholder="https://play.min.io atau http://192.168.1.10:9000" />
          </label>
          <label class="form-control">
            <span class="label-text mb-2 font-medium">Bucket</span>
            <input v-model="hubMinioDraft.minio.bucket" class="input input-bordered w-full font-mono" placeholder="syncguard-backups" />
          </label>
          <label class="form-control">
            <span class="label-text mb-2 font-medium">Prefix</span>
            <input v-model="hubMinioDraft.minio.prefix" class="input input-bordered w-full font-mono" placeholder="syncguard" />
          </label>
          <label class="form-control">
            <span class="label-text mb-2 font-medium">Access Key</span>
            <input v-model="hubMinioDraft.minio.accessKey" class="input input-bordered w-full font-mono" placeholder="minioadmin" autocomplete="off" />
          </label>
          <label class="form-control">
            <span class="label-text mb-2 font-medium">Secret Key</span>
            <input v-model="hubMinioDraft.minio.secretKey" type="password" class="input input-bordered w-full" :placeholder="hubMinioDraft.id ? 'Kosongkan jika tidak ganti' : 'Isi secret key'" autocomplete="new-password" />
          </label>
          <label class="form-control md:col-span-2">
            <span class="label-text mb-2 font-medium">mc Path</span>
            <input v-model="hubMinioDraft.minio.mcPath" class="input input-bordered w-full font-mono" placeholder="mc" />
          </label>
        </div>

        <div v-if="hubMinioTestError" class="alert alert-error mt-4">
          <span>{{ hubMinioTestError }}</span>
        </div>
        <div v-if="hubMinioTestSuccess" class="alert alert-success mt-4">
          <span>{{ hubMinioTestSuccess }}</span>
        </div>

        <div class="modal-action">
          <button type="button" class="btn btn-ghost" @click="closeHubMinioModal">Batal</button>
          <button type="button" class="btn btn-outline" :disabled="hubMinioTestBusy" @click="testHubMinioJob">
            <span v-if="hubMinioTestBusy" class="loading loading-spinner loading-xs" />
            Test koneksi
          </button>
          <button type="button" class="btn btn-primary" :disabled="hubMinioBusy" @click="saveHubMinioJob">
            <span v-if="hubMinioBusy" class="loading loading-spinner loading-xs" />
            Simpan job
          </button>
        </div>
      </div>
      <form method="dialog" class="modal-backdrop"><button @click="closeHubMinioModal">close</button></form>
    </dialog>

    <dialog id="delete_hub_minio_job_modal" class="modal">
      <div class="modal-box">
        <h3 class="text-lg font-bold">Hapus hub MinIO job?</h3>
        <p class="py-3 text-sm text-base-content/75">
          Job MinIO di hub, riwayat run, dan log terkait akan dihapus permanen dari hub.
        </p>
        <div class="modal-action">
          <button type="button" class="btn btn-ghost" @click="closeDeleteHubMinioJob">Batal</button>
          <button type="button" class="btn btn-error" @click="confirmDeleteHubMinioJob">Hapus job</button>
        </div>
      </div>
      <form method="dialog" class="modal-backdrop"><button @click="closeDeleteHubMinioJob">close</button></form>
    </dialog>
  </AppLayout>
</template>
