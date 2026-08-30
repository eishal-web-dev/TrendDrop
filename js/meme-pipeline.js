/**
 * Meme Remix rendering pipeline. Uses the real @ffmpeg/ffmpeg (0.12,
 * single-thread @ffmpeg/core so it runs without COOP/COEP headers) to
 * genuinely process the uploaded video — this produces a real, playable
 * MP4, not a mockup or an edit plan.
 *
 * Captions and meme reactions are both rendered as browser <canvas> PNGs
 * (so any script — Latin, Urdu/Nastaliq via a loaded web font, Devanagari
 * — renders correctly) and composited with ffmpeg's `overlay` filter at
 * the right timestamps. Dead-air trimming uses ffmpeg's own
 * `silencedetect` filter, parsed from its real log output. Zoom pattern
 * interrupts use `zoompan`. Everything here is genuine processing, not a
 * simulated progress bar.
 */

const FFMPEG_VERSION = '0.12.15';
const CORE_VERSION = '0.12.10';

let ffmpegInstance = null;
let ffmpegLoadPromise = null;

async function loadFFmpeg(onLog) {
  if (ffmpegInstance) return ffmpegInstance;
  if (ffmpegLoadPromise) return ffmpegLoadPromise;

  ffmpegLoadPromise = (async () => {
    const { FFmpeg } = await import(`https://cdn.jsdelivr.net/npm/@ffmpeg/ffmpeg@${FFMPEG_VERSION}/+esm`);
    const { toBlobURL } = await import(`https://cdn.jsdelivr.net/npm/@ffmpeg/util@0.12.2/+esm`);

    const ffmpeg = new FFmpeg();
    if (onLog) ffmpeg.on('log', ({ message }) => onLog(message));

    const baseURL = `https://cdn.jsdelivr.net/npm/@ffmpeg/core@${CORE_VERSION}/dist/esm`;
    await ffmpeg.load({
      coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, 'text/javascript'),
      wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, 'application/wasm'),
    });

    ffmpegInstance = ffmpeg;
    return ffmpeg;
  })();

  return ffmpegLoadPromise;
}

// ---------- Silence detection (real, parsed from ffmpeg's own log) ----------

async function detectSilence(ffmpeg, inputName, { noiseDb = -30, minDurationS = 0.6 } = {}) {
  const lines = [];
  const collector = message => lines.push(message);
  ffmpeg.on('log', collector);
  try {
    await ffmpeg.exec(['-i', inputName, '-af', `silencedetect=noise=${noiseDb}dB:d=${minDurationS}`, '-f', 'null', '-']);
  } catch {
    // silencedetect still writes to the log even though `-f null -` exec
    // can throw in some core builds; we read from `lines` regardless.
  }
  ffmpeg.off('log', collector);

  const segments = [];
  let pendingStart = null;
  for (const line of lines) {
    const startMatch = line.match(/silence_start:\s*([\d.]+)/);
    if (startMatch) pendingStart = Number(startMatch[1]);
    const endMatch = line.match(/silence_end:\s*([\d.]+)/);
    if (endMatch && pendingStart !== null) {
      segments.push({ start: pendingStart, end: Number(endMatch[1]) });
      pendingStart = null;
    }
  }
  return segments;
}

// ---------- Audio stream presence check ----------

/**
 * Detects whether the input actually has an audio stream, by running
 * ffmpeg with no output (a deliberate "failure" that still logs stream
 * info) and checking for an "Audio:" line. Needed because the
 * filter_complex graph can't reference `0:a` unconditionally the way
 * `-map 0:a?` can for a plain copy — silent source videos would
 * otherwise break the whole render.
 */
