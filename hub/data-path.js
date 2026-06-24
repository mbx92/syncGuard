const fs = require('fs');
const path = require('path');

const DATA_DIR = process.env.HUB_DATA_DIR
  ? path.resolve(process.env.HUB_DATA_DIR)
  : path.join(__dirname, 'data');

function ensureDataDir() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  return DATA_DIR;
}

function resolveDataPath(...parts) {
  return path.join(DATA_DIR, ...parts);
}

module.exports = {
  DATA_DIR,
  ensureDataDir,
  resolveDataPath
};
