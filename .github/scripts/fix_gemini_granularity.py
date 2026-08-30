from pathlib import Path
import json


def replace_block(text: str, start_marker: str, end_marker: str, replacement: str) -> str:
    start = text.find(start_marker)
    if start < 0:
        raise SystemExit(f"start marker missing: {start_marker[:70]}")
    end = text.find(end_marker, start)
    if end < 0:
        raise SystemExit(f"end marker missing: {end_marker[:70]}")
    return text[:start] + replacement + text[end:]


# 1) Return Gemini's real chunk granularity from upload init.
p = Path("api/video-upload-init.js")
s = p.read_text()
old = "const uploadToken = crypto.createHmac('sha256', apiKey).update(uploadUrl).digest('hex');\n    return send(res, 200, { configured: true, uploadUrl, uploadToken, displayName });"
new = "const uploadToken = crypto.createHmac('sha256', apiKey).update(uploadUrl).digest('hex');\n    const reportedGranularity = Number(startRes.headers.get('x-goog-upload-chunk-granularity') || 0);\n    const chunkGranularityBytes = Number.isFinite(reportedGranularity) && reportedGranularity > 0\n      ? reportedGranularity\n      : 8 * 1024 * 1024;\n    return send(res, 200, { configured: true, uploadUrl, uploadToken, displayName, chunkGranularityBytes });"
if "chunkGranularityBytes" not in s:
    if old not in s:
        raise SystemExit("upload-init return block not found")
    s = s.replace(old, new, 1)
p.write_text(s)


# 2) Browser sends Gemini-sized chunks directly. Vercel only queries accepted offset.
helper = r'''function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function queryGeminiUpload(uploadUrl, uploadToken) {
  const response = await fetch('/api/video-upload-query', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ uploadUrl, uploadToken }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.detail ? `${data.error} (${data.detail})` : (data.error || 'Could not confirm upload progress.'));
  }
  return data;
}

async function sendDirectGeminiChunk(uploadUrl, chunk, mimeType, offset, isFinal) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 150000);
  try {
    const response = await fetch(uploadUrl, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': mimeType,
        'X-Goog-Upload-Offset': String(offset),
        'X-Goog-Upload-Command': isFinal ? 'upload, finalize' : 'upload',
      },
      body: chunk,
    });
    if (response.ok) {
      let data = null;
      if (isFinal) {
        try { data = await response.json(); } catch {}
      }
      return { data };
    }
    return { data: null };
  } catch {
    // Firefox may hide Gemini's response because the upload response lacks CORS
    // headers. TrendDrop verifies the actual byte offset through Vercel next.
    return { data: null };
  } finally {
    clearTimeout(timer);
  }
}

async function uploadGeminiFile(uploadUrl, uploadToken, file, mimeType, reportedGranularity) {
  const fallback = 8 * 1024 * 1024;
  const parsed = Number(reportedGranularity);
  const granularity = Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
  let offset = 0;

  while (offset < file.size) {
    const remaining = file.size - offset;
    const chunkLength = remaining > granularity ? granularity : remaining;
    const end = offset + chunkLength;
    const isFinal = end >= file.size;
    const chunk = file.slice(offset, end);
    let accepted = false;
    let finalData = null;

    for (let attempt = 0; attempt < 3 && !accepted; attempt++) {
      const direct = await sendDirectGeminiChunk(uploadUrl, chunk, mimeType, offset, isFinal);
      if (direct.data?.file?.uri) return direct.data;
      finalData = direct.data || finalData;

      for (let poll = 0; poll < 12; poll++) {
        await sleep(poll === 0 ? 180 : 450);
        const status = await queryGeminiUpload(uploadUrl, uploadToken);
        const received = Number(status.sizeReceived || 0);
        if (received >= end || (isFinal && status.status && status.status !== 'active')) {
          accepted = true;
          break;
        }
        if (received > offset && received < end) {
          throw new Error(`The AI provider accepted only part of a video chunk (${received - offset} bytes). Please retry the upload.`);
        }
      }
    }

    if (!accepted) {
      throw new Error(`The AI provider did not confirm video bytes ${offset}-${end}. Please retry.`);
    }

    offset = end;
    if (isFinal) return finalData || {};
  }

  return {};
}'''

old_call = "uploadGeminiFile(initData.uploadUrl, initData.uploadToken, videoFile, uploadMimeType)"
new_call = "uploadGeminiFile(initData.uploadUrl, initData.uploadToken, videoFile, uploadMimeType, initData.chunkGranularityBytes)"

# Meme Remix
p = Path("js/meme-remix-app.js")
s = p.read_text()
s = replace_block(
    s,
    "async function uploadGeminiFile(uploadUrl, uploadToken, file, mimeType) {",
    "\n\nfunction openPicker",
    helper,
)
if old_call in s:
    s = s.replace(old_call, new_call, 1)
elif new_call not in s:
    raise SystemExit("meme upload call missing")
p.write_text(s)

# Viral Brain
p = Path("viral-brain.html")
s = p.read_text()
helper_inline = "\n".join(("  " + line if line else line) for line in helper.splitlines())
s = replace_block(
    s,
    "  async function uploadGeminiFile(uploadUrl, uploadToken, file, mimeType) {",
    "\n\n  function useVideoFile",
    helper_inline,
)
if old_call in s:
    s = s.replace(old_call, new_call, 1)
elif new_call not in s:
    raise SystemExit("viral upload call missing")
p.write_text(s)

# 3) Remove invalid 2 MiB Vercel media relay and retain only small query route.
Path("api/video-upload-chunk.js").unlink(missing_ok=True)
p = Path("vercel.json")
cfg = json.loads(p.read_text())
funcs = cfg.setdefault("functions", {})
funcs.pop("api/video-upload-chunk.js", None)
funcs["api/video-upload-query.js"] = {"maxDuration": 20}
p.write_text(json.dumps(cfg, indent=2) + "\n")