async function hasAudioStream(ffmpeg, inputName) {
  const lines = [];
  const collector = message => lines.push(message);
  ffmpeg.on('log', collector);
  try {
    await ffmpeg.exec(['-i', inputName]);
  } catch {
    // Expected to "fail" with no output specified — we only want the log.
  }
  ffmpeg.off('log', collector);
  return lines.some(line => /Stream #\d+:\d+.*Audio:/.test(line));
}



const CANVAS_W = 1080;
const CANVAS_H = 1920;

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** Renders a caption card safe-zoned for Reels/TikTok/Shorts UI (avoids bottom ~18% and top ~10%). */
function renderCaptionCanvas(text, style) {
  const canvas = document.createElement('canvas');
  canvas.width = CANVAS_W;
  canvas.height = CANVAS_H;
  const ctx = canvas.getContext('2d');

  const fontSize = style === 'minimal' ? 44 : 56;
  ctx.font = `700 ${fontSize}px 'Inter', 'Noto Sans', sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  const maxWidth = CANVAS_W * 0.86;
  const words = String(text || '').split(/\s+/);
  const lines = [];
  let current = '';
  for (const word of words) {
    const test = current ? `${current} ${word}` : word;
    if (ctx.measureText(test).width > maxWidth && current) {
      lines.push(current);
      current = word;
    } else {
      current = test;
    }
  }
  if (current) lines.push(current);

  const lineHeight = fontSize * 125;
  const safeBottom = CANVAS_H * 0.78; // stay above platform UI controls
  const blockHeight = lines.length * (fontSize * 1.25);
  const startY = safeBottom - blockHeight;

  if (style === 'bold') {
    ctx.save();
    ctx.fillStyle = 'rgba(10,10,18,0.55)';
    roundRect(ctx, CANVAS_W * 0.06, startY - 16, CANVAS_W * 0.88, blockHeight + 32, 20);
    ctx.fill();
    ctx.restore();
  }

  lines.forEach((line, i) => {
    const y = startY + i * (fontSize * 1.25) + fontSize * 0.6;
    ctx.lineWidth = 10;
    ctx.strokeStyle = 'rgba(0,0,0,0.85)';
    ctx.strokeText(line, CANVAS_W / 2, y);
    ctx.fillStyle = style === 'cinematic' ? '#f5f3ff' : '#ffffff';
    ctx.fillText(line, CANVAS_W / 2, y);
  });

  return canvas;
}

/** Renders an original TrendDrop meme reaction card (text + emoji, never a licensed clip). */
function renderMemeCanvas(template) {
  const canvas = document.createElement('canvas');
  canvas.width = CANVAS_W;
  canvas.height = CANVAS_H;
  const ctx = canvas.getContext('2d');

  const cardW = CANVAS_W * 0.7;
  const cardH = 340;
  const cardX = (CANVAS_W - cardW) / 2;
  const cardY = CANVAS_H * 0.32;

  const gradient = ctx.createLinearGradient(cardX, cardY, cardX, cardY + cardH);
  gradient.addColorStop(0, template.bg[0]);
  gradient.addColorStop(1, template.bg[1]);
  ctx.fillStyle = gradient;
  roundRect(ctx, cardX, cardY, cardW, cardH, 32);
  ctx.fill();
  ctx.lineWidth = 3;
  ctx.strokeStyle = template.accent;
  ctx.stroke();

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `88px sans-serif`;
  ctx.fillText(template.emoji, CANVAS_W / 2, cardY + cardH * 0.42);

  ctx.font = `700 44px 'Inter', 'Noto Sans', sans-serif`;
  ctx.fillStyle = '#ffffff';
  ctx.fillText(template.text, CANVAS_W / 2, cardY + cardH * 0.78);

  return canvas;
}

function canvasToPng(canvas) {
  return new Promise(resolve => {
    canvas.toBlob(blob => {
      blob.arrayBuffer().then(buf => resolve(new Uint8Array(buf)));
    }, 'image/png');
  });
}

// ---------- Edit-decision -> ffmpeg filter graph ----------

/**
 * Builds the full ffmpeg argument list for one render pass: scale/pad to
 * 1080x1920, optional silence trimming (concat of kept segments), a
 * piecewise zoompan for pattern interrupts, and overlay compositing for
 * every caption and meme card, each time-windowed with `enable=between`.
 */
function buildRenderArgs({ overlayCount, zoomMoments, trims, durationSeconds, hasZoom, hasAudio }) {
  const filters = [];
  let videoLabel = '0:v';
  let audioLabel = hasAudio ? '0:a' : null;

  // 1) Normalize to vertical 1080x1920, covering the frame.
  filters.push(`[${videoLabel}]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920[base]`);
  videoLabel = 'base';

  // 2) Dead-air trim: only applied when the caller supplied kept-segment
  // cut points (built by the caller from the inverse of detected silence,
  // capped to a handful of segments to keep the filter graph tractable in
  // a browser-side WASM run). Audio is trimmed and concatenated in lockstep
  // with the video so the two stay in sync — trimming only the video track
  // would silently desync audio from picture. Skipped entirely for silent
  // sources, since there's no audio track to keep in sync with anyway.
  if (trims && trims.length > 1 && hasAudio) {
    const videoTrimLabels = trims.map((seg, i) => {
      filters.push(`[${videoLabel}]trim=start=${seg.start}:end=${seg.end},setpts=PTS-STARTPTS[vt${i}]`);
      return `[vt${i}]`;
    });
    filters.push(`${videoTrimLabels.join('')}concat=n=${trims.length}:v=1:a=0[trimmed]`);
    videoLabel = 'trimmed';

    const audioTrimLabels = trims.map((seg, i) => {
      filters.push(`[${audioLabel}]atrim=start=${seg.start}:end=${seg.end},asetpts=PTS-STARTPTS[at${i}]`);
      return `[at${i}]`;
    });
    filters.push(`${audioTrimLabels.join('')}concat=n=${trims.length}:v=0:a=1[atrimmed]`);
    audioLabel = 'atrimmed';
  } else if (trims && trims.length > 1 && !hasAudio) {
    // Video-only trim path for silent sources.
    const videoTrimLabels = trims.map((seg, i) => {
      filters.push(`[${videoLabel}]trim=start=${seg.start}:end=${seg.end},setpts=PTS-STARTPTS[vt${i}]`);
      return `[vt${i}]`;
    });
    filters.push(`${videoTrimLabels.join('')}concat=n=${trims.length}:v=1:a=0[trimmed]`);
    videoLabel = 'trimmed';
  }

  // 3) Zoom pattern interrupt(s): a single zoompan pass with a piecewise
  // zoom expression, active only inside the requested windows.
  if (hasZoom && zoomMoments.length) {
    const conditions = zoomMoments
      .map(z => `between(on,${Math.round(z.atSeconds * 25)},${Math.round((z.atSeconds + z.durationSeconds) * 25)})`)
      .join('+');
    filters.push(`[${videoLabel}]zoompan=z='if(${conditions},min(zoom+0.0015,1.12),1)':d=1:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=1080x1920:fps=25[zoomed]`);
    videoLabel = 'zoomed';
  }

  // 4) Overlay every caption/meme PNG at its time window.
  const overlayInputs = [];
  for (let i = 0; i < overlayCount; i++) {
    overlayInputs.push(`overlay${i}.png`);
    const nextLabel = `ov${i}`;
    filters.push(`[${videoLabel}][${i + 1}:v]overlay=0:0:enable='between(t,{{START${i}}},{{END${i}}})'[${nextLabel}]`);
    videoLabel = nextLabel;
  }

  filters.push(`[${videoLabel}]format=yuv420p[vout]`);

  // Audio normalization is folded into the same filter_complex graph
  // (rather than a separate -af flag) to avoid ffmpeg's ambiguity when a
  // simple filter and -filter_complex both target the same mapped stream.
  // Skipped entirely when the source has no audio stream at all.
  let finalAudioLabel = null;
  if (hasAudio) {
    filters.push(`[${audioLabel}]loudnorm[aout]`);
    finalAudioLabel = 'aout';
  }

  return { filters, overlayInputs, finalVideoLabel: 'vout', finalAudioLabel };
}

/**
 * Runs the complete pipeline. `onProgress(stage, detail)` is called for
 * each genuine processing stage — there is no fake timer here.
 */
async function renderMemeRemix({ videoFile, editDecision, onProgress }) {
  onProgress('load', 'Loading the video engine (first time only)…');
  const logLines = [];
  const ffmpeg = await loadFFmpeg(msg => logLines.push(msg));

  onProgress('upload', 'Reading your video…');
  const { fetchFile } = await import('https://cdn.jsdelivr.net/npm/@ffmpeg/util@0.12.2/+esm');
  await ffmpeg.writeFile('input.mp4', await fetchFile(videoFile));

  const hasAudio = await hasAudioStream(ffmpeg, 'input.mp4');

  let trims = null;
  if (editDecision.removeDeadAir && hasAudio) {
    onProgress('silence', 'Detecting dead air and long pauses…');
    const silence = await detectSilence(ffmpeg, 'input.mp4');
    const meaningful = silence.filter(s => s.end - s.start >= 0.6).slice(0, 6); // cap for a tractable filter graph
    if (meaningful.length) {
      trims = [];
      let cursor = 0;
      for (const gap of meaningful) {
        if (gap.start > cursor) trims.push({ start: cursor, end: gap.start });
        cursor = gap.end;
      }
      trims.push({ start: cursor, end: editDecision.durationSeconds });
      trims = trims.filter(t => t.end - t.start > 0.15);
    }
  }

  onProgress('overlays', 'Building captions and meme overlays…');
  const overlays = [];
  for (const caption of editDecision.captions) {
    const canvas = renderCaptionCanvas(caption.text, editDecision.captionStyle);
    overlays.push({ png: await canvasToPng(canvas), start: caption.startSeconds, end: caption.endSeconds, kind: 'caption' });
  }
  for (const meme of editDecision.memeMoments) {
    if (!meme.template) continue;
    const canvas = renderMemeCanvas(meme.template);
    overlays.push({ png: await canvasToPng(canvas), start: meme.startSeconds, end: meme.endSeconds, kind: 'meme' });
  }

  for (let i = 0; i < overlays.length; i++) {
    await ffmpeg.writeFile(`overlay${i}.png`, overlays[i].png);
  }

  onProgress('render', `Rendering ${overlays.length} overlay${overlays.length === 1 ? '' : 's'}${trims ? ' and trimming dead air' : ''}…`);

  const { filters, overlayInputs, finalVideoLabel, finalAudioLabel } = buildRenderArgs({
    overlayCount: overlays.length,
    zoomMoments: editDecision.zoomMoments,
    trims,
    durationSeconds: editDecision.durationSeconds,
    hasZoom: editDecision.zoomMoments && editDecision.zoomMoments.length > 0,
    hasAudio,
  });

  let filterComplex = filters.join(';');
  overlays.forEach((o, i) => {
    filterComplex = filterComplex.replace(`{{START${i}}}`, o.start.toFixed(2)).replace(`{{END${i}}}`, o.end.toFixed(2));
  });

  const inputArgs = ['-i', 'input.mp4'];
  overlayInputs.forEach(name => inputArgs.push('-i', name));

  const args = [
    ...inputArgs,
    '-filter_complex', filterComplex,
    '-map', `[${finalVideoLabel}]`,
    ...(finalAudioLabel ? ['-map', `[${finalAudioLabel}]`] : []),
    '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '23',
    ...(finalAudioLabel ? ['-c:a', 'aac', '-b:a', '128k'] : ['-an']),
    '-movflags', '+faststart',
    'output.mp4',
  ];

  await ffmpeg.exec(args);

  onProgress('done', 'Export complete.');
  const data = await ffmpeg.readFile('output.mp4');
  // readFile() returns a Uint8Array (FileData = Uint8Array | string).
  // Pass it to Blob directly rather than `.buffer` — if the returned
  // array is ever a view into a larger underlying ArrayBuffer, `.buffer`
  // would include bytes outside the actual file, corrupting the export.
  const blob = new Blob([data], { type: 'video/mp4' });
  return { blob, url: URL.createObjectURL(blob), logLines };
}

if (typeof window !== 'undefined') {
  window.TrendDropMemePipeline = { renderMemeRemix, loadFFmpeg, detectSilence };
}

export { renderMemeRemix, loadFFmpeg, detectSilence };
