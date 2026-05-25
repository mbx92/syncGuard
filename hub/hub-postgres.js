const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const cron = require('node-cron');

const store = require('./store');
const postgresUtil = require('../backend/postgres-util');

const DUMPS_ROOT = path.join(__dirname, 'data', 'postgres-dumps');

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

function sanitizeJob(job) {
  if (!job) return job;
  return {
    ...job,
    postgres: postgresUtil.sanitizePostgresForClient(job.postgres)
  };
}

function normalizeJobPayload(body, existingJob = null) {
  const previous = existingJob?.postgres || {};
  const pg = body.postgres || {};
  const passwordEncrypted = pg.password
    ? postgresUtil.encryptPassword(pg.password)
    : (previous.passwordEncrypted || '');

  return {
    id: existingJob?.id || generateId('hubpg'),
    name: String(body.name || '').trim(),
    description: String(body.description || '').trim(),
    schedule: String(body.schedule || existingJob?.schedule || 'manual').trim() || 'manual',
    destPath: String(body.destPath || existingJob?.destPath || '').trim(),
    enabled: body.enabled !== undefined ? !!body.enabled : (existingJob?.enabled ?? true),
    createdAt: existingJob?.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    lastRun: existingJob?.lastRun || null,
    lastResult: existingJob?.lastResult || null,
    lastDuration: existingJob?.lastDuration || null,
    status: existingJob?.status || 'idle',
    postgres: {
      host: String(pg.host || previous.host || '').trim(),
      port: parseInt(pg.port, 10) || previous.port || 5432,
      database: String(pg.database || previous.database || '').trim(),
      username: String(pg.username || previous.username || '').trim(),
      passwordEncrypted,
      pgDumpPath: String(pg.pgDumpPath || previous.pgDumpPath || 'pg_dump').trim() || 'pg_dump',
      dumpFormat: postgresUtil.normalizeDumpFormat(pg.dumpFormat || previous.dumpFormat || 'custom'),
      extraOptions: String(pg.extraOptions || previous.extraOptions || '').trim(),
      retentionCount: parseInt(pg.retentionCount, 10) || previous.retentionCount || 3
    }
  };
}

function validateJob(job) {
  if (!job.name) return 'Nama job wajib diisi.';
  if (!job.destPath) return 'Destination path wajib diisi.';
  if (!job.postgres?.host || !job.postgres?.database || !job.postgres?.username) {
    return 'Host, database, dan username PostgreSQL wajib diisi.';
  }
  return '';
}

function getJob(jobId) {
  return store.getHubPostgresJob(cloneStore(), jobId);
}

function listJobs() {
  return store.listHubPostgresJobs(cloneStore()).map(sanitizeJob);
}

function listRuns(jobId) {
  return store.listHubPostgresRuns(cloneStore(), jobId);
}

function getLogs(jobId, runId, last) {
  return store.getHubPostgresLogTail(cloneStore(), jobId, runId, last);
}

function appendLog(jobId, runId, lines, level = 'info') {
  const nextStore = cloneStore();
  store.addHubPostgresLogLines(nextStore, jobId, runId, Array.isArray(lines) ? lines : [lines], level);
  saveStore(nextStore);
}

function updateRun(runId, patch) {
  const nextStore = cloneStore();
  store.updateHubPostgresRun(nextStore, runId, patch);
  saveStore(nextStore);
}

function updateJobRuntime(jobId, patch) {
  const nextStore = cloneStore();
  const job = store.getHubPostgresJob(nextStore, jobId);
  if (!job) return null;
  const updated = store.upsertHubPostgresJob(nextStore, { ...job, ...patch, id: job.id });
  saveStore(nextStore);
  return updated;
}

function cleanupOldDumps(job) {
  const retentionCount = Math.max(1, parseInt(job.postgres?.retentionCount, 10) || 3);
  const dumpDir = path.join(DUMPS_ROOT, String(job.id));
  if (!fs.existsSync(dumpDir)) return;
  const files = fs.readdirSync(dumpDir)
    .map((name) => {
      const filePath = path.join(dumpDir, name);
      return { filePath, stat: fs.statSync(filePath) };
    })
    .filter((entry) => entry.stat.isFile())
    .sort((a, b) => b.stat.mtimeMs - a.stat.mtimeMs);

  files.slice(retentionCount).forEach((entry) => {
    try {
      fs.unlinkSync(entry.filePath);
    } catch {}
  });
}

