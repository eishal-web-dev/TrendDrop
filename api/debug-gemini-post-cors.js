module.exports = async function handler(req, res) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return res.status(500).json({ ok:false, error:'missing key' });
  try {
    const size = 16;
    const startRes = await fetch('https://generativelanguage.googleapis.com/upload/v1beta/files', {
      method:'POST',
      headers:{
        'x-goog-api-key': apiKey,
        'X-Goog-Upload-Protocol':'resumable',
        'X-Goog-Upload-Command':'start',
        'X-Goog-Upload-Header-Content-Length': String(size),
        'X-Goog-Upload-Header-Content-Type':'video/mp4',
        'Content-Type':'application/json'
      },
      body: JSON.stringify({ file:{ display_name:'trenddrop-cors-post-test.mp4' } })
    });
    const uploadUrl = startRes.headers.get('x-goog-upload-url');
    if (!uploadUrl) return res.status(200).json({ok:false,startStatus:startRes.status,startBody:(await startRes.text()).slice(0,300)});
    const body = Buffer.alloc(size, 0);
    const up = await fetch(uploadUrl, {
      method:'POST',
      headers:{
        'Origin':'https://trenddrop-delta.vercel.app',
        'Content-Type':'video/mp4',
        'X-Goog-Upload-Offset':'0',
        'X-Goog-Upload-Command':'upload, finalize'
      },
      body
    });
    const text = await up.text();
    return res.status(200).json({
      ok:true,
      uploadStatus:up.status,
      allowOrigin:up.headers.get('access-control-allow-origin'),
      exposeHeaders:up.headers.get('access-control-expose-headers'),
      vary:up.headers.get('vary'),
      contentType:up.headers.get('content-type'),
      body:text.slice(0,500)
    });
  } catch (e) {
    return res.status(200).json({ok:false,error:String(e && e.message || e)});
  }
};
