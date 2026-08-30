const { send, parseBody, rateLimit, clientKey } = require('./_lib/http');

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return send(res, 405, { error: 'Use POST for this endpoint.' });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return send(res, 200, { configured: false, message: 'Video AI is not configured.' });

  if (!rateLimit(`video-resolve:${clientKey(req)}`, { limit: 12, windowMs: 60_000 })) {
    return send(res, 429, { error: 'Too many upload checks. Wait a moment and try again.' });
  }

  const body = parseBody(req);
  if (!body) return send(res, 400, { error: 'Invalid request body.' });

  const displayName = String(body.displayName || '').slice(0, 160);
  const fileSizeBytes = Number(body.fileSizeBytes);
  const mimeType = String(body.mimeType || '').toLowerCase();
  if (!displayName) return send(res, 400, { error: 'Upload ID is missing.' });

  try {
    // The browser successfully sends Gemini's resumable upload, but Gemini's
    // final POST response omits Access-Control-Allow-Origin. Firefox therefore
    // hides that JSON from client JS. Resolve the freshly-created File here
    // from the server, where CORS does not apply.
    for (let attempt = 0; attempt < 10; attempt++) {
      const listRes = await fetch('https://generativelanguage.googleapis.com/v1beta/files?pageSize=100', {
        headers: { 'x-goog-api-key': apiKey },
      });
      if (!listRes.ok) {
        const detail = await listRes.text().catch(() => '');
        console.error('[video-upload-resolve] list failed', listRes.status, detail.slice(0, 300));
        return send(res, 502, { error: 'Could not verify the uploaded video.' });
      }

      const data = await listRes.json();
      const match = (data.files || []).find(file => {
        if (file.displayName !== displayName) return false;
        if (Number.isFinite(fileSizeBytes) && fileSizeBytes > 0 && Number(file.sizeBytes) !== fileSizeBytes) return false;
        if (mimeType && file.mimeType && String(file.mimeType).toLowerCase() !== mimeType) return false;
        return file.state !== 'FAILED';
      });

      if (match?.uri) {
        return send(res, 200, {
          configured: true,
          file: {
            uri: match.uri,
            name: match.name,
            mimeType: match.mimeType || mimeType,
            state: match.state,
            sizeBytes: match.sizeBytes,
          },
        });
      }

      await sleep(550);
    }

    return send(res, 404, {
      error: 'The video did not finish uploading to the AI provider.',
      detail: 'The browser sent the upload but TrendDrop could not confirm the resulting file. Try again with a smaller MP4.',
    });
  } catch (error) {
    console.error('[video-upload-resolve]', error);
    return send(res, 500, { error: 'Could not verify the uploaded video.' });
  }
};
