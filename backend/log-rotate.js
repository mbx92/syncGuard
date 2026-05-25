const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const DEFAULT_MAX_MB = 10;
const DEFAULT_KEEP = 3;

function getLimits(hubConfig) {
  return {
    maxMb: hubConfig?.localLogMaxMbPerJob ?? DEFAULT_MAX_MB,
    keep: hubConfig?.localLogKeepRotations ?? DEFAULT_KEEP
  };
}

function rotateIfNeeded(logFile, maxMb, keep) {
  if (!fs.existsSync(logFile)) return;
  const stat = fs.statSync(logFile);
  const maxBytes = maxMb * 1024 * 1024;
  if (stat.size < maxBytes) return;

  for (let i = keep; i >= 1; i--) {
    const from = i === 1 ? logFile : `${logFile}.${i - 1}`;
    const to = `${logFile}.${i}`;
    if (fs.existsSync(from)) {
      if (fs.existsSync(to)) fs.unlinkSync(to);
      fs.renameSync(from, to);
    }
  }

  const oldest = `${logFile}.${keep}`;
  if (fs.existsSync(oldest) && keep >= 3) {
    try {
      const gz = `${oldest}.gz`;
      const data = fs.readFileSync(oldest);
      fs.writeFileSync(gz, zlib.gzipSync(data));
      fs.unlinkSync(oldest);
    } catch {
      /* keep uncompressed if gzip fails */
    }
  }
}

function afterWrite(logsDir, jobId, hubConfig) {
  const { maxMb, keep } = getLimits(hubConfig);
  const logFile = path.join(logsDir, `${jobId}.log`);
  try {
    rotateIfNeeded(logFile, maxMb, keep);
  } catch (e) {
    console.error('[log-rotate]', e.message);
  }
}

module.exports = { afterWrite, rotateIfNeeded, getLimits };
