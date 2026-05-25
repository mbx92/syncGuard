<script setup>
import { ref, onMounted, onUnmounted, computed } from 'vue';
import AppLayout from '../components/AppLayout.vue';
import AgentCard from '../components/AgentCard.vue';
import { useHubApi } from '../composables/useHubApi';

const { api, error, loading } = useHubApi();
const agents = ref([]);
let timer = null;

const stats = computed(() => {
  const list = agents.value;
  return {
    total: list.length,
    online: list.filter((agent) => agent.online).length,
    offline: list.filter((agent) => !agent.online).length,
    running: list.reduce(
      (count, agent) => count + (agent.jobsSummary || []).filter((job) => job.status === 'running').length,
      0
    )
  };
});

async function load() {
  try {
    const data = await api('/agents');
    agents.value = data.agents || [];
  } catch {
    agents.value = [];
  }
}

onMounted(async () => {
  await load();
  timer = setInterval(load, 30000);
});

onUnmounted(() => clearInterval(timer));
</script>

<template>
  <AppLayout
    title="Dashboard"
    subtitle="Ringkasan kondisi hub, status agent, dan backup yang sedang berjalan."
  >
    <template #hero-actions>
      <button type="button" class="btn btn-primary" :disabled="loading" @click="load">
        <span v-if="loading" class="loading loading-spinner loading-sm" />
        <span v-else>Refresh data</span>
      </button>
    </template>

    <div v-if="error" class="alert alert-error">
      <span>{{ error }}</span>
    </div>

    <section class="stats-grid">
      <article class="metric-card" style="--metric-color: var(--color-primary)">
        <div class="metric-label">Total agent</div>
        <div class="metric-value">{{ stats.total }}</div>
        <div class="metric-note">Seluruh node yang terdaftar di hub.</div>
      </article>

      <article class="metric-card" style="--metric-color: var(--color-success)">
        <div class="metric-label">Agent online</div>
        <div class="metric-value text-success">{{ stats.online }}</div>
        <div class="metric-note">{{ stats.offline }} agent belum mengirim heartbeat.</div>
      </article>

      <article class="metric-card" style="--metric-color: var(--color-warning)">
        <div class="metric-label">Job berjalan</div>
        <div class="metric-value text-warning">{{ stats.running }}</div>
        <div class="metric-note">Backup aktif saat ini di seluruh agent.</div>
      </article>
    </section>

    <section class="surface-card">
      <div class="p-5 md:p-6">
        <div class="section-head">
          <div>
            <h2 class="section-title">Daftar agent</h2>
            <p class="section-copy">
              Buka detail agent untuk menjalankan job, menghentikan proses, dan melihat log backup.
            </p>
          </div>
          <div class="badge badge-outline">{{ agents.length }} agent</div>
        </div>

        <div v-if="!agents.length && !loading" class="empty-state">
          <svg xmlns="http://www.w3.org/2000/svg" class="empty-state-icon" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.6" d="M9 17v-2a4 4 0 014-4h4m0 0l-3-3m3 3l-3 3M5 7h14M5 12h5" />
          </svg>
          <h3 class="text-lg font-semibold">Belum ada agent</h3>
          <p class="mt-2 text-sm text-base-content/65">
            Tambahkan agent baru dari halaman Settings atau aktifkan hub di portable agent yang sudah ada.
          </p>
          <router-link to="/settings" class="btn btn-primary mt-5">Buka Settings</router-link>
        </div>

        <div v-else-if="loading" class="space-y-4">
          <div v-for="item in 5" :key="item" class="list-card animate-pulse">
            <div>
              <div class="h-6 w-2/3 rounded bg-base-300" />
              <div class="mt-2 h-4 w-1/3 rounded bg-base-300" />
              <div class="mt-3 h-4 w-1/2 rounded bg-base-300" />
            </div>
            <div class="list-card-stats">
              <div class="h-18 rounded-2xl bg-base-300" />
              <div class="h-18 rounded-2xl bg-base-300" />
              <div class="h-18 rounded-2xl bg-base-300" />
            </div>
            <div class="h-10 w-28 justify-self-end rounded-xl bg-base-300" />
          </div>
        </div>

        <div v-else class="space-y-4">
          <AgentCard v-for="agent in agents" :key="agent.agentId" :agent="agent" />
        </div>
      </div>
    </section>
  </AppLayout>
</template>
