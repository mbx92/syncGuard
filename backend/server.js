const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const { spawn, exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const cors = require('cors');
const cron = require('node-cron');
const ssh = require('./ssh');
const lifecycle = require('./lifecycle');
const rsyncUtil = require('./rsync-util');
const postgresUtil = require('./postgres-util');
const minioUtil = require('./minio-util');
const agentHub = require('./agent-hub');
const logRotate = require('./log-rotate');
const logPurge = require('./log-purge');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../frontend')));

const CONFIG_FILE = path.join(__dirname, '../config/config.json');
const LOGS_DIR = path.join(__dirname, '../logs');

// Ensure directories exist
if (!fs.existsSync(LOGS_DIR)) fs.mkdirSync(LOGS_DIR, { recursive: true });

// Default config
const defaultConfig = {
  nas: {
    ip: '192.168.1.100',
    user: 'admin',
    port: 22,
    basePath: '/volume1/backup',
    password: ''
  },
  jobs: [],
  settings: {
    syncEngine: 'rsync',
    rsyncPath: 'tools/cwrsync/bin/rsync.exe',
    pgDumpPath: 'pg_dump',
    mcPath: 'tools/mc/mc.exe',
    sshKeyPath: '',
    defaultOptions: '-avz --progress --delete',
    robocopyPath: 'robocopy',
    robocopyDefaultOptions: '/E /Z /R:3 /W:5 /MT:8 /MIR',
    smbShare: '\\\\192.168.1.100\\backup',
    smbPassword: ''
  },
  minio: {
    endpoint: '',
    bucket: '',
    prefix: 'syncguard',
    accessKey: '',
    secretKeyEncrypted: ''
  },
  hub: {
    enabled: false,
    url: '',
    agentId: '',
    apiKey: '',
    heartbeatIntervalSec: 30,
    logPushMode: 'summary',
    logPushMaxLinesPerMinute: 30,
    localLogMaxMbPerJob: 10,
    localLogKeepRotations: 3
  }
};

function loadConfig() {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      const saved = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
      return {
        ...defaultConfig,
        ...saved,
        nas: { ...defaultConfig.nas, ...saved.nas },
        settings: { ...defaultConfig.settings, ...saved.settings },
        minio: { ...defaultConfig.minio, ...saved.minio },
        hub: { ...defaultConfig.hub, ...saved.hub },
        jobs: saved.jobs || []
      };
    }
  } catch (e) {}
  return JSON.parse(JSON.stringify(defaultConfig));
}

function getJobSyncEngine(job, config) {
  return job.syncEngine || config.settings.syncEngine || 'rsync';
}

function isRobocopySuccess(code) {
  return code >= 0 && code < 8;
}

function classifyExclusion(pattern) {
  if (pattern.includes('*') || pattern.includes('?')) return 'file';
  if (/^\*?\./.test(pattern) || /\.[a-z0-9]+$/i.test(pattern)) return 'file';
  return 'dir';
}

function buildRsyncCommand(job, config) {
  const spawnSpec = rsyncUtil.buildRsyncJobArgs(job, config);

  return {
    engine: 'rsync',
    executable: spawnSpec.executable,
    args: spawnSpec.args,
    commandLabel: spawnSpec.displayCommand,
    resolvedRsyncPath: spawnSpec.resolvedPath,
    cwd: spawnSpec.cwd
  };
}

function buildRobocopyCommand(job, config) {
  const options = job.options || config.settings.robocopyDefaultOptions || '/E /Z /R:3 /W:5 /MT:8 /MIR';
  const smbShare = (config.settings.smbShare || '').replace(/\\+$/, '');
  const dest = (job.destPath || `${smbShare}\\${job.name}`).replace(/\\+$/, '');
  const source = getJobRuntimeSource(job).replace(/\\+$/, '');

  const args = options.split(' ').filter(Boolean);

  if (job.exclusions && job.exclusions.length > 0) {
    const dirs = [];
    const files = [];
    job.exclusions.forEach(ex => {
      if (classifyExclusion(ex) === 'file') files.push(ex);
      else dirs.push(ex);
    });
    if (dirs.length) args.push('/XD', ...dirs);
    if (files.length) args.push('/XF', ...files);
  }

  args.push(source, dest);

  return {
    engine: 'robocopy',
    executable: config.settings.robocopyPath || 'robocopy',
    args,
    commandLabel: `robocopy ${args.join(' ')}`
  };
}

function buildMinioMirrorCommand(job, config) {
  const minio = { ...defaultConfig.minio, ...config.minio };
  const localPath = getJobRuntimeSource(job);
  const dest = minioUtil.formatJobDestination(minio, job.name);
  return {
    engine: 'minio',
    mode: 'sanitized-mirror',
    localPath,
    minio,
    commandLabel: `mc cp (normalisasi path) ${localPath} → ${dest.uri}`
  };
}

function buildMinioUploadCommand(minioConfig, settings, localFile, jobName) {
  const ctx = minioUtil.buildUploadContext(minioConfig, settings, localFile, jobName);
  return {
    engine: 'minio',
    executable: ctx.executable,
    args: ctx.args,
    env: ctx.env,
    commandLabel: `mc ${ctx.args.join(' ')}`
  };
}

function buildSyncCommand(job, config) {
  const engine = getJobSyncEngine(job, config);
  if (engine === 'minio') return buildMinioMirrorCommand(job, config);
  if (engine === 'robocopy') return buildRobocopyCommand(job, config);
  if (getJobType(job) === 'postgresql') {
    const syncJob = { ...job, sourcePath: getJobRuntimeSource(job) };
    return buildRsyncCommand(syncJob, config);
  }
  return buildRsyncCommand(job, config);
}

function sanitizeMinioConfig(minio) {
  if (!minio) return minioUtil.sanitizeMinioForClient(defaultConfig.minio);
  return minioUtil.sanitizeMinioForClient({ ...defaultConfig.minio, ...minio });
}

function sanitizeHubForClient(hub) {
  const h = { ...defaultConfig.hub, ...hub };
  return {
    enabled: !!h.enabled,
    url: h.url || '',
    agentId: h.agentId || '',
    heartbeatIntervalSec: h.heartbeatIntervalSec || 30,
    logPushMode: h.logPushMode || 'summary',
    logPushMaxLinesPerMinute: h.logPushMaxLinesPerMinute || 30,
    localLogMaxMbPerJob: h.localLogMaxMbPerJob || 10,
    localLogKeepRotations: h.localLogKeepRotations || 3,
    apiKeySet: !!(h.apiKey && String(h.apiKey).length > 0)
  };
}

