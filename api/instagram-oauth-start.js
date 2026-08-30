const crypto = require('crypto');
const { send } = require('./_lib/http');
const { setSessionCookie } = require('./_lib/session');

/**
 * Instagram Business Login (direct, no Facebook Page required) — current
 * as of Meta's 2026 documentation. Authorize endpoint lives on
 * api.instagram.com; all API calls after token exchange go to
 * graph.instagram.com, not graph.facebook.com.
 *
 * Required env vars: META_APP_ID, META_APP_SECRET, META_REDIRECT_URI,
 * COOKIE_SECRET (see api/_lib/session.js).
 */
module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return send(res, 405, { error: 'Use GET for this endpoint.' });
  }

  const appId = process.env.META_APP_ID;
  const redirectUri = process.env.META_REDIRECT_URI;
  const hasSecret = Boolean(process.env.META_APP_SECRET);
  const hasCookieSecret = Boolean(process.env.COOKIE_SECRET);

  if (!appId || !redirectUri || !hasSecret || !hasCookieSecret) {
    return send(res, 200, {
      configured: false,
      message: 'Official Instagram account connection is not set up yet. This requires META_APP_ID, META_APP_SECRET, META_REDIRECT_URI, and COOKIE_SECRET.',
      missing: [
        !appId && 'META_APP_ID',
        !hasSecret && 'META_APP_SECRET',
        !redirectUri && 'META_REDIRECT_URI',
        !hasCookieSecret && 'COOKIE_SECRET',
      ].filter(Boolean),
    });
  }

  const state = crypto.randomBytes(16).toString('hex');
  setSessionCookie(res, { oauthState: state }, 600); // 10 min CSRF window, overwritten on callback

  const params = new URLSearchParams({
    client_id: appId,
    redirect_uri: redirectUri,
    response_type: 'code',
    // Minimum scope for permitted profile/media read. Deeper insights
    // scopes (e.g. instagram_business_manage_insights) require additional
    // Meta App Review and are not requested until a real product need
    // justifies that review.
    scope: 'instagram_business_basic',
    state,
  });

  return send(res, 200, {
    configured: true,
    authorizeUrl: `https://api.instagram.com/oauth/authorize?${params.toString()}`,
  });
};
