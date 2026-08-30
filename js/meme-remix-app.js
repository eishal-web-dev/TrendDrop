import { renderMemeRemix } from './meme-pipeline.js';

const $ = id => document.getElementById(id);

// meme-templates.js is loaded as a classic (non-module) script; it
// attaches its exports to `window` explicitly since `const` at classic-
// script top level does not do that automatically.
const TAGS = window.TAG_DATA;
const pickTemplateForMoment = window.pickTemplateForMoment;

const DEFAULTS = {
  platform: 'Instagram Reels',
  audience: 'Global',
  language: 'English',
  memeStyle: ['global-genz'],
  videoType: 'Talking head',
  intensity: 'Balanced',
  goal: 'More watch time',
  captionStyle: 'Bold viral captions',
};

const state = { ...DEFAULTS, memeStyle: [...DEFAULTS.memeStyle] };
let videoFile = null;
let demoMode = false;
let lastAnalysis = null;
let lastEditDecision = null;
let lastRenderResult = null;
let cancelRequested = false;

function showToast(message) {
  $('toast').textContent = message;
  $('toast').classList.add('active');
  clearTimeout(window._toastTimer);
  window._toastTimer = setTimeout(() => $('toast').classList.remove('active'), 2400);
}

// ---------- Tag chip rendering ----------
function renderChips() {
  document.querySelectorAll('.chips').forEach(container => {
    const group = container.dataset.group;
    const mode = container.dataset.mode;
    const options = group === 'memeStyle'
      ? TAGS.memeStyle.map(t => ({ id: t.id, label: t.label }))
      : TAGS[group].map(v => ({ id: v, label: v }));

    container.innerHTML = options.map(opt => {
      const selected = mode === 'multi' ? state[group].includes(opt.id) : state[group] === opt.id;
      return `<button type="button" class="chip${selected ? ' selected' : ''}" data-value="${opt.id}">${opt.label}</button>`;
    }).join('');

    container.querySelectorAll('.chip').forEach(chip => {
      chip.addEventListener('click', () => {
        const value = chip.dataset.value;
        if (mode === 'multi') {
          const list = state[group];
          const idx = list.indexOf(value);
          if (idx >= 0) list.splice(idx, 1);
          else if (list.length < 3) list.push(value);
          else { showToast('Pick up to 3 meme styles'); return; }
        } else {
          state[group] = value;
        }
        renderChips();
      });
    });
  });
}
renderChips();

$('topicInput').addEventListener('input', () => {
  $('charCount').textContent = $('topicInput').value.length;
});

// ---------- Upload handling ----------
const ALLOWED_TYPES = new Set(['video/mp4', 'video/quicktime', 'video/webm']);
const VIDEO_MIME_BY_EXT = { mp4: 'video/mp4', m4v: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm' };

function normalizeVideoMime(file) {
  const type = String(file?.type || '').toLowerCase();
  if (ALLOWED_TYPES.has(type)) return type;
  const name = String(file?.name || '');
  const ext = name.includes('.') ? name.split('.').pop().toLowerCase() : '';
  return VIDEO_MIME_BY_EXT[ext] || '';
}

function uploadGeminiFile(uploadUrl, file, mimeType) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', uploadUrl, true);
    xhr.setRequestHeader('Content-Type', mimeType);
    xhr.setRequestHeader('X-Goog-Upload-Offset', '0');
    xhr.setRequestHeader('X-Goog-Upload-Command', 'upload, finalize');
    xhr.timeout = 180000;
    xhr.onload = () => {
      let data = null;
      try { data = JSON.parse(xhr.responseText || '{}'); } catch {}
      if (xhr.status >= 200 && xhr.status < 300) resolve(data || {});
      else reject(new Error(`Video upload failed (HTTP ${xhr.status || 'unknown'}).`));
    };
    xhr.onerror = () => reject(new Error('The browser could not send the video to the AI provider. Check the connection and try again.'));
    xhr.ontimeout = () => reject(new Error('The video upload timed out. Try a smaller file or a faster connection.'));
    xhr.send(file);
  });
}

