const { clearSessionCookie } = require('./_lib/session');
const { send } = require('./_lib/http');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return send(res, 405, { error: 'Use POST for this endpoint.' });
  }
  clearSessionCookie(res);
  return send(res, 200, { disconnected: true });
};
