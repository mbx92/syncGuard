const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const cron = require('node-cron');

const store = require('./store');
const { resolveDataPath } = require('./data-path');
const minioUtil = require('../backend/minio-util');
const postgresUtil = require('../backend/postgres-util');

const MINIO_STAGING_ROOT = resolveDataPath('minio-backups');

const activeRuns = new Map();
const schedules = new Map();

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function generateId(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function cloneStore() {
  return store.loadStore();
}

function saveStore(nextStore) {
  store.saveStore(nextStore);
  return nextStore;
}

function sanitizeMinioCredentials(minio) {
  if (!minio) return null;
  return minioUtil.sanitizeMinioForClient(minio);
}

function sanitizeJob(job) {
  if (!job) return job;
  return {
    ...job,
    minio: sanitizeMinioCredentials(job.minio),
    postgres: job.postgres ? postgresUtil.sanitizePostgresForClient(job.postgres) : null
  };
}

function normalizeJobPayload(body, existingJob = null) {
  const prevMinio = existingJob?.minio || {};
  const mc = body.minio || {};
  const secretKeyEncrypted = mc.secretKey
    ? minioUtil.encryptSecretKey(mc.secretKey)
    : (prevMinio.secretKeyEncrypted || '');

  const destType = String(body.destType || existingJob?.destType || 'folder').trim();

  const job = {
    id: existingJob?.id || generateId('hubmc'),
    name: String(body.name || '').trim(),
    description: String(body.description || '').trim(),
    schedule: String(body.schedule || existingJob?.schedule || 'manual').trim() || 'manual',
    destType,
    enabled: body.enabled !== undefined ? !!body.enabled : (existingJob?.enabled ?? true),
    createdAt: existingJob?.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    lastRun: existingJob?.lastRun || null,
    lastResult: existingJob?.lastResult || null,
    lastDuration: existingJob?.lastDuration || null,
    status: existingJob?.status || 'idle',
    minio: {
      endpoint: String(mc.endpoint || prevMinio.endpoint || '').trim(),
      bucket: String(mc.bucket || prevMinio.bucket || '').trim(),
      prefix: String(mc.prefix !== undefined ? mc.prefix : (prevMinio.prefix || '')).trim(),
      accessKey: String(mc.accessKey || prevMinio.accessKey || '').trim(),
      secretKeyEncrypted,
      mcPath: String(mc.mcPath || prevMinio.mcPath || 'mc').trim() || 'mc'
    }
  };

  if (destType === 'postgres') {
    const prevPg = existingJob?.postgres || {};
    const pg = body.postgres || {};
    const passwordEncrypted = pg.password
      ? postgresUtil.encryptPassword(pg.password)
      : (prevPg.passwordEncrypted || '');
    job.postgres = {
      host: String(pg.host || prevPg.host || '').trim(),
      port: parseInt(pg.port, 10) || prevPg.port || 5432,
      database: String(pg.database || prevPg.database || '').trim(),
      username: String(pg.username || prevPg.username || '').trim(),
      passwordEncrypted,
      pgDumpPath: String(pg.pgDumpPath || prevPg.pgDumpPath || 'pg_dump').trim() || 'pg_dump',
      dumpFormat: postgresUtil.normalizeDumpFormat(pg.dumpFormat || prevPg.dumpFormat || 'custom'),
      extraOptions: String(pg.extraOptions || prevPg.extraOptions || '').trim(),
      retentionCount: parseInt(pg.retentionCount, 10) || prevPg.retentionCount || 3
    };
    job.sourceDir = '';
  } else {
    job.postgres = null;
    job.sourceDir = String(body.sourceDir || existingJob?.sourceDir || '').trim();
  }

  return job;
}

function validateJob(job) {
  if (!job.name) return 'Nama job wajib diisi.';
  if (!job.minio?.endpoint) return 'Endpoint MinIO wajib diisi.';
  if (!job.minio?.bucket) return 'Bucket wajib diisi.';
  if (!job.minio?.accessKey) return 'Access Key wajib diisi.';
  if (!job.minio?.secretKeyEncrypted) return 'Secret Key wajib diisi.';
  if (job.destType === 'postgres') {
    if (!job.postgres?.host || !job.postgres?.database || !job.postgres?.username) {
      return 'Host, database, dan username PostgreSQL wajib diisi.';
    }
  } else {
    if (!job.sourceDir) return 'Source directory wajib diisi untuk tipe folder.';
  }
  return '';
}

function getJob(jobId) {
  return store.getHubMinioJob(cloneStore(), jobId);
}

function listJobs() {
  return store.listHubMinioJobs(cloneStore()).map(sanitizeJob);
}

function listRuns(jobId) {
  return store.listHubMinioRuns(cloneStore(), jobId);
}

function getLogs(jobId, runId, last) {
  return store.getHubMinioLogTail(cloneStore(), jobId, runId, last);
}

function appendLog(jobId, runId, lines, level = 'info') {
  const nextStore = cloneStore();
  store.addHubMinioLogLines(nextStore, jobId, runId, Array.isArray(lines) ? lines : [lines], level);
  saveStore(nextStore);
}

function updateRun(runId, patch) {
  const nextStore = cloneStore();
  store.updateHubMinioRun(nextStore, runId, patch);
  saveStore(nextStore);
}

function updateJobRuntime(jobId, patch) {
  const nextStore = cloneStore();
  const job = store.getHubMinioJob(nextStore, jobId);
  if (!job) return null;
  const updated = store.upsertHubMinioJob(nextStore, { ...job, ...patch, id: job.id });
  saveStore(nextStore);
  return updated;
}

function finalizeRun(job, run, result) {
  const endTime = new Date();
  const durationSec = Math.round((endTime.getTime() - new Date(run.startedAt).getTime()) / 1000);
  updateRun(run.id, {
    finishedAt: endTime.toISOString(),
    durationSec,
    result: result.success ? 'success' : (result.message || result.error || 'failed')
  });
  updateJobRuntime(job.id, {
    status: result.success ? 'idle' : 'failed',
    lastRun: run.startedAt,
    lastResult: result.success ? 'success' : (result.message || result.error || 'failed'),
    lastDuration: durationSec
  });
  activeRuns.delete(job.id);
}

async function runFolderMirror(job, run) {
  const cancelToken = { cancelled: false };
  activeRuns.set(job.id, { cancel: () => { cancelToken.cancelled = true; }, runId: run.id });

  appendLog(job.id, run.id, `Command: mc cp (normalisasi path) ${job.sourceDir} → MinIO`);

  const result = await minioUtil.runSanitizedMinioMirror(
    job.minio,
    { mcPath: job.minio.mcPath },
    job.sourceDir,
    job.name,
    {
      onLog: (line) => appendLog(job.id, run.id, line),
      onProgress: () => {},
      isCancelled: () => cancelToken.cancelled
    }
  );

  if (result.cancelled) {
    return { success: false, error: 'Backup dibatalkan', message: 'dibatalkan' };
  }
  if (!result.success) {
    return { success: false, error: result.error, message: result.error };
  }
  return { success: true, message: result.message || 'upload ke MinIO selesai' };
}

async function runPostgresDump(job, run) {
  const stagingDir = path.join(MINIO_STAGING_ROOT, job.id);
  ensureDir(stagingDir);

  const dumpResult = await new Promise((resolve) => {
    const extension = postgresUtil.getDumpFileExtension(job.postgres?.dumpFormat);
    const ts = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, '').replace('T', '_');
    const dbName = String(job.postgres?.database || 'database').replace(/[^a-zA-Z0-9._-]+/g, '-');
    const fileName = `${dbName}_${ts}.${extension}`;
    const outputFile = path.join(stagingDir, fileName);

    const args = [
      '--no-password',
      '-h', job.postgres.host,
      '-p', String(job.postgres.port || 5432),
      '-U', job.postgres.username,
      '-d', job.postgres.database
    ];
    if (job.postgres.extraOptions) {
      args.push(...job.postgres.extraOptions.split(' ').filter(Boolean));
    }
    args.push(`--format=${postgresUtil.normalizeDumpFormat(job.postgres.dumpFormat)}`);
    args.push('--file', outputFile);

    const env = { ...process.env };
    const pw = postgresUtil.decryptPassword(job.postgres?.passwordEncrypted || '');
    if (pw) env.PGPASSWORD = pw;

    const pgDumpPath = postgresUtil.resolvePgDumpPath({ postgres: job.postgres }, {});
    appendLog(job.id, run.id, `=== pg_dump started ===`);
    appendLog(job.id, run.id, `Command: ${pgDumpPath} ${args.join(' ')}`);

    const proc = spawn(pgDumpPath, args, { shell: false, windowsHide: true, env });
    activeRuns.set(job.id, { proc, runId: run.id });

    proc.stdout.on('data', (data) => {
      data.toString().split('\n').forEach((line) => { if (line.trim()) appendLog(job.id, run.id, line); });
    });
    proc.stderr.on('data', (data) => {
      data.toString().split('\n').forEach((line) => { if (line.trim()) appendLog(job.id, run.id, `[pg_dump] ${line}`, 'error'); });
    });
    proc.on('error', (err) => {
      const error = err.code === 'ENOENT'
        ? postgresUtil.formatPgDumpNotFoundMessage(pgDumpPath)
        : err.message;
      resolve({ ok: false, error });
    });
    proc.on('close', (code) => {
      if (code !== 0) { resolve({ ok: false, error: `pg_dump gagal (exit ${code})` }); return; }
      try {
        const stat = fs.statSync(outputFile);
        appendLog(job.id, run.id, `Dump created: ${fileName} (${stat.size} bytes)`);
        resolve({ ok: true, outputFile, fileName, sizeBytes: stat.size });
      } catch (e) {
        resolve({ ok: false, error: e.message });
      }
    });
  });

  if (!dumpResult.ok) return dumpResult;

  // Upload dump file to MinIO
  const uploadResult = await new Promise((resolve) => {
    const ctx = minioUtil.buildUploadContext(job.minio, { mcPath: job.minio.mcPath }, dumpResult.outputFile, job.name);
    appendLog(job.id, run.id, `=== Upload ke MinIO started ===`);
    appendLog(job.id, run.id, `Command: ${ctx.executable} ${ctx.args.join(' ')}`);

    const proc = spawn(ctx.executable, ctx.args, { shell: false, env: ctx.env });
    activeRuns.set(job.id, { proc, runId: run.id });

    proc.stdout.on('data', (data) => {
      data.toString().split('\n').forEach((line) => { if (line.trim()) appendLog(job.id, run.id, line); });
    });
    proc.stderr.on('data', (data) => {
      data.toString().split('\n').forEach((line) => { if (line.trim()) appendLog(job.id, run.id, `[mc] ${line}`, 'error'); });
    });
    proc.on('error', (err) => {
      const error = err.code === 'ENOENT'
        ? `MinIO Client (mc) tidak ditemukan. Download dari https://dl.min.io/client/mc/release/`
        : err.message;
      resolve({ ok: false, error });
    });
    proc.on('close', (code) => {
      if (code === 0) {
        resolve({ ok: true, message: 'upload ke MinIO selesai' });
      } else {
        resolve({ ok: false, error: `mc cp gagal (exit ${code})` });
      }
    });
  });

  if (uploadResult.ok) {
    cleanupOldStagingFiles(stagingDir, job.postgres?.retentionCount || 3);
  }

  return uploadResult;
}