function sanitizeConfig(config) {
  return {
    ...config,
    nas: ssh.sanitizeNasForClient(config.nas),
    settings: ssh.sanitizeSettingsForClient(config.settings),
    minio: sanitizeMinioConfig(config.minio),
    hub: sanitizeHubForClient(config.hub),
    jobs: (config.jobs || []).map(postgresUtil.sanitizeJobForClient),
    nasProfiles: (config.nasProfiles || []).map(sanitizeNasProfile)
  };
}

function sanitizeNasProfile(profile) {
  return {
    ...profile,
    passwordSet: !!(profile.password && String(profile.password).length > 0),
    password: undefined
  };
}

function sanitizeJobNas(job) {
  if (!job) return job;
  return { ...job, nasProfileId: job.nasProfileId || undefined };
}

function getJobType(job) {
  return job.jobType || 'filesystem';
}

function getJobRuntimeSource(job) {
  return getJobType(job) === 'postgresql'
    ? postgresUtil.getJobDumpDir(job.id)
    : job.sourcePath;
}

function resolveJobDestination(job, config) {
  const engine = getJobSyncEngine(job, config);
  if (engine === 'minio') {
    const minio = { ...defaultConfig.minio, ...config.minio };
    const dest = minioUtil.formatJobDestination(minio, job.name);
    if (dest.warning) return `${dest.uri} (bucket belum diset)`;
    return dest.uri;
  }
  if (engine === 'robocopy') {
    if (job.destPath) return job.destPath;
    const share = (config.settings.smbShare || '').replace(/\\+$/, '');
    return share ? `${share}\\${job.name}` : '—';
  }
  const nas = rsyncUtil.getEffectiveNas(job, config);
  if (nas?.ip) {
    const base = (nas.basePath || '').replace(/\/+$/, '');
    return `${nas.user}@${nas.ip}:${base}/${job.name}`;
  }
  return '—';
}

function sanitizeJobForStatus(job) {
  return sanitizeJobNas(postgresUtil.sanitizeJobForClient(job));
}

function normalizeJobPayload(body, config, existingJob = null) {
  const jobType = body.jobType || existingJob?.jobType || 'filesystem';
  const allowedEngines = ['rsync', 'robocopy', 'minio'];
  const rawEngine = body.syncEngine || existingJob?.syncEngine || config.settings.syncEngine || 'rsync';
  const syncEngine = allowedEngines.includes(rawEngine) ? rawEngine : 'rsync';
  const base = {
    id: existingJob?.id || Date.now().toString(),
    name: body.name,
    description: body.description || '',
    schedule: body.schedule || 'manual',
    syncEngine,
    destPath: body.destPath || '',
    options: body.options || (syncEngine === 'robocopy'
      ? config.settings.robocopyDefaultOptions
      : (syncEngine === 'minio' ? '' : config.settings.defaultOptions)),
    exclusions: body.exclusions || [],
    enabled: existingJob?.enabled ?? true,
    createdAt: existingJob?.createdAt || new Date().toISOString(),
    lastRun: existingJob?.lastRun || null,
    lastResult: existingJob?.lastResult || null,
    jobType
  };

  if (jobType === 'postgresql') {
    const previous = existingJob?.postgres || {};
    const pg = body.postgres || {};
    const passwordEncrypted = pg.password
      ? postgresUtil.encryptPassword(pg.password)
      : (previous.passwordEncrypted || '');

    return {
      ...base,
      sourcePath: '',
      postgres: {
        host: pg.host || previous.host || '',
        port: parseInt(pg.port, 10) || previous.port || 5432,
        database: pg.database || previous.database || '',
        username: pg.username || previous.username || '',
        passwordEncrypted,
        pgDumpPath: pg.pgDumpPath || previous.pgDumpPath || config.settings.pgDumpPath || 'pg_dump',
        dumpFormat: postgresUtil.normalizeDumpFormat(pg.dumpFormat || previous.dumpFormat || 'custom'),
        extraOptions: pg.extraOptions || previous.extraOptions || '',
        retentionCount: parseInt(pg.retentionCount, 10) || previous.retentionCount || 3
      }
    };
  }

  return {
    ...base,
    sourcePath: body.sourcePath,
    postgres: null,
    nasProfileId: (body.nasProfileId || '').trim() || undefined
  };
}

function mergeConfigUpdate(current, body) {
  const updated = { ...current };
  if (body.jobs !== undefined) updated.jobs = body.jobs;
  if (body.nas) {
    const { password, ...nasRest } = body.nas;
    updated.nas = { ...current.nas, ...nasRest };
    if (password !== undefined && password !== '') {
      if (current.nas?.password !== password) {
        updated.settings = { ...updated.settings, sshKeyDeployed: false };
      }
      updated.nas.password = password;
    }
  }
  if (body.settings) {
    const { smbPassword, ...settingsRest } = body.settings;
    updated.settings = { ...current.settings, ...settingsRest };
    if (smbPassword !== undefined && smbPassword !== '') {
      updated.settings.smbPassword = smbPassword;
    }
  }
  if (body.minio) {
    const { secretKey, ...minioRest } = body.minio;
    updated.minio = { ...defaultConfig.minio, ...current.minio, ...minioRest };
    if (secretKey !== undefined && secretKey !== '') {
      updated.minio.secretKeyEncrypted = minioUtil.encryptSecretKey(secretKey);
    }
    if (updated.minio.endpoint) {
      updated.minio.endpoint = minioUtil.normalizeMinioEndpoint(updated.minio.endpoint);
    }
  }
  if (body.hub) {
    updated.hub = { ...current.hub, ...body.hub };
    if (!body.hub.apiKey) {
      updated.hub.apiKey = current.hub?.apiKey || '';
    }
  }
  return updated;
}

function saveConfig(config) {
  fs.mkdirSync(path.dirname(CONFIG_FILE), { recursive: true });
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
}

// In-memory job status
const jobStatus = {};
const activeProcesses = {};
const cronJobs = {};

function initJobStatus(config) {
  config.jobs.forEach(job => {
    if (!jobStatus[job.id]) {
      jobStatus[job.id] = {
        status: 'idle',
        lastRun: null,
        lastResult: null,
        progress: null,
        transferred: null,
        speed: null,
        eta: null
      };
    }
  });
}

// WebSocket broadcast
function broadcast(data) {
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify(data));
    }
  });
  try {
    agentHub.onBroadcast(data);
  } catch (e) {
    console.error('[agent-hub] broadcast:', e.message);
  }
}

// Log to file
function writeLog(jobId, content) {
  const logFile = path.join(LOGS_DIR, `${jobId}.log`);
  const timestamp = new Date().toISOString();
  fs.appendFileSync(logFile, `[${timestamp}] ${content}\n`);
  const cfg = loadConfig();
  logRotate.afterWrite(LOGS_DIR, jobId, cfg.hub);
}

