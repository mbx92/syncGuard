const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');

const { encryptPassword, decryptPassword } = require('./postgres-util');

const MINIO_ALIAS = 'syncguard';

function sanitizeObjectKeyPart(value) {
  return String(value || 'backup')
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '') || 'backup';
}

function formatMinioObjectKey(minioConfig, jobName, fileName = null) {
  const prefix = String(minioConfig.prefix || '').replace(/^\/+|\/+$/g, '');
  const safeJobName = sanitizeObjectKeyPart(jobName);
  const parts = [prefix, safeJobName, fileName].filter(Boolean);
  return parts.join('/');
}

function formatMinioDestination(minioConfig, jobName, fileName = null) {
  const bucket = String(minioConfig.bucket || '').trim();
  const objectKey = formatMinioObjectKey(minioConfig, jobName, fileName);
  return `${MINIO_ALIAS}/${bucket}/${objectKey}`;
}

function fileExists(filePath) {
  try {
    return fs.existsSync(filePath) && fs.statSync(filePath).isFile();
  } catch {
    return false;
  }
}

function getPathEntries() {
  return String(process.env.PATH || '')
    .split(path.delimiter)
    .map((e) => e.trim())
    .filter(Boolean);
}

function findInPath(name) {
  const matches = [];
  const candidates = process.platform === 'win32' ? [name, `${name}.exe`] : [name];
  getPathEntries().forEach((dir) => {
    candidates.forEach((c) => {
      const full = path.join(dir, c);
      if (fileExists(full)) matches.push(full);
    });
  });
  return [...new Set(matches)];
}

function resolveMcPath(mcPath) {
  const configured = String(mcPath || '').trim();
  if (!configured || configured === 'mc') {
    const found = findInPath('mc');
    return found[0] || 'mc';
  }
  if (path.isAbsolute(configured) || /[\\/]/.test(configured)) {
    if (fileExists(configured)) return configured;
    if (process.platform === 'win32' && !configured.endsWith('.exe') && fileExists(`${configured}.exe`)) {
      return `${configured}.exe`;
    }
    return configured;
  }
  const found = findInPath(configured);
  return found[0] || configured;
}

function getEffectiveMcPath(settings) {
  return resolveMcPath(settings?.mcPath);
}

function sanitizeMinioForClient(minio) {
  if (!minio) return null;
  const { secretKeyEncrypted, ...rest } = minio;
  return { ...rest, secretKeySet: !!secretKeyEncrypted };
}

const encryptSecretKey = encryptPassword;
const decryptSecretKey = decryptPassword;

function encodeMcHostCredential(value) {
  // MC_HOST uses userinfo URL (user:pass@host). Only encode chars that break parsing.
  // Do NOT use encodeURIComponent — it encodes '=' and breaks S3 signing for many providers.
  return String(value || '')
    .replace(/%/g, '%25')
    .replace(/@/g, '%40')
    .replace(/:/g, '%3A');
}

function buildMinioEnv(minioConfig) {
  const env = { ...process.env };
  const secretKey = decryptSecretKey(minioConfig.secretKeyEncrypted || '');
  const endpoint = String(minioConfig.endpoint || '').trim().replace(/\/$/, '');
  if (endpoint && minioConfig.accessKey && secretKey) {
    let proto = 'https';
    let hostPart = endpoint;
    if (endpoint.startsWith('https://')) { proto = 'https'; hostPart = endpoint.slice(8); }
    else if (endpoint.startsWith('http://')) { proto = 'http'; hostPart = endpoint.slice(7); }
    env[`MC_HOST_${MINIO_ALIAS}`] =
      `${proto}://${encodeMcHostCredential(minioConfig.accessKey)}:${encodeMcHostCredential(secretKey)}@${hostPart}`;
  }
  env.MC_DISABLE_UPDATE = 'true';
  return env;
}

function buildMirrorArgs(minioConfig, localPath, jobName) {
  const dest = `${formatMinioDestination(minioConfig, jobName)}/`;
  return ['mirror', '--overwrite', '--remove', localPath, dest];
}

