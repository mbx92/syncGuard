const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');

const PROJECT_ROOT = path.join(__dirname, '..');
const SECRET_FILE = path.join(PROJECT_ROOT, 'config', 'syncguard.secret');
const DUMPS_ROOT = path.join(PROJECT_ROOT, 'data', 'db-dumps');
const WINDOWS_POSTGRES_ROOT = 'C:\\Program Files\\PostgreSQL';

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function getSecretKey() {
  ensureDir(path.dirname(SECRET_FILE));
  if (fs.existsSync(SECRET_FILE)) {
    return Buffer.from(fs.readFileSync(SECRET_FILE, 'utf8').trim(), 'hex');
  }
  const secret = crypto.randomBytes(32);
  fs.writeFileSync(SECRET_FILE, secret.toString('hex'), 'utf8');
  return secret;
}

function encryptPassword(value) {
  if (!value) return '';
  const iv = crypto.randomBytes(12);
  const key = getSecretKey();
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv.toString('hex'), tag.toString('hex'), encrypted.toString('hex')].join('.');
}

function decryptPassword(value) {
  if (!value) return '';
  const [ivHex, tagHex, dataHex] = String(value).split('.');
  if (!ivHex || !tagHex || !dataHex) return '';
  const decipher = crypto.createDecipheriv('aes-256-gcm', getSecretKey(), Buffer.from(ivHex, 'hex'));
  decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(dataHex, 'hex')),
    decipher.final()
  ]);
  return decrypted.toString('utf8');
}

function sanitizePostgresForClient(postgres) {
  if (!postgres) return null;
  const { passwordEncrypted, ...rest } = postgres;
  return { ...rest, passwordSet: !!passwordEncrypted };
}

function sanitizeJobForClient(job) {
  if (!job) return job;
  if ((job.jobType || 'filesystem') !== 'postgresql') return job;
  return {
    ...job,
    postgres: sanitizePostgresForClient(job.postgres)
  };
}

function normalizeDumpFormat(format) {
  const value = String(format || '').trim().toLowerCase();
  return value === 'plain' ? 'plain' : 'custom';
}

function getDumpFileExtension(format) {
  return normalizeDumpFormat(format) === 'plain' ? 'sql' : 'dump';
}

function getConfiguredPgDumpPath(job, settings) {
  return (
    job?.postgres?.pgDumpPath?.trim() ||
    settings?.pgDumpPath?.trim() ||
    'pg_dump'
  );
}

