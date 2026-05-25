const fs = require('fs');
const path = require('path');
const auth = require('./auth');

const DATA_DIR = path.join(__dirname, 'data');
const STORE_FILE = path.join(DATA_DIR, 'store.json');

const emptyStore = () => ({
  agents: {},
  runs: [],
  events: [],
  logTail: [],
  commands: [],
  audit: [],
  hubPostgresJobs: [],
  hubPostgresRuns: [],
  hubPostgresLogTail: []
});

function loadStore() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(STORE_FILE)) {
    const s = emptyStore();
    saveStore(s);
    return s;
  }
  try {
    return { ...emptyStore(), ...JSON.parse(fs.readFileSync(STORE_FILE, 'utf8')) };
  } catch {
    return emptyStore();
  }
}

function saveStore(store) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(STORE_FILE, JSON.stringify(store, null, 2));
}

function listAgents(store) {
  return Object.values(store.agents).map(a => ({
    agentId: a.agentId,
    hostname: a.hostname,
    version: a.version,
    lastSeenAt: a.lastSeenAt,
    registeredAt: a.registeredAt,
    jobsSummary: a.jobsSummary || [],
    configSnapshot: a.configSnapshot,
    online: isOnline(a)
  }));
}

/** Daftar lengkap untuk admin UI (termasuk apiKey). */
function listAgentsForAdmin(store) {
  return Object.values(store.agents).map(a => ({
    agentId: a.agentId,
    hostname: a.hostname || a.agentId,
    apiKey: a.apiKey || '',
    lastSeenAt: a.lastSeenAt,
    registeredAt: a.registeredAt,
    online: isOnline(a),
    jobsSummary: a.jobsSummary || []
  }));
}

function isOnline(agent, intervalSec = 60) {
  if (!agent?.lastSeenAt) return false;
  return Date.now() - new Date(agent.lastSeenAt).getTime() < intervalSec * 2 * 1000;
}

function upsertAgent(store, payload) {
  const { agentId, hostname, version, configSnapshot, jobsSummary } = payload;
  const existing = store.agents[agentId] || {};
  store.agents[agentId] = {
    ...existing,
    agentId,
    hostname: hostname || existing.hostname || agentId,
    version: version || existing.version,
    configSnapshot: configSnapshot ?? existing.configSnapshot,
    jobsSummary: jobsSummary ?? existing.jobsSummary,
    lastSeenAt: new Date().toISOString(),
    registeredAt: existing.registeredAt || new Date().toISOString()
  };
  if (!existing.apiKey) {
    store.agents[agentId].apiKey = auth.generateApiKey();
  }
  return store.agents[agentId];
}

function registerAgentManual(store, agentId, hostname) {
  if (!store.agents[agentId]) {
    store.agents[agentId] = {
      agentId,
      hostname: hostname || agentId,
      apiKey: auth.generateApiKey(),
      registeredAt: new Date().toISOString(),
      lastSeenAt: null,
      jobsSummary: []
    };
  }
  return store.agents[agentId];
}

function addRun(store, run) {
  const id = run.id || `run-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const row = { id, ...run, createdAt: new Date().toISOString() };
  store.runs.push(row);
  return row;
}

function listRuns(store, agentId, jobId) {
  let rows = store.runs.filter(r => r.agentId === agentId);
  if (jobId) rows = rows.filter(r => r.jobId === jobId);
  return rows.sort((a, b) => new Date(b.startedAt) - new Date(a.startedAt));
}

function addEvents(store, events) {
  for (const ev of events) {
    store.events.push({
      id: `ev-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      ...ev,
      createdAt: new Date().toISOString()
    });
  }
}

function addLogLines(store, agentId, jobId, runId, lines, level = 'info') {
  const existing = store.logTail.filter(l => l.runId === runId);
  let lineNo = existing.length ? Math.max(...existing.map(l => l.lineNo)) : 0;
  for (const text of lines) {
    lineNo += 1;
    store.logTail.push({
      agentId,
      jobId,
      runId,
      lineNo,
      text,
      level,
      createdAt: new Date().toISOString()
    });
  }
}