function buildUploadArgs(minioConfig, localFile, jobName) {
  const fileName = path.basename(localFile);
  const dest = formatMinioDestination(minioConfig, jobName, fileName);
  return ['cp', localFile, dest];
}

function buildMirrorContext(minioConfig, settings, localPath, jobName) {
  return {
    executable: getEffectiveMcPath(settings),
    args: buildMirrorArgs(minioConfig, localPath, jobName),
    env: buildMinioEnv(minioConfig)
  };
}

function buildUploadContext(minioConfig, settings, localFile, jobName) {
  return {
    executable: getEffectiveMcPath(settings),
    args: buildUploadArgs(minioConfig, localFile, jobName),
    env: buildMinioEnv(minioConfig)
  };
}

function testMcBinary(mcPath) {
  return new Promise((resolve) => {
    const resolved = resolveMcPath(mcPath);
    execFile(resolved, ['--version'], { windowsHide: true, timeout: 10000 }, (err, stdout, stderr) => {
      if (err) {
        if (err.code === 'ENOENT') {
          resolve({
            ok: false,
            error: `MinIO Client (mc) tidak ditemukan di "${resolved}". Download dari https://dl.min.io/client/mc/release/ lalu isi mc Path di Settings.`
          });
          return;
        }
        resolve({ ok: false, error: (stderr || err.message || '').trim() || 'mc tidak dapat dijalankan' });
        return;
      }
      resolve({ ok: true, version: (stdout || stderr || '').split('\n')[0].trim() });
    });
  });
}

async function testMinioConnection(minioConfig, settings) {
  const mcPath = getEffectiveMcPath(settings);
  const binary = await testMcBinary(mcPath);
  if (!binary.ok) return binary;

  const bucket = String(minioConfig.bucket || '').trim();
  if (!bucket) return { ok: false, error: 'Bucket name wajib diisi' };
  if (!minioConfig.endpoint) return { ok: false, error: 'Endpoint MinIO wajib diisi' };
  if (!minioConfig.accessKey) return { ok: false, error: 'Access Key wajib diisi' };
  if (!minioConfig.secretKeyEncrypted) return { ok: false, error: 'Secret Key wajib diisi' };

  return new Promise((resolve) => {
    const env = buildMinioEnv(minioConfig);
    // Test with ls on the bucket
    execFile(
      mcPath,
      ['ls', `${MINIO_ALIAS}/${bucket}`, '--no-color'],
      { env, windowsHide: true, timeout: 20000 },
      (err, stdout, stderr) => {
        if (err) {
          const msg = (stderr || err.message || '').trim();
          resolve({ ok: false, error: msg || 'Koneksi ke MinIO gagal. Periksa endpoint, bucket, dan kredensial.' });
          return;
        }
        resolve({ ok: true, version: binary.version, output: (stdout || '').trim().split('\n').slice(0, 3).join('\n') });
      }
    );
  });
}

function parseMcOutput(line) {
  // mc mirror progress: "X KiB / Y MiB ┃██████████┃ Z% Z.Z KiB/s"
  const pctMatch = line.match(/(\d+)%/);
  if (pctMatch) {
    const info = { progress: parseInt(pctMatch[1]) };
    const speedMatch = line.match(/([\d.]+\s*(?:[KMGT]i?B\/s|B\/s))/i);
    if (speedMatch) info.speed = speedMatch[1].trim();
    return info;
  }
  return null;
}

module.exports = {
  MINIO_ALIAS,
  encryptSecretKey,
  decryptSecretKey,
  sanitizeMinioForClient,
  sanitizeObjectKeyPart,
  formatMinioObjectKey,
  formatMinioDestination,
  resolveMcPath,
  getEffectiveMcPath,
  buildMinioEnv,
  buildMirrorContext,
  buildUploadContext,
  testMcBinary,
  testMinioConnection,
  parseMcOutput
};
