const fs = require('fs');
const path = require('path');
const { spawn, execFile } = require('child_process');
const { Client } = require('ssh2');

const KEYS_DIR = path.join(__dirname, '../config/keys');
const KEY_BASENAME = 'syncguard_ed25519';

function ensureKeysDir() {
  if (!fs.existsSync(KEYS_DIR)) fs.mkdirSync(KEYS_DIR, { recursive: true });
}

function getKeyPaths() {
  const base = path.join(KEYS_DIR, KEY_BASENAME);
  return { privateKey: base, publicKey: `${base}.pub` };
}

function resolveSshKeyPath(config) {
  const custom = config.settings?.sshKeyPath?.trim();
  if (custom && fs.existsSync(custom)) return custom;
  const { privateKey } = getKeyPaths();
  if (fs.existsSync(privateKey)) return privateKey;
  return custom || '';
}

/** Key file hanya dipakai jika sudah di-deploy ke NAS (hindari key stale setelah ganti password). */
function resolveActiveSshKeyPath(config) {
  if (!config.settings?.sshKeyDeployed) return '';
  return resolveSshKeyPath(config);
}

function getKeyStatus(config) {
  const paths = getKeyPaths();
  const resolved = resolveSshKeyPath(config);
  const custom = config.settings?.sshKeyPath?.trim();
  return {
    keysDir: KEYS_DIR,
    privateKey: paths.privateKey,
    publicKey: paths.publicKey,
    resolvedPath: resolved,
    hasDefaultKey: fs.existsSync(paths.privateKey),
    hasPublicKey: fs.existsSync(paths.publicKey),
    usingCustomPath: !!(custom && custom === resolved),
    keyDeployed: !!config.settings?.sshKeyDeployed
  };
}

function readPublicKey() {
  const { publicKey } = getKeyPaths();
  if (!fs.existsSync(publicKey)) return null;
  return fs.readFileSync(publicKey, 'utf8').trim();
}

function generateKeyPair() {
  ensureKeysDir();
  const { privateKey, publicKey } = getKeyPaths();

  if (fs.existsSync(privateKey)) {
    return Promise.resolve({ ok: true, existed: true, privateKey, publicKey });
  }

  return new Promise((resolve) => {
    // execFile + no shell: argumen tidak di-parse ulang oleh cmd.exe (hindari "Too many arguments")
    const args = [
      '-q',
      '-t', 'ed25519',
      '-f', privateKey,
      '-N', '',
      '-C', 'syncguard-backup'
    ];

    execFile('ssh-keygen', args, { windowsHide: true }, (err, stdout, stderr) => {
      if (!err && fs.existsSync(privateKey)) {
        resolve({ ok: true, privateKey, publicKey });
        return;
      }

      const msg = (stderr || stdout || err?.message || '').trim();
      resolve({
        ok: false,
        error: msg || 'ssh-keygen gagal. Pastikan OpenSSH Client terpasang (Settings → Apps → Optional Features).'
      });
    });
  });
}

function sanitizeSshError(msg) {
  if (!msg) return '';
  let s = String(msg)
    .replace(/\*\* WARNING:[\s\S]*?openssh\.com\/pq\.html\r?\n?/gi, '')
    .replace(/Permission denied, please try again\.[\r\n]*/gi, '')
    .replace(/\r/g, '')
    .trim();
  if (/All configured authentication methods failed/i.test(s)) {
    return 'Login ditolak NAS — password salah atau user tidak punya akses SSH.';
  }
  if (/Permission denied \(publickey,password\)/i.test(s)) {
    return 'Login ditolak NAS — password dan SSH key ditolak.';
  }
  if (/Permission denied/i.test(s)) {
    return 'Login ditolak NAS — password atau SSH key salah.';
  }
  return s || 'SSH auth gagal';
}