function getLogTail(store, agentId, jobId, runId, limit = 200) {
  let rows = store.logTail.filter(l => l.agentId === agentId);
  if (jobId) rows = rows.filter(l => l.jobId === jobId);
  if (runId) rows = rows.filter(l => l.runId === runId);
  rows.sort((a, b) => a.lineNo - b.lineNo);
  return rows.slice(-limit).map(r => r.text);
}

function purgeHubLogs(store, agentId, scope, jobId, beforeDate) {
  let removed = { runs: 0, events: 0, logTail: 0 };
  if (scope === 'all') {
    removed.runs = store.runs.filter(r => r.agentId === agentId).length;
    removed.events = store.events.filter(e => e.agentId === agentId).length;
    removed.logTail = store.logTail.filter(l => l.agentId === agentId).length;
    store.runs = store.runs.filter(r => r.agentId !== agentId);
    store.events = store.events.filter(e => e.agentId !== agentId);
    store.logTail = store.logTail.filter(l => l.agentId !== agentId);
  } else if (scope === 'job' && jobId) {
    const runIds = new Set(store.runs.filter(r => r.agentId === agentId && r.jobId === jobId).map(r => r.id));
    removed.runs = runIds.size;
    store.runs = store.runs.filter(r => !(r.agentId === agentId && r.jobId === jobId));
    store.events = store.events.filter(e => !(e.agentId === agentId && (e.jobId === jobId || runIds.has(e.runId))));
    const before = store.logTail.length;
    store.logTail = store.logTail.filter(l => !(l.agentId === agentId && l.jobId === jobId));
    removed.logTail = before - store.logTail.length;
  } else if (scope === 'older_than' && beforeDate) {
    const cutoff = new Date(beforeDate).getTime();
    const oldRunIds = new Set(
      store.runs
        .filter(r => r.agentId === agentId && new Date(r.startedAt).getTime() < cutoff)
        .map(r => r.id)
    );
    removed.runs = oldRunIds.size;
    store.runs = store.runs.filter(r => !oldRunIds.has(r.id));
    store.events = store.events.filter(e => !oldRunIds.has(e.runId));
    const before = store.logTail.length;
    store.logTail = store.logTail.filter(l => !oldRunIds.has(l.runId));
    removed.logTail = before - store.logTail.length;
  }
  return removed;
}

