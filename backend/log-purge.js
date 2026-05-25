const fs = require('fs');
const path = require('path');

function listLogFiles(logsDir, jobId) {
  if (!fs.existsSync(logsDir)) return [];
  const prefix = jobId ? `${jobId}.log` : '';
  return fs.readdirSync(logsDir).filter(name => {
    if (name === 'syncguard-server.log') return false;
    if (jobId) return name === `${jobId}.log` || name.startsWith(`${jobId}.log.`);
    return name.endsWith('.log') || /\.log\.\d+(\.gz)?$/.test(name);
  });
}

function deleteFiles(logsDir, files) {
  const deletedFiles = [];
  let freedBytes = 0;
  for (const name of files) {
    const fp = path.join(logsDir, name);
    try {
      const stat = fs.statSync(fp);
      freedBytes += stat.size;
      fs.unlinkSync(fp);
      deletedFiles.push(name);
    } catch {
      /* skip */
    }
  }
  return { deletedFiles, freedBytes };
}

function purgeLogs(logsDir, scope, jobId, beforeDate, activeJobIds = []) {
  if (scope === 'job' && jobId) {
    if (activeJobIds.includes(jobId)) {
      return { ok: false, error: 'Job sedang running — tidak bisa hapus log' };
    }
    const files = listLogFiles(logsDir, jobId);
    const result = deleteFiles(logsDir, files);
    return { ok: true, ...result };
  }

  if (scope === 'all') {
    const files = listLogFiles(logsDir, null);
    const result = deleteFiles(logsDir, files);
    return { ok: true, ...result };
  }

  if (scope === 'older_than' && beforeDate) {
    const cutoff = new Date(beforeDate).getTime();
    const all = listLogFiles(logsDir, jobId || null);
    const toDelete = all.filter(name => {
      const fp = path.join(logsDir, name);
      try {
        return fs.statSync(fp).mtimeMs < cutoff;
      } catch {
        return false;
      }
    });
    const result = deleteFiles(logsDir, toDelete);
    return { ok: true, ...result };
  }

  return { ok: false, error: 'Invalid scope' };
}

module.exports = { purgeLogs, listLogFiles };
