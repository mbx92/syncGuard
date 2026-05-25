<script setup>
import { computed } from 'vue';
import { useRouter } from 'vue-router';

const props = defineProps({
  agent: { type: Object, required: true }
});

const router = useRouter();

const statusText = computed(() => (props.agent.online ? 'Online' : 'Offline'));
const statusClass = computed(() => (props.agent.online ? 'badge-success' : 'badge-ghost'));

const runningCount = computed(() =>
  (props.agent.jobsSummary || []).filter((job) => job.status === 'running').length
);

const totalJobs = computed(() => (props.agent.jobsSummary || []).length);

const failedJobs = computed(() =>
  (props.agent.jobsSummary || []).filter((job) => /fail|error/i.test(job.lastResult)).length
);

function open() {
  router.push({ name: 'agent', params: { id: props.agent.agentId } });
}

function formatLastSeen(date) {
  if (!date) return '-';
  const now = new Date();
  const diff = now - new Date(date);
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'Baru saja';
  if (mins < 60) return `${mins} menit lalu`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} jam lalu`;
  return new Date(date).toLocaleDateString('id-ID');
}
</script>

<template>
  <article class="list-card">
    <div class="min-w-0">
      <div class="list-card-meta">
        <div class="text-lg font-semibold truncate">{{ agent.hostname || agent.agentId }}</div>
        <span class="badge badge-status" :class="statusClass">{{ statusText }}</span>
      </div>
      <div class="mono-soft mt-2 truncate">{{ agent.agentId }}</div>
      <div class="mt-3 text-sm text-base-content/65">
        Terakhir aktif: <span class="text-base-content/85">{{ formatLastSeen(agent.lastSeenAt) }}</span>
      </div>
    </div>

    <div class="list-card-stats">
      <div class="list-stat">
        <div class="list-stat-label">Total job</div>
        <div class="list-stat-value">{{ totalJobs }}</div>
      </div>
      <div class="list-stat">
        <div class="list-stat-label">Running</div>
        <div class="list-stat-value text-warning">{{ runningCount }}</div>
      </div>
      <div class="list-stat">
        <div class="list-stat-label">Error</div>
        <div class="list-stat-value text-error">{{ failedJobs }}</div>
      </div>
    </div>

    <div class="flex justify-end">
      <button type="button" class="btn btn-primary btn-sm" @click="open">
        Buka detail
      </button>
    </div>
  </article>
</template>
