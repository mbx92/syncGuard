const fs = require('fs');
const path = require('path');

const PID_FILE = path.join(__dirname, '../config/syncguard.pid');
let serverRef = null;
let wssRef = null;
let shutdownHooks = [];
let shuttingDown = false;

function writePidFile() {
  fs.mkdirSync(path.dirname(PID_FILE), { recursive: true });
  fs.writeFileSync(PID_FILE, String(process.pid), 'utf8');
}

function removePidFile() {
  try {
    if (fs.existsSync(PID_FILE)) fs.unlinkSync(PID_FILE);
  } catch (e) {}
}

function registerShutdownHook(fn) {
  shutdownHooks.push(fn);
}

function initLifecycle(server, wss, port) {
  serverRef = server;
  wssRef = wss;

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`\n[ERROR] Port ${port} sudah dipakai oleh proses lain.`);
      console.error('        Jalankan stop.bat atau klik "Stop Server" di dashboard, lalu coba lagi.\n');
      process.exit(1);
    }
    console.error('[ERROR] Server error:', err.message);
    process.exit(1);
  });

  writePidFile();

  const onSignal = (signal) => {
    console.log(`\n[SyncGuard] Menerima ${signal}, menutup server...`);
    gracefulShutdown(0);
  };

  process.on('SIGINT', onSignal);
  process.on('SIGTERM', onSignal);
  if (process.platform === 'win32') {
    process.on('SIGBREAK', onSignal);
  }

  process.on('exit', removePidFile);
}

function gracefulShutdown(exitCode = 0) {
  if (shuttingDown) return;
  shuttingDown = true;

  for (const hook of shutdownHooks) {
    try { hook(); } catch (e) { console.error('[SyncGuard] Shutdown hook error:', e.message); }
  }

  if (wssRef) {
    wssRef.clients.forEach(client => {
      try { client.close(1001, 'server shutting down'); } catch (e) {}
    });
    try { wssRef.close(); } catch (e) {}
  }

  if (serverRef) {
    serverRef.close(() => {
      removePidFile();
      process.exit(exitCode);
    });
    setTimeout(() => {
      removePidFile();
      process.exit(exitCode || 1);
    }, 4000);
  } else {
    removePidFile();
    process.exit(exitCode);
  }
}

function getServerInfo(port) {
  return {
    pid: process.pid,
    port,
    uptime: Math.floor(process.uptime()),
    pidFile: PID_FILE
  };
}

module.exports = {
  PID_FILE,
  initLifecycle,
  gracefulShutdown,
  registerShutdownHook,
  getServerInfo,
  removePidFile
};
