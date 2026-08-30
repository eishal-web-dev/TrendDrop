const { readSession, setSessionCookie } = require('./_lib/session');
const { send, withTimeout } = require('./_lib/http');

const REFRESH_WINDOW_MS = 7 * 24 * 60 * 60 * 1000; // refresh inside the last 7 days of validity

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return send(res, 405, { error: 'Use GET for this endpoint.' });
  }

  const session = readSession(req);
  if (!session?.accessToken) {
    return send(res, 200, { connected: false });
  }

  if (Date.now() >= session.expiresAt) {
    return send(res, 200, { connected: false, expired: true });
  }

  // Proactively refresh a long-lived token nearing expiry so the user
  // doesn't get silently disconnected mid-session.
  let accessToken = session.accessToken;
  let expiresAt = session.expiresAt;
  if (expiresAt - Date.now() < REFRESH_WINDOW_MS) {
    const { signal, clear } = withTimeout(10000);
    try {
      const params = new URLSearchParams({ grant_type: 'ig_refresh_token', access_token: accessToken });
      const refreshRes = await fetch(`https://graph.instagram.com/refresh_access_token?${params.toString()}`, { signal });
      if (refreshRes.ok) {
        const refreshed = await refreshRes.json();
        if (refreshed.access_token) {
          accessToken = refreshed.access_token;
          expiresAt = Date.now() + (Number(refreshed.expires_in) || 60 * 24 * 60 * 60) * 1000;
          setSessionCookie(res, { accessToken, expiresAt, profile: session.profile }, Math.floor((expiresAt - Date.now()) / 1000));
        }
      }
    } catch {
      // Refresh failure isn't fatal — the existing token is still valid until expiresAt.
    } finally {
      clear();
    }
  }

  return send(res, 200, {
    connected: true,
    profile: session.profile,
    expiresAt,
    note: 'Basic profile fields only (instagram_business_basic). Insights such as reach, saves, and retention require additional Meta App Review before they can be requested.',
  });
};
