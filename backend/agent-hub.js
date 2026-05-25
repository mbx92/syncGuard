const os = require('os');
const path = require('path');

const DEFAULT_HUB = {
  enabled: false,
  url: '',
  agentId: '',
  apiKey: '',
  heartbeatIntervalSec: 30,
  logPushMode: 'summary',
  logPushMaxLinesPerMinute: 30
};

let config = { hub: { ...DEFAULT_HUB } };
let callbacks = {};
let pollTimer = null;
let linesThisMinute = 0;
let minuteWindow = Date.now();
let lastProgressAt = {};
let currentRuns = {};
let lastLineByJob = {};
let hubConnection = { ok: false, error: null, lastOkAt: null };

function init(hubConfig, cbs) {
  config = { hub: { ...DEFAULT_HUB, ...hubConfig } };
  callbacks = cbs || {};
  stop();
  if (!config.hub.enabled || !config.hub.url) {
    console.log('[agent-hub] Nonaktif (enabled/url belum diset).');
    return;
  }
  if (!config.hub.apiKey) {
    console.log('[agent-hub] API Key kosong — daftar agent di Hub Settings atau isi apiKey.');
    return;
  }
  hubConnection = { ok: false, error: null, lastOkAt: null };
  const agentId = config.hub.agentId || os.hostname();
  console.log(`[agent-hub] Menghubungkan ke ${hubBase()} sebagai ${agentId}...`);
  register()
    .then(() => heartbeat())
    .then(() => {
      pollTimer = setInterval(() => {
        heartbeat();
        pollCommands();
      }, (config.hub.heartbeatIntervalSec || 30) * 1000);
      console.log('[agent-hub] Terhubung ke hub — heartbeat OK.');
    })
    .catch(err => {
      hubConnection.ok = false;
      hubConnection.error = err.message;
      console.error('[agent-hub] Gagal connect:', err.message);
      if (/invalid api key/i.test(err.message)) {
        console.error(
          '[agent-hub] API Key tidak cocok dengan agentId di hub. ' +
          'Buka Hub → Settings → salin apiKey untuk agentId yang sama.'
        );
      }
    });
}

function stop() {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = null;
}

function isEnabled() {
  return !!(config.hub?.enabled && config.hub?.url && config.hub?.apiKey);
}

function getStatus() {
  return {
    configured: isEnabled(),
    connected: hubConnection.ok,
    lastError: hubConnection.error,
    lastOkAt: hubConnection.lastOkAt,
    agentId: config.hub?.agentId || '',
    url: config.hub?.url || ''
  };
}

function hubBase() {
  return config.hub.url.replace(/\/+$/, '');
}

async function hubFetch(path, options = {}) {
  const url = `${hubBase()}${path}`;
  const headers = {
    'Content-Type': 'application/json',
    ...options.headers
  };
  if (config.hub.apiKey) {
    headers.Authorization = `Bearer ${config.hub.apiKey}`;
  }
  const res = await fetch(url, { ...options, headers });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data;
}

async function register() {
  const agentId = config.hub.agentId || os.hostname();
  const snap = callbacks.getConfigSnapshot ? callbacks.getConfigSnapshot() : null;
  const jobsSummary = callbacks.getJobsSummary ? callbacks.getJobsSummary() : [];
  const data = await hubFetch('/api/v1/agents/register', {
    method: 'POST',
    body: JSON.stringify({
      agentId,
      hostname: os.hostname(),
      version: '1.0.0',
      configSnapshot: snap,
      jobsSummary
    })
  });
  if (data.apiKey) {
    config.hub.apiKey = data.apiKey;
    if (callbacks.saveHubCredentials) {
      callbacks.saveHubCredentials({
        apiKey: data.apiKey,
        agentId: data.agentId || agentId
      });
    }
    if (data.enrolled) {
      console.log('[agent-hub] Terdaftar ke hub. apiKey disimpan di config.');
    }
  }
  return data;
}

async function heartbeat() {
  if (!isEnabled()) return;
  const jobsSummary = callbacks.getJobsSummary ? callbacks.getJobsSummary() : [];
  try {
    await hubFetch('/api/v1/agents/heartbeat', {
      method: 'POST',
      body: JSON.stringify({
        agentId: config.hub.agentId || os.hostname(),
        hostname: os.hostname(),
        jobsSummary
      })
    });
    hubConnection.ok = true;
    hubConnection.error = null;
    hubConnection.lastOkAt = new Date().toISOString();
  } catch (e) {
    hubConnection.ok = false;
    hubConnection.error = e.message;
    console.error('[agent-hub] Heartbeat gagal:', e.message);
    throw e;
  }
}

function canPushLines(count) {
  const now = Date.now();
  if (now - minuteWindow > 60000) {
    minuteWindow = now;
    linesThisMinute = 0;
  }
  const max = config.hub.logPushMaxLinesPerMinute || 30;
  if (linesThisMinute + count > max) return false;
  linesThisMinute += count;
  return true;
}

