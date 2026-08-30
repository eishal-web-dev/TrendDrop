const http = require('http');

const PORT = Number(process.env.PORT || 3000);
const MAX_BYTES = 210 * 1024 * 1024;
const ALLOWED_ORIGINS = new Set([
  'https://trenddrop-delta.vercel.app',
  'https://trenddrop-ash-d0707d97.vercel.app',
  'https://trenddrop-git-main-ash-d0707d97.vercel.app'
]);

function cors(req, res) {
  const origin = String(req.headers.origin || '');
  if (ALLOWED_ORIGINS.has(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS, GET');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Content-Length, X-Goog-Upload-Offset, X-Goog-Upload-Command');
  res.setHeader('Access-Control-Max-Age', '86400');
}

function json(res, status, payload) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(payload));
}

function validTarget(raw) {
  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:') return null;
    if (url.hostname !== 'generativelanguage.googleapis.com') return null;
    if (!url.pathname.startsWith('/upload/v1beta/files')) return null;
    return url;
  } catch {
    return null;
  }
}

const server = http.createServer(async (req, res) => {
  cors(req, res);

  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    return res.end();
  }

  if (req.method === 'GET' && req.url === '/health') {
    return json(res, 200, { ok: true, service: 'trenddrop-upload-proxy' });
  }

  if (req.method !== 'POST') {
    return json(res, 405, { error: 'Use POST.' });
  }

  const requestUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  if (requestUrl.pathname !== '/upload') {
    return json(res, 404, { error: 'Not found.' });
  }

  const origin = String(req.headers.origin || '');
  if (origin && !ALLOWED_ORIGINS.has(origin)) {
    return json(res, 403, { error: 'Origin not allowed.' });
  }

  const target = validTarget(requestUrl.searchParams.get('target') || '');
  if (!target) {
    return json(res, 400, { error: 'Invalid upload target.' });
  }

  const declared = Number(req.headers['content-length'] || 0);
  if (!Number.isFinite(declared) || declared <= 0 || declared > MAX_BYTES) {
    return json(res, 413, { error: 'Video is missing or too large.' });
  }

  try {
    const headers = {
      'Content-Length': String(declared),
      'X-Goog-Upload-Offset': String(req.headers['x-goog-upload-offset'] || '0'),
      'X-Goog-Upload-Command': String(req.headers['x-goog-upload-command'] || 'upload, finalize')
    };

    const upstream = await fetch(target, {
      method: 'POST',
      headers,
      body: req,
      duplex: 'half'
    });

    const text = await upstream.text();
    res.statusCode = upstream.status;
    const contentType = upstream.headers.get('content-type');
    if (contentType) res.setHeader('Content-Type', contentType);
    else res.setHeader('Content-Type', 'application/json; charset=utf-8');
    return res.end(text);
  } catch (error) {
    console.error('[upload-proxy] relay failed', error);
    return json(res, 502, { error: 'Could not relay the video upload.' });
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`TrendDrop upload proxy listening on ${PORT}`);
});
