<script setup>
import { ref } from 'vue';
import { useRouter, useRoute } from 'vue-router';
import { useAdminAuth } from '../composables/useAdminAuth';
import { useHubApi } from '../composables/useHubApi';
import { useTheme } from '../composables/useTheme';

const router = useRouter();
const route = useRoute();
const { setToken } = useAdminAuth();
const { api } = useHubApi();
const { isLight, toggleTheme } = useTheme();

const inputToken = ref('');
const err = ref('');
const busy = ref(false);
const showPassword = ref(false);

async function submit() {
  if (!inputToken.value.trim()) {
    err.value = 'Masukkan admin token.';
    return;
  }

  err.value = '';
  busy.value = true;
  setToken(inputToken.value);
  try {
    const health = await fetch('/api/v1/health');
    if (!health.ok) {
      err.value = 'Server hub tidak merespons. Pastikan hub berjalan di port 7443.';
      setToken('');
      return;
    }
    await api('/agents', { skipAuth: false });
    router.push(route.query.redirect || '/');
  } catch (e) {
    err.value = e.message || 'Token tidak valid atau server tidak merespons.';
    setToken('');
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div class="login-shell">
    <div class="fixed right-4 top-4 z-20">
      <button
        type="button"
        class="btn btn-ghost btn-square"
        :title="isLight ? 'Aktifkan dark mode' : 'Aktifkan light mode'"
        @click="toggleTheme"
      >
        <svg v-if="isLight" xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8" d="M21 12.79A9 9 0 1111.21 3a7 7 0 009.79 9.79z" />
        </svg>
        <svg v-else xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8" d="M12 3v2.25M12 18.75V21M4.97 4.97l1.59 1.59M17.44 17.44l1.59 1.59M3 12h2.25M18.75 12H21M4.97 19.03l1.59-1.59M17.44 6.56l1.59-1.59M15.75 12a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0z" />
        </svg>
      </button>
    </div>

    <div class="login-grid">
      <section class="login-panel p-7 md:p-10">
        <div class="brand-lockup brand-panel">
          <img src="/icon.png" alt="SyncGuard" class="brand-mark" />
          <div class="eyebrow brand-syncguard-title">SyncGuard Hub</div>
        </div>
        <h1 class="page-title mt-5">Masuk ke panel administrasi</h1>
        <p class="page-subtitle">
          Satu tempat untuk memantau backup, menjalankan job, dan mengelola koneksi semua agent.
        </p>

        <div class="mt-8 grid gap-4 sm:grid-cols-3">
          <div class="rounded-2xl bg-base-100/60 p-4">
            <div class="text-sm text-base-content/60">Monitoring</div>
            <div class="mt-2 font-semibold">Status agent terpusat</div>
          </div>
          <div class="rounded-2xl bg-base-100/60 p-4">
            <div class="text-sm text-base-content/60">Kontrol</div>
            <div class="mt-2 font-semibold">Run dan stop job dari hub</div>
          </div>
          <div class="rounded-2xl bg-base-100/60 p-4">
            <div class="text-sm text-base-content/60">Audit</div>
            <div class="mt-2 font-semibold">Riwayat aktivitas lebih rapi</div>
          </div>
        </div>
      </section>

      <section class="login-panel p-7 md:p-10">
        <h2 class="text-2xl font-semibold">Admin Token</h2>
        <p class="mt-2 text-sm text-base-content/65">
          Gunakan <code class="font-mono">adminToken</code> dari <code class="font-mono">hub/config.json</code>,
          bukan API key milik agent.
        </p>

        <div v-if="err" class="alert alert-error mt-6">
          <span>{{ err }}</span>
        </div>

        <label class="form-control mt-6">
          <span class="label-text mb-2 font-medium">Token</span>
          <div class="relative">
            <input
              v-model="inputToken"
              :type="showPassword ? 'text' : 'password'"
              class="input input-bordered w-full pr-20 font-mono"
              placeholder="syncguard-admin-..."
              :disabled="busy"
              @keyup.enter="submit"
            />
            <button
              type="button"
              class="btn btn-ghost btn-sm absolute right-2 top-1/2 -translate-y-1/2"
              @click="showPassword = !showPassword"
            >
              {{ showPassword ? 'Hide' : 'Show' }}
            </button>
          </div>
        </label>

        <button type="button" class="btn btn-primary w-full mt-6" :disabled="busy || !inputToken.trim()" @click="submit">
          <span v-if="busy" class="loading loading-spinner loading-sm" />
          <span v-else>Masuk ke dashboard</span>
        </button>

        <div class="mt-6 rounded-2xl bg-base-100/55 p-4 text-sm text-base-content/65">
          Jika token benar tetapi login gagal, cek bahwa endpoint <code class="font-mono">/api/v1/health</code>
          bisa diakses dan server hub berjalan.
        </div>
      </section>
    </div>
  </div>
</template>