function cleanupOldStagingFiles(dir, retentionCount) {
  try {
    if (!fs.existsSync(dir)) return;
    const files = fs.readdirSync(dir)
      .map((name) => { const fp = path.join(dir, name); return { fp, stat: fs.statSync(fp) }; })
      .filter((e) => e.stat.isFile())
      .sort((a, b) => b.stat.mtimeMs - a.stat.mtimeMs);
    files.slice(Math.max(1, retentionCount)).forEach((e) => { try { fs.unlinkSync(e.fp); } catch {} });
  } catch {}
}

async function runJob(jobId, trigger = 'manual') {
  const job = getJob(jobId);
  if (!job) return { ok: false, error: 'Hub MinIO job not found' };
  if (activeRuns.has(jobId)) return { ok: false, error: 'Job sudah berjalan' };

  const validationError = validateJob(job);
  if (validationError) return { ok: false, error: validationError };

  const mcBinary = await minioUtil.testMcBinary(minioUtil.resolveMcPath(job.minio?.mcPath));
  if (!mcBinary.ok) return { ok: false, error: mcBinary.error };

  const startedAt = new Date().toISOString();
  const run = (() => {
    const nextStore = cloneStore();
    const created = store.addHubMinioRun(nextStore, {
      id: generateId('hubmc-run'),
      jobId: job.id,
      jobName: job.name,
      startedAt,
      trigger,
      result: 'running'
    });
    store.addAudit(nextStore, { action: 'hub_minio_run', agentId: 'hub', jobId: job.id });
    saveStore(nextStore);
    return created;
  })();

  updateJobRuntime(job.id, { status: 'running', lastRun: startedAt, lastResult: 'running' });
  appendLog(job.id, run.id, `=== Hub MinIO backup started (${trigger}) ===`);
  appendLog(job.id, run.id, `Type: ${job.destType}, Bucket: ${job.minio?.bucket}`);

  let result;
  if (job.destType === 'postgres') {
    result = await runPostgresDump(job, run);
  } else {
    result = await runFolderMirror(job, run);
  }

  const success = result.ok !== false && result.success !== false;
  finalizeRun(job, run, { success, error: result.error, message: result.message || (success ? 'selesai' : result.error) });

  if (success) {
    appendLog(job.id, run.id, `=== Backup COMPLETED ===`);
    return { ok: true, runId: run.id };
  } else {
    appendLog(job.id, run.id, `=== Backup FAILED: ${result.error} ===`, 'error');
    return { ok: false, error: result.error };
  }
}

