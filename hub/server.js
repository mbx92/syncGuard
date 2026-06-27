const express = require('express');
const path = require('path');
const fs = require('fs');
const cors = require('cors');
const store = require('./store');
const auth = require('./auth');
const logPolicy = require('./log-policy');
const hubPostgres = require('./hub-postgres');
const hubMinio = require('./hub-minio');
const hubConfigModule = require('./hub-config');
const { ensureDataDir } = require('./data-path');

const PUBLIC_DIR = path.join(__dirname, 'public');

let hubConfig = hubConfigModule.loadHubConfig();
ensureDataDir();
const app = express();
app.use(cors());
app.use(express.json({ limit: '2mb' }));

function withStore(fn) {
  const s = store.loadStore();
  const result = fn(s);
  logPolicy.purgeOldData(s, logPolicy.getPolicy(hubConfig).retention);
  logPolicy.capLogTail(s, logPolicy.getPolicy(hubConfig).retention);
  store.saveStore(s);
  return result;
}

function requireAdmin(req, res, next) {
  const token = req.headers['x-admin-token'];
  const check = auth.verifyAdminToken(token, hubConfigModule.resolveAdminToken(hubConfig));
  if (!check.ok) return res.status(401).json({ error: check.error });
  next();
}

function requireAgent(req, res, next) {
  const token = auth.parseBearer(req);
  const agentId = req.body?.agentId || req.query?.agentId;
  if (!agentId || !token) {
    return res.status(401).json({ error: 'agentId and Bearer token required' });
  }
  const s = store.loadStore();
  const check = auth.verifyAgentAuth(agentId, token, s.agents);
  if (!check.ok) return res.status(401).json({ error: check.error });
  req.agentId = agentId;
  req.agent = check.agent;
  next();
}

// ─── Agent API ───────────────────────────────────────────────────────────────

app.post('/api/v1/agents/register', (req, res) => {
  const agentId = req.body?.agentId;
  if (!agentId) return res.status(400).json({ error: 'agentId required' });

  const s = store.loadStore();
  const token = auth.parseBearer(req);
  const existing = s.agents[agentId];

  if (existing) {
    const check = auth.verifyAgentAuth(agentId, token, s.agents);
    if (!check.ok) return res.status(401).json({ error: check.error });
  }

  const agent = store.upsertAgent(s, {
    agentId,
    hostname: req.body.hostname,
    version: req.body.version || '1.0.0',
    configSnapshot: req.body.configSnapshot,
    jobsSummary: req.body.jobsSummary
  });
  logPolicy.purgeOldData(s, logPolicy.getPolicy(hubConfig).retention);
  store.saveStore(s);

  res.json({
    ok: true,
    agentId: agent.agentId,
    apiKey: agent.apiKey,
    enrolled: !existing
  });
});

app.post('/api/v1/agents/heartbeat', requireAgent, (req, res) => {
  withStore(s => {
    store.upsertAgent(s, {
      agentId: req.agentId,
      hostname: req.body.hostname,
      jobsSummary: req.body.jobsSummary
    });
  });
  res.json({ ok: true });
});

app.post('/api/v1/agents/events', requireAgent, (req, res) => {
  const events = req.body.events || [];
  withStore(s => store.addEvents(s, events.map(e => ({ ...e, agentId: req.agentId }))));
  res.json({ ok: true, count: events.length });
});

app.post('/api/v1/agents/runs', requireAgent, (req, res) => {
  const run = withStore(s => store.addRun(s, { ...req.body, agentId: req.agentId }));
  res.json({ ok: true, run });
});

app.post('/api/v1/agents/logs', requireAgent, (req, res) => {
  const policy = logPolicy.getPolicy(hubConfig);
  const lines = (req.body.lines || []).map(l => logPolicy.truncateLine(l, policy.ingest.maxLineLength));
  const rate = logPolicy.checkRateLimit(req.agentId, lines.length, policy.ingest);
  if (!rate.ok) return res.status(429).json({ error: rate.error });

  withStore(s => {
    store.addLogLines(
      s,
      req.agentId,
      req.body.jobId,
      req.body.runId,
      lines,
      req.body.level || 'info'
    );
  });
  res.json({ ok: true, lines: lines.length });
});

