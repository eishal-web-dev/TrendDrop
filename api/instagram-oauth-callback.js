const { readSession, setSessionCookie } = require('./_lib/session');
const { withTimeout } = require('./_lib/http');

function redirectWithStatus(res, status) {
  res.statusCode = 302;
  res.setHeader('Location', `/viral-brain.html?ig_connect=${status}`);
  res.end();
}

/**
 * GET /api/instagram-oauth-callback?code=...&state=...
 *
 * Exchanges the authorization code for a short-lived token, then a
 * 60-day long-lived token, fetches the permitted basic profile fields,
 * and stores everything server-side in an encrypted httpOnly cookie.
 * The access token is never sent to the browser as readable JSON.
 */
module.exports = async function handler(req, res) {
  const { code, state, error: oauthError } = req.query || {};

  if (oauthError) return redirectWithStatus(res, 'denied');
  if (!code || !state) return redirectWithStatus(res, 'error');

  const existing = readSession(req);
  if (!existing || existing.oauthState !== state) {
    return redirectWithStatus(res, 'error'); // CSRF check failed or session expired
  }

  const appId = process.env.META_APP_ID;
  const appSecret = process.env.META_APP_SECRET;
  const redirectUri = process.env.META_REDIRECT_URI;
  if (!appId || !appSecret || !redirectUri) return redirectWithStatus(res, 'not_configured');

  const { signal, clear } = withTimeout(15000);
  try {
    const tokenForm = new URLSearchParams({
      client_id: appId,
      client_secret: appSecret,
      grant_type: 'authorization_code',
      redirect_uri: redirectUri,
      code: String(code),
    });

    const shortLivedRes = await fetch('https://api.instagram.com/oauth/access_token', {
      method: 'POST',
      body: tokenForm,
      signal,
    });
    if (!shortLivedRes.ok) return redirectWithStatus(res, 'error');
    const shortLived = await shortLivedRes.json();
    if (!shortLived.access_token) return redirectWithStatus(res, 'error');

    const longLivedParams = new URLSearchParams({
      grant_type: 'ig_exchange_token',
      client_secret: appSecret,
      access_token: shortLived.access_token,
    });
    const longLivedRes = await fetch(`https://graph.instagram.com/access_token?${longLivedParams.toString()}`, { signal });
    if (!longLivedRes.ok) return redirectWithStatus(res, 'error');
    const longLived = await longLivedRes.json();
    if (!longLived.access_token) return redirectWithStatus(res, 'error');

    const profileRes = await fetch(
      `https://graph.instagram.com/me?fields=id,username,account_type,media_count&access_token=${encodeURIComponent(longLived.access_token)}`,
      { signal }
    );
    const profile = profileRes.ok ? await profileRes.json() : null;

    const expiresAt = Date.now() + (Number(longLived.expires_in) || 60 * 24 * 60 * 60) * 1000;

    setSessionCookie(res, {
      accessToken: longLived.access_token,
      expiresAt,
      profile: profile
        ? { id: profile.id, username: profile.username, accountType: profile.account_type, mediaCount: profile.media_count }
        : null,
    }, Math.min(60 * 24 * 60 * 60, Math.floor((expiresAt - Date.now()) / 1000)));

    return redirectWithStatus(res, 'success');
  } catch {
    return redirectWithStatus(res, 'error');
  } finally {
    clear();
  }
};
