const DEFAULT_RETENTION = {
  runsDays: 90,
  logTailLinesPerRun: 200,
  logTailRunsKept: 50
};

const DEFAULT_INGEST = {
  maxLinesPerMinutePerAgent: 120,
  maxLineLength: 500
};

const rateBuckets = new Map();

function getPolicy(hubConfig) {
  return {
    retention: { ...DEFAULT_RETENTION, ...hubConfig?.retention },
    ingest: { ...DEFAULT_INGEST, ...hubConfig?.ingest }
  };
}

function truncateLine(line, maxLen) {
  const s = String(line || '');
  if (s.length <= maxLen) return s;
  return s.slice(0, maxLen) + '…';
}

function checkRateLimit(agentId, lineCount, ingest) {
  const now = Date.now();
  const key = agentId;
  let bucket = rateBuckets.get(key);
  if (!bucket || now - bucket.windowStart > 60000) {
    bucket = { windowStart: now, count: 0 };
    rateBuckets.set(key, bucket);
  }
  bucket.count += lineCount;
  if (bucket.count > ingest.maxLinesPerMinutePerAgent) {
    return { ok: false, error: 'Rate limit exceeded' };
  }
  return { ok: true };
}

function capLogTail(store, retention) {
  const maxLines = retention.logTailLinesPerRun;
  const byRun = {};
  for (const row of store.logTail) {
    if (!byRun[row.runId]) byRun[row.runId] = [];
    byRun[row.runId].push(row);
  }
  const keptRunIds = new Set(
    [...store.runs]
      .sort((a, b) => new Date(b.startedAt) - new Date(a.startedAt))
      .slice(0, retention.logTailRunsKept * 20)
      .map(r => r.id)
  );
  const next = [];
  for (const [runId, rows] of Object.entries(byRun)) {
    if (!keptRunIds.has(runId) && rows.length > 0) continue;
    const sorted = rows.sort((a, b) => a.lineNo - b.lineNo);
    const slice = sorted.slice(-maxLines);
    next.push(...slice);
  }
  store.logTail = next;

  const hubByRun = {};
  for (const row of store.hubPostgresLogTail || []) {
    if (!hubByRun[row.runId]) hubByRun[row.runId] = [];
    hubByRun[row.runId].push(row);
  }
  const keptHubRunIds = new Set(
    [...(store.hubPostgresRuns || [])]
      .sort((a, b) => new Date(b.startedAt) - new Date(a.startedAt))
      .slice(0, retention.logTailRunsKept * 20)
      .map(r => r.id)
  );
  const nextHub = [];
  for (const [runId, rows] of Object.entries(hubByRun)) {
    if (!keptHubRunIds.has(runId) && rows.length > 0) continue;
    const sorted = rows.sort((a, b) => a.lineNo - b.lineNo);
    nextHub.push(...sorted.slice(-maxLines));
  }
  store.hubPostgresLogTail = nextHub;
}

function purgeOldData(store, retention) {
  const cutoff = Date.now() - retention.runsDays * 86400000;
  const oldRunIds = new Set(
    store.runs.filter(r => new Date(r.startedAt).getTime() < cutoff).map(r => r.id)
  );
  if (oldRunIds.size === 0) return;
  store.runs = store.runs.filter(r => !oldRunIds.has(r.id));
  store.events = store.events.filter(e => !oldRunIds.has(e.runId));
  store.logTail = store.logTail.filter(l => !oldRunIds.has(l.runId));

  const oldHubRunIds = new Set(
    (store.hubPostgresRuns || []).filter(r => new Date(r.startedAt).getTime() < cutoff).map(r => r.id)
  );
  if (oldHubRunIds.size > 0) {
    store.hubPostgresRuns = (store.hubPostgresRuns || []).filter(r => !oldHubRunIds.has(r.id));
    store.hubPostgresLogTail = (store.hubPostgresLogTail || []).filter(l => !oldHubRunIds.has(l.runId));
  }
}

module.exports = {
  getPolicy,
  truncateLine,
  checkRateLimit,
  capLogTail,
  purgeOldData
};