app.get('/api/v1/agents/commands', requireAgent, (req, res) => {
  const cmds = withStore(s => store.getPendingCommands(s, req.agentId, req.query.since));
  res.json({ commands: cmds });
});

app.post('/api/v1/agents/commands/:id/ack', requireAgent, (req, res) => {
  const cmd = withStore(s =>
    store.ackCommand(s, req.params.id, req.body.status || 'completed', req.body.result, req.body.error)
  );
  if (!cmd) return res.status(404).json({ error: 'Command not found' });
  res.json({ ok: true, command: cmd });
});

// ─── Admin API ───────────────────────────────────────────────────────────────

app.get('/api/v1/health', (req, res) => {
  res.json({ ok: true, service: 'syncguard-hub', version: '1.0.0' });
});

function getHubSettingsResponse() {
  return {
    retention: hubConfig.retention,
    ingest: hubConfig.ingest,
    port: hubConfig.port,
    publicUrl: hubConfig.publicUrl || '',
    hubPostgresJobs: hubPostgres.listJobs(),
    hubMinioJobs: hubMinio.listJobs()
  };
}

app.get('/api/v1/hub/config', requireAdmin, (req, res) => {
  res.json(getHubSettingsResponse());
});

app.get('/api/v1/config', requireAdmin, (req, res) => {
  res.json(getHubSettingsResponse());
});

app.post('/api/v1/config', requireAdmin, (req, res) => {
  hubConfig = hubConfigModule.saveHubConfigPatch({
    publicUrl: String(req.body?.publicUrl || '').trim()
  });
  res.json({ ok: true, config: getHubSettingsResponse() });
});

app.get('/api/v1/agents', requireAdmin, (req, res) => {
  const s = store.loadStore();
  const agents = store.listAgentsForAdmin(s);
  res.json({ agents });
});

app.post('/api/v1/agents', requireAdmin, (req, res) => {
  const { agentId, hostname } = req.body;
  if (!agentId) return res.status(400).json({ error: 'agentId required' });
  const agent = withStore(s => store.registerAgentManual(s, agentId, hostname));
  res.json({ ok: true, agentId: agent.agentId, apiKey: agent.apiKey });
});

app.get('/api/v1/agents/:id', requireAdmin, (req, res) => {
  const s = store.loadStore();
  const agent = s.agents[req.params.id];
  if (!agent) return res.status(404).json({ error: 'Agent not found' });
  res.json({
    ...agent,
    apiKey: agent.apiKey,
    online: store.isOnline(agent)
  });
});

app.delete('/api/v1/agents/:id', requireAdmin, (req, res) => {
  const result = withStore(s => store.deleteAgent(s, req.params.id));
  if (!result.ok) return res.status(404).json({ error: result.error });
  res.json(result);
});

app.get('/api/v1/agents/:id/runs', requireAdmin, (req, res) => {
  const runs = withStore(s => store.listRuns(s, req.params.id, req.query.jobId));
  res.json({ runs });
});

app.get('/api/v1/agents/:id/logs', requireAdmin, (req, res) => {
  const lines = withStore(s =>
    store.getLogTail(s, req.params.id, req.query.jobId, req.query.runId, parseInt(req.query.last, 10) || 200)
  );
  res.json({ lines });
});

app.get('/api/v1/agents/:id/events', requireAdmin, (req, res) => {
  const s = store.loadStore();
  let events = s.events.filter(e => e.agentId === req.params.id);
  if (req.query.runId) events = events.filter(e => e.runId === req.query.runId);
  events.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  res.json({ events: events.slice(0, parseInt(req.query.limit, 10) || 100) });
});

