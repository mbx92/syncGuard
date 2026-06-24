const fs = require('fs');
const path = require('path');
const { resolveDataPath, ensureDataDir } = require('./data-path');

const HUB_CONFIG_FILE = path.join(__dirname, 'config.json');
const RUNTIME_CONFIG_FILE = resolveDataPath('runtime-config.json');

const DEFAULT_CONFIG = {
  port: 7443,
  publicUrl: '',
  adminToken: 'syncguard-admin-change-me',
  retention: {
    runsDays: 90,
    logTailLinesPerRun: 200,
    logTailRunsKept: 50,
    maxDbSizeMb: 500
  },
  ingest: {
    maxLinesPerMinutePerAgent: 120,
    maxLineLength: 500,
    dropDuplicateWindowSec: 30
  }
};

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function loadHubConfig() {
  const fileConfig = readJson(HUB_CONFIG_FILE) || {};
  const runtimeConfig = readJson(RUNTIME_CONFIG_FILE) || {};
  const merged = {
    ...DEFAULT_CONFIG,
    ...fileConfig,
    ...runtimeConfig,
    retention: { ...DEFAULT_CONFIG.retention, ...fileConfig.retention, ...runtimeConfig.retention },
    ingest: { ...DEFAULT_CONFIG.ingest, ...fileConfig.ingest, ...runtimeConfig.ingest }
  };

  if (process.env.HUB_ADMIN_TOKEN) {
    merged.adminToken = process.env.HUB_ADMIN_TOKEN;
  }
  if (process.env.HUB_PUBLIC_URL) {
    merged.publicUrl = process.env.HUB_PUBLIC_URL.trim();
  }
  if (process.env.HUB_PORT) {
    merged.port = parseInt(process.env.HUB_PORT, 10) || merged.port;
  }

  return merged;
}

function saveHubConfigPatch(patch) {
  ensureDataDir();
  const runtime = {
    ...(readJson(RUNTIME_CONFIG_FILE) || {}),
    ...patch,
    retention: {
      ...(readJson(RUNTIME_CONFIG_FILE)?.retention || {}),
      ...(patch.retention || {})
    },
    ingest: {
      ...(readJson(RUNTIME_CONFIG_FILE)?.ingest || {}),
      ...(patch.ingest || {})
    }
  };
  fs.writeFileSync(RUNTIME_CONFIG_FILE, JSON.stringify(runtime, null, 2));
  return loadHubConfig();
}

function resolveAdminToken(config) {
  return process.env.HUB_ADMIN_TOKEN || config.adminToken;
}

function resolvePort(config) {
  return parseInt(process.env.PORT || process.env.HUB_PORT || config.port || 7443, 10);
}

module.exports = {
  HUB_CONFIG_FILE,
  RUNTIME_CONFIG_FILE,
  loadHubConfig,
  saveHubConfigPatch,
  resolveAdminToken,
  resolvePort
};