function getPathEntries() {
  return String(process.env.PATH || '')
    .split(path.delimiter)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function fileExists(filePath) {
  try {
    return fs.existsSync(filePath) && fs.statSync(filePath).isFile();
  } catch {
    return false;
  }
}

function expandExecutableCandidates(rawPath) {
  const value = String(rawPath || '').trim();
  if (!value) return [];

  const candidates = [value];
  if (process.platform === 'win32' && !/\.exe$/i.test(value)) {
    candidates.push(`${value}.exe`);
  }
  return [...new Set(candidates)];
}

function findInPath(commandName) {
  const matches = [];
  getPathEntries().forEach((entry) => {
    expandExecutableCandidates(path.join(entry, commandName)).forEach((candidate) => {
      if (fileExists(candidate)) {
        matches.push(candidate);
      }
    });
  });
  return [...new Set(matches)];
}

function findWindowsInstalledPgDump() {
  if (process.platform !== 'win32' || !fs.existsSync(WINDOWS_POSTGRES_ROOT)) {
    return [];
  }

  const matches = [];
  fs.readdirSync(WINDOWS_POSTGRES_ROOT, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .sort((a, b) => b.name.localeCompare(a.name, undefined, { numeric: true, sensitivity: 'base' }))
    .forEach((entry) => {
      const versionDir = path.join(WINDOWS_POSTGRES_ROOT, entry.name);
      const binCandidate = path.join(versionDir, 'bin', 'pg_dump.exe');
      const runtimeCandidate = path.join(versionDir, 'pgAdmin 4', 'runtime', 'pg_dump.exe');
      if (fileExists(binCandidate)) matches.push(binCandidate);
      if (fileExists(runtimeCandidate)) matches.push(runtimeCandidate);
    });

  return [...new Set(matches)];
}

function resolvePgDumpPath(job, settings) {
  const configured = getConfiguredPgDumpPath(job, settings);
  const normalized = configured.trim();
  const hasPathSeparator = /[\\/]/.test(normalized);
  const isAbsolute = path.isAbsolute(normalized);

  if (hasPathSeparator || isAbsolute) {
    const directMatch = expandExecutableCandidates(normalized).find(fileExists);
    return directMatch || normalized;
  }

  const pathMatch = findInPath(normalized)[0];
  if (pathMatch) return pathMatch;

  const windowsMatch = findWindowsInstalledPgDump()[0];
  if (windowsMatch) return windowsMatch;

  return normalized || 'pg_dump';
}

function formatPgDumpNotFoundMessage(pgDumpPath) {
  const configured = String(pgDumpPath || 'pg_dump').trim() || 'pg_dump';
  const hints = [];

  if (process.platform === 'win32') {
    const detected = findWindowsInstalledPgDump();
    if (detected.length > 0) {
      hints.push(`Isi Pg Dump Path dengan: ${detected[0]}`);
    } else {
      hints.push('Install PostgreSQL client tools atau isi Pg Dump Path dengan lokasi pg_dump.exe');
    }
  } else {
    hints.push('Pastikan pg_dump tersedia di PATH atau isi Pg Dump Path dengan path absolut binary');
  }

  return `pg_dump tidak ditemukan (${configured}). ${hints.join('. ')}`;
}

function testPgDumpBinary(pgDumpPath) {
  return new Promise((resolve) => {
    execFile(pgDumpPath || 'pg_dump', ['--version'], { windowsHide: true, timeout: 15000 }, (err, stdout, stderr) => {
      if (err) {
        if (err.code === 'ENOENT') {
          resolve({
            ok: false,
            error: formatPgDumpNotFoundMessage(pgDumpPath)
          });
          return;
        }
        resolve({
          ok: false,
          error: (stderr || err.message || '').trim() || 'pg_dump tidak dapat dijalankan'
        });
        return;
      }
      resolve({
        ok: true,
        version: (stdout || stderr || '').split('\n')[0].trim()
      });
    });
  });
}

function buildConnectionArgs(postgres) {
  const args = [
    '--no-password',
    '-h', postgres.host,
    '-p', String(postgres.port || 5432),
    '-U', postgres.username,
    '-d', postgres.database
  ];

  if (postgres.extraOptions) {
    args.push(...postgres.extraOptions.split(' ').filter(Boolean));
  }

  return args;
}

function buildDumpArgs(job, outputFile) {
  const postgres = job.postgres || {};
  const dumpFormat = normalizeDumpFormat(postgres.dumpFormat);
  const formatArgs = dumpFormat === 'plain'
    ? ['--format=plain']
    : ['--format=custom'];

  return [
    ...buildConnectionArgs(postgres),
    ...formatArgs,
    '--file', outputFile
  ];
}

function buildDumpEnv(job) {
  const env = { ...process.env };
  const password = decryptPassword(job.postgres?.passwordEncrypted || '');
  if (password) env.PGPASSWORD = password;
  return env;
}

function getJobDumpDir(jobId) {
  return path.join(DUMPS_ROOT, String(jobId));
}

function sanitizeFilePart(value) {
  return String(value || 'database').replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/-+/g, '-');
}

function formatTimestamp(date = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return [
    date.getUTCFullYear(),
    pad(date.getUTCMonth() + 1),
    pad(date.getUTCDate())
  ].join('') + '_' + [
    pad(date.getUTCHours()),
    pad(date.getUTCMinutes()),
    pad(date.getUTCSeconds())
  ].join('');
}

function createDumpContext(job, settings) {
  const dumpDir = getJobDumpDir(job.id);
  ensureDir(dumpDir);
  const extension = getDumpFileExtension(job.postgres?.dumpFormat);
  const fileName = `${sanitizeFilePart(job.postgres?.database)}_${formatTimestamp()}.${extension}`;
  const outputFile = path.join(dumpDir, fileName);
  return {
    executable: resolvePgDumpPath(job, settings),
    args: buildDumpArgs(job, outputFile),
    env: buildDumpEnv(job),
    dumpDir,
    outputFile,
    fileName,
    dumpFormat: normalizeDumpFormat(job.postgres?.dumpFormat)
  };
}

async function testPostgresConnection(job, settings) {
  const pgDumpPath = resolvePgDumpPath(job, settings);
  const binary = await testPgDumpBinary(pgDumpPath);
  if (!binary.ok) return binary;

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'syncguard-pgtest-'));
  const tempFile = path.join(tempDir, 'schema.sql');
  const args = [
    ...buildConnectionArgs(job.postgres || {}),
    '--schema-only',
    '--no-owner',
    '--no-privileges',
    '--file', tempFile
  ];

  return new Promise((resolve) => {
    execFile(pgDumpPath, args, { env: buildDumpEnv(job), windowsHide: true, timeout: 30000 }, (err, stdout, stderr) => {
      try {
        fs.rmSync(tempDir, { recursive: true, force: true });
      } catch {}
      if (err) {
        resolve({
          ok: false,
          error: (stderr || err.message || '').trim() || 'Koneksi PostgreSQL gagal'
        });
        return;
      }
      resolve({
        ok: true,
        output: (stdout || '').trim(),
        version: binary.version
      });
    });
  });
}

function cleanupOldDumps(job) {
  const retentionCount = Math.max(1, parseInt(job.postgres?.retentionCount, 10) || 3);
  const dumpDir = getJobDumpDir(job.id);
  if (!fs.existsSync(dumpDir)) return;
  const files = fs.readdirSync(dumpDir)
    .map((name) => {
      const filePath = path.join(dumpDir, name);
      return { name, filePath, stat: fs.statSync(filePath) };
    })
    .filter((entry) => entry.stat.isFile())
    .sort((a, b) => b.stat.mtimeMs - a.stat.mtimeMs);

  files.slice(retentionCount).forEach((entry) => {
    try {
      fs.unlinkSync(entry.filePath);
    } catch {}
  });
}

module.exports = {
  DUMPS_ROOT,
  encryptPassword,
  decryptPassword,
  formatPgDumpNotFoundMessage,
  getDumpFileExtension,
  normalizeDumpFormat,
  sanitizePostgresForClient,
  sanitizeJobForClient,
  resolvePgDumpPath,
  testPgDumpBinary,
  testPostgresConnection,
  createDumpContext,
  cleanupOldDumps,
  getJobDumpDir
};
