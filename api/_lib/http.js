const ALLOWED_INSTAGRAM_HOSTS = new Set(['instagram.com', 'www.instagram.com', 'ig.me']);

function send(res, status, payload) {
  res.status(status);
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', status === 200
    ? 'public, s-maxage=120, stale-while-revalidate=600'
    : 'no-store');
  return res.end(JSON.stringify(payload));
}

function parseBody(req) {
  try {
    return typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
  } catch {
    return null;
  }
}

/** Only ever fetch instagram.com/ig.me (and Meta Graph for OAuth) — prevents SSRF via user-supplied URLs. */
function isAllowedInstagramUrl(rawUrl) {
  try {
    const parsed = new URL(rawUrl.startsWith('http') ? rawUrl : `https://${rawUrl}`);
    const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
    return ALLOWED_INSTAGRAM_HOSTS.has(host) || host === 'instagram.com';
  } catch {
    return false;
  }
}

function withTimeout(ms) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  return { signal: controller.signal, clear: () => clearTimeout(timer) };
}

/** Very small in-memory rate limiter. Serverless instances are ephemeral and
 * multi-region, so this is a best-effort throttle, not a hard guarantee —
 * sufficient to blunt casual abuse without adding a paid store (Redis/KV). */
const buckets = new Map();
function rateLimit(key, { limit, windowMs }) {
  const now = Date.now();
  const bucket = buckets.get(key) || [];
  const recent = bucket.filter(ts => now - ts < windowMs);
  if (recent.length >= limit) {
    buckets.set(key, recent);
    return false;
  }
  recent.push(now);
  buckets.set(key, recent);
  return true;
}

function clientKey(req) {
  return String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown').split(',')[0].trim();
}

module.exports = { send, parseBody, isAllowedInstagramUrl, withTimeout, rateLimit, clientKey };
