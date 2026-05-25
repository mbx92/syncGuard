<script setup>
import { ref, onMounted, onUnmounted, computed } from 'vue';
import { useRoute } from 'vue-router';
import AppLayout from '../components/AppLayout.vue';
import { useHubApi } from '../composables/useHubApi';

const route = useRoute();
const agentId = computed(() => route.params.id);
const { api, error, loading } = useHubApi();

const agent = ref(null);
const runs = ref([]);
const logLines = ref([]);
const selectedJobId = ref('');
const logBusy = ref(false);
const purgeModal = ref(null);
const purgeScope = ref('job');
let timer = null;

const jobs = computed(() => agent.value?.jobsSummary || agent.value?.configSnapshot?.jobs || []);
const runningJobs = computed(() => jobs.value.filter((job) => job.status === 'running').length);

async function loadAgent() {
  agent.value = await api(`/agents/${agentId.value}`);
}

async function loadRuns() {
  const q = selectedJobId.value ? `?jobId=${selectedJobId.value}` : '';
  const data = await api(`/agents/${agentId.value}/runs${q}`);
  runs.value = data.runs || [];
}

async function loadLogs() {
  if (!selectedJobId.value) return;
  const data = await api(`/agents/${agentId.value}/logs?jobId=${selectedJobId.value}&last=200`);
  logLines.value = data.lines || [];
}

async function refresh() {
  await loadAgent();
  await loadRuns();
  if (selectedJobId.value) await loadLogs();
}

async function runJob(jobId) {
  await api(`/agents/${agentId.value}/commands`, {
    method: 'POST',
    body: { type: 'run_job', payload: { jobId } }
  });
  setTimeout(refresh, 2000);
}

async function stopJob(jobId) {
  await api(`/agents/${agentId.value}/commands`, {
    method: 'POST',
    body: { type: 'stop_job', payload: { jobId } }
  });
  setTimeout(refresh, 1500);
}

async function fetchLogTail() {
  if (!selectedJobId.value) return;
  logBusy.value = true;
  try {
    await api(`/agents/${agentId.value}/logs/request`, {
      method: 'POST',
      body: { jobId: selectedJobId.value, last: 300 }
    });
    setTimeout(async () => {
      await loadLogs();
      logBusy.value = false;
    }, 3000);
  } catch {
    logBusy.value = false;
  }
}

function openPurge(scope, jobId) {
  purgeScope.value = scope;
  purgeModal.value = jobId || null;
  document.getElementById('purge_modal')?.showModal();
}

async function confirmPurge() {
  const body = {
    scope: purgeScope.value,
    purgeAgent: true
  };
  if (purgeScope.value === 'job') body.jobId = purgeModal.value || selectedJobId.value;
  await api(`/agents/${agentId.value}/logs/purge`, { method: 'POST', body });
  document.getElementById('purge_modal')?.close();
  logLines.value = [];
  await loadRuns();
}

function resultBadge(result) {
  if (!result) return 'badge-ghost';
  if (/success/i.test(result)) return 'badge-success';
  if (/fail|error/i.test(result)) return 'badge-error';
  return 'badge-warning';
}

function formatDateTime(value) {
  if (!value) return '-';
  return new Date(value).toLocaleString('id-ID');
}

onMounted(async () => {
  await refresh();
  timer = setInterval(refresh, 30000);
});

onUnmounted(() => clearInterval(timer));
</script>

