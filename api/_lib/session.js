const crypto = require('crypto');

/**
 * Encrypts the Instagram OAuth access token into an httpOnly cookie value.
 * The token is never sent to or stored in browser JavaScript — only this
 * encrypted blob touches the client, and only as an opaque httpOnly cookie.
 *
 * Requires COOKIE_SECRET (32 bytes, base64) in the environment.
 * Generate with: openssl rand -base64 32
 */
function getKey() {
  const raw = process.env.COOKIE_SECRET;
  if (!raw) throw new Error('COOKIE_SECRET is not configured');
  const key = Buffer.from(raw, 'base64');
  if (key.length !== 32) throw new Error('COOKIE_SECRET must decode to exactly 32 bytes');
  return key;
}

function encrypt(plainObject) {
  const key = getKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const plaintext = Buffer.from(JSON.stringify(plainObject), 'utf8');
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return [iv.toString('base64url'), authTag.toString('base64url'), encrypted.toString('base64url')].join('.');
}

function decrypt(token) {
  const key = getKey();
  const [ivB64, tagB64, dataB64] = String(token || '').split('.');
  if (!ivB64 || !tagB64 || !dataB64) return null;
  try {
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ivB64, 'base64url'));
    decipher.setAuthTag(Buffer.from(tagB64, 'base64url'));
    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(dataB64, 'base64url')),
      decipher.final(),
    ]);
    return JSON.parse(decrypted.toString('utf8'));
  } catch {
    return null;
  }
}

const COOKIE_NAME = 'td_ig_session';

function parseCookies(req) {
  const header = req.headers.cookie || '';
  return Object.fromEntries(
    header.split(';').map(part => part.trim()).filter(Boolean).map(part => {
      const idx = part.indexOf('=');
      return [decodeURIComponent(part.slice(0, idx)), decodeURIComponent(part.slice(idx + 1))];
    })
  );
}

function setSessionCookie(res, payload, maxAgeSeconds) {
  const value = encrypt(payload);
  res.setHeader('Set-Cookie', `${COOKIE_NAME}=${encodeURIComponent(value)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAgeSeconds}`);
}

function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', `${COOKIE_NAME}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`);
}

function readSession(req) {
  const cookies = parseCookies(req);
  const raw = cookies[COOKIE_NAME];
  if (!raw) return null;
  return decrypt(raw);
}

module.exports = { setSessionCookie, clearSessionCookie, readSession, COOKIE_NAME };
