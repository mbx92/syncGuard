const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn, execFile } = require('child_process');
const { Client } = require('ssh2');

const KEYS_DIR = path.join(__dirname, '../config/keys');
const KEY_BASENAME = 'syncguard_ed25519';
const PROJECT_ROOT = path.join(__dirname, '..');
const KEY_COMMENT = 'syncguard-backup';

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
    keyDeployed: !!config.settings?.sshKeyDeployed,
    keyGenMethod: 'node-crypto',
    sshKeygenPath: resolveSshKeygenPath()
  };
}

function readPublicKey() {
  const { publicKey } = getKeyPaths();
  if (!fs.existsSync(publicKey)) return null;
  return fs.readFileSync(publicKey, 'utf8').trim();
}

/** Cari ssh-keygen di bundle cwRsync, Windows OpenSSH, atau PATH.
 *  Tidak pernah mengembalikan string generik — jika tidak ditemukan, throw. */
function resolveSshKeygenPath() {
  const candidates = [];
  if (process.platform === 'win32') {
    candidates.push(
      path.join(PROJECT_ROOT, 'tools', 'cwrsync', 'bin', 'ssh-keygen.exe'),
      path.join(process.env.WINDIR || 'C:\\Windows', 'System32', 'OpenSSH', 'ssh-keygen.exe')
    );
  }
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  const err = new Error('ssh-keygen tidak ditemukan. Pastikan folder tools/cwrsync ada.');
  err.code = 'ENOENT';
  throw err;
}

function sshWireEncode(typeStr, data) {
  const type = Buffer.from(typeStr);
  const lenType = Buffer.alloc(4);
  lenType.writeUInt32BE(type.length, 0);
  const lenData = Buffer.alloc(4);
  lenData.writeUInt32BE(data.length, 0);
  return Buffer.concat([lenType, type, lenData, data]);
}

function encodeEd25519PublicKey(publicKey, comment = KEY_COMMENT) {
  const jwk = publicKey.export({ format: 'jwk' });
  const raw = Buffer.from(jwk.x, 'base64url');
  const wire = sshWireEncode('ssh-ed25519', raw);
  return `ssh-ed25519 ${wire.toString('base64')} ${comment}`;
}

/** Generate ed25519 key pair tanpa ssh-keygen — untuk portable/offline builder. */
function generateKeyPairWithNode(privateKeyPath, publicKeyPath) {
  try {
    const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
    const privatePem = privateKey.export({ type: 'pkcs8', format: 'pem' });
    const pubLine = encodeEd25519PublicKey(publicKey);
    fs.writeFileSync(privateKeyPath, privatePem, { encoding: 'utf8', mode: 0o600 });
    fs.writeFileSync(publicKeyPath, `${pubLine}\n`, { encoding: 'utf8' });
    return { ok: true, method: 'node-crypto' };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

function generateKeyPairWithExec(privateKeyPath, publicKeyPath) {
  const keygenPath = resolveSshKeygenPath();
  return new Promise((resolve) => {
    const args = [
      '-q',
      '-t', 'ed25519',
      '-f', privateKeyPath,
      '-N', '',
      '-C', KEY_COMMENT
    ];

    execFile(keygenPath, args, { windowsHide: true }, (err, stdout, stderr) => {
      if (!err && fs.existsSync(privateKeyPath)) {
        resolve({ ok: true, method: 'ssh-keygen', keygenPath });
        return;
      }
      const msg = (stderr || stdout || err?.message || '').trim();
      resolve({
        ok: false,
        error: msg || `ssh-keygen gagal (${keygenPath})`,
        keygenPath
      });
    });
  });
}

async function generateKeyPair() {
  ensureKeysDir();
  const { privateKey, publicKey } = getKeyPaths();

  if (fs.existsSync(privateKey)) {
    return { ok: true, existed: true, privateKey, publicKey };
  }

  const nodeResult = generateKeyPairWithNode(privateKey, publicKey);
  if (nodeResult.ok) {
    return { ok: true, privateKey, publicKey, method: nodeResult.method };
  }

  const execResult = await generateKeyPairWithExec(privateKey, publicKey);
  if (execResult.ok) {
    return { ok: true, privateKey, publicKey, method: execResult.method };
  }

  return {
    ok: false,
    error: execResult.error || nodeResult.error || 'Gagal membuat key pair.',
    details: { node: nodeResult.error, exec: execResult.error }
  };
}

function sanitizeSshError(msg) {
  if (!msg) return '';
  let s = stripSshNoise(msg);
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

/** OpenSSH PQ warning on stderr — informational, bukan kegagalan backup. */
function stripSshNoise(text) {
  return String(text || '')
    .replace(/\*\* WARNING:[\s\S]*?openssh\.com\/pq\.html\r?\n?/gi, '')
    .replace(/Permission denied, please try again\.[\r\n]*/gi, '')
    .replace(/\r/g, '')
    .trim();
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

async function fixNasSshHomePermissions(config, opts = {}) {
  let conn;
  try {
    conn = await sshConnect(config, { password: opts.password ?? config.nas?.password, useKey: false });
    const result = await execCommand(conn, [
      'chmod go-w "$HOME" 2>/dev/null || chmod 755 "$HOME"',
      'chmod 700 "$HOME/.ssh" 2>/dev/null || true',
      'chmod 600 "$HOME/.ssh/authorized_keys" 2>/dev/null || true',
      'echo FIX_OK'
    ].join(' && '));
    return { ok: result.stdout.includes('FIX_OK') };
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
      'chmod go-w "$HOME" 2>/dev/null || chmod 755 "$HOME"',
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
  resolveSshKeygenPath,
  getKeyStatus,
  generateKeyPair,
  sshConnect,
  testSshConnection,
  deployPublicKey,
  fixNasSshHomePermissions,
  sanitizeNasForClient,
  sanitizeSettingsForClient,
  sanitizeSshError,
  stripSshNoise
};
