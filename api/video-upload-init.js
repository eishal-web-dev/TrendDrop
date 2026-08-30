const { send, parseBody, rateLimit, clientKey, withTimeout } = require('./_lib/http');

const MAX_BYTES = 200 * 1024 * 1024; // generous ceiling; duration is the real gate, enforced client-side (<=180s)
const ALLOWED_MIME = new Set(['video/mp4', 'video/quicktime', 'video/webm']);

/**
 * POST { fileSizeBytes, mimeType, displayName }
 *
 * Starts a resumable upload session with Gemini's File API using
 * GEMINI_API_KEY (server-side only) and returns just the upload URL.
 * The browser then PUTs the raw video bytes straight to that URL —
 * the video itself never passes through this function's body, which
 * keeps us well under Vercel's function payload limits, and the API key
 * never reaches client JavaScript.
 */
module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return send(res, 405, { error: 'Use POST for this endpoint.' });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return send(res, 200, { configured: false, message: 'Video AI is not configured.' });
  }

  if (!rateLimit(`video-init:${clientKey(req)}`, { limit: 8, windowMs: 60_000 })) {
    return send(res, 429, { error: 'Too many upload attempts. Wait a moment and try again.' });
  }

  const body = parseBody(req);
  if (!body) return send(res, 400, { error: 'Invalid request body.' });

  const fileSizeBytes = Number(body.fileSizeBytes);
  const requestedMimeType = String(body.mimeType || '').toLowerCase();
  const originalDisplayName = String(body.displayName || 'trenddrop-upload').slice(0, 80).replace(/[^\w.\- ]/g, '_');
  const uniquePrefix = `trenddrop-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
  const displayName = `${uniquePrefix}-${originalDisplayName}`.slice(0, 150);
  const ext = originalDisplayName.includes('.') ? originalDisplayName.split('.').pop().toLowerCase() : '';
  const mimeType = ALLOWED_MIME.has(requestedMimeType)
    ? requestedMimeType
    : ({ mp4: 'video/mp4', m4v: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm' }[ext] || '');

  if (!Number.isFinite(fileSizeBytes) || fileSizeBytes <= 0 || fileSizeBytes > MAX_BYTES) {
    return send(res, 400, { error: 'File size is missing or too large.' });
  }
  if (!ALLOWED_MIME.has(mimeType)) {
    return send(res, 400, { error: 'Only MP4, MOV, and WebM are supported.' });
  }

  const { signal, clear } = withTimeout(15000);
  try {
    const startRes = await fetch('https://generativelanguage.googleapis.com/upload/v1beta/files', {
      method: 'POST',
      signal,
      headers: {
        'x-goog-api-key': apiKey,
        'X-Goog-Upload-Protocol': 'resumable',
        'X-Goog-Upload-Command': 'start',
        'X-Goog-Upload-Header-Content-Length': String(fileSizeBytes),
        'X-Goog-Upload-Header-Content-Type': mimeType,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ file: { display_name: displayName } }),
    });

    if (!startRes.ok) {
      const errBody = await startRes.text().catch(() => '');
      console.error('[video-upload-init] Gemini start-upload failed', startRes.status, errBody.slice(0, 500));
      const locationBlocked = /user location is not supported/i.test(errBody);
      return send(res, 502, {
        error: locationBlocked
          ? 'Gemini is blocking requests from this server\u2019s region.'
          : 'Could not start the video upload with the AI provider.',
        detail: locationBlocked
          ? 'The Vercel function region (see vercel.json "regions") is currently in a country Gemini\u2019s API blocks, even though the same account works fine from a browser. Fix: change "regions" in vercel.json to a supported region such as "iad1" (US East) and redeploy.'
          : `HTTP ${startRes.status}: ${errBody.slice(0, 300)}`,
      });
    }

    const uploadUrl = startRes.headers.get('x-goog-upload-url');
    if (!uploadUrl) {
      return send(res, 502, { error: 'The AI provider did not return an upload URL.' });
    }

    return send(res, 200, { configured: true, uploadUrl, displayName });
  } catch (error) {
    if (error?.name === 'AbortError') return send(res, 504, { error: 'The AI provider took too long to respond.' });
    return send(res, 500, { error: 'Could not start the video upload.' });
  } finally {
    clear();
  }
};