function stopJob(jobId) {
  const active = activeRuns.get(jobId);
  if (!active) return { ok: false, error: 'Job tidak sedang berjalan' };
  if (typeof active.cancel === 'function') {
    active.cancel();
    return { ok: true };
  }
  if (active.proc) {
    active.proc.kill(process.platform === 'win32' ? undefined : 'SIGTERM');
  }
  return { ok: true };
}

function destroySchedule(jobId) {
  const task = schedules.get(jobId);
  if (task) { task.destroy(); schedules.delete(jobId); }
}

function scheduleJob(job) {
  destroySchedule(job.id);
  if (!job.enabled || !job.schedule || job.schedule === 'manual') return;
  try {
    const task = cron.schedule(job.schedule, () => runJob(job.id, 'schedule'));
    schedules.set(job.id, task);
  } catch {}
}

function createJob(payload) {
  const job = normalizeJobPayload(payload);
  const err = validateJob(job);
  if (err) throw new Error(err);
  const nextStore = cloneStore();
  const saved = store.upsertHubMinioJob(nextStore, job);
  store.addAudit(nextStore, { action: 'create_hub_minio_job', agentId: 'hub', jobId: saved.id });
  saveStore(nextStore);
  scheduleJob(saved);
  return sanitizeJob(saved);
}

