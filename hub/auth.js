const crypto = require('crypto');

function generateApiKey() {
  return crypto.randomBytes(24).toString('hex');
}

function verifyAdminToken(headerToken, configToken) {
  if (!configToken || configToken === 'syncguard-admin-change-me') {
    return { ok: false, error: 'Set adminToken in hub/config.json' };
  }
  if (!headerToken || headerToken !== configToken) {
    return { ok: false, error: 'Invalid admin token' };
  }
  return { ok: true };
}

function verifyAgentAuth(agentId, bearerToken, agents) {
  const agent = agents[agentId];
  if (!agent) return { ok: false, error: 'Agent not registered' };
  if (!agent.apiKey || agent.apiKey !== bearerToken) {
    return {
      ok: false,
      error: `Invalid API key for agent "${agentId}" — gunakan apiKey dari Hub Settings untuk agentId ini`
    };
  }
  return { ok: true, agent };
}

function parseBearer(req) {
  const h = req.headers.authorization || '';
  if (h.startsWith('Bearer ')) return h.slice(7).trim();
  return null;
}

module.exports = {
  generateApiKey,
  verifyAdminToken,
  verifyAgentAuth,
  parseBearer
};