function sshConnect(config, opts = {}) {
  const { nas } = config;
  const password = opts.password ?? nas.password;
  const privateKeyPath = opts.useKey !== false ? resolveSshKeyPath(config) : '';

  return new Promise((resolve, reject) => {
    const conn = new Client();
    const connectOpts = {
      host: nas.ip,
      port: nas.port || 22,
      username: nas.user,
      readyTimeout: 15000,
      tryKeyboard: true
    };

    if (opts.useKey !== false && privateKeyPath && fs.existsSync(privateKeyPath)) {
      connectOpts.privateKey = fs.readFileSync(privateKeyPath, 'utf8');
    } else if (password) {
      connectOpts.password = password;
    } else {
      return reject(new Error('Isi password NAS atau generate & deploy SSH key terlebih dahulu.'));
    }

    conn.on('keyboard-interactive', (_name, _instr, _lang, prompts, finish) => {
      if (password && prompts?.length) {
        finish(prompts.map(() => password));
      } else {
        finish([]);
      }
    });

    conn.on('ready', () => resolve(conn));
    conn.on('error', (err) => reject(new Error(sanitizeSshError(err.message))));
    conn.connect(connectOpts);
  });
}

function execCommand(conn, command) {
  return new Promise((resolve, reject) => {
    conn.exec(command, (err, stream) => {
      if (err) return reject(err);
      let stdout = '';
      let stderr = '';
      stream.on('data', d => { stdout += d; });
      stream.stderr.on('data', d => { stderr += d; });
      stream.on('close', code => {
        resolve({ code, stdout, stderr });
      });
    });
  });
}

async function testSshConnection(config, opts = {}) {
  let conn;
  try {
    conn = await sshConnect(config, opts);
    const result = await execCommand(conn, 'echo OK && uname -a 2>/dev/null || echo synology');
    const authMethod = opts.useKey === false ? 'password' : (resolveActiveSshKeyPath(config) ? 'ssh-key' : 'password');
    return {
      ok: result.code === 0,
      output: result.stdout.trim(),
      authMethod,
      error: result.stderr.trim() || (result.code !== 0 ? `SSH exit code ${result.code}` : '')
    };
  } catch (e) {
    return { ok: false, error: sanitizeSshError(e.message) };
  } finally {
    if (conn) conn.end();
  }
}

async function deployPublicKey(config, opts = {}) {
  const gen = await generateKeyPair();
  if (!gen.ok) return gen;

  const pubKey = readPublicKey();
  if (!pubKey) {
    return { ok: false, error: 'Public key tidak ditemukan setelah generate.' };
  }

  const password = opts.password ?? config.nas?.password;
  if (!password && !resolveSshKeyPath(config)) {
    return { ok: false, error: 'Password NAS diperlukan untuk deploy key pertama kali.' };
  }

  let conn;
  try {
    conn = await sshConnect(config, { password, useKey: false });

    const escapedKey = pubKey.replace(/'/g, "'\\''");
    const cmd = [
      'mkdir -p ~/.ssh',
      'chmod 700 ~/.ssh',
      `grep -qxF '${escapedKey}' ~/.ssh/authorized_keys 2>/dev/null || echo '${escapedKey}' >> ~/.ssh/authorized_keys`,
      'chmod 600 ~/.ssh/authorized_keys',
      'echo DEPLOY_OK'
    ].join(' && ');

    const result = await execCommand(conn, cmd);
    if (result.code !== 0 || !result.stdout.includes('DEPLOY_OK')) {
      return {
        ok: false,
        error: result.stderr.trim() || result.stdout.trim() || `Deploy gagal (exit ${result.code})`
      };
    }

    const paths = getKeyPaths();
    return {
      ok: true,
      message: 'SSH public key berhasil dikirim ke NAS (authorized_keys).',
      privateKey: paths.privateKey,
      publicKey: paths.publicKey
    };
  } catch (e) {
    return { ok: false, error: sanitizeSshError(e.message) };
  } finally {
    if (conn) conn.end();
  }
}

function sanitizeNasForClient(nas) {
  if (!nas) return nas;
  const { password, ...rest } = nas;
  return { ...rest, passwordSet: !!password };
}

function sanitizeSettingsForClient(settings) {
  if (!settings) return settings;
  const { smbPassword, ...rest } = settings;
  return { ...rest, smbPasswordSet: !!smbPassword };
}

module.exports = {
  KEYS_DIR,
  getKeyPaths,
  resolveSshKeyPath,
  resolveActiveSshKeyPath,
  getKeyStatus,
  generateKeyPair,
  sshConnect,
  testSshConnection,
  deployPublicKey,
  sanitizeNasForClient,
  sanitizeSettingsForClient,
  sanitizeSshError
};