// Parse rsync output for progress
function parseRsyncOutput(line) {
  const info = {};
  const progressMatch = line.match(/^\s*([\d,]+)\s+(\d+)%\s+([\d.]+\w+\/s)\s+(\d+:\d+:\d+)/);
  if (progressMatch) {
    info.transferred = progressMatch[1].replace(/,/g, '');
    info.progress = parseInt(progressMatch[2]);
    info.speed = progressMatch[3];
    info.eta = progressMatch[4];
    return info;
  }
  return null;
}

// Parse robocopy output for progress
function parseRobocopyOutput(line) {
  const pctMatch = line.match(/^\s*([\d.]+)\s*%\s*$/);
  if (pctMatch) {
    return { progress: Math.round(parseFloat(pctMatch[1])) };
  }

  const summaryMatch = line.match(/^\s*Files\s*:\s*(\d+)\s+(\d+)/);
  if (summaryMatch) {
    const total = parseInt(summaryMatch[1]);
    const copied = parseInt(summaryMatch[2]);
    if (total > 0) {
      return { progress: Math.min(100, Math.round((copied / total) * 100)) };
    }
  }

  return null;
}

function parseSyncOutput(engine, line) {
  if (engine === 'robocopy') return parseRobocopyOutput(line);
  if (engine === 'minio') return minioUtil.parseMcOutput(line);
  return parseRsyncOutput(line);
}

function stopProcess(jobId) {
  const proc = activeProcesses[jobId];
  if (!proc) return false;

  if (typeof proc.cancel === 'function') {
    proc.cancel();
    delete activeProcesses[jobId];
    return true;
  }

  if (process.platform === 'win32' && proc.pid) {
    exec(`taskkill /F /T /PID ${proc.pid}`, () => {});
  } else {
    proc.kill('SIGTERM');
  }

  delete activeProcesses[jobId];
  return true;
}

// Map SMB share with credentials before robocopy
function mapSmbShare(config) {
  const share = config.settings.smbShare;
  const password = config.settings.smbPassword || config.nas?.password;
  const user = config.nas?.user;
  if (!share || !password || !user) {
    return Promise.resolve({ ok: true, skipped: true });
  }

  return new Promise((resolve) => {
    const cmd = `net use "${share}" "${password.replace(/"/g, '""')}" /user:${user}`;
    exec(cmd, (err, stdout, stderr) => {
      if (err) {
        resolve({ ok: false, error: stderr || err.message });
      } else {
        resolve({ ok: true, output: stdout.trim() });
      }
    });
  });
}

function spawnTrackedProcess(jobId, executable, args, options = {}) {
  const proc = spawn(executable, args, options);
  activeProcesses[jobId] = proc;
  return proc;
}

function attachProcessLogs(jobId, proc, handlers = {}) {
  proc.stdout.on('data', (data) => {
    const lines = data.toString().split('\n');
    lines.forEach((line) => {
      if (!line.trim()) return;
      writeLog(jobId, line);
      handlers.onStdoutLine?.(line);
    });
  });

  proc.stderr.on('data', (data) => {
    const cleaned = ssh.stripSshNoise(data.toString());
    if (!cleaned) return;
    cleaned.split('\n').forEach((line) => {
      const t = line.trim();
      if (!t) return;
      writeLog(jobId, `ERR: ${t}`);
      handlers.onStderrLine?.(t);
    });
  });
}

function finalizeJobResult(jobId, job, startTime, result) {
  delete activeProcesses[jobId];
  const endTime = new Date();
  const duration = Math.round((endTime - startTime) / 1000);
  const success = !!result.success;

  jobStatus[jobId] = {
    ...jobStatus[jobId],
    status: success ? 'success' : 'failed',
    lastResult: success ? 'success' : (result.message || result.error || 'failed'),
    progress: success ? 100 : jobStatus[jobId].progress,
    endTime: endTime.toISOString(),
    duration
  };

  const cfg = loadConfig();
  const jobIdx = cfg.jobs.findIndex(j => j.id === jobId);
  if (jobIdx >= 0) {
    cfg.jobs[jobIdx].lastRun = startTime.toISOString();
    cfg.jobs[jobIdx].lastResult = jobStatus[jobId].lastResult;
    cfg.jobs[jobIdx].lastDuration = duration;
    saveConfig(cfg);
  }

  writeLog(jobId, `=== Backup ${success ? 'COMPLETED' : 'FAILED'} (${result.message || result.error || 'done'}, duration: ${duration}s) ===\n`);
  broadcast({ type: 'job_status', jobId, status: jobStatus[jobId] });
  return { success, duration, error: result.error || null };
}

