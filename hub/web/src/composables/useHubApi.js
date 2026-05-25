import { ref } from 'vue';
import { useAdminAuth } from './useAdminAuth';

const error = ref(null);
const loading = ref(false);

function formatApiError(e) {
  if (e.status === 401) {
    return 'Token admin salah — gunakan adminToken dari hub/config.json (bukan apiKey agent).';
  }
  if (e.status === 404) {
    return `Endpoint tidak ditemukan (${e.path || 'API'}). Restart hub: npm run hub:stop lalu npm run hub. Pastikan URL http://localhost:7443 bukan port 7432.`;
  }
  if (!e.status) {
    return 'Tidak dapat menghubungi hub. Pastikan npm run hub jalan di port 7443.';
  }
  return e.message || 'Koneksi gagal';
}

export function useHubApi() {
  const { getHeaders, isAuthenticated } = useAdminAuth();

  async function api(path, options = {}) {
    if (!isAuthenticated.value && !options.skipAuth) {
      throw new Error('Not authenticated');
    }
    loading.value = true;
    error.value = null;
    try {
      const res = await fetch(`/api/v1${path}`, {
        method: options.method || 'GET',
        headers: {
          'Content-Type': 'application/json',
          ...getHeaders(),
          ...options.headers
        },
        body: options.body != null ? JSON.stringify(options.body) : undefined
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const msg = data.error || res.statusText || 'Request failed';
        const err = new Error(msg);
        err.status = res.status;
        err.path = `/api/v1${path}`;
        throw err;
      }
      return data;
    } catch (e) {
      error.value = formatApiError(e);
      throw e;
    } finally {
      loading.value = false;
    }
  }

  return { api, error, loading };
}
