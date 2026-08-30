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
      body: JSON.stringify({ file: { display_name: 'trenddrop-upload-protocol-test.mp4' } })
    });
    const uploadUrl = startRes.headers.get('x-goog-upload-url');
    if (!startRes.ok || !uploadUrl) {
      return res.status(200).json({ ok: false, stage: 'start', status: startRes.status, body: (await startRes.text()).slice(0,300) });
    }

    const uploadRes = await fetch(uploadUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'video/mp4',
        'X-Goog-Upload-Offset': '0',
        'X-Goog-Upload-Command': 'upload, finalize'
      },
      body: Buffer.alloc(1024)
    });
    const body = await uploadRes.text();
    return res.status(200).json({
      ok: uploadRes.ok,
      startStatus: startRes.status,
      uploadStatus: uploadRes.status,
      uploadContentType: uploadRes.headers.get('content-type'),
      body: body.slice(0,500)
    });
  } catch (e) {
    return res.status(200).json({ ok: false, error: String(e && e.message || e) });
  }
};