function enqueueCommand(store, agentId, type, payload) {
  const cmd = {
    id: `cmd-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    agentId,
    type,
    payload: payload || {},
    status: 'pending',
    createdAt: new Date().toISOString(),
    result: null,
    error: null
  };
  store.commands.push(cmd);
  return cmd;
}

function getPendingCommands(store, agentId, since) {
  const sinceMs = since ? new Date(since).getTime() : 0;
  return store.commands.filter(
    c => c.agentId === agentId && c.status === 'pending' && new Date(c.createdAt).getTime() > sinceMs
  );
}

function ackCommand(store, commandId, status, result, error) {
  const cmd = store.commands.find(c => c.id === commandId);
  if (!cmd) return null;
  cmd.status = status;
  cmd.result = result;
  cmd.error = error;
  cmd.completedAt = new Date().toISOString();
  return cmd;
}

function addAudit(store, entry) {
  store.audit.push({
    id: `aud-${Date.now()}`,
    ...entry,
    at: new Date().toISOString()
  });
  if (store.audit.length > 500) store.audit = store.audit.slice(-500);
}

/** Hapus agent dan semua data terkait di hub. */
function deleteAgent(store, agentId) {
  if (!store.agents[agentId]) {
    return { ok: false, error: 'Agent not found' };
  }

  const removed = {
    agentId,
    runs: store.runs.filter(r => r.agentId === agentId).length,
    events: store.events.filter(e => e.agentId === agentId).length,
    logTail: store.logTail.filter(l => l.agentId === agentId).length,
    commands: store.commands.filter(c => c.agentId === agentId).length
  };

  delete store.agents[agentId];
  store.runs = store.runs.filter(r => r.agentId !== agentId);
  store.events = store.events.filter(e => e.agentId !== agentId);
  store.logTail = store.logTail.filter(l => l.agentId !== agentId);
  store.commands = store.commands.filter(c => c.agentId !== agentId);

  addAudit(store, { action: 'delete_agent', agentId, removed });

  return { ok: true, removed };
}

function listHubPostgresJobs(store) {
  return [...(store.hubPostgresJobs || [])].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

function getHubPostgresJob(store, jobId) {
  return (store.hubPostgresJobs || []).find((job) => job.id === jobId) || null;
}

function upsertHubPostgresJob(store, job) {
  const jobs = store.hubPostgresJobs || (store.hubPostgresJobs = []);
  const idx = jobs.findIndex((row) => row.id === job.id);
  if (idx >= 0) {
    jobs[idx] = { ...jobs[idx], ...job, updatedAt: new Date().toISOString() };
    return jobs[idx];
  }

  const row = {
    enabled: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...job
  };
  jobs.push(row);
  return row;
}

function deleteHubPostgresJob(store, jobId) {
  const existing = getHubPostgresJob(store, jobId);
  if (!existing) return { ok: false, error: 'Hub PostgreSQL job not found' };

  store.hubPostgresJobs = (store.hubPostgresJobs || []).filter((job) => job.id !== jobId);
  const runIds = new Set((store.hubPostgresRuns || []).filter((run) => run.jobId === jobId).map((run) => run.id));
  store.hubPostgresRuns = (store.hubPostgresRuns || []).filter((run) => run.jobId !== jobId);
  store.hubPostgresLogTail = (store.hubPostgresLogTail || []).filter((line) => !runIds.has(line.runId) && line.jobId !== jobId);
  return { ok: true, removed: existing };
}

function addHubPostgresRun(store, run) {
  const row = {
    id: run.id || `hubpg-run-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    createdAt: new Date().toISOString(),
    ...run
  };
  (store.hubPostgresRuns || (store.hubPostgresRuns = [])).push(row);
  return row;
}

function updateHubPostgresRun(store, runId, patch) {
  const run = (store.hubPostgresRuns || []).find((row) => row.id === runId);
  if (!run) return null;
  Object.assign(run, patch);
  return run;
}

function listHubPostgresRuns(store, jobId) {
  let rows = [...(store.hubPostgresRuns || [])];
  if (jobId) rows = rows.filter((run) => run.jobId === jobId);
  return rows.sort((a, b) => new Date(b.startedAt) - new Date(a.startedAt));
}

function addHubPostgresLogLines(store, jobId, runId, lines, level = 'info') {
  const existing = (store.hubPostgresLogTail || []).filter((row) => row.runId === runId);
  let lineNo = existing.length ? Math.max(...existing.map((row) => row.lineNo)) : 0;
  for (const text of lines) {
    lineNo += 1;
    store.hubPostgresLogTail.push({
      jobId,
      runId,
      lineNo,
      text,
      level,
      createdAt: new Date().toISOString()
    });
  }
}

function getHubPostgresLogTail(store, jobId, runId, limit = 200) {
  let rows = [...(store.hubPostgresLogTail || [])];
  if (jobId) rows = rows.filter((row) => row.jobId === jobId);
  if (runId) rows = rows.filter((row) => row.runId === runId);
  rows.sort((a, b) => a.lineNo - b.lineNo);
  return rows.slice(-limit).map((row) => row.text);
}

module.exports = {
  loadStore,
  saveStore,
  listAgents,
  listAgentsForAdmin,
  isOnline,
  upsertAgent,
  registerAgentManual,
  addRun,
  listRuns,
  addEvents,
  addLogLines,
  getLogTail,
  purgeHubLogs,
  enqueueCommand,
  getPendingCommands,
  ackCommand,
  addAudit,
  deleteAgent,
  listHubPostgresJobs,
  getHubPostgresJob,
  upsertHubPostgresJob,
  deleteHubPostgresJob,
  addHubPostgresRun,
  updateHubPostgresRun,
  listHubPostgresRuns,
  addHubPostgresLogLines,
  getHubPostgresLogTail
};
