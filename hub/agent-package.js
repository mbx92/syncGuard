const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');

const PROJECT_ROOT = path.join(__dirname, '..');
const DOWNLOADS_DIR = path.join(__dirname, 'data', 'downloads');

const ROOT_FILES = [
  'SyncGuard.exe',
  'SyncGuard.vbs',
  'SyncGuard-Stop.vbs',
  'start.bat',
  'stop.bat',
  'install-startup.bat',
  'remove-startup.bat',
  'refresh-icon-cache.bat',
  'install-cwrsync.bat',
  'install-node.bat',
  'setup-portable.bat',
  'package.json',
  'package-lock.json',
  'README.md',
  'PORTABLE.md'
];

const ROOT_DIRS = [
  'assets',
  'backend',
  'frontend',
  'scripts',
  'tools',
  'node_modules'
];

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function copyFileIfExists(src, dest) {
  if (!fs.existsSync(src)) return;
  ensureDir(path.dirname(dest));
  fs.copyFileSync(src, dest);
}

function copyDir(src, dest) {
  if (!fs.existsSync(src)) return;
  ensureDir(dest);
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDir(srcPath, destPath);
    } else if (entry.isFile()) {
      copyFileIfExists(srcPath, destPath);
    }
  }
}

function buildAgentConfig(agent, hubUrl) {
  return {
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
      sshKeyPath: '',
      defaultOptions: '-avz --progress --delete',
      robocopyPath: 'robocopy',
      robocopyDefaultOptions: '/E /Z /R:3 /W:5 /MT:8 /MIR',
      smbShare: '\\\\192.168.1.100\\backup',
      smbPassword: ''
    },
    hub: {
      enabled: true,
      url: hubUrl,
      agentId: agent.agentId,
      apiKey: agent.apiKey,
      heartbeatIntervalSec: 30,
      logPushMode: 'summary',
      logPushMaxLinesPerMinute: 30,
      localLogMaxMbPerJob: 10,
      localLogKeepRotations: 3
    }
  };
}

function writeAgentConfig(destRoot, agent, hubUrl) {
  const configDir = path.join(destRoot, 'config');
  const keysDir = path.join(configDir, 'keys');
  ensureDir(keysDir);
  fs.writeFileSync(path.join(configDir, 'config.json'), JSON.stringify(buildAgentConfig(agent, hubUrl), null, 2));
  const knownHostsSrc = path.join(PROJECT_ROOT, 'config', 'known_hosts');
  copyFileIfExists(knownHostsSrc, path.join(configDir, 'known_hosts'));
}

function stageAgentFolder(agent, hubUrl) {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'syncguard-agent-'));
  const packageRoot = path.join(tempRoot, `syncguard-agent-${agent.agentId}`);
  ensureDir(packageRoot);

  ROOT_FILES.forEach((file) => {
    copyFileIfExists(path.join(PROJECT_ROOT, file), path.join(packageRoot, file));
  });
  ROOT_DIRS.forEach((dir) => {
    copyDir(path.join(PROJECT_ROOT, dir), path.join(packageRoot, dir));
  });

  writeAgentConfig(packageRoot, agent, hubUrl);
  ensureDir(path.join(packageRoot, 'logs'));
  ensureDir(path.join(packageRoot, 'data'));
  return { tempRoot, packageRoot };
}

function zipDirectory(sourceDir, zipPath) {
  return new Promise((resolve, reject) => {
    if (process.platform === 'win32') {
      const psEscape = (value) => String(value).replace(/'/g, "''");
      const script = [
        `$source = '${psEscape(sourceDir)}'`,
        `$destination = '${psEscape(zipPath)}'`,
        "if (Test-Path -LiteralPath $destination) { Remove-Item -LiteralPath $destination -Force }",
        "Compress-Archive -LiteralPath $source -DestinationPath $destination -Force"
      ].join('; ');
      execFile(
        'powershell.exe',
        ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', script],
        { windowsHide: true },
        (err, stdout, stderr) => {
          if (err) {
            reject(new Error((stderr || stdout || err.message || '').trim() || 'Gagal membuat ZIP agent'));
            return;
          }
          resolve(zipPath);
        }
      );
      return;
    }

    execFile(
      'tar',
      ['-a', '-cf', zipPath, path.basename(sourceDir)],
      { cwd: path.dirname(sourceDir) },
      (err, stdout, stderr) => {
        if (err) {
          reject(new Error((stderr || stdout || err.message || '').trim() || 'Gagal membuat ZIP agent'));
          return;
        }
        resolve(zipPath);
      }
    );
  });
}

function cleanupDir(dir) {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {}
}

function cleanupOldDownloads(maxAgeMs = 6 * 60 * 60 * 1000) {
  ensureDir(DOWNLOADS_DIR);
  const now = Date.now();
  for (const entry of fs.readdirSync(DOWNLOADS_DIR, { withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const fullPath = path.join(DOWNLOADS_DIR, entry.name);
    try {
      const stat = fs.statSync(fullPath);
      if (now - stat.mtimeMs > maxAgeMs) {
        fs.unlinkSync(fullPath);
      }
    } catch {}
  }
}

async function createAgentPackage(agent, hubUrl) {
  cleanupOldDownloads();
  ensureDir(DOWNLOADS_DIR);
  const { tempRoot, packageRoot } = stageAgentFolder(agent, hubUrl);
  const zipPath = path.join(DOWNLOADS_DIR, `syncguard-agent-${agent.agentId}.zip`);
  try {
    await zipDirectory(packageRoot, zipPath);
    return {
      zipPath,
      fileName: path.basename(zipPath)
    };
  } finally {
    cleanupDir(tempRoot);
  }
}

module.exports = {
  createAgentPackage
};
