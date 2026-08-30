const crypto = require('crypto');
const { send, parseBody, rateLimit, clientKey, withTimeout } = require('./_lib/http');

function validGeminiUploadUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname === 'generativelanguage.googleapis.com';
  } catch {
    return false;
  }
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return send(res, 405, { error: 'Use POST for this endpoint.' });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return send(res, 200, { configured: false });

  if (!rateLimit(`video-query:${clientKey(req)}`, { limit: 120, windowMs: 60_000 })) {
    return send(res, 429, { error: 'Too many upload status checks. Wait a moment and retry.' });
  }

  const body = parseBody(req);
  if (!body) return send(res, 400, { error: 'Invalid request body.' });

  const uploadUrl = String(body.uploadUrl || '');
  const uploadToken = String(body.uploadToken || '');
  if (!validGeminiUploadUrl(uploadUrl)) return send(res, 400, { error: 'Invalid upload session.' });

  const expectedToken = crypto.createHmac('sha256', apiKey).update(uploadUrl).digest('hex');
  const a = Buffer.from(uploadToken);
  const b = Buffer.from(expectedToken);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return send(res, 403, { error: 'Invalid upload token.' });
  }

  const { signal, clear } = withTimeout(15000);
  try {
    const queryRes = await fetch(uploadUrl, {
      method: 'POST',
      signal,
      headers: { 'X-Goog-Upload-Command': 'query' },
    });

    const sizeReceived = Number(queryRes.headers.get('x-goog-upload-size-received') || 0);
    const status = String(queryRes.headers.get('x-goog-upload-status') || '').toLowerCase();
    if (!queryRes.ok) {
      const text = await queryRes.text().catch(() => '');
      return send(res, 502, {
        error: 'Could not confirm video upload progress.',
        detail: `HTTP ${queryRes.status}: ${text.slice(0, 220)}`,
      });
    }

    return send(res, 200, {
      configured: true,
      sizeReceived: Number.isFinite(sizeReceived) ? sizeReceived : 0,
      status,
    });
  } catch (error) {
    if (error?.name === 'AbortError') return send(res, 504, { error: 'Upload status check timed out.' });
    return send(res, 500, { error: 'Could not check upload progress.' });
  } finally {
    clear();
  }
};