function openPicker() { $('videoInput').click(); }
$('uploadZone').addEventListener('click', openPicker);
$('uploadZone').addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openPicker(); } });
['dragenter', 'dragover'].forEach(t => $('uploadZone').addEventListener(t, e => { e.preventDefault(); $('uploadZone').classList.add('drag'); }));
['dragleave', 'drop'].forEach(t => $('uploadZone').addEventListener(t, e => { e.preventDefault(); $('uploadZone').classList.remove('drag'); }));
$('uploadZone').addEventListener('drop', e => { const f = e.dataTransfer.files?.[0]; if (f) useVideoFile(f); });
$('videoInput').addEventListener('change', e => { const f = e.target.files?.[0]; if (f) useVideoFile(f); });

function formatBytes(bytes) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function useVideoFile(file) {
  if (!normalizeVideoMime(file)) { showToast('Please choose an MP4, MOV, WebM, or M4V file'); return; }
  if (file.size > 200 * 1024 * 1024) { showToast('Keep uploads under 200 MB'); return; }
  demoMode = false;
  videoFile = file;
  const url = URL.createObjectURL(file);
  const video = document.createElement('video');
  video.src = url; video.muted = true; video.playsInline = true; video.preload = 'metadata';
  video.addEventListener('loadedmetadata', () => {
    const duration = Number.isFinite(video.duration) ? video.duration : null;
    if (duration && duration > 180) {
      showToast(`This video is ${Math.round(duration)}s — Meme Remix supports up to 3 minutes. Trim it and re-upload.`);
      videoFile = null;
      $('makeViralBtn').disabled = true;
      $('fileMeta').textContent = `${formatBytes(file.size)} · ${Math.round(duration)}s — too long, max 3 min`;
      return;
    }
    $('fileMeta').textContent = `${formatBytes(file.size)} · ${duration ? Math.round(duration) + 's' : 'duration unknown'}`;
  });
  $('fileThumb').replaceChildren(video);
  $('fileName').textContent = file.name;
  $('fileMeta').textContent = `${formatBytes(file.size)} · reading duration…`;
  $('fileCard').classList.add('active');
  $('makeViralBtn').disabled = false;
}

$('removeFile').addEventListener('click', () => {
  videoFile = null;
  demoMode = false;
  $('videoInput').value = '';
  $('fileCard').classList.remove('active');
  $('fileThumb').textContent = '▶';
  $('makeViralBtn').disabled = true;
});

$('demoBtn').addEventListener('click', () => {
  demoMode = true;
  videoFile = null;
  $('fileThumb').textContent = '▶';
  $('fileName').textContent = 'sample-demo.mp4 (SAMPLE DEMO DATA)';
  $('fileMeta').textContent = 'No file uploaded — sample demo data only';
  $('fileCard').classList.add('active');
  $('makeViralBtn').disabled = false;
  showToast('Sample demo data loaded — no real video will be rendered');
});

// ---------- Edit-decision building ----------
const INTENSITY_LIMITS = {
  Light: { memes: 1, zoom: 0, deadAir: false },
  Balanced: { memes: 4, zoom: 2, deadAir: true },
  Maximum: { memes: 7, zoom: 3, deadAir: true },
};

const CAPTION_STYLE_MAP = {
  'Meme subtitles': 'bold',
  'Bold viral captions': 'bold',
  'Minimal clean': 'minimal',
  'Cinematic': 'cinematic',
  'MrBeast-style emphasis': 'bold',
  'Urdu/Hindi subtitles': 'bold',
};