function buildDumpContext(job) {
  const dumpDir = path.join(DUMPS_ROOT, String(job.id));
  ensureDir(dumpDir);
  const extension = postgresUtil.getDumpFileExtension(job.postgres?.dumpFormat);
  const timestamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, '').replace('T', '_');
  const fileName = `${String(job.postgres?.database || 'database').replace(/[^a-zA-Z0-9._-]+/g, '-')}_${timestamp}.${extension}`;
  const outputFile = path.join(dumpDir, fileName);
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
  const password = postgresUtil.decryptPassword(job.postgres?.passwordEncrypted || '');
  if (password) env.PGPASSWORD = password;

  return {
    executable: postgresUtil.resolvePgDumpPath({ postgres: job.postgres }, {}),
    args,
    env,
    dumpDir,
    outputFile,
    fileName,
    dumpFormat: postgresUtil.normalizeDumpFormat(job.postgres?.dumpFormat)
  };
}

async function testConnection(payload) {
  const existing = payload.id ? getJob(payload.id) : null;
  const job = normalizeJobPayload(payload, existing);
  const validationError = validateJob(job);
  if (validationError) return { ok: false, error: validationError };
  return postgresUtil.testPostgresConnection({ id: job.id, postgres: job.postgres }, {});
}

function finalizeRun(job, run, result) {
  const endTime = new Date();
  const durationSec = Math.round((endTime.getTime() - new Date(run.startedAt).getTime()) / 1000);
  updateRun(run.id, {
    finishedAt: endTime.toISOString(),
    durationSec,
    result: result.success ? 'success' : (result.message || result.error || 'failed'),
    dumpFile: result.dumpFile || run.dumpFile || null,
    dumpSizeBytes: result.dumpSizeBytes || run.dumpSizeBytes || null
  });
  updateJobRuntime(job.id, {
    status: result.success ? 'idle' : 'failed',
    lastRun: run.startedAt,
    lastResult: result.success ? 'success' : (result.message || result.error || 'failed'),
    lastDuration: durationSec
  });
  activeRuns.delete(job.id);
}

async function copyDumpToDestination(outputFile, destPath) {
  await fs.promises.mkdir(destPath, { recursive: true });
  const targetFile = path.join(destPath, path.basename(outputFile));
  await fs.promises.copyFile(outputFile, targetFile);
  return targetFile;
}