function filterLogLine(line, isError) {
  const mode = config.hub.logPushMode || 'summary';
  if (mode === 'off') return false;
  if (isError || /ERR:|FAILED|ERROR/i.test(line)) return true;
  if (mode === 'errors') return false;
  if (/^=== Backup|Command:/i.test(line)) return true;
  if (mode === 'summary') {
    if (/\d+%|\/s|progress/i.test(line)) return false;
    return false;
  }
  if (mode === 'live') return true;
  return false;
}

function onBroadcast(msg) {
  if (!isEnabled()) return;
  const agentId = config.hub.agentId || os.hostname();

  if (msg.type === 'job_status') {
    const st = msg.status || {};
    const events = [{
      agentId,
      jobId: msg.jobId,
      type: 'job_status',
      payload: { status: st.status, lastResult: st.lastResult, progress: st.progress }
    }];

    if (st.status === 'running' && !currentRuns[msg.jobId]) {
      currentRuns[msg.jobId] = `run-${Date.now()}`;
      hubFetch('/api/v1/agents/runs', {
        method: 'POST',
        body: JSON.stringify({
          agentId,
          id: currentRuns[msg.jobId],
          jobId: msg.jobId,
          startedAt: st.startTime || new Date().toISOString(),
          engine: st.engine,
          result: null
        })
      }).catch(() => {});
    }

    if (st.status === 'success' || st.status === 'failed' || st.status === 'stopped') {
      const runId = currentRuns[msg.jobId];
      if (runId) {
        hubFetch('/api/v1/agents/runs', {
          method: 'POST',
          body: JSON.stringify({
            agentId,
            id: runId,
            jobId: msg.jobId,
            startedAt: st.startTime,
            endedAt: st.endTime || new Date().toISOString(),
            durationSec: st.duration,
            result: st.lastResult,
            exitCode: st.status === 'success' ? 0 : 1
          })
        }).catch(() => {});
        delete currentRuns[msg.jobId];
      }
    }

    hubFetch('/api/v1/agents/events', {
      method: 'POST',
      body: JSON.stringify({ agentId, events })
    }).catch(() => {});
  }

  if (msg.type === 'job_progress') {
    const now = Date.now();
    const last = lastProgressAt[msg.jobId] || 0;
    if (now - last < 10000) return;
    lastProgressAt[msg.jobId] = now;
    hubFetch('/api/v1/agents/events', {
      method: 'POST',
      body: JSON.stringify({
        agentId,
        events: [{
          agentId,
          jobId: msg.jobId,
          runId: currentRuns[msg.jobId],
          type: 'progress',
          payload: {
            progress: msg.progress,
            speed: msg.speed,
            eta: msg.eta
          }
        }]
      })
    }).catch(() => {});
  }

  if (msg.type === 'job_log') {
    const line = msg.line || '';
    if (!filterLogLine(line, msg.isError)) return;
    if (lastLineByJob[msg.jobId] === line) return;
    lastLineByJob[msg.jobId] = line;
    if (!canPushLines(1)) return;

    hubFetch('/api/v1/agents/logs', {
      method: 'POST',
      body: JSON.stringify({
        agentId,
        jobId: msg.jobId,
        runId: currentRuns[msg.jobId],
        level: msg.isError ? 'error' : 'info',
        lines: [line]
      })
    }).catch(() => {});
  }
}

async function pollCommands() {
  if (!isEnabled()) return;
  const agentId = config.hub.agentId || os.hostname();
  let data;
  try {
    data = await hubFetch(`/api/v1/agents/commands?agentId=${encodeURIComponent(agentId)}`);
  } catch {
    return;
  }

  for (const cmd of data.commands || []) {
    try {
      const result = await executeCommand(cmd);
      await hubFetch(`/api/v1/agents/commands/${cmd.id}/ack`, {
        method: 'POST',
        body: JSON.stringify({
          agentId,
          status: 'completed',
          result
        })
      });
    } catch (e) {
      await hubFetch(`/api/v1/agents/commands/${cmd.id}/ack`, {
        method: 'POST',
        body: JSON.stringify({
          agentId,
          status: 'failed',
          error: e.message
        })
      }).catch(() => {});
    }
  }
}

async function executeCommand(cmd) {
  const { type, payload } = cmd;
  switch (type) {
    case 'run_job':
      return callbacks.runJob(payload.jobId);
    case 'stop_job':
      return callbacks.stopJob(payload.jobId);
    case 'fetch_log_tail': {
      const lines = callbacks.getJobLogTail
        ? callbacks.getJobLogTail(payload.jobId, payload.last || 300)
        : [];
      await hubFetch('/api/v1/agents/logs', {
        method: 'POST',
        body: JSON.stringify({
          agentId: config.hub.agentId || os.hostname(),
          jobId: payload.jobId,
          lines,
          level: 'info'
        })
      });
      return { lines: lines.length };
    }
    case 'delete_local_logs':
      return callbacks.purgeLogs(
        payload.scope,
        payload.jobId,
        payload.beforeDate
      );
    case 'update_job':
      return callbacks.updateJob(payload.jobId, payload.data);
    case 'update_config':
      return callbacks.updateConfig(payload.data);
    default:
      throw new Error(`Unknown command: ${type}`);
  }
}

function reload(hubConfig) {
  init(hubConfig, callbacks);
}

module.exports = {
  init,
  stop,
  reload,
  isEnabled,
  getStatus,
  onBroadcast
};
