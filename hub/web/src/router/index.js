import { createRouter, createWebHistory } from 'vue-router';
import { useAdminAuth } from '../composables/useAdminAuth';

const routes = [
  { path: '/login', name: 'login', component: () => import('../views/LoginView.vue'), meta: { public: true } },
  { path: '/', name: 'dashboard', component: () => import('../views/DashboardView.vue') },
  { path: '/agents/:id', name: 'agent', component: () => import('../views/AgentDetailView.vue') },
  { path: '/settings', name: 'settings', component: () => import('../views/SettingsView.vue') }
];

const router = createRouter({
  history: createWebHistory(),
  routes
});

router.beforeEach((to) => {
  const { isAuthenticated } = useAdminAuth();
  if (!to.meta.public && !isAuthenticated.value) {
    return { name: 'login', query: { redirect: to.fullPath } };
  }
  if (to.name === 'login' && isAuthenticated.value) {
    return { name: 'dashboard' };
  }
});

export default router;