function updateJob(jobId, payload) {
  const nextStore = cloneStore();
  const existing = store.getHubMinioJob(nextStore, jobId);
  if (!existing) throw new Error('Hub MinIO job not found');
  const job = normalizeJobPayload(payload, existing);
  const err = validateJob(job);
  if (err) throw new Error(err);
  const saved = store.upsertHubMinioJob(nextStore, { ...existing, ...job, id: jobId });
  store.addAudit(nextStore, { action: 'update_hub_minio_job', agentId: 'hub', jobId: saved.id });
  saveStore(nextStore);
  scheduleJob(saved);
  return sanitizeJob(saved);
}

function deleteJob(jobId) {
  destroySchedule(jobId);
  const nextStore = cloneStore();
  const result = store.deleteHubMinioJob(nextStore, jobId);
  if (!result.ok) throw new Error(result.error);
  store.addAudit(nextStore, { action: 'delete_hub_minio_job', agentId: 'hub', jobId });
  saveStore(nextStore);
  return result;
}

async function testConnection(payload) {
  const existing = payload.id ? getJob(payload.id) : null;
  const job = normalizeJobPayload(payload, existing);
  if (!job.minio?.endpoint || !job.minio?.bucket || !job.minio?.accessKey) {
    return { ok: false, error: 'Endpoint, bucket, dan access key wajib diisi' };
  }
  return minioUtil.testMinioConnection(job.minio, { mcPath: job.minio.mcPath });
}

function scheduleAll() {
  listJobs().forEach((j) => {
    const raw = getJob(j.id);
    if (raw) scheduleJob(raw);
  });
}

function init() {
  ensureDir(MINIO_STAGING_ROOT);
  scheduleAll();
}

module.exports = {
  init,
  listJobs,
  getJob: (jobId) => sanitizeJob(getJob(jobId)),
  listRuns,
  getLogs,
  createJob,
  updateJob,
  deleteJob,
  runJob,
  stopJob,
  testConnection
};