async function runPostgresJob(jobId, job, config, startTime) {
  const binary = await postgresUtil.testPgDumpBinary(postgresUtil.resolvePgDumpPath(job, config.settings));
  if (!binary.ok) {
    return { error: binary.error };
  }

  const dumpContext = postgresUtil.createDumpContext(job, config.settings);
  jobStatus[jobId] = {
    ...jobStatus[jobId],
    phase: 'dump',
    progress: null
  };
  broadcast({ type: 'job_status', jobId, status: jobStatus[jobId] });
  writeLog(jobId, '=== PostgreSQL dump started ===');
  writeLog(jobId, `Command: ${dumpContext.executable} ${dumpContext.args.join(' ')}`);
  writeLog(jobId, `Dump format: ${dumpContext.dumpFormat} (${dumpContext.fileName})`);

  const dumpResult = await new Promise((resolve) => {
    const proc = spawnTrackedProcess(jobId, dumpContext.executable, dumpContext.args, {
      shell: false,
      windowsHide: true,
      env: dumpContext.env
    });

    attachProcessLogs(jobId, proc, {
      onStdoutLine: (line) => broadcast({ type: 'job_log', jobId, line }),
      onStderrLine: (line) => broadcast({ type: 'job_log', jobId, line: `[pg_dump] ${line}`, isError: true })
    });

    proc.on('close', (code) => {
      delete activeProcesses[jobId];
      if (code !== 0) {
        resolve({ ok: false, error: `pg_dump gagal (exit ${code})` });
        return;
      }
      const stat = fs.statSync(dumpContext.outputFile);
      writeLog(jobId, `=== PostgreSQL dump completed (${dumpContext.fileName}, ${stat.size} bytes) ===`);
      resolve({
        ok: true,
        dumpDir: dumpContext.dumpDir,
        outputFile: dumpContext.outputFile,
        fileName: dumpContext.fileName,
        sizeBytes: stat.size
      });
    });

    proc.on('error', (err) => {
      delete activeProcesses[jobId];
      const message = err.code === 'ENOENT'
        ? postgresUtil.formatPgDumpNotFoundMessage(dumpContext.executable)
        : err.message;
      resolve({ ok: false, error: message });
    });
  });

  if (!dumpResult.ok) {
    return finalizeJobResult(jobId, job, startTime, { success: false, error: dumpResult.error, message: dumpResult.error });
  }

  const jobEngine = getJobSyncEngine(job, config);
  let syncCmd;
  if (jobEngine === 'minio') {
    const minio = { ...defaultConfig.minio, ...config.minio };
    const minioCheck = minioUtil.validateMinioConfig(minio);
    if (!minioCheck.ok) {
      return finalizeJobResult(jobId, job, startTime, { success: false, error: minioCheck.error, message: minioCheck.error });
    }
    syncCmd = buildMinioUploadCommand(minio, config.settings, dumpResult.outputFile, job.name);
  } else {
    const syncJob = { ...job, sourcePath: dumpResult.dumpDir };
    syncCmd = buildSyncCommand(syncJob, config);
  }

  jobStatus[jobId] = {
    ...jobStatus[jobId],
    phase: 'sync',
    progress: 0,
    dumpFile: dumpResult.fileName,
    dumpSizeBytes: dumpResult.sizeBytes
  };
  broadcast({ type: 'job_status', jobId, status: jobStatus[jobId] });
  const syncLabel = jobEngine === 'minio' ? 'Upload ke MinIO' : 'Sync to NAS';
  writeLog(jobId, `=== ${syncLabel} started ===`);
  writeLog(jobId, `Command: ${syncCmd.commandLabel}`);
  if (jobEngine === 'minio') {
    const minio = { ...defaultConfig.minio, ...config.minio };
    const loc = minioUtil.describeMinioUploadLocation(minio, job.name, dumpResult.fileName);
    writeLog(jobId, `Destination: ${loc.uri}`);
    if (loc.warning) writeLog(jobId, `WARNING: ${loc.warning}`);
    writeLog(jobId, `Browse: ${loc.browseHint}`);
  }

  const syncResult = await new Promise((resolve) => {
    const useShell = process.platform === 'win32' &&
      !path.isAbsolute(syncCmd.executable) &&
      syncCmd.executable.toLowerCase() !== 'wsl';

    const syncEnv = syncCmd.engine === 'rsync'
      ? { ...process.env, ...rsyncUtil.getRsyncRunEnv(config, job) }
      : syncCmd.engine === 'minio'
        ? syncCmd.env
        : process.env;

    const proc = spawnTrackedProcess(jobId, syncCmd.executable, syncCmd.args, {
      shell: useShell,
      windowsHide: true,
      cwd: syncCmd.cwd,
      env: syncEnv
    });

    attachProcessLogs(jobId, proc, {
      onStdoutLine: (line) => {
        const progress = parseSyncOutput(syncCmd.engine, line);
        if (progress) {
          Object.assign(jobStatus[jobId], progress);
          broadcast({ type: 'job_progress', jobId, ...progress, line });
        } else {
          broadcast({ type: 'job_log', jobId, line });
        }
      },
      onStderrLine: (line) => broadcast({ type: 'job_log', jobId, line: `[stderr] ${line}`, isError: true })
    });

    proc.on('close', (code) => {
      delete activeProcesses[jobId];
      const success = syncCmd.engine === 'robocopy' ? isRobocopySuccess(code) : code === 0;
      const dest = syncCmd.engine === 'minio' ? 'MinIO' : 'NAS';
      resolve(success
        ? { success: true, message: `dump + upload ke ${dest} selesai` }
        : { success: false, error: `sync ke ${dest} gagal (exit ${code})`, message: `sync ke ${dest} gagal (exit ${code})` });
    });

    proc.on('error', (err) => {
      delete activeProcesses[jobId];
      resolve({ success: false, error: err.message, message: err.message });
    });
  });

  if (syncResult.success && jobEngine === 'minio') {
    const minio = { ...defaultConfig.minio, ...config.minio };
    const safeDumpName = minioUtil.sanitizeObjectKeyPart(dumpResult.fileName);
    const verify = await minioUtil.verifyMinioObject(minio, config.settings, job.name, safeDumpName);
    if (!verify.ok) {
      syncResult.success = false;
      syncResult.error = verify.error;
      syncResult.message = verify.error;
    } else {
      writeLog(jobId, `Verified: ${verify.uri}`);
      const loc = minioUtil.describeMinioUploadLocation(minio, job.name, dumpResult.fileName);
      writeLog(jobId, `MinIO object: bucket "${loc.bucket}" → ${loc.objectKey}`);
    }
  }

  if (syncResult.success) {
    postgresUtil.cleanupOldDumps(job);
  }

  return finalizeJobResult(jobId, job, startTime, syncResult);
}