app.get('/api/v1/hub/postgres/jobs', requireAdmin, (req, res) => {
  res.json({ jobs: hubPostgres.listJobs() });
});

app.get('/api/v1/hub/postgres/jobs/:id', requireAdmin, (req, res) => {
  const job = hubPostgres.getJob(req.params.id);
  if (!job) return res.status(404).json({ error: 'Hub PostgreSQL job not found' });
  res.json({ job });
});

app.post('/api/v1/hub/postgres/jobs', requireAdmin, (req, res) => {
  try {
    const job = hubPostgres.createJob(req.body || {});
    res.json({ ok: true, job });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.put('/api/v1/hub/postgres/jobs/:id', requireAdmin, (req, res) => {
  try {
    const job = hubPostgres.updateJob(req.params.id, req.body || {});
    res.json({ ok: true, job });
  } catch (err) {
    const status = /not found/i.test(err.message) ? 404 : 400;
    res.status(status).json({ error: err.message });
  }
});

app.delete('/api/v1/hub/postgres/jobs/:id', requireAdmin, (req, res) => {
  try {
    const result = hubPostgres.deleteJob(req.params.id);
    res.json({ ok: true, result });
  } catch (err) {
    const status = /not found/i.test(err.message) ? 404 : 400;
    res.status(status).json({ error: err.message });
  }
});

app.post('/api/v1/hub/postgres/jobs/:id/run', requireAdmin, async (req, res) => {
  const result = await hubPostgres.runJob(req.params.id, 'manual');
  if (!result.ok) return res.status(400).json({ error: result.error });
  res.json({ ok: true, ...result });
});

app.post('/api/v1/hub/postgres/jobs/:id/stop', requireAdmin, (req, res) => {
  const result = hubPostgres.stopJob(req.params.id);
  if (!result.ok) return res.status(400).json({ error: result.error });
  res.json(result);
});

app.post('/api/v1/hub/postgres/test', requireAdmin, async (req, res) => {
  const result = await hubPostgres.testConnection(req.body || {});
  if (!result.ok) return res.status(400).json({ error: result.error });
  res.json(result);
});

app.get('/api/v1/hub/postgres/runs', requireAdmin, (req, res) => {
  res.json({ runs: hubPostgres.listRuns(req.query.jobId) });
});

app.get('/api/v1/hub/postgres/logs', requireAdmin, (req, res) => {
  const lines = hubPostgres.getLogs(req.query.jobId, req.query.runId, parseInt(req.query.last, 10) || 200);
  res.json({ lines });
});

// ─── Hub MinIO Jobs ───────────────────────────────────────────────────────────

app.get('/api/v1/hub/minio/jobs', requireAdmin, (req, res) => {
  res.json({ jobs: hubMinio.listJobs() });
});

app.get('/api/v1/hub/minio/jobs/:id', requireAdmin, (req, res) => {
  const job = hubMinio.getJob(req.params.id);
  if (!job) return res.status(404).json({ error: 'Hub MinIO job not found' });
  res.json({ job });
});

app.post('/api/v1/hub/minio/jobs', requireAdmin, (req, res) => {
  try {
    const job = hubMinio.createJob(req.body || {});
    res.json({ ok: true, job });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.put('/api/v1/hub/minio/jobs/:id', requireAdmin, (req, res) => {
  try {
    const job = hubMinio.updateJob(req.params.id, req.body || {});
    res.json({ ok: true, job });
  } catch (err) {
    const status = /not found/i.test(err.message) ? 404 : 400;
    res.status(status).json({ error: err.message });
  }
});

app.delete('/api/v1/hub/minio/jobs/:id', requireAdmin, (req, res) => {
  try {
    const result = hubMinio.deleteJob(req.params.id);
    res.json({ ok: true, result });
  } catch (err) {
    const status = /not found/i.test(err.message) ? 404 : 400;
    res.status(status).json({ error: err.message });
  }
});

app.post('/api/v1/hub/minio/jobs/:id/run', requireAdmin, async (req, res) => {
  const result = await hubMinio.runJob(req.params.id, 'manual');
  if (!result.ok) return res.status(400).json({ error: result.error });
  res.json({ ok: true, ...result });
});

app.post('/api/v1/hub/minio/jobs/:id/stop', requireAdmin, (req, res) => {
  const result = hubMinio.stopJob(req.params.id);
  if (!result.ok) return res.status(400).json({ error: result.error });
  res.json(result);
});

app.post('/api/v1/hub/minio/test', requireAdmin, async (req, res) => {
  const result = await hubMinio.testConnection(req.body || {});
  if (!result.ok) return res.status(400).json({ error: result.error });
  res.json(result);
});

app.get('/api/v1/hub/minio/runs', requireAdmin, (req, res) => {
  res.json({ runs: hubMinio.listRuns(req.query.jobId) });
});

app.get('/api/v1/hub/minio/logs', requireAdmin, (req, res) => {
  const lines = hubMinio.getLogs(req.query.jobId, req.query.runId, parseInt(req.query.last, 10) || 200);
  res.json({ lines });
});

app.post('/api/v1/agents/:id/commands', requireAdmin, (req, res) => {
  const cmd = withStore(s =>
    store.enqueueCommand(s, req.params.id, req.body.type, req.body.payload)
  );
  res.json({ ok: true, command: cmd });
});

app.post('/api/v1/agents/:id/logs/request', requireAdmin, (req, res) => {
  const cmd = withStore(s =>
    store.enqueueCommand(s, req.params.id, 'fetch_log_tail', {
      jobId: req.body.jobId,
      last: req.body.last || 300
    })
  );
  res.json({ ok: true, command: cmd });
});

app.post('/api/v1/agents/:id/logs/purge', requireAdmin, (req, res) => {
  const { scope, jobId, beforeDate, purgeAgent } = req.body;
  if (!scope) return res.status(400).json({ error: 'scope required' });

  const hubRemoved = withStore(s => store.purgeHubLogs(s, req.params.id, scope, jobId, beforeDate));

  let command = null;
  if (purgeAgent !== false) {
    command = withStore(s =>
      store.enqueueCommand(s, req.params.id, 'delete_local_logs', { scope, jobId, beforeDate })
    );
  }

  withStore(s => store.addAudit(s, {
    action: 'purge_logs',
    agentId: req.params.id,
    scope,
    jobId,
    hubRemoved
  }));

  res.json({ ok: true, hubRemoved, command });
});

app.get('/api/v1/audit', requireAdmin, (req, res) => {
  const s = store.loadStore();
  res.json({ audit: s.audit.slice(-100).reverse() });
});

// ─── SPA static ──────────────────────────────────────────────────────────────

const indexPath = path.join(PUBLIC_DIR, 'index.html');
if (fs.existsSync(PUBLIC_DIR)) {
  app.use(express.static(PUBLIC_DIR));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api/')) return next();
    if (fs.existsSync(indexPath)) res.sendFile(indexPath);
    else next();
  });
}

app.use((req, res) => {
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ error: 'Not found' });
  }
  res.status(404).send('Hub UI not built. Run: npm run hub:build');
});

const PORT = hubConfigModule.resolvePort(hubConfig);
hubPostgres.init();
hubMinio.init();
const httpServer = app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n╔══════════════════════════════════════╗`);
  console.log(`║   SyncGuard Hub on :${PORT}              ║`);
  console.log(`║   Data: ${process.env.HUB_DATA_DIR || 'hub/data'}`.padEnd(39) + '║');
  console.log(`╚══════════════════════════════════════╝\n`);
});

httpServer.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\n[ERROR] Port ${PORT} sudah dipakai (hub mungkin masih jalan).`);
    console.error('        Jalankan: npm run hub:stop  atau  stop-hub.bat\n');
    process.exit(1);
  }
  console.error('[ERROR] Hub server:', err.message);
  process.exit(1);
});
