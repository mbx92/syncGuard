const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile, spawn } = require('child_process');

const { encryptPassword, decryptPassword } = require('./postgres-util');

const MINIO_ALIAS = 'syncguard';
const PROJECT_ROOT = path.join(__dirname, '..');
const BUNDLED_MC_REL = 'tools/mc/mc.exe';

function sanitizeObjectKeyPart(value) {
  let s = String(value || 'backup')
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (!s || s === '.' || s === '..') s = 'backup';
  return s;
}

/** Normalisasi path relatif (setiap folder/file) agar aman untuk MinIO/S3. */
function sanitizeRelativeObjectPath(relativePath) {
  const parts = String(relativePath || '').replace(/\\/g, '/').split('/').filter(Boolean);
  if (!parts.length) return '';
  return parts.map(sanitizeObjectKeyPart).join('/');
}

function formatMinioFileDestination(minioConfig, jobName, relativeObjectPath) {
  const bucket = String(minioConfig.bucket || '').trim();
  if (!bucket) {
    throw new Error('MinIO bucket wajib diisi. Settings → MinIO → isi Bucket Name lalu Save All Settings.');
  }
  const baseKey = formatMinioObjectKey(minioConfig, jobName);
  const rel = sanitizeRelativeObjectPath(relativeObjectPath);
  const fullKey = rel ? `${baseKey}/${rel}` : baseKey;
  return `${MINIO_ALIAS}/${bucket}/${fullKey.replace(/\/+/g, '/')}`;
}

function formatMinioObjectKey(minioConfig, jobName, fileName = null) {
  const prefix = String(minioConfig.prefix || '').replace(/^\/+|\/+$/g, '');
  const safeJobName = sanitizeObjectKeyPart(jobName);
  const parts = [prefix, safeJobName, fileName].filter(Boolean);
  return parts.join('/');
}

function formatMinioDestination(minioConfig, jobName, fileName = null) {
  const bucket = String(minioConfig.bucket || '').trim();
  if (!bucket) {
    throw new Error('MinIO bucket wajib diisi. Settings → MinIO → isi Bucket Name lalu Save All Settings.');
  }
  const objectKey = formatMinioObjectKey(minioConfig, jobName, fileName);
  return `${MINIO_ALIAS}/${bucket}/${objectKey}`;
}

function formatMinioUri(minioConfig, jobName, fileName = null) {
  const bucket = String(minioConfig.bucket || '').trim();
  const objectKey = formatMinioObjectKey(minioConfig, jobName, fileName);
  return `s3://${bucket}/${objectKey}`;
}

function describeMinioUploadLocation(minioConfig, jobName, fileName) {
  const bucket = String(minioConfig.bucket || '').trim();
  const objectKey = formatMinioObjectKey(minioConfig, jobName, fileName);
  if (bucket) {
    return {
      bucket,
      objectKey,
      uri: formatMinioUri(minioConfig, jobName, fileName),
      browseHint: `MinIO Console → bucket "${bucket}" → ${objectKey.split('/').slice(0, -1).join('/') || '(root)'}`
    };
  }
  const prefix = String(minioConfig.prefix || '').replace(/^\/+|\/+$/g, '');
  const safeJob = sanitizeObjectKeyPart(jobName);
  const likelyBucket = prefix || 'syncguard';
  const likelyObjectKey = prefix ? objectKey : `${safeJob}/${fileName}`;
  return {
    bucket: likelyBucket,
    objectKey: likelyObjectKey,
    uri: `s3://${likelyBucket}/${likelyObjectKey}`,
    browseHint: `MinIO Console → bucket "${likelyBucket}" → folder "${safeJob}"`,
    warning: 'Bucket Name kosong di Settings — isi Bucket Name lalu Save All Settings agar path konsisten.'
  };
}

/** Tujuan folder job di MinIO (tanpa nama file). */
function formatJobDestination(minioConfig, jobName) {
  const bucket = String(minioConfig?.bucket || '').trim();
  const objectKey = formatMinioObjectKey(minioConfig, jobName);
  const endpoint = String(minioConfig?.endpoint || '').trim();
  if (bucket) {
    return {
      uri: `s3://${bucket}/${objectKey}/`,
      bucket,
      objectPrefix: `${objectKey}/`,
      endpoint
    };
  }
  const loc = describeMinioUploadLocation(minioConfig, jobName, 'backup.sql');
  const folderUri = loc.uri.replace(/\/[^/]+$/, '/');
  return {
    uri: folderUri,
    bucket: loc.bucket,
    objectPrefix: `${loc.objectKey.replace(/\/[^/]+$/, '')}/`,
    endpoint,
    warning: loc.warning
  };
}

