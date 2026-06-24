<script setup>
import { useRouter, useRoute } from 'vue-router';
import { useAdminAuth } from '../composables/useAdminAuth';

const props = defineProps({
  title: { type: String, default: 'Dashboard' },
  subtitle: {
    type: String,
    default: 'Pantau agent, jalankan job, dan kelola akses dari satu hub.'
  }
});

const router = useRouter();
const route = useRoute();
const { logout } = useAdminAuth();

function onLogout() {
  logout();
  router.push({ name: 'login' });
}

const menuItems = [
  { name: 'Dashboard', path: '/', description: 'Ringkasan agent dan aktivitas' },
  { name: 'Settings', path: '/settings', description: 'Akses, retensi, dan registrasi agent' }
];
</script>

<template>
  <div class="app-shell lg:flex">
    <aside class="app-sidebar hidden lg:flex lg:w-76 lg:flex-col lg:border-r lg:sticky lg:top-0 lg:h-screen">
      <div class="px-6 py-7 border-b border-base-300/70">
        <router-link to="/" class="block">
          <div class="brand-lockup brand-panel">
            <img src="/icon.png" alt="SyncGuard" class="brand-mark" />
            <div>
              <div class="eyebrow brand-syncguard-title">SyncGuard Hub</div>
              <div class="mt-3 text-2xl font-bold brand-syncguard-subtitle">Control Center</div>
            </div>
          </div>
          <p class="mt-4 text-sm text-base-content/65">
            Antarmuka operasional untuk memantau backup agent secara konsisten.
          </p>
        </router-link>
      </div>

      <nav class="flex-1 px-4 py-5 space-y-2">
        <router-link
          v-for="item in menuItems"
          :key="item.path"
          :to="item.path"
          class="block rounded-2xl border border-transparent px-4 py-3 transition hover:border-base-300 hover:bg-base-100/40"
          :class="route.path === item.path ? 'bg-base-100/70 border-base-300 shadow-lg' : 'text-base-content/80'"
        >
          <div class="font-semibold">{{ item.name }}</div>
          <div class="mt-1 text-sm text-base-content/55">{{ item.description }}</div>
        </router-link>
      </nav>

      <div class="px-4 pb-5">
        <button type="button" class="btn btn-outline btn-error w-full" @click="onLogout">
          Logout
        </button>
      </div>
    </aside>

    <div class="min-h-screen flex-1">
      <header class="lg:hidden sticky top-0 z-40 border-b border-base-300/70 bg-base-100/90 backdrop-blur">
        <div class="navbar px-4">
          <div class="navbar-start">
            <div class="dropdown">
              <button type="button" tabindex="0" class="btn btn-ghost">
                Menu
              </button>
              <ul tabindex="0" class="dropdown-content menu mt-2 w-64 rounded-2xl border border-base-300 bg-base-200 p-2 shadow-2xl">
                <li v-for="item in menuItems" :key="item.path">
                  <router-link :to="item.path">{{ item.name }}</router-link>
                </li>
                <li><a href="#logout" @click.prevent="onLogout">Logout</a></li>
              </ul>
            </div>
          </div>
          <div class="navbar-center">
            <router-link to="/" class="brand-lockup gap-3 mobile-brand-bar">
              <img src="/icon.png" alt="SyncGuard" class="brand-mark brand-mark-sm" />
              <span class="font-semibold brand-syncguard-title">SyncGuard Hub</span>
            </router-link>
          </div>
          <div class="navbar-end">
            <button type="button" class="btn btn-ghost btn-sm" @click="onLogout">Keluar</button>
          </div>
        </div>
      </header>

      <main class="app-main">
        <div class="content-wrap">
          <section class="page-hero">
            <div>
              <div class="eyebrow">Hub Console</div>
              <h1 class="page-title">{{ props.title }}</h1>
              <p class="page-subtitle">{{ props.subtitle }}</p>
            </div>
            <div class="hero-actions">
              <slot name="hero-actions" />
            </div>
          </section>

          <slot />
        </div>
      </main>
    </div>
  </div>
</template>
