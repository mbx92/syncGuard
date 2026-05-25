const fs = require('fs');
const path = require('path');
const { execFile, exec } = require('child_process');
const ssh = require('./ssh');

const PROJECT_ROOT = path.join(__dirname, '..');
const BUNDLED_RSYNC_REL = 'tools/cwrsync/bin/rsync.exe';

function fileExists(p) {
  try {
    return fs.existsSync(p);
  } catch {
    return false;
  }
}

function getBundledCwRsyncPath() {
  return path.join(PROJECT_ROOT, 'tools', 'cwrsync', 'bin', 'rsync.exe');
}

function getDefaultRsyncPathRelative() {
  return BUNDLED_RSYNC_REL;
}

function isBundledInstalled() {
  return fileExists(getBundledCwRsyncPath());
}

/** Resolve path tersimpan — tidak pernah scan sistem */
function resolveRsyncPath(settings) {
  const configured = (settings?.rsyncPath || '').trim();

  if (configured && configured.toLowerCase() !== 'rsync') {
    if (path.isAbsolute(configured)) return configured;
    return path.join(PROJECT_ROOT, configured.replace(/\//g, path.sep));
  }

  const bundled = getBundledCwRsyncPath();
  if (fileExists(bundled)) return bundled;

  return configured || 'rsync';
}

function isRsyncPathConfigured(settings) {
  const p = (settings?.rsyncPath || '').trim();
  return !!(p && p.toLowerCase() !== 'rsync');
}

/** Hanya cek bundle lokal project — tanpa scan C:\ atau WSL */
function detectRsyncInstallation() {
  if (isBundledInstalled()) {
    return [{ path: getDefaultRsyncPathRelative(), label: 'bundled', type: 'native' }];
  }
  return [];
}

function pickBestRsyncInstall(detected) {
  return detected[0]?.path || null;
}

function installBundledCwRsync() {
  const destDir = path.join(PROJECT_ROOT, 'tools', 'cwrsync');
  const sources = [
    'C:\\cwrsync',
    'C:\\Program Files\\cwRsync',
    'C:\\Program Files (x86)\\cwRsync'
  ];
  const src = sources.find(s => fileExists(path.join(s, 'bin', 'rsync.exe')));

  if (!src) {
    return Promise.resolve({
      ok: false,
      error: 'cwRsync tidak ditemukan di sistem. Install dari https://itefix.net/cwrsync lalu jalankan install-cwrsync.bat'
    });
  }

  return new Promise((resolve) => {
    fs.mkdirSync(path.dirname(destDir), { recursive: true });
    const cmd = `xcopy "${src}" "${destDir}" /E /I /Y /Q`;
    exec(cmd, { windowsHide: true }, (err) => {
      if (err || !fileExists(getBundledCwRsyncPath())) {
        resolve({ ok: false, error: `Gagal menyalin cwRsync dari ${src} ke tools/cwrsync` });
        return;
      }
      resolve({
        ok: true,
        path: getDefaultRsyncPathRelative(),
        absolute: getBundledCwRsyncPath(),
        source: src
      });
    });
  });
}

function getRsyncCwd(executable) {
  if (process.platform !== 'win32') return undefined;
  const lower = executable.toLowerCase();
  if (lower.endsWith('.exe') && fileExists(executable)) {
    return path.dirname(executable);
  }
  return undefined;
}

function buildRsyncSpawn(rsyncPath, rsyncArgs) {
  const resolved = resolveRsyncPath({ rsyncPath });
  const tokens = resolved.split(/\s+/).filter(Boolean);

  let executable;
  let args;

  if (tokens[0].toLowerCase() === 'wsl') {
    executable = 'wsl';
    const wslRsync = tokens.slice(1);
    if (!wslRsync.length || wslRsync[0] !== 'rsync') {
      wslRsync.unshift('rsync');
    }
    args = [...wslRsync, ...rsyncArgs];
  } else {
    executable = tokens[0];
    args = [...tokens.slice(1), ...rsyncArgs];
  }

  const displayCommand = [executable, ...args].join(' ');
  const cwd = getRsyncCwd(executable);
  return { executable, args, displayCommand, resolvedPath: resolved, cwd };
}

function testRsyncBinary(rsyncPath) {
  const { executable, args, cwd } = buildRsyncSpawn(rsyncPath, ['--version']);
  const opts = { windowsHide: true, timeout: 20000 };
  if (cwd) opts.cwd = cwd;

  return new Promise((resolve) => {
    execFile(executable, args, opts, (err, stdout, stderr) => {
      if (err) {
        resolve({
          ok: false,
          path: resolveRsyncPath({ rsyncPath }),
          error: (stderr || err.message || '').trim() || 'rsync tidak dapat dijalankan'
        });
        return;
      }
      const line = (stdout || stderr || '').split('\n')[0].trim();
      resolve({
        ok: true,
        path: resolveRsyncPath({ rsyncPath }),
        version: line
      });
    });
  });
}

function getBundledSsh(rsyncExecutable) {
  const cwd = getRsyncCwd(rsyncExecutable);
  if (cwd) {
    const sshExe = path.join(cwd, 'ssh.exe');
    if (fileExists(sshExe)) return sshExe;
  }
  return 'ssh';
}

function usesCwRsyncStyle(rsyncExecutable) {
  if (process.platform !== 'win32') return false;
  const lower = (rsyncExecutable || '').toLowerCase();
  return lower.includes('cwrsync') || lower.includes('tools/cwrsync') || lower.endsWith('.exe');
}

function normalizeLocalSource(sourcePath, rsyncExecutable) {
  let p = sourcePath.trim().replace(/\\/g, '/');
  if (!p.endsWith('/')) p += '/';

  const driveMatch = p.match(/^([A-Za-z]):\/?(.*)$/);
  if (driveMatch && usesCwRsyncStyle(rsyncExecutable)) {
    const drive = driveMatch[1].toLowerCase();
    const rest = driveMatch[2] || '';
    return `/cygdrive/${drive}/${rest}`.replace(/\/+/g, '/');
  }
  return p;
}

function buildRemoteDest(nas, jobName) {
  const base = (nas.basePath || '').replace(/\\/g, '/').replace(/\/+$/, '');
  const safeName = jobName.trim().replace(/\\/g, '/');
  const remotePath = `${base}/${safeName}/`.replace(/\/+/g, '/');
  return `${nas.user}@${nas.ip}:${remotePath}`;
}

function toCygwinPath(winPath) {
  if (!winPath || process.platform !== 'win32') return winPath;
  const normalized = winPath.replace(/\\/g, '/');
  const m = normalized.match(/^([A-Za-z]):\/?(.*)$/);
  if (m) return `/cygdrive/${m[1].toLowerCase()}/${m[2]}`.replace(/\/+/g, '/');
  return normalized;
}

function getKnownHostsPath(useCw) {
  const p = path.join(PROJECT_ROOT, 'config/known_hosts');
  return useCw ? toCygwinPath(p) : p;
}

function buildSshTransport(nas, sshKeyPath, rsyncExecutable, opts = {}) {
  const useCw = usesCwRsyncStyle(rsyncExecutable);
  const sshBin = getBundledSsh(rsyncExecutable);
  const hasKey = !!(sshKeyPath && fileExists(sshKeyPath));
  const hasPassword = !!opts.password;
  const keyForSsh = hasKey && useCw ? toCygwinPath(sshKeyPath) : sshKeyPath;

  const parts = [
    sshBin,
    '-p', String(nas.port || 22),
    '-o', 'StrictHostKeyChecking=no',
    '-o', 'ConnectTimeout=15',
    '-o', `UserKnownHostsFile=${getKnownHostsPath(useCw)}`
  ];

  if (hasKey && !hasPassword) {
    parts.push('-o', 'BatchMode=yes');
  } else {
    parts.push('-o', 'BatchMode=no');
    parts.push('-o', 'PreferredAuthentications=publickey,password,keyboard-interactive');
  }

  if (hasKey) {
    parts.push('-o', 'IdentitiesOnly=yes');
    parts.push('-i', keyForSsh);
  }

  return parts.map(p => (/\s/.test(p) ? `"${p}"` : p)).join(' ');
}

function getRsyncSshEnv(config) {
  const password = config.nas?.password;
  if (!password) return {};

  const askpass = path.join(__dirname, 'tools/ssh-askpass.cmd');
  return {
    SYNCGUARD_SSH_PASS: password,
    SSH_ASKPASS: askpass,
    SSH_ASKPASS_REQUIRE: 'force',
    DISPLAY: 'syncguard:0'
  };
}

function testRsyncSshAuth(config) {
  const resolved = resolveRsyncPath(config.settings);
  const keyPath = ssh.resolveSshKeyPath(config) || '';
  const useCw = usesCwRsyncStyle(resolved);
  const sshBin = getBundledSsh(resolved);
  const cwd = getRsyncCwd(resolved.split(/\s+/)[0]);

  const testArgs = [
    '-p', String(config.nas.port || 22),
    '-o', 'StrictHostKeyChecking=no',
    '-o', 'ConnectTimeout=15',
    '-o', `UserKnownHostsFile=${getKnownHostsPath(useCw)}`,
    '-o', 'BatchMode=no',
    '-o', 'PreferredAuthentications=publickey,password,keyboard-interactive'
  ];
  if (keyPath && fileExists(keyPath)) {
    testArgs.push('-o', 'IdentitiesOnly=yes', '-i', useCw ? toCygwinPath(keyPath) : keyPath);
  }
  testArgs.push(`${config.nas.user}@${config.nas.ip}`, 'echo RSYNC_SSH_OK');

  const opts = {
    windowsHide: true,
    timeout: 20000,
    env: { ...process.env, ...getRsyncSshEnv(config) }
  };
  if (cwd) opts.cwd = cwd;

  return new Promise((resolve) => {
    execFile(sshBin, testArgs, opts, (err, stdout, stderr) => {
      const out = (stdout || '').trim();
      const errOut = (stderr || '').trim();
      const ok = !err && out.includes('RSYNC_SSH_OK');
      resolve({
        ok,
        output: out,
        error: ok ? '' : (errOut || err?.message || 'SSH auth gagal'),
        sshBin,
        keyPath: useCw && keyPath ? toCygwinPath(keyPath) : keyPath
      });
    });
  });
}

function buildRsyncJobArgs(job, config) {
  const resolved = resolveRsyncPath(config.settings);
  const keyPath = ssh.resolveSshKeyPath(config) || '';

  const options = (job.options || config.settings.defaultOptions || '-avz --progress')
    .split(' ')
    .filter(Boolean);

  const rsyncArgs = [...options];
  rsyncArgs.push('-e', buildSshTransport(config.nas, keyPath, resolved, { password: config.nas?.password }));

  if (job.exclusions?.length) {
    job.exclusions.forEach(ex => rsyncArgs.push(`--exclude=${ex}`));
  }

  const source = normalizeLocalSource(job.sourcePath, resolved);
  const dest = buildRemoteDest(config.nas, job.name);
  rsyncArgs.push(source, dest);

  return buildRsyncSpawn(config.settings.rsyncPath, rsyncArgs);
}

function getRsyncRunEnv(config) {
  return getRsyncSshEnv(config);
}

module.exports = {
  PROJECT_ROOT,
  BUNDLED_RSYNC_REL,
  getBundledCwRsyncPath,
  getDefaultRsyncPathRelative,
  isBundledInstalled,
  detectRsyncInstallation,
  installBundledCwRsync,
  resolveRsyncPath,
  isRsyncPathConfigured,
  pickBestRsyncInstall,
  buildRsyncSpawn,
  buildRsyncJobArgs,
  testRsyncBinary,
  testRsyncSshAuth,
  getRsyncRunEnv,
  normalizeLocalSource,
  buildRemoteDest,
  toCygwinPath
};