function buildEditDecision(analysis) {
  const limits = INTENSITY_LIMITS[state.intensity] || INTENSITY_LIMITS.Balanced;
  const familySafeOnly = state.memeStyle.includes('clean');

  const captions = (analysis.transcriptSegments || []).map(seg => ({
    text: seg.text,
    startSeconds: seg.startSeconds,
    endSeconds: Math.max(seg.endSeconds, seg.startSeconds + 0.8),
  }));

  const rankedMoments = [...(analysis.moments || [])]
    .filter(m => m.type !== 'boring')
    .sort((a, b) => a.startSeconds - b.startSeconds)
    .slice(0, limits.memes);

  const memeMoments = rankedMoments.map(m => {
    const template = pickTemplateForMoment
      ? pickTemplateForMoment(m, state.memeStyle, familySafeOnly)
      : null;
    return {
      startSeconds: m.startSeconds,
      endSeconds: Math.max(m.endSeconds, m.startSeconds + 1.1),
      type: m.type,
      description: m.description,
      template,
    };
  }).filter(m => m.template);

  const zoomSource = (analysis.moments || []).filter(m => ['shock', 'realization', 'success'].includes(m.type));
  const zoomMoments = zoomSource.slice(0, limits.zoom).map(m => ({ atSeconds: m.startSeconds, durationSeconds: 0.6 }));

  return {
    durationSeconds: analysis.durationSeconds || 30,
    captions,
    memeMoments,
    zoomMoments,
    captionStyle: CAPTION_STYLE_MAP[state.captionStyle] || 'bold',
    removeDeadAir: limits.deadAir,
    intensity: state.intensity,
    tags: { ...state },
  };
}

// ---------- Progress UI ----------
const STAGE_ORDER = ['upload', 'speech', 'moments', 'memes', 'captions', 'render'];
function setStage(stageKey, percent, title, copy) {
  $('progressOrb').style.setProperty('--progress', `${percent}%`);
  $('progressPercent').textContent = `${percent}%`;
  $('progressTitle').textContent = title;
  $('progressCopy').textContent = copy;
  const items = [...document.querySelectorAll('.stage-item')];
  const idx = STAGE_ORDER.indexOf(stageKey);
  items.forEach((item, i) => {
    if (i < idx) { item.classList.add('done'); item.querySelector('.stage-mark').textContent = '✓'; }
  });
}

function resetStages() {
  document.querySelectorAll('.stage-item').forEach(item => {
    item.classList.remove('done');
    item.querySelector('.stage-mark').textContent = '○';
  });
}

// ---------- Main flow ----------
$('makeViralBtn').addEventListener('click', runPipeline);
$('cancelBtn').addEventListener('click', () => {
  cancelRequested = true;
  showToast('Cancelling…');
});

async function runPipeline() {
  $('emptyState').style.display = 'none';
  $('previewState').classList.remove('active');
  $('progressState').classList.add('active');
  $('workspaceStatus').textContent = 'PROCESSING';
  $('errorBanner').style.display = 'none';
  resetStages();
  cancelRequested = false;

  if (demoMode) {
    await runDemoFlow();
    return;
  }

  try {
    setStage('upload', 8, 'Uploading…', 'Sending your video to the AI analyzer.');
    const uploadMimeType = normalizeVideoMime(videoFile);
    const initRes = await fetch('/api/video-upload-init', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fileSizeBytes: videoFile.size, mimeType: uploadMimeType, displayName: videoFile.name }),
    });
    const initData = await initRes.json();
    if (initData.configured === false) return showAiNotConfigured();
    if (!initRes.ok || !initData.uploadUrl) throw new Error(initData.detail ? `${initData.error} (${initData.detail})` : (initData.error || 'Could not start the upload.'));
    if (cancelRequested) return backToEmpty();

    const uploaded = await uploadGeminiFile(initData.uploadUrl, videoFile, uploadMimeType);
    const fileUri = uploaded?.file?.uri;
    const mimeType = uploaded?.file?.mimeType || uploadMimeType;
    if (!fileUri) throw new Error('The AI provider did not confirm the upload.');
    if (cancelRequested) return backToEmpty();

    setStage('speech', 22, 'Reading speech…', 'Transcribing what is actually said in your video.');
    setStage('moments', 32, 'Detecting moments…', 'Finding jokes, pauses, shocks, and realizations.');

    const topic = $('topicInput').value.trim();
    const analyzeRes = await fetch('/api/video-analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fileUri, mimeType, topic }),
    });
    const analyzeData = await analyzeRes.json();
    if (analyzeData.configured === false) return showAiNotConfigured();
    if (!analyzeRes.ok) throw new Error(analyzeData.detail ? `${analyzeData.error} (${analyzeData.detail})` : (analyzeData.error || 'Video analysis failed.'));
    if (cancelRequested) return backToEmpty();

    lastAnalysis = analyzeData.analysis;
    setStage('memes', 45, 'Matching memes…', 'Picking reactions that fit each real moment and your chosen style.');
    lastEditDecision = buildEditDecision(lastAnalysis);
    setStage('captions', 55, 'Building captions…', 'Rendering caption cards from the real transcript.');

    const result = await renderMemeRemix({
      videoFile,
      editDecision: lastEditDecision,
      onProgress: (stage, detail) => {
        const percentMap = { load: 58, upload: 62, silence: 68, overlays: 75, render: 90, done: 100 };
        setStage('render', percentMap[stage] || 80, stageTitle(stage), detail);
      },
    });

    lastRenderResult = result;
    showPreview({ demo: false });
  } catch (error) {
    showError(error.message || 'Something went wrong during rendering.');
  }
}

