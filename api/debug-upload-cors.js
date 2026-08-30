module.exports = async function handler(req, res) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return res.status(500).json({ ok: false, error: 'missing key' });
  try {
    const startRes = await fetch('https://generativelanguage.googleapis.com/upload/v1beta/files', {
      method: 'POST',
      headers: {
        'x-goog-api-key': apiKey,
        'X-Goog-Upload-Protocol': 'resumable',
        'X-Goog-Upload-Command': 'start',
        'X-Goog-Upload-Header-Content-Length': '1024',
        'X-Goog-Upload-Header-Content-Type': 'video/mp4',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ file: { display_name: 'trenddrop-cors-test.mp4' } })
    });
    const uploadUrl = startRes.headers.get('x-goog-upload-url');
    if (!startRes.ok || !uploadUrl) {
      return res.status(200).json({ ok: false, startStatus: startRes.status, startBody: (await startRes.text()).slice(0,300) });
    }
    const origin = 'https://trenddrop-delta.vercel.app';
    const opt = await fetch(uploadUrl, {
      method: 'OPTIONS',
      headers: {
        'Origin': origin,
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'x-goog-upload-command,x-goog-upload-offset'
      }
    });
    return res.status(200).json({
      ok: true,
      startStatus: startRes.status,
      optionsStatus: opt.status,
      allowOrigin: opt.headers.get('access-control-allow-origin'),
      allowMethods: opt.headers.get('access-control-allow-methods'),
      allowHeaders: opt.headers.get('access-control-allow-headers'),
      optionsBody: (await opt.text()).slice(0,300)
    });
  } catch (e) {
    return res.status(200).json({ ok: false, error: String(e && e.message || e) });
  }
};