async function runJob(jobId, trigger = 'manual') {
  const job = getJob(jobId);
  if (!job) return { ok: false, error: 'Hub PostgreSQL job not found' };
  if (activeRuns.has(jobId)) return { ok: false, error: 'Job sudah berjalan' };

  const validationError = validateJob(job);
  if (validationError) return { ok: false, error: validationError };

  const binary = await postgresUtil.testPgDumpBinary(postgresUtil.resolvePgDumpPath({ postgres: job.postgres }, {}));
  if (!binary.ok) return { ok: false, error: binary.error };

  const startedAt = new Date().toISOString();
  const run = (() => {
    const nextStore = cloneStore();
    const createdRun = store.addHubPostgresRun(nextStore, {
      id: generateId('hubpg-run'),
      jobId: job.id,
      jobName: job.name,
      startedAt,
      trigger,
      result: 'running'
    });
    store.addAudit(nextStore, { action: 'hub_postgres_run', agentId: 'hub', jobId: job.id });
    saveStore(nextStore);
    return createdRun;
  })();

  updateJobRuntime(job.id, { status: 'running', lastRun: startedAt, lastResult: 'running' });
  appendLog(job.id, run.id, `=== Hub PostgreSQL backup started (${trigger}) ===`);

  const dumpContext = buildDumpContext(job);
  appendLog(job.id, run.id, `Command: ${dumpContext.executable} ${dumpContext.args.join(' ')}`);
  appendLog(job.id, run.id, `Destination: ${job.destPath}`);

  return new Promise((resolve) => {
    const proc = spawn(dumpContext.executable, dumpContext.args, {
      shell: false,
      windowsHide: true,
      env: dumpContext.env
    });

    activeRuns.set(job.id, { proc, runId: run.id });

    proc.stdout.on('data', (data) => {
      data.toString().split('\n').forEach((line) => {
        if (line.trim()) appendLog(job.id, run.id, line);
      });
    });

    proc.stderr.on('data', (data) => {
      data.toString().split('\n').forEach((line) => {
        if (line.trim()) appendLog(job.id, run.id, `[pg_dump] ${line}`, 'error');
      });
    });

    proc.on('error', (err) => {
      const error = err.code === 'ENOENT'
        ? postgresUtil.formatPgDumpNotFoundMessage(dumpContext.executable)
        : err.message;
      appendLog(job.id, run.id, error, 'error');
      finalizeRun(job, run, { success: false, error, message: error });
      resolve({ ok: false, error });
    });

    proc.on('close', async (code) => {
      if (code !== 0) {
        const error = `pg_dump gagal (exit ${code})`;
        appendLog(job.id, run.id, error, 'error');
        finalizeRun(job, run, { success: false, error, message: error });
        resolve({ ok: false, error });
        return;
      }

      try {
        const stat = fs.statSync(dumpContext.outputFile);
        appendLog(job.id, run.id, `Dump created: ${dumpContext.fileName} (${stat.size} bytes)`);
        const copiedTo = await copyDumpToDestination(dumpContext.outputFile, job.destPath);
        appendLog(job.id, run.id, `Copied to destination: ${copiedTo}`);
        cleanupOldDumps(job);
        finalizeRun(job, run, {
          success: true,
          message: 'backup selesai',
          dumpFile: dumpContext.fileName,
          dumpSizeBytes: stat.size
        });
        resolve({ ok: true, runId: run.id, dumpFile: dumpContext.fileName, destination: copiedTo });
      } catch (err) {
        appendLog(job.id, run.id, err.message, 'error');
        finalizeRun(job, run, { success: false, error: err.message, message: err.message });
        resolve({ ok: false, error: err.message });
      }
    });
  });
}

function stopJob(jobId) {
  const active = activeRuns.get(jobId);
  if (!active) return { ok: false, error: 'Job tidak sedang berjalan' };
  active.proc.kill(process.platform === 'win32' ? undefined : 'SIGTERM');
  return { ok: true };
}

function destroySchedule(jobId) {
  const task = schedules.get(jobId);
  if (task) {
    task.destroy();
    schedules.delete(jobId);
  }
}

function scheduleJob(job) {
  destroySchedule(job.id);
  if (!job.enabled || !job.schedule || job.schedule === 'manual') return;
  try {
    const task = cron.schedule(job.schedule, () => {
      runJob(job.id, 'schedule');
    });
    schedules.set(job.id, task);
  } catch {}
}

function scheduleAll() {
  listJobs().forEach(scheduleJob);
}

function createJob(payload) {
  const job = normalizeJobPayload(payload);
  const validationError = validateJob(job);
  if (validationError) throw new Error(validationError);

  const nextStore = cloneStore();
  const saved = store.upsertHubPostgresJob(nextStore, job);
  store.addAudit(nextStore, { action: 'create_hub_postgres_job', agentId: 'hub', jobId: saved.id });
  saveStore(nextStore);
  scheduleJob(saved);
  return sanitizeJob(saved);
}

function updateJob(jobId, payload) {
  const nextStore = cloneStore();
  const existing = store.getHubPostgresJob(nextStore, jobId);
  if (!existing) throw new Error('Hub PostgreSQL job not found');
  const job = normalizeJobPayload(payload, existing);
  const validationError = validateJob(job);
  if (validationError) throw new Error(validationError);
  const saved = store.upsertHubPostgresJob(nextStore, { ...existing, ...job, id: jobId });
  store.addAudit(nextStore, { action: 'update_hub_postgres_job', agentId: 'hub', jobId: saved.id });
  saveStore(nextStore);
  scheduleJob(saved);
  return sanitizeJob(saved);
}

function deleteJob(jobId) {
  destroySchedule(jobId);
  const nextStore = cloneStore();
  const result = store.deleteHubPostgresJob(nextStore, jobId);
  if (!result.ok) throw new Error(result.error);
  store.addAudit(nextStore, { action: 'delete_hub_postgres_job', agentId: 'hub', jobId });
  saveStore(nextStore);
  return result;
}

function init() {
  ensureDir(DUMPS_ROOT);
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