function validateMinioConfig(minioConfig) {
  const bucket = String(minioConfig?.bucket || '').trim();
  const endpoint = String(minioConfig?.endpoint || '').trim();
  const accessKey = String(minioConfig?.accessKey || '').trim();
  if (!endpoint) {
    return { ok: false, error: 'MinIO endpoint belum dikonfigurasi. Settings → MinIO → isi Endpoint lalu Save All Settings.' };
  }
  if (!bucket) {
    return { ok: false, error: 'MinIO bucket wajib diisi. Settings → MinIO → isi Bucket Name lalu Save All Settings.' };
  }
  if (!accessKey) {
    return { ok: false, error: 'MinIO Access Key belum dikonfigurasi. Save All Settings setelah mengisi form MinIO.' };
  }
  if (!minioConfig?.secretKeyEncrypted) {
    return { ok: false, error: 'MinIO Secret Key belum dikonfigurasi. Save All Settings setelah mengisi Secret Key.' };
  }
  return { ok: true };
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

function getBundledMcPath() {
  return path.join(PROJECT_ROOT, 'tools', 'mc', 'mc.exe');
}

function getDefaultMcPathRelative() {
  return BUNDLED_MC_REL;
}

function isBundledMcInstalled() {
  return fileExists(getBundledMcPath());
}

function installBundledMc() {
  const dest = getBundledMcPath();
  const destDir = path.dirname(dest);

  if (fileExists(dest)) {
    return Promise.resolve({
      ok: true,
      path: getDefaultMcPathRelative(),
      absolute: dest,
      existed: true
    });
  }

  const sources = [
    path.join(PROJECT_ROOT, 'mc.exe'),
    path.join(PROJECT_ROOT, 'tools', 'mc', 'mc.exe')
  ];
  if (process.platform === 'win32') {
    sources.push(
      'C:\\mc\\mc.exe',
      'C:\\Program Files\\MinIO Client\\mc.exe',
      path.join(process.env.LOCALAPPDATA || '', 'Programs', 'mc', 'mc.exe')
    );
  }

  const src = sources.find((p) => p !== dest && fileExists(p));
  if (!src) {
    return Promise.resolve({
      ok: false,
      error: 'mc.exe tidak ditemukan. Letakkan mc.exe di folder root project atau download dari https://dl.min.io/client/mc/release/windows-amd64/mc.exe lalu jalankan install-mc.bat'
    });
  }

  return new Promise((resolve) => {
    try {
      fs.mkdirSync(destDir, { recursive: true });
      fs.copyFileSync(src, dest);
      resolve({
        ok: true,
        path: getDefaultMcPathRelative(),
        absolute: dest,
        source: src
      });
    } catch (e) {
      resolve({ ok: false, error: `Gagal menyalin mc.exe ke tools/mc: ${e.message}` });
    }
  });
}

function resolveMcPath(mcPath) {
  const configured = String(mcPath || '').trim();

  if (configured && configured.toLowerCase() !== 'mc') {
    if (path.isAbsolute(configured)) {
      if (fileExists(configured)) return configured;
      if (process.platform === 'win32' && !configured.endsWith('.exe') && fileExists(`${configured}.exe`)) {
        return `${configured}.exe`;
      }
      return configured;
    }
    if (/[\\/]/.test(configured)) {
      const rel = path.join(PROJECT_ROOT, configured.replace(/\//g, path.sep));
      if (fileExists(rel)) return rel;
      if (fileExists(configured)) return configured;
      return rel;
    }
    const found = findInPath(configured);
    return found[0] || configured;
  }

  const bundled = getBundledMcPath();
  if (fileExists(bundled)) return bundled;

  const rootMc = path.join(PROJECT_ROOT, 'mc.exe');
  if (fileExists(rootMc)) return rootMc;

  const found = findInPath('mc');
  if (found[0]) return found[0];

  return process.platform === 'win32' ? getDefaultMcPathRelative() : 'mc';
}

function getEffectiveMcPath(settings) {
  return resolveMcExecutable(settings?.mcPath);
}

/** Path absolut ke binary mc — hindari hang ENOENT saat cwd berbeda. */
function resolveMcExecutable(mcPathOrSettings) {
  const configured = typeof mcPathOrSettings === 'object'
    ? mcPathOrSettings?.mcPath
    : mcPathOrSettings;
  const resolved = resolveMcPath(configured);
  if (path.isAbsolute(resolved) && fileExists(resolved)) return resolved;
  if (/[\\/]/.test(resolved)) {
    const fromRoot = path.join(PROJECT_ROOT, resolved.replace(/\//g, path.sep));
    if (fileExists(fromRoot)) return fromRoot;
  }
  return resolved;
}

function formatFileSize(bytes) {
  if (!bytes || bytes < 1024) return `${bytes || 0} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GiB`;
}

function killMcProcess(proc) {
  if (!proc?.pid) return;
  try {
    if (process.platform === 'win32') {
      spawn('taskkill', ['/F', '/T', '/PID', String(proc.pid)], { windowsHide: true, stdio: 'ignore' });
    } else {
      proc.kill('SIGKILL');
    }
  } catch {
    /* ignore */
  }
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

/** IP LAN / localhost tanpa skema → http (MinIO lokal jarang pakai TLS). */
function isPrivateOrLocalHost(host) {
  const h = String(host || '').split(':')[0].replace(/^\[|\]$/g, '').toLowerCase();
  if (!h || h === 'localhost' || h === '127.0.0.1' || h === '::1') return true;
  if (/^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(h)) return true;
  if (/^192\.168\.\d{1,3}\.\d{1,3}$/.test(h)) return true;
  const m172 = h.match(/^172\.(\d{1,3})\.\d{1,3}\.\d{1,3}$/);
  if (m172) {
    const second = parseInt(m172[1], 10);
    if (second >= 16 && second <= 31) return true;
  }
  return false;
}

function normalizeMinioEndpoint(endpoint) {
  let e = String(endpoint || '').trim().replace(/\/+$/, '');
  if (!e) return e;
  if (/^https?:\/\//i.test(e)) return e;
  const hostPart = e.split('/')[0];
  const proto = isPrivateOrLocalHost(hostPart) ? 'http' : 'https';
  return `${proto}://${e}`;
}

function parseMcStatTextSize(stdout) {
  const m = String(stdout).match(/Size\s*:\s*([\d.]+)\s*([KMGTP]?i?B)/i);
  if (!m) return null;
  const n = parseFloat(m[1]);
  const unit = m[2].toUpperCase().replace(/IB$/, 'IB');
  const map = { B: 1, KIB: 1024, MIB: 1024 ** 2, GIB: 1024 ** 3, TIB: 1024 ** 4 };
  const mult = map[unit] || map.B;
  return Math.round(n * mult);
}

function parseSizeToken(token) {
  const m = String(token || '').trim().match(/^([\d.]+)\s*([KMGTP]?i?B)$/i);
  if (!m) return null;
  const n = parseFloat(m[1]);
  const u = m[2].toUpperCase();
  const mult = {
    B: 1, KIB: 1024, MIB: 1024 ** 2, GIB: 1024 ** 3, TIB: 1024 ** 4,
    KB: 1000, MB: 1e6, GB: 1e9, TB: 1e12
  };
  if (mult[u] != null) return Math.round(n * mult[u]);
  if (u.endsWith('IB')) return Math.round(n * (mult[u] || 1));
  return Math.round(n);
}

function normalizeRemoteObjectKey(key, objectPrefix) {
  let k = String(key || '').replace(/\\/g, '/').replace(/^\/+/, '');
  const p = String(objectPrefix || '').replace(/^\/+|\/+$/g, '');
  if (!p) return k;
  if (k === p) return '';
  if (k.startsWith(`${p}/`)) return k.slice(p.length + 1);
  return k;
}

function ingestMcLsJsonLine(line, objectPrefix, index) {
  const row = JSON.parse(line);
  if (row.type && row.type !== 'file') return;
  const rawKey = row.key || row.name || '';
  const rel = normalizeRemoteObjectKey(rawKey, objectPrefix);
  if (!rel) return;
  const size = Number(row.size);
  index.set(rel, Number.isFinite(size) ? size : null);
}

function ingestMcLsTextLine(line, objectPrefix, index) {
  const m = line.match(/\]\s+([\d.]+\s*[KMGTP]?i?B)\s+(.+)$/i);
  if (!m) return;
  const rel = normalizeRemoteObjectKey(m[2].trim(), objectPrefix);
  if (!rel) return;
  index.set(rel, parseSizeToken(m[1]));
}

/** Satu kali mc ls --recursive untuk indeks remote (ganti mc stat per file). */
function listMinioPrefixIndex(mcPath, env, minioConfig, jobName) {
  const bucket = String(minioConfig.bucket || '').trim();
  const objectPrefix = formatMinioObjectKey(minioConfig, jobName);
  const listTarget = `${MINIO_ALIAS}/${bucket}/${objectPrefix}/`;

  return new Promise((resolve) => {
    const executable = resolveMcExecutable(mcPath);
    execFile(
      executable,
      ['ls', '--recursive', '--json', listTarget],
      { env, windowsHide: true, timeout: 300000, maxBuffer: 64 * 1024 * 1024 },
      (err, stdout, stderr) => {
        const index = new Map();
        const out = String(stdout || '').trim();
        if (out) {
          out.split('\n').forEach((line) => {
            const t = line.trim();
            if (!t) return;
            try {
              ingestMcLsJsonLine(t, objectPrefix, index);
            } catch {
              ingestMcLsTextLine(t, objectPrefix, index);
            }
          });
        }
        if (index.size === 0 && out) {
          out.split('\n').forEach((line) => ingestMcLsTextLine(line, objectPrefix, index));
        }
        resolve({
          index,
          listTarget,
          error: err && index.size === 0 ? (stderr || err.message || '').trim() : null
        });
      }
    );
  });
}

async function runConcurrent(tasks, concurrency, worker, isCancelled) {
  const results = new Array(tasks.length);
  let nextIdx = 0;
  let active = 0;
  let cancelled = false;

  return new Promise((resolve, reject) => {
    const pump = () => {
      if (cancelled || isCancelled?.()) {
        cancelled = true;
        if (active === 0) resolve({ results, cancelled: true });
        return;
      }
      while (active < concurrency && nextIdx < tasks.length) {
        const taskIndex = nextIdx++;
        active++;
        Promise.resolve(worker(tasks[taskIndex], taskIndex))
          .then((result) => {
            results[taskIndex] = result;
            active--;
            if (nextIdx >= tasks.length && active === 0) {
              resolve({ results, cancelled });
            } else {
              pump();
            }
          })
          .catch(reject);
      }
    };
    if (!tasks.length) resolve({ results, cancelled: false });
    else pump();
  });
}

function statMinioObject(mcPath, env, destMcPath) {
  return new Promise((resolve) => {
    const executable = resolveMcExecutable(mcPath);
    execFile(
      executable,
      ['stat', destMcPath, '--json'],
      { env, windowsHide: true, timeout: 60000 },
      (err, stdout, stderr) => {
        if (err) {
          const msg = (stderr || err.message || '').trim();
          if (/not found|does not exist|no such/i.test(msg)) {
            resolve({ exists: false });
            return;
          }
          execFile(
            executable,
            ['stat', destMcPath, '--no-color'],
            { env, windowsHide: true, timeout: 60000 },
            (err2, stdout2) => {
              if (err2) {
                resolve({ exists: false });
                return;
              }
              resolve({ exists: true, size: parseMcStatTextSize(stdout2) });
            }
          );
          return;
        }
        try {
          const data = JSON.parse(stdout);
          const size = Number(data.size ?? data.metadata?.size ?? 0);
          resolve({
            exists: true,
            size: Number.isFinite(size) && size >= 0 ? size : parseMcStatTextSize(stdout)
          });
        } catch {
          resolve({ exists: true, size: parseMcStatTextSize(stdout) });
        }
      }
    );
  });
}

function buildMinioEnv(minioConfig) {
  const env = { ...process.env };
  const secretKey = decryptSecretKey(minioConfig.secretKeyEncrypted || '');
  const endpoint = normalizeMinioEndpoint(minioConfig.endpoint || '');
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
  const fileName = sanitizeObjectKeyPart(path.basename(localFile));
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
    const resolved = resolveMcExecutable(mcPath);
    execFile(resolved, ['--version'], { windowsHide: true, timeout: 10000 }, (err, stdout, stderr) => {
      if (err) {
        if (err.code === 'ENOENT') {
          resolve({
            ok: false,
            error: `MinIO Client (mc) tidak ditemukan di "${resolved}". Jalankan install-mc.bat atau set mc Path ke tools/mc/mc.exe di Settings.`
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
  const configCheck = validateMinioConfig(minioConfig);
  if (!configCheck.ok) return configCheck;

  const mcPath = getEffectiveMcPath(settings);
  const binary = await testMcBinary(mcPath);
  if (!binary.ok) return binary;

  const bucket = String(minioConfig.bucket || '').trim();

  return new Promise((resolve) => {
    const env = buildMinioEnv(minioConfig);
    execFile(
      resolveMcExecutable(mcPath),
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

function verifyMinioObject(minioConfig, settings, jobName, fileName) {
  return new Promise((resolve) => {
    const mcPath = getEffectiveMcPath(settings);
    let dest;
    try {
      dest = formatMinioDestination(minioConfig, jobName, fileName);
    } catch (e) {
      resolve({ ok: false, error: e.message });
      return;
    }
    execFile(
      mcPath,
      ['stat', dest, '--no-color'],
      { env: buildMinioEnv(minioConfig), windowsHide: true, timeout: 20000 },
      (err, stdout, stderr) => {
        if (err) {
          const uri = formatMinioUri(minioConfig, jobName, fileName);
          const msg = (stderr || err.message || '').trim();
          resolve({
            ok: false,
            error: msg || `Object tidak ditemukan setelah upload (${uri}). Periksa bucket dan prefix di Settings → MinIO.`
          });
          return;
        }
        resolve({ ok: true, output: (stdout || '').trim(), uri: formatMinioUri(minioConfig, jobName, fileName) });
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

function walkLocalFiles(rootDir) {
  const files = [];
  const root = path.resolve(rootDir);

  function walk(current, relParts) {
    let entries;
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch (e) {
      return;
    }
    for (const ent of entries) {
      const nextParts = [...relParts, ent.name];
      const full = path.join(current, ent.name);
      if (ent.isDirectory()) {
        walk(full, nextParts);
      } else if (ent.isFile()) {
        files.push({
          absolute: full,
          relative: nextParts.join('/')
        });
      }
    }
  }

  walk(root, []);
  return files;
}

function buildUniqueSanitizedPaths(files) {
  const used = new Map();
  return files.map((file) => {
    const original = file.relative.replace(/\\/g, '/');
    let objectKey = sanitizeRelativeObjectPath(original);
    if (!objectKey) {
      objectKey = sanitizeObjectKeyPart(path.basename(file.absolute));
    }
    if (used.has(objectKey)) {
      const n = used.get(objectKey) + 1;
      used.set(objectKey, n);
      const ext = path.extname(objectKey);
      const base = ext ? objectKey.slice(0, -ext.length) : objectKey;
      objectKey = `${base}-${n}${ext}`;
    } else {
      used.set(objectKey, 1);
    }
    return {
      ...file,
      objectKey,
      renamed: objectKey !== original
    };
  });
}

function mcCp(mcPath, env, localFile, destMcPath, hooks = {}) {
  const executable = resolveMcExecutable(mcPath);
  const timeoutMs = hooks.timeoutMs || 30 * 60 * 1000;

  return new Promise((resolve) => {
    const args = ['cp', localFile, destMcPath, '--no-color'];
    let proc;
    try {
      proc = spawn(executable, args, { env, windowsHide: true });
    } catch (e) {
      resolve({ ok: false, error: e.message });
      return;
    }

    hooks.registerProc?.(proc);

    let stdout = '';
    let stderr = '';
    let settled = false;
    let lastOutputAt = Date.now();

    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(hardTimer);
      clearInterval(stallTimer);
      resolve(result);
    };

    const hardTimer = setTimeout(() => {
      killMcProcess(proc);
      finish({
        ok: false,
        error: `mc cp timeout (${Math.round(timeoutMs / 60000)} menit). Cek endpoint MinIO (port API, bukan Console) dan ukuran file.`
      });
    }, timeoutMs);

    const stallTimer = setInterval(() => {
      if (settled) return;
      if (Date.now() - lastOutputAt > 120000) {
        hooks.onLine?.('Menunggu mc cp… (file besar atau koneksi lambat)');
        lastOutputAt = Date.now();
      }
    }, 30000);

    const handleLine = (line, isErr) => {
      const t = line.trim();
      if (!t) return;
      lastOutputAt = Date.now();
      if (isErr) stderr += `${t}\n`;
      else stdout += `${t}\n`;
      hooks.onLine?.(isErr ? `ERR: ${t}` : t);
    };

    proc.stdout.on('data', (data) => {
      data.toString().split('\n').forEach((line) => handleLine(line, false));
    });
    proc.stderr.on('data', (data) => {
      data.toString().split('\n').forEach((line) => handleLine(line, true));
    });
    proc.on('error', (err) => {
      finish({ ok: false, error: err.code === 'ENOENT'
        ? `mc tidak ditemukan: ${executable}`
        : err.message });
    });
    proc.on('close', (code) => {
      if (code === 0) {
        finish({ ok: true, stdout: stdout.trim() });
        return;
      }
      const msg = (stderr || stdout || `mc cp exit ${code}`).trim();
      finish({ ok: false, error: msg });
    });
  });
}

/**
 * Upload folder ke MinIO dengan normalisasi nama path (ganti mc mirror langsung).
 * Karakter tidak didukung MinIO (#, spasi aneh, dll.) diganti per segmen path.
 */
async function runSanitizedMinioMirror(minioConfig, settings, localPath, jobName, hooks = {}) {
  const { onLog, onProgress, isCancelled } = hooks;
  const log = (msg) => onLog?.(msg);

  const root = path.resolve(localPath);
  if (!fs.existsSync(root)) {
    return { success: false, error: `Folder sumber tidak ditemukan: ${root}` };
  }
  if (!fs.statSync(root).isDirectory()) {
    return { success: false, error: `Bukan folder: ${root}` };
  }

  const mcPath = getEffectiveMcPath(settings);
  const env = buildMinioEnv(minioConfig);
  const binary = await testMcBinary(mcPath);
  if (!binary.ok) return { success: false, error: binary.error };

  const files = walkLocalFiles(root);
  if (!files.length) {
    log('Folder sumber kosong — tidak ada file untuk di-upload.');
    return { success: true, message: 'folder kosong', uploaded: 0 };
  }

  const mapped = buildUniqueSanitizedPaths(files).map((item) => {
    let fileSize = 0;
    try {
      fileSize = fs.statSync(item.absolute).size;
    } catch {
      /* ignore */
    }
    return { ...item, fileSize };
  });
  const renamedCount = mapped.filter((f) => f.renamed).length;
  const destPreview = formatJobDestination(minioConfig, jobName).uri;
  const uploadConcurrency = Math.max(1, Math.min(8, hooks.uploadConcurrency || 4));

  log(`MinIO sync: ${mapped.length} file — incremental + upload paralel (×${uploadConcurrency})`);
  log(`Tujuan: ${destPreview}`);
  const endpointNorm = normalizeMinioEndpoint(minioConfig.endpoint || '');
  if (endpointNorm && endpointNorm !== String(minioConfig.endpoint || '').trim()) {
    log(`Endpoint dinormalisasi: ${endpointNorm}`);
  }
  if (renamedCount > 0) {
    log(`${renamedCount} path dinormalisasi (karakter tidak didukung MinIO diganti)`);
  }

  log('Memuat indeks object MinIO (sekali)…');
  const remoteList = await listMinioPrefixIndex(mcPath, env, minioConfig, jobName);
  if (remoteList.error) {
    log(`Catatan indeks remote: ${remoteList.error} — akan upload tanpa skip`);
  } else {
    log(`Indeks remote: ${remoteList.index.size} object di ${remoteList.listTarget}`);
  }

  const toUpload = [];
  let skipped = 0;
  let planFailed = 0;
  let lastError = '';
  const activeProcs = new Set();

  for (const item of mapped) {
    let dest;
    try {
      dest = formatMinioFileDestination(minioConfig, jobName, item.objectKey);
    } catch (e) {
      planFailed++;
      lastError = e.message;
      log(`ERR: ${item.relative}: ${e.message}`);
      continue;
    }

    const remoteSize = remoteList.index.get(item.objectKey);
    if (remoteSize != null && remoteSize === item.fileSize) {
      skipped++;
      continue;
    }

    toUpload.push({ ...item, dest, changed: remoteSize != null && remoteSize !== item.fileSize });
  }

  if (skipped > 0) {
    log(`⊘ ${skipped} file dilewati (sudah ada, ukuran sama)`);
  }
  if (!toUpload.length) {
    if (planFailed > 0) {
      return {
        success: false,
        error: lastError,
        message: lastError,
        uploaded: 0,
        skipped,
        failed: planFailed
      };
    }
    log('Semua file sudah ada di MinIO — tidak ada upload.');
    return {
      success: true,
      message: `${skipped} file sudah ada (tidak ada perubahan)`,
      uploaded: 0,
      skipped,
      renamed: renamedCount
    };
  }

  log(`Upload ${toUpload.length} file…`);

  const poolResult = await runConcurrent(
    toUpload,
    uploadConcurrency,
    async (item, idx) => {
      if (isCancelled?.()) return { ok: false, cancelled: true, item };

      log(`[${idx + 1}/${toUpload.length}] ${item.relative} (${formatFileSize(item.fileSize)})${item.changed ? ' ↻ diubah' : ''}`);

      let procRef = null;
      const result = await mcCp(mcPath, env, item.absolute, item.dest, {
        registerProc: (proc) => {
          procRef = proc;
          activeProcs.add(proc);
          hooks.registerProc?.(proc);
        },
        onLine: (line) => {
          if (/ERR:|error|failed/i.test(line)) log(`  ${line}`);
        },
        timeoutMs: hooks.timeoutMsPerFile
      });
      if (procRef) activeProcs.delete(procRef);

      onProgress?.({
        progress: Math.min(99, Math.round(((idx + 1) / toUpload.length) * 100)),
        uploaded: idx + 1,
        total: toUpload.length,
        current: item.objectKey
      });

      return { ...result, item };
    },
    () => {
      if (isCancelled?.()) {
        activeProcs.forEach(killMcProcess);
        activeProcs.clear();
        return true;
      }
      return false;
    }
  );

  if (poolResult.cancelled || isCancelled?.()) {
    return { success: false, error: 'Backup dibatalkan', cancelled: true, uploaded: 0, skipped, failed: planFailed };
  }

  let uploaded = 0;
  let failed = planFailed;
  for (const r of poolResult.results) {
    if (!r) continue;
    if (r.ok) uploaded++;
    else {
      failed++;
      lastError = r.error || lastError;
      log(`ERR: ${r.item?.relative}: ${r.error}`);
    }
  }

  if (failed > 0) {
    if (/timeout|ECONNREFUSED|dial tcp|no route/i.test(lastError || '')) {
      log('Petunjuk: Settings → MinIO → Endpoint harus port API (mis. :9000), bukan Console (:9090).');
    }
    return {
      success: false,
      error: `${failed} file gagal. ${lastError}`,
      message: `${failed} file gagal`,
      uploaded,
      skipped,
      failed,
      renamed: renamedCount
    };
  }

  onProgress?.({ progress: 100, uploaded, skipped, total: mapped.length });

  return {
    success: true,
    message: skipped > 0
      ? `${uploaded} di-upload, ${skipped} dilewati (sudah ada)`
      : `${uploaded} file di-upload ke MinIO`,
    uploaded,
    skipped,
    renamed: renamedCount
  };
}

module.exports = {
  MINIO_ALIAS,
  encryptSecretKey,
  decryptSecretKey,
  sanitizeMinioForClient,
  sanitizeObjectKeyPart,
  sanitizeRelativeObjectPath,
  formatMinioObjectKey,
  formatMinioFileDestination,
  formatMinioDestination,
  formatMinioUri,
  describeMinioUploadLocation,
  formatJobDestination,
  validateMinioConfig,
  getBundledMcPath,
  getDefaultMcPathRelative,
  isBundledMcInstalled,
  installBundledMc,
  resolveMcPath,
  resolveMcExecutable,
  getEffectiveMcPath,
  normalizeMinioEndpoint,
  isPrivateOrLocalHost,
  listMinioPrefixIndex,
  runConcurrent,
  statMinioObject,
  buildMinioEnv,
  buildMirrorContext,
  buildUploadContext,
  testMcBinary,
  testMinioConnection,
  verifyMinioObject,
  parseMcOutput,
  runSanitizedMinioMirror,
  walkLocalFiles,
  buildUniqueSanitizedPaths
};