function stageTitle(stage) {
  return {
    load: 'Loading the video engine…',
    upload: 'Reading your video…',
    silence: 'Detecting dead air…',
    overlays: 'Rendering overlays…',
    render: 'Exporting MP4…',
    done: 'Export complete',
  }[stage] || 'Processing…';
}

function showAiNotConfigured() {
  $('progressState').classList.remove('active');
  $('emptyState').style.display = 'grid';
  $('workspaceStatus').textContent = 'VIDEO AI NOT CONFIGURED';
  showToast('Video AI is not configured on this server (missing GEMINI_API_KEY)');
}

function backToEmpty() {
  $('progressState').classList.remove('active');
  $('emptyState').style.display = 'grid';
  $('workspaceStatus').textContent = 'WAITING FOR A VIDEO';
}

function showError(message) {
  $('progressState').classList.remove('active');
  $('previewState').classList.add('active');
  $('previewLayout').style.display = 'none';
  $('errorBanner').style.display = 'block';
  $('errorBanner').textContent = message;
  $('workspaceStatus').textContent = 'RENDER FAILED';
  showToast('Rendering failed');
}

async function runDemoFlow() {
  const stages = [
    ['upload', 15, 'Uploading…', 'Sample demo data.'],
    ['speech', 35, 'Reading speech…', 'Sample demo data.'],
    ['moments', 50, 'Detecting moments…', 'Sample demo data.'],
    ['memes', 65, 'Matching memes…', 'Sample demo data.'],
    ['captions', 80, 'Building captions…', 'Sample demo data.'],
    ['render', 100, 'Sample ready', 'No real video was rendered — this is a preview of the plan only.'],
  ];
  for (const [key, pct, title, copy] of stages) {
    setStage(key, pct, title, copy);
    await new Promise(r => setTimeout(r, 320));
  }
  lastAnalysis = DEMO_ANALYSIS;
  lastEditDecision = buildEditDecision(lastAnalysis);
  lastRenderResult = null;
  showPreview({ demo: true });
}

// ---------- Preview + timeline ----------
function showPreview({ demo }) {
  $('progressState').classList.remove('active');
  $('previewState').classList.add('active');
  $('previewLayout').style.display = 'grid';
  $('errorBanner').style.display = 'none';
  $('demoBanner').style.display = demo ? 'block' : 'none';
  $('workspaceStatus').textContent = demo ? 'SAMPLE DEMO DATA' : 'EXPORT READY';
  $('workspaceStatus').classList.add('ready');

  if (demo) {
    $('previewVideo').removeAttribute('src');
    $('downloadMp4').removeAttribute('href');
    $('downloadMp4').textContent = 'No video to download (demo)';
  } else if (lastRenderResult) {
    $('previewVideo').src = lastRenderResult.url;
    $('downloadMp4').href = lastRenderResult.url;
    $('downloadMp4').textContent = '↓ Download MP4';
  }

  const jsonBlob = new Blob([JSON.stringify({ analysis: lastAnalysis, editDecision: stripTemplateFns(lastEditDecision) }, null, 2)], { type: 'application/json' });
  $('downloadJson').href = URL.createObjectURL(jsonBlob);

  const srt = buildSrt(lastEditDecision.captions);
  $('downloadSrt').href = URL.createObjectURL(new Blob([srt], { type: 'text/plain' }));

  renderTimeline();
}

