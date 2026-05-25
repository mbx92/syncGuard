import { computed, ref } from 'vue';

const STORAGE_KEY = 'syncguard_hub_theme';
const DARK_THEME = 'syncguard-hub-dark';
const LIGHT_THEME = 'syncguard-hub-light';

const theme = ref(localStorage.getItem(STORAGE_KEY) || DARK_THEME);

function applyTheme(value) {
  const nextTheme = value === LIGHT_THEME ? LIGHT_THEME : DARK_THEME;
  theme.value = nextTheme;
  document.documentElement.setAttribute('data-theme', nextTheme);
  localStorage.setItem(STORAGE_KEY, nextTheme);
}

applyTheme(theme.value);

export function useTheme() {
  const isLight = computed(() => theme.value === LIGHT_THEME);

  function toggleTheme() {
    applyTheme(isLight.value ? DARK_THEME : LIGHT_THEME);
  }

  return {
    theme,
    isLight,
    toggleTheme,
    applyTheme,
    darkTheme: DARK_THEME,
    lightTheme: LIGHT_THEME
  };
}