<template>
  <AppLayout
    :title="agent?.hostname || agentId"
    subtitle="Kelola job agent, lihat riwayat backup, dan ambil log operasional dari satu halaman."
  >
    <template #hero-actions>
      <router-link to="/" class="btn btn-ghost">Kembali ke dashboard</router-link>
      <button type="button" class="btn btn-primary" :disabled="loading" @click="refresh">
        <span v-if="loading" class="loading loading-spinner loading-sm" />
        <span v-else>Refresh agent</span>
      </button>
    </template>

    <div v-if="error" class="alert alert-error">
      <span>{{ error }}</span>
    </div>

    <section v-if="agent" class="stats-grid">
      <article class="metric-card" style="--metric-color: var(--color-primary)">
        <div class="metric-label">Status agent</div>
        <div class="metric-value" :class="agent.online ? 'text-success' : 'text-base-content'">
          {{ agent.online ? 'Online' : 'Offline' }}
        </div>
        <div class="metric-note">Agent ID: {{ agent.agentId }}</div>
      </article>

      <article class="metric-card" style="--metric-color: var(--color-warning)">
        <div class="metric-label">Job berjalan</div>
        <div class="metric-value text-warning">{{ runningJobs }}</div>
        <div class="metric-note">{{ jobs.length }} job tersedia di agent ini.</div>
      </article>

      <article class="metric-card" style="--metric-color: var(--color-info)">
        <div class="metric-label">Heartbeat terakhir</div>
        <div class="metric-value text-xl md:text-3xl">{{ formatDateTime(agent.lastSeenAt) }}</div>
        <div class="metric-note">Data diperbarui otomatis setiap 30 detik.</div>
      </article>
    </section>

    <section class="surface-card">
      <div class="p-5 md:p-6">
        <div class="section-head">
          <div>
            <h2 class="section-title">Daftar job</h2>
            <p class="section-copy">Aksi operasional utama dipusatkan di tabel ini.</p>
          </div>
          <button type="button" class="btn btn-outline btn-error btn-sm" @click="openPurge('all')">
            Hapus semua log agent
          </button>
        </div>

        <div class="data-table overflow-x-auto">
          <table class="table">
            <thead>
              <tr>
                <th>Nama job</th>
                <th>Status</th>
                <th>Hasil terakhir</th>
                <th class="text-right">Aksi</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="job in jobs" :key="job.id" class="hover">
                <td>
                  <div class="font-semibold">{{ job.name }}</div>
                  <div class="mono-soft mt-1">{{ job.id }}</div>
                </td>
                <td>
                  <span class="badge badge-status" :class="job.status === 'running' ? 'badge-warning' : 'badge-ghost'">
                    {{ job.status || 'idle' }}
                  </span>
                </td>
                <td>
                  <span class="badge badge-status" :class="resultBadge(job.lastResult)">
                    {{ job.lastResult || '-' }}
                  </span>
                </td>
                <td>
                  <div class="flex flex-wrap justify-end gap-2">
                    <button type="button" class="btn btn-primary btn-sm" :disabled="!agent.online" @click="runJob(job.id)">
                      Run
                    </button>
                    <button type="button" class="btn btn-ghost btn-sm" :disabled="!agent.online" @click="stopJob(job.id)">
                      Stop
                    </button>
                    <button type="button" class="btn btn-outline btn-sm" @click="selectedJobId = job.id; loadLogs()">
                      Lihat log
                    </button>
                    <button type="button" class="btn btn-outline btn-error btn-sm" @click="openPurge('job', job.id)">
                      Hapus log
                    </button>
                  </div>
                </td>
              </tr>
              <tr v-if="!jobs.length">
                <td colspan="4" class="text-center text-base-content/55">Tidak ada job pada agent ini.</td>
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
            <h2 class="section-title">Riwayat backup</h2>
            <p class="section-copy">30 eksekusi terakhir untuk agent ini.</p>
          </div>
          <div v-if="selectedJobId" class="badge badge-outline">Filter job: {{ selectedJobId }}</div>
        </div>

        <div class="data-table overflow-x-auto">
          <table class="table">
            <thead>
              <tr>
                <th>Job</th>
                <th>Mulai</th>
                <th>Durasi</th>
                <th>Hasil</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="run in runs.slice(0, 30)" :key="run.id">
                <td class="font-mono text-xs">{{ run.jobId }}</td>
                <td class="text-sm">{{ formatDateTime(run.startedAt) }}</td>
                <td>{{ run.durationSec != null ? `${run.durationSec}s` : '-' }}</td>
                <td>
                  <span class="badge badge-status" :class="resultBadge(run.result)">{{ run.result || '-' }}</span>
                </td>
              </tr>
              <tr v-if="!runs.length">
                <td colspan="4" class="text-center text-base-content/55">Belum ada riwayat backup.</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </section>

    <section v-if="selectedJobId" class="surface-card">
      <div class="p-5 md:p-6">
        <div class="section-head">
          <div>
            <h2 class="section-title">Log job</h2>
            <p class="section-copy">Menampilkan cache log untuk <span class="font-mono">{{ selectedJobId }}</span>.</p>
          </div>
          <div class="flex flex-wrap gap-2">
            <button type="button" class="btn btn-secondary btn-sm" :disabled="logBusy || !agent?.online" @click="fetchLogTail">
              <span v-if="logBusy" class="loading loading-spinner loading-xs" />
              Ambil dari agent
            </button>
            <button type="button" class="btn btn-ghost btn-sm" @click="loadLogs">Refresh cache</button>
          </div>
        </div>

        <div v-if="!agent?.online" class="alert alert-warning mb-4">
          <span>Agent sedang offline. Log penuh tetap berada di mesin lokal agent.</span>
        </div>

        <pre class="log-console max-h-96 overflow-auto whitespace-pre-wrap">{{ logLines.join('\n') || '(kosong)' }}</pre>
      </div>
    </section>

    <dialog id="purge_modal" class="modal">
      <div class="modal-box">
        <h3 class="text-lg font-bold">Hapus log?</h3>
        <p class="py-3 text-sm text-base-content/70">
          Hub akan menghapus cache log dan mengirim perintah penghapusan ke agent.
          <template v-if="purgeScope === 'all'"> Tindakan ini berlaku untuk semua job.</template>
          <template v-else> Tindakan ini berlaku untuk job yang sedang dipilih.</template>
        </p>
        <div class="modal-action">
          <form method="dialog">
            <button class="btn btn-ghost">Batal</button>
          </form>
          <button type="button" class="btn btn-error" @click="confirmPurge">Hapus log</button>
        </div>
      </div>
      <form method="dialog" class="modal-backdrop"><button>close</button></form>
    </dialog>
  </AppLayout>
</template>