function stripTemplateFns(editDecision) {
  return {
    ...editDecision,
    memeMoments: editDecision.memeMoments.map(m => ({ ...m, template: m.template ? { id: m.template.id, text: m.template.text, emoji: m.template.emoji } : null })),
  };
}

function srtTime(seconds) {
  const ms = Math.round((seconds % 1) * 1000);
  const total = Math.floor(seconds);
  const h = String(Math.floor(total / 3600)).padStart(2, '0');
  const m = String(Math.floor((total % 3600) / 60)).padStart(2, '0');
  const s = String(total % 60).padStart(2, '0');
  return `${h}:${m}:${s},${String(ms).padStart(3, '0')}`;
}

function buildSrt(captions) {
  return captions.map((c, i) => `${i + 1}\n${srtTime(c.startSeconds)} --> ${srtTime(c.endSeconds)}\n${c.text}\n`).join('\n');
}

function renderTimeline() {
  const items = [
    ...lastEditDecision.captions.map((c, i) => ({ kind: 'caption', index: i, time: c.startSeconds, label: `Caption: "${c.text}"` })),
    ...lastEditDecision.memeMoments.map((m, i) => ({ kind: 'meme', index: i, time: m.startSeconds, label: `Meme (${m.type}): ${m.template.text} ${m.template.emoji}` })),
    ...lastEditDecision.zoomMoments.map((z, i) => ({ kind: 'zoom', index: i, time: z.atSeconds, label: 'Zoom pattern interrupt' })),
  ].sort((a, b) => a.time - b.time);

  $('timelineTitle').textContent = `What TrendDrop changed (${items.length})`;
  $('timelineList').innerHTML = items.length
    ? items.map(item => `<div class="timeline-item" data-kind="${item.kind}" data-index="${item.index}">
        <span class="tl-time">${Math.round(item.time)}s</span>
        <span class="tl-desc">${escapeHtml(item.label)}</span>
        <button class="tl-remove" data-kind="${item.kind}" data-index="${item.index}" type="button">✕</button>
      </div>`).join('')
    : '<p style="color:var(--muted);font-size:12px">No edits were added — try Balanced or Maximum intensity.</p>';

  document.querySelectorAll('.tl-remove').forEach(btn => {
    btn.addEventListener('click', () => {
      const { kind, index } = btn.dataset;
      const key = kind === 'caption' ? 'captions' : kind === 'meme' ? 'memeMoments' : 'zoomMoments';
      lastEditDecision[key].splice(Number(index), 1);
      renderTimeline();
      showToast('Removed — click Re-render to update the MP4');
    });
  });
}

function escapeHtml(value) {
  const div = document.createElement('div');
  div.textContent = value;
  return div.innerHTML;
}

$('rerenderBtn').addEventListener('click', async () => {
  if (demoMode || !videoFile) { showToast('Upload a real video to render — demo mode has no video to re-render'); return; }
  $('previewState').classList.remove('active');
  $('progressState').classList.add('active');
  resetStages();
  try {
    const result = await renderMemeRemix({
      videoFile,
      editDecision: lastEditDecision,
      onProgress: (stage, detail) => setStage('render', { load: 60, upload: 65, silence: 72, overlays: 82, render: 92, done: 100 }[stage] || 80, stageTitle(stage), detail),
    });
    lastRenderResult = result;
    showPreview({ demo: false });
    showToast('Re-rendered with your changes');
  } catch (error) {
    showError(error.message || 'Re-render failed.');
  }
});

const DEMO_ANALYSIS = {
  durationSeconds: 28,
  transcript: '[Sample demo data]',
  transcriptSegments: [
    { text: '[Sample] Okay nobody told me this before I started', startSeconds: 0, endSeconds: 3.2 },
    { text: '[Sample] and honestly it changed everything', startSeconds: 3.4, endSeconds: 6.1 },
  ],
  moments: [
    { startSeconds: 1.5, endSeconds: 2.8, type: 'confusion', description: 'Sample demo moment.' },
    { startSeconds: 9, endSeconds: 10.5, type: 'realization', description: 'Sample demo moment.' },
    { startSeconds: 15, endSeconds: 16.5, type: 'joke', description: 'Sample demo moment.' },
  ],
};