// Run a backup job
async function runJob(jobId) {
  const config = loadConfig();
  const job = config.jobs.find(j => j.id === jobId);
  if (!job) return { error: 'Job not found' };

  if (activeProcesses[jobId] || jobStatus[jobId]?.status === 'running') {
    return { error: 'Job masih berjalan. Tunggu selesai atau klik Stop sebelum menjalankan lagi.' };
  }

  const engine = getJobSyncEngine(job, config);
  if (engine === 'rsync') {
    const rsyncPath = rsyncUtil.resolveRsyncPath(config.settings);
    const test = await rsyncUtil.testRsyncBinary(config.settings.rsyncPath);
    if (!test.ok) {
      return { error: `Rsync tidak ditemukan di ${rsyncPath}. Jalankan install-cwrsync.bat` };
    }

    const hasPerJobNas = !!(job.nasProfileId && (config.nasProfiles || []).find(p => p.id === job.nasProfileId));
    if (!hasPerJobNas) {
      if (!config.settings?.sshKeyDeployed) {
        const pwCheck = config.nas?.password
          ? await ssh.testSshConnection(config, { useKey: false })
          : { ok: false };
        if (pwCheck.ok) {
          return {
            error: 'SSH key belum di-deploy ke NAS. Setelah ganti password Synology: isi password baru → Save NAS Config → Deploy SSH Key ke NAS.'
          };
        }
        return {
          error: 'SSH key belum di-deploy. Isi password NAS yang baru, Save, lalu klik Deploy SSH Key ke NAS.'
        };
      }
      const keyPath = ssh.resolveActiveSshKeyPath(config);
      if (!keyPath) {
        return {
          error: 'File SSH key tidak ditemukan. Generate key lalu Deploy SSH Key ke NAS.'
        };
      }
      const sshTest = await rsyncUtil.testRsyncSshKeyAuth(config, keyPath);
      if (!sshTest.ok) {
        return {
          error: `SSH key auth gagal (${config.nas.user}@${config.nas.ip}:${config.nas.port}): ${sshTest.error}. Deploy ulang SSH key setelah ganti password NAS.`
        };
      }
    }
  }

  if (engine === 'robocopy') {
    const mapped = await mapSmbShare(config);
    if (!mapped.ok) {
      return { error: `Gagal map SMB share: ${mapped.error}` };
    }
  }

  if (engine === 'minio') {
    const minio = { ...defaultConfig.minio, ...config.minio };
    const minioCheck = minioUtil.validateMinioConfig(minio);
    if (!minioCheck.ok) {
      return { error: minioCheck.error };
    }
    const mcTest = await minioUtil.testMcBinary(minioUtil.getEffectiveMcPath(config.settings));
    if (!mcTest.ok) {
      return { error: mcTest.error };
    }
  }

  const syncCmd = buildSyncCommand(job, config);

  const startTime = new Date();
  jobStatus[jobId] = {
    status: 'running',
    lastRun: startTime.toISOString(),
    lastResult: null,
    progress: 0,
    transferred: null,
    speed: null,
    eta: null,
    startTime: startTime.toISOString(),
    engine,
    phase: getJobType(job) === 'postgresql' ? 'dump' : null
  };

  broadcast({ type: 'job_status', jobId, status: jobStatus[jobId] });
  writeLog(jobId, `=== Backup started (${engine}) ===`);
  if (getJobType(job) !== 'postgresql') {
    writeLog(jobId, `Command: ${syncCmd.commandLabel}`);
  }

  if (getJobType(job) === 'postgresql') {
    return runPostgresJob(jobId, job, config, startTime);
  }

  if (engine === 'minio' && syncCmd.mode === 'sanitized-mirror') {
    const cancelToken = { cancelled: false };
    let mcChild = null;
    activeProcesses[jobId] = {
      cancel: () => {
        cancelToken.cancelled = true;
        if (mcChild) {
          try {
            if (process.platform === 'win32' && mcChild.pid) {
              exec(`taskkill /F /T /PID ${mcChild.pid}`, () => {});
            } else {
              mcChild.kill('SIGTERM');
            }
          } catch { /* ignore */ }
        }
      }
    };

    return minioUtil.runSanitizedMinioMirror(
      syncCmd.minio,
      config.settings,
      syncCmd.localPath,
      job.name,
      {
        onLog: (line) => {
          writeLog(jobId, line);
          const progress = minioUtil.parseMcOutput(line);
          if (progress) {
            Object.assign(jobStatus[jobId], progress);
            broadcast({ type: 'job_progress', jobId, ...progress, line });
          } else {
            broadcast({ type: 'job_log', jobId, line });
          }
        },
        onProgress: (progress) => {
          Object.assign(jobStatus[jobId], progress);
          broadcast({ type: 'job_progress', jobId, ...progress });
        },
        isCancelled: () => cancelToken.cancelled,
        registerProc: (proc) => { mcChild = proc; }
      }
    ).then((result) => finalizeJobResult(jobId, job, startTime, {
      success: !!result.success,
      error: result.error,
      message: result.message || (result.success ? 'backup selesai' : result.error)
    })).catch((err) => finalizeJobResult(jobId, job, startTime, {
      success: false,
      error: err.message,
      message: err.message
    }));
  }

  return new Promise((resolve) => {
    const useShell = process.platform === 'win32' &&
      !path.isAbsolute(syncCmd.executable) &&
      syncCmd.executable.toLowerCase() !== 'wsl';

    const spawnEnv = engine === 'rsync'
      ? { ...process.env, ...rsyncUtil.getRsyncRunEnv(config, job) }
      : engine === 'minio'
        ? syncCmd.env
        : process.env;

    const proc = spawn(syncCmd.executable, syncCmd.args, {
      shell: useShell,
      windowsHide: true,
      cwd: syncCmd.cwd,
      env: spawnEnv
    });

    activeProcesses[jobId] = proc;

    proc.stdout.on('data', (data) => {
      const lines = data.toString().split('\n');
      lines.forEach(line => {
        if (!line.trim()) return;
        writeLog(jobId, line);

        const progress = parseSyncOutput(engine, line);
        if (progress) {
          Object.assign(jobStatus[jobId], progress);
          broadcast({ type: 'job_progress', jobId, ...progress, line });
        } else {
          broadcast({ type: 'job_log', jobId, line });
        }
      });
    });

    proc.stderr.on('data', (data) => {
      const cleaned = ssh.stripSshNoise(data.toString());
      if (!cleaned) return;
      cleaned.split('\n').forEach((line) => {
        const t = line.trim();
        if (!t) return;
        writeLog(jobId, `ERR: ${t}`);
        const isRsyncMissing = /not recognized|not found|ENOENT/i.test(t);
        const hint = isRsyncMissing
          ? ' — Set Rsync Path di Settings ke C:\\cwrsync\\bin\\rsync.exe atau wsl rsync'
          : '';
        broadcast({ type: 'job_log', jobId, line: `[stderr] ${t}${hint}`, isError: true });
      });
    });

    proc.on('close', (code) => {
      delete activeProcesses[jobId];
      const endTime = new Date();
      const duration = Math.round((endTime - startTime) / 1000);

      const success = engine === 'robocopy' ? isRobocopySuccess(code) : code === 0;
      jobStatus[jobId] = {
        ...jobStatus[jobId],
        status: success ? 'success' : 'failed',
        lastResult: success ? 'success' : `failed (exit ${code})`,
        progress: success ? 100 : jobStatus[jobId].progress,
        endTime: endTime.toISOString(),
        duration
      };

      const cfg = loadConfig();
      const jobIdx = cfg.jobs.findIndex(j => j.id === jobId);
      if (jobIdx >= 0) {
        cfg.jobs[jobIdx].lastRun = startTime.toISOString();
        cfg.jobs[jobIdx].lastResult = jobStatus[jobId].lastResult;
        cfg.jobs[jobIdx].lastDuration = duration;
        saveConfig(cfg);
      }

      writeLog(jobId, `=== Backup ${success ? 'COMPLETED' : 'FAILED'} (exit: ${code}, duration: ${duration}s) ===\n`);
      broadcast({ type: 'job_status', jobId, status: jobStatus[jobId] });
      resolve({ success, code, duration });
    });

    proc.on('error', (err) => {
      delete activeProcesses[jobId];
      let msg = err.message;
      if (err.code === 'ENOENT') {
        if (engine === 'minio') {
          msg = 'MinIO Client (mc) tidak ditemukan. Download dari https://dl.min.io/client/mc/release/ lalu isi mc Path di Settings.';
        } else if (engine === 'robocopy') {
          msg = 'robocopy not found. Pastikan robocopy tersedia di PATH Windows.';
        } else {
          const detected = rsyncUtil.detectRsyncInstallation();
          msg = detected.length
            ? `rsync tidak dapat dijalankan. Coba set Rsync Path ke: ${detected[0].path}`
            : 'rsync tidak ditemukan. Install cwRsync atau gunakan WSL (wsl rsync).';
        }
      }

      jobStatus[jobId] = {
        ...jobStatus[jobId],
        status: 'failed',
        lastResult: `error: ${msg}`,
        endTime: new Date().toISOString()
      };
      writeLog(jobId, `ERROR: ${msg}`);
      broadcast({ type: 'job_status', jobId, status: jobStatus[jobId] });
      resolve({ error: msg });
    });
  });
}

