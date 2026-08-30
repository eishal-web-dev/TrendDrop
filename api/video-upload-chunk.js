const crypto = require('crypto');
const { send, rateLimit, clientKey, withTimeout } = require('./_lib/http');

const MAX_CHUNK_BYTES = 3 * 1024 * 1024;

function isAllowedGeminiUploadUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:'
      && url.hostname === 'generativelanguage.googleapis.com'
      && url.pathname.startsWith('/upload/');
  } catch {
    return false;
  }
}

function safeEqualHex(a, b) {
  if (!a || !b || a.length !== b.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));
  } catch {
    return false;
  }
}

async function readRawBody(req) {
  if (Buffer.isBuffer(req.body)) return req.body;
  if (req.body instanceof Uint8Array) return Buffer.from(req.body);

  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buf.length;
    if (total > MAX_CHUNK_BYTES) throw new Error('CHUNK_TOO_LARGE');
    chunks.push(buf);
  }
  return Buffer.concat(chunks);
}

async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return send(res, 405, { error: 'Use POST for this endpoint.' });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return send(res, 200, { configured: false, message: 'Video AI is not configured.' });

  if (!rateLimit(`video-chunk:${clientKey(req)}`, { limit: 140, windowMs: 5 * 60_000 })) {
    return send(res, 429, { error: 'Too many upload chunks. Wait a moment and try again.' });
  }

  const uploadUrl = String(req.headers['x-trenddrop-upload-url'] || '');
  const uploadToken = String(req.headers['x-trenddrop-upload-token'] || '');
  const offset = Number(req.headers['x-trenddrop-upload-offset']);
  const isFinal = String(req.headers['x-trenddrop-upload-final'] || '') === '1';

  if (!isAllowedGeminiUploadUrl(uploadUrl)) {
    return send(res, 400, { error: 'Invalid upload session.' });
  }
  if (!Number.isSafeInteger(offset) || offset < 0) {
    return send(res, 400, { error: 'Invalid upload offset.' });
  }

  const expectedToken = crypto.createHmac('sha256', apiKey).update(uploadUrl).digest('hex');
  if (!safeEqualHex(uploadToken, expectedToken)) {
    return send(res, 403, { error: 'Invalid upload token.' });
  }

  let rawBody;
  try {
    rawBody = await readRawBody(req);
  } catch (error) {
    if (error?.message === 'CHUNK_TOO_LARGE') {
      return send(res, 413, { error: 'Upload chunk is too large.' });
    }
    return send(res, 400, { error: 'Could not read upload chunk.' });
  }

  if (!rawBody.length || rawBody.length > MAX_CHUNK_BYTES) {
    return send(res, 400, { error: 'Upload chunk is empty or too large.' });
  }

  const { signal, clear } = withTimeout(55_000);
  try {
    const upstream = await fetch(uploadUrl, {
      method: 'POST',
      signal,
      headers: {
        'X-Goog-Upload-Offset': String(offset),
        'X-Goog-Upload-Command': isFinal ? 'upload, finalize' : 'upload',
      },
      body: rawBody,
    });

    const text = await upstream.text().catch(() => '');
    if (!upstream.ok) {
      console.error('[video-upload-chunk] Gemini upload failed', upstream.status, text.slice(0, 500));
      return send(res, 502, {
        error: 'The AI provider rejected part of the video upload.',
        detail: `HTTP ${upstream.status}: ${text.slice(0, 300)}`,
      });
    }

    if (!isFinal) {
      return send(res, 200, { ok: true, nextOffset: offset + rawBody.length });
    }

    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch {}
    if (!data?.file?.uri) {
      return send(res, 502, { error: 'The AI provider did not return the uploaded file reference.' });
    }
    return send(res, 200, data);
  } catch (error) {
    if (error?.name === 'AbortError') {
      return send(res, 504, { error: 'One upload chunk took too long. Please retry.' });
    }
    console.error('[video-upload-chunk] relay failed', error?.message || error);
    return send(res, 502, { error: 'Could not relay the video chunk to the AI provider.' });
  } finally {
    clear();
  }
}

module.exports = handler;
module.exports.config = { api: { bodyParser: false } };
