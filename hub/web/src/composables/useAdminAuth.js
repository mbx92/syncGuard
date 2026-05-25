import { ref, computed } from 'vue';

const TOKEN_KEY = 'syncguard_hub_admin_token';
const token = ref(localStorage.getItem(TOKEN_KEY) || '');

export function useAdminAuth() {
  const isAuthenticated = computed(() => !!token.value);

  function setToken(value) {
    token.value = value.trim();
    if (token.value) {
      localStorage.setItem(TOKEN_KEY, token.value);
    } else {
      localStorage.removeItem(TOKEN_KEY);
    }
  }

  function logout() {
    setToken('');
  }

  function getHeaders() {
    return { 'X-Admin-Token': token.value };
  }

  return { token, isAuthenticated, setToken, logout, getHeaders };
}