// Schedule jobs with cron
function setupSchedule(job) {
  if (cronJobs[job.id]) {
    cronJobs[job.id].destroy();
    delete cronJobs[job.id];
  }
  if (job.schedule && job.schedule !== 'manual') {
    try {
      cronJobs[job.id] = cron.schedule(job.schedule, () => {
        console.log(`[cron] Running job: ${job.name}`);
        runJob(job.id);
      });
      console.log(`[cron] Scheduled "${job.name}" with: ${job.schedule}`);
    } catch (e) {
      console.error(`[cron] Invalid schedule for ${job.name}: ${e.message}`);
    }
  }
}

function setupAllSchedules() {
  const config = loadConfig();
  config.jobs.forEach(job => setupSchedule(job));
}

// ─── API Routes ───────────────────────────────────────────────────────────────

// GET /api/config
app.get('/api/config', (req, res) => {
  res.json(sanitizeConfig(loadConfig()));
});

// POST /api/config
app.post('/api/config', (req, res) => {
  const config = mergeConfigUpdate(loadConfig(), req.body);
  saveConfig(config);
  initJobStatus(config);
  initAgentHub(config);
  res.json({ ok: true });
});

// ─── NAS Profiles CRUD ───────────────────────────────────────────────────────

function generateProfileId() {
  return 'np_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

app.get('/api/nas-profiles', (req, res) => {
  const config = loadConfig();
  res.json({ profiles: (config.nasProfiles || []).map(sanitizeNasProfile) });
});

app.post('/api/nas-profiles', (req, res) => {
  const { name, ip, port, user, basePath, password } = req.body || {};
  if (!name || !ip || !user) {
    return res.status(400).json({ error: 'name, ip, dan user wajib diisi' });
  }
  const profile = {
    id: generateProfileId(),
    name,
    ip,
    port: parseInt(port, 10) || 22,
    user,
    basePath: basePath || '',
    password: password || ''
  };
  const config = loadConfig();
  config.nasProfiles = [...(config.nasProfiles || []), profile];
  saveConfig(config);
  res.json({ ok: true, profile: sanitizeNasProfile(profile) });
});

app.put('/api/nas-profiles/:id', (req, res) => {
  const config = loadConfig();
  const idx = (config.nasProfiles || []).findIndex(p => p.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Profile not found' });
  const existing = config.nasProfiles[idx];
  const { name, ip, port, user, basePath, password } = req.body || {};
  const updated = {
    ...existing,
    name: name || existing.name,
    ip: ip || existing.ip,
    port: parseInt(port, 10) || existing.port || 22,
    user: user || existing.user,
    basePath: basePath !== undefined ? basePath : existing.basePath
  };
  if (password !== undefined && password !== '') {
    updated.password = password;
  }
  config.nasProfiles[idx] = updated;
  saveConfig(config);
  res.json({ ok: true, profile: sanitizeNasProfile(updated) });
});

app.delete('/api/nas-profiles/:id', (req, res) => {
  const config = loadConfig();
  const idx = (config.nasProfiles || []).findIndex(p => p.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Profile not found' });
  config.nasProfiles.splice(idx, 1);
  config.jobs.forEach(j => {
    if (j.nasProfileId === req.params.id) delete j.nasProfileId;
  });
  saveConfig(config);
  res.json({ ok: true });
});

// GET /api/status
app.get('/api/status', (req, res) => {
  const config = loadConfig();
  const jobs = config.jobs.map(job => ({
    ...sanitizeJobForStatus(job),
    destination: resolveJobDestination(job, config),
    status: jobStatus[job.id] || { status: 'idle' }
  }));
  res.json({
    jobs,
    nas: ssh.sanitizeNasForClient(config.nas),
    settings: ssh.sanitizeSettingsForClient(config.settings),
    minio: sanitizeMinioConfig(config.minio),
    hub: sanitizeHubForClient(config.hub),
    nasProfiles: (config.nasProfiles || []).map(sanitizeNasProfile)
  });
});

// POST /api/jobs
app.post('/api/jobs', (req, res) => {
  const config = loadConfig();
  const job = normalizeJobPayload(req.body, config);
  config.jobs.push(job);
  saveConfig(config);
  jobStatus[job.id] = { status: 'idle' };
  setupSchedule(job);
  broadcast({ type: 'jobs_updated' });
  res.json({ ok: true, job: sanitizeJobForStatus(job) });
});

// PUT /api/jobs/:id
app.put('/api/jobs/:id', (req, res) => {
  const config = loadConfig();
  const idx = config.jobs.findIndex(j => j.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Job not found' });
  config.jobs[idx] = normalizeJobPayload(req.body, config, config.jobs[idx]);
  saveConfig(config);
  setupSchedule(config.jobs[idx]);
  broadcast({ type: 'jobs_updated' });
  res.json({ ok: true });
});

// DELETE /api/jobs/:id
app.delete('/api/jobs/:id', (req, res) => {
  const config = loadConfig();
  const id = req.params.id;
  config.jobs = config.jobs.filter(j => j.id !== id);
  saveConfig(config);
  if (cronJobs[id]) { cronJobs[id].destroy(); delete cronJobs[id]; }
  delete jobStatus[id];
  broadcast({ type: 'jobs_updated' });
  res.json({ ok: true });
});

// POST /api/jobs/:id/run
app.post('/api/jobs/:id/run', async (req, res) => {
  const result = await runJob(req.params.id);
  if (result?.error) {
    res.json({ success: false, error: result.error });
    return;
  }
  res.json(result);
});

// POST /api/jobs/:id/stop
app.post('/api/jobs/:id/stop', (req, res) => {
  const id = req.params.id;
  if (stopProcess(id)) {
    jobStatus[id] = { ...jobStatus[id], status: 'stopped', lastResult: 'stopped by user' };
    broadcast({ type: 'job_status', jobId: id, status: jobStatus[id] });
    res.json({ ok: true });
  } else {
    res.json({ ok: false, error: 'Not running' });
  }
});

// GET /api/jobs/:id/log
app.get('/api/jobs/:id/log', (req, res) => {
  const logFile = path.join(LOGS_DIR, `${req.params.id}.log`);
  if (fs.existsSync(logFile)) {
    const lines = fs.readFileSync(logFile, 'utf8').split('\n').filter(Boolean);
    const last = parseInt(req.query.last) || 200;
    res.json({ lines: lines.slice(-last) });
  } else {
    res.json({ lines: [] });
  }
});

// GET|POST /api/test-connection
async function handleTestConnection(req, res) {
  let config = loadConfig();
  if (req.body?.nas) {
    config = mergeConfigUpdate(config, { nas: req.body.nas });
  }
  const engine = req.query.engine || req.body?.engine || config.settings.syncEngine || 'rsync';
  const preferPassword = req.body?.preferPassword !== false;

  if (engine === 'robocopy') {
    const share = config.settings.smbShare;
    if (!share) {
      return res.json({ ok: false, error: 'SMB Share path belum dikonfigurasi' });
    }

    const mapped = await mapSmbShare(config);
    if (!mapped.ok && !mapped.skipped) {
      return res.json({ ok: false, error: mapped.error });
    }

    const proc = spawn('cmd', ['/c', `dir "${share}"`], { shell: false });
    let out = '', err = '';
    proc.stdout.on('data', d => out += d);
    proc.stderr.on('data', d => err += d);
    proc.on('close', code => {
      res.json({
        ok: code === 0,
        output: out.trim().split('\n').slice(0, 5).join('\n'),
        error: err.trim() || (code !== 0 ? 'Tidak dapat mengakses SMB share. Pastikan share sudah di-map atau kredensial Windows valid.' : '')
      });
    });
    proc.on('error', e => {
      res.json({ ok: false, error: e.message });
    });
    return;
  }

  const result = await rsyncUtil.testRsyncConnection(config, { preferPassword });
  if (result.ok && result.authMethod === 'password' && config.settings?.sshKeyDeployed) {
    const saved = loadConfig();
    saved.settings.sshKeyDeployed = false;
    saveConfig(saved);
    result.hint = (result.hint || '') + ' Status key di-reset — deploy ulang SSH key.';
  }
  res.json({
    ok: result.ok,
    output: result.output,
    error: result.error,
    hint: result.hint,
    authMethod: result.authMethod,
    sshBin: result.sshBin,
    keyPath: result.keyPath
  });
}

app.get('/api/test-connection', handleTestConnection);
app.post('/api/test-connection', handleTestConnection);

app.post('/api/postgres/test', async (req, res) => {
  const config = loadConfig();
  const draftJob = normalizeJobPayload({
    ...req.body,
    jobType: 'postgresql'
  }, config, req.body.id ? config.jobs.find((job) => job.id === req.body.id) : null);

  const postgres = draftJob.postgres || {};
  if (!postgres.host || !postgres.database || !postgres.username) {
    return res.json({ ok: false, error: 'Host, database, dan username PostgreSQL wajib diisi.' });
  }

  const result = await postgresUtil.testPostgresConnection(draftJob, config.settings);
  res.json(result);
});

app.post('/api/minio/test', async (req, res) => {
  const config = loadConfig();
  const body = req.body || {};
  const secretKey = body.secretKey;
  const minioConfig = {
    ...defaultConfig.minio,
    ...config.minio,
    endpoint: minioUtil.normalizeMinioEndpoint(body.endpoint || config.minio?.endpoint || ''),
    bucket: body.bucket || config.minio?.bucket || '',
    prefix: body.prefix !== undefined ? body.prefix : (config.minio?.prefix || 'syncguard'),
    accessKey: body.accessKey || config.minio?.accessKey || '',
    secretKeyEncrypted: secretKey
      ? minioUtil.encryptSecretKey(secretKey)
      : (config.minio?.secretKeyEncrypted || '')
  };
  const settings = { ...config.settings, mcPath: body.mcPath || config.settings?.mcPath };
  const result = await minioUtil.testMinioConnection(minioConfig, settings);
  res.json(result);
});

// GET /api/ssh/status
app.get('/api/ssh/status', (req, res) => {
  const config = loadConfig();
  res.json(ssh.getKeyStatus(config));
});

// POST /api/ssh/generate-key
app.post('/api/ssh/generate-key', async (req, res) => {
  const result = await ssh.generateKeyPair();
  if (result.ok && !result.existed) {
    const config = loadConfig();
    config.settings.sshKeyPath = result.privateKey;
    saveConfig(config);
  }
  res.json(result);
});

// POST /api/ssh/deploy-key
app.post('/api/ssh/deploy-key', async (req, res) => {
  const config = loadConfig();
  if (req.body.password) {
    config.nas.password = req.body.password;
    saveConfig(config);
  }
  const result = await ssh.deployPublicKey(config, { password: req.body.password });
  if (result.ok) {
    const cfg = loadConfig();
    cfg.settings.sshKeyPath = result.privateKey;
    cfg.settings.sshKeyDeployed = true;
    saveConfig(cfg);

    const keyPath = ssh.resolveSshKeyPath(cfg);
    let verify = await rsyncUtil.testRsyncSshKeyAuth(cfg, keyPath);
    if (!verify.ok) {
      await ssh.fixNasSshHomePermissions(cfg, { password: req.body.password || cfg.nas?.password });
      verify = await rsyncUtil.testRsyncSshKeyAuth(cfg, keyPath);
    }
    result.verified = verify.ok;
    if (!verify.ok) {
      result.warning = `Key terkirim, tapi login via cwRsync SSH gagal: ${verify.error}. Pastikan user NAS "${cfg.nas.user}" benar.`;
      cfg.settings.sshKeyDeployed = false;
      saveConfig(cfg);
    }
  }
  res.json(result);
});

// GET /api/rsync/status — path tersimpan saja, tanpa scan sistem
app.get('/api/rsync/status', async (req, res) => {
  const config = loadConfig();
  const configured = rsyncUtil.resolveRsyncPath(config.settings);
  const test = rsyncUtil.isRsyncPathConfigured(config.settings)
    ? await rsyncUtil.testRsyncBinary(config.settings.rsyncPath)
    : { ok: false, error: 'Rsync path belum dikonfigurasi' };
  res.json({
    configured,
    saved: config.settings.rsyncPath || '',
    autoDetected: rsyncUtil.isRsyncPathConfigured(config.settings),
    test
  });
});

// POST /api/rsync/install — salin cwRsync ke tools/cwrsync (sekali)
app.post('/api/rsync/install', async (req, res) => {
  const result = await rsyncUtil.installBundledCwRsync();
  if (result.ok) {
    const config = loadConfig();
    config.settings.rsyncPath = result.path;
    saveConfig(config);
  }
  res.json(result);
});

// POST /api/rsync/detect — tidak scan jika path sudah tersimpan
app.post('/api/rsync/detect', async (req, res) => {
  const config = loadConfig();

  if (rsyncUtil.isRsyncPathConfigured(config.settings) && !req.body?.force) {
    const test = await rsyncUtil.testRsyncBinary(config.settings.rsyncPath);
    return res.json({
      saved: config.settings.rsyncPath,
      resolved: rsyncUtil.resolveRsyncPath(config.settings),
      skippedScan: true,
      test
    });
  }

  if (!rsyncUtil.isBundledInstalled()) {
    const installed = await rsyncUtil.installBundledCwRsync();
    if (installed.ok) {
      config.settings.rsyncPath = installed.path;
      saveConfig(config);
      const test = await rsyncUtil.testRsyncBinary(installed.path);
      return res.json({
        installed: true,
        saved: installed.path,
        source: installed.source,
        test
      });
    }
    return res.json({
      ok: false,
      error: installed.error,
      hint: 'Jalankan install-cwrsync.bat'
    });
  }

  const rel = rsyncUtil.getDefaultRsyncPathRelative();
  config.settings.rsyncPath = rel;
  saveConfig(config);
  const test = await rsyncUtil.testRsyncBinary(rel);
  res.json({ saved: rel, bundled: true, test });
});

// GET /api/rsync/detect — legacy, redirect ke status
app.get('/api/rsync/detect', async (req, res) => {
  const config = loadConfig();
  const test = await rsyncUtil.testRsyncBinary(config.settings.rsyncPath);
  res.json({
    detected: [],
    resolved: rsyncUtil.resolveRsyncPath(config.settings),
    configured: config.settings.rsyncPath || '',
    test
  });
});

// POST /api/shutdown
app.post('/api/shutdown', (req, res) => {
  res.json({ ok: true, message: 'Server shutting down...' });
  setTimeout(() => lifecycle.gracefulShutdown(0), 150);
});

// GET /api/server-info
app.get('/api/server-info', (req, res) => {
  res.json(lifecycle.getServerInfo(PORT));
});

// GET /api/hub/status — koneksi agent ke pusat (heartbeat nyata)
app.get('/api/hub/status', (req, res) => {
  const config = loadConfig();
  const live = agentHub.getStatus();
  res.json({
    enabled: !!config.hub?.enabled,
    url: config.hub?.url || '',
    agentId: config.hub?.agentId || '',
    hasApiKey: !!(config.hub?.apiKey),
    configured: live.configured,
    connected: live.connected,
    lastError: live.lastError,
    lastOkAt: live.lastOkAt
  });
});

// WebSocket connection handler
wss.on('connection', (ws) => {
  const config = loadConfig();
  ws.send(JSON.stringify({
    type: 'init',
    jobStatus,
    activeJobs: Object.keys(activeProcesses)
  }));
});

// Start server
const PORT = process.env.PORT || 7432;
const cfg = loadConfig();
initJobStatus(cfg);
setupAllSchedules();

if (rsyncUtil.isRsyncPathConfigured(cfg.settings)) {
  console.log(`[SyncGuard] Rsync: ${rsyncUtil.resolveRsyncPath(cfg.settings)}`);
} else if (rsyncUtil.isBundledInstalled()) {
  console.log(`[SyncGuard] Rsync bundled: ${rsyncUtil.getBundledCwRsyncPath()}`);
} else {
  console.log('[SyncGuard] Rsync: belum diinstall — jalankan install-cwrsync.bat');
}

if (minioUtil.isBundledMcInstalled()) {
  console.log(`[SyncGuard] MinIO Client bundled: ${minioUtil.getBundledMcPath()}`);
} else {
  console.log('[SyncGuard] mc: belum diinstall — jalankan install-mc.bat untuk job MinIO');
}

lifecycle.registerShutdownHook(() => {
  Object.keys(activeProcesses).forEach(stopProcess);
  Object.values(cronJobs).forEach(c => c.destroy());
});

function readJobLogTail(jobId, last) {
  const logFile = path.join(LOGS_DIR, `${jobId}.log`);
  if (!fs.existsSync(logFile)) return [];
  const lines = fs.readFileSync(logFile, 'utf8').split('\n').filter(Boolean);
  return lines.slice(-(last || 300));
}

function initAgentHub(config) {
  agentHub.init(config.hub, {
    getConfigSnapshot: () => sanitizeConfig(loadConfig()),
    getJobsSummary: () => {
      const cfg = loadConfig();
      return cfg.jobs.map(job => ({
        id: job.id,
        name: job.name,
        status: (jobStatus[job.id] || {}).status || 'idle',
        lastResult: job.lastResult || (jobStatus[job.id] || {}).lastResult,
        lastRun: job.lastRun
      }));
    },
    runJob: (jobId) => runJob(jobId),
    stopJob: (jobId) => {
      if (stopProcess(jobId)) {
        jobStatus[jobId] = { ...jobStatus[jobId], status: 'stopped', lastResult: 'stopped by user' };
        broadcast({ type: 'job_status', jobId, status: jobStatus[jobId] });
        return { ok: true };
      }
      return { ok: false, error: 'Not running' };
    },
    getJobLogTail: readJobLogTail,
    purgeLogs: (scope, jobId, beforeDate) =>
      logPurge.purgeLogs(LOGS_DIR, scope, jobId, beforeDate, Object.keys(activeProcesses)),
    updateJob: (jobId, data) => {
      const cfg = loadConfig();
      const idx = cfg.jobs.findIndex(j => j.id === jobId);
      if (idx === -1) throw new Error('Job not found');
      cfg.jobs[idx] = { ...cfg.jobs[idx], ...data };
      saveConfig(cfg);
      setupSchedule(cfg.jobs[idx]);
      broadcast({ type: 'jobs_updated' });
      return { ok: true };
    },
    updateConfig: (data) => {
      const cfg = mergeConfigUpdate(loadConfig(), data);
      saveConfig(cfg);
      initAgentHub(cfg);
      return { ok: true };
    },
    saveHubCredentials: ({ apiKey, agentId }) => {
      const cfg = loadConfig();
      cfg.hub.apiKey = apiKey;
      if (agentId) cfg.hub.agentId = agentId;
      saveConfig(cfg);
    }
  });
}

lifecycle.initLifecycle(server, wss, PORT);

initAgentHub(cfg);

server.listen(PORT, () => {
  console.log(`\n╔══════════════════════════════════╗`);
  console.log(`║   SyncGuard running on :${PORT}    ║`);
  console.log(`║   Open: http://localhost:${PORT}   ║`);
  console.log(`║   PID: ${process.pid}`.padEnd(37) + '║');
  console.log(`╚══════════════════════════════════╝`);
  console.log(`\nTekan Ctrl+C atau jalankan stop.bat untuk keluar.\n`);
});
