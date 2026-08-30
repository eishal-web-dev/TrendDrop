const { send, parseBody, rateLimit, clientKey, withTimeout } = require('./_lib/http');

const MODEL = 'gemini-2.5-flash';

// One structured schema covers both Viral Brain's "improve my draft" flow
// and Meme Remix's "find edit moments" flow, so both features share one
// real analysis call instead of duplicating prompt logic.
const RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    transcript: { type: 'string' },
    transcriptSegments: {
      type: 'array',
      description: 'Speech broken into short caption-length segments with real timestamps from the video.',
      items: {
        type: 'object',
        properties: {
          text: { type: 'string' },
          startSeconds: { type: 'number' },
          endSeconds: { type: 'number' },
        },
        required: ['text', 'startSeconds', 'endSeconds'],
      },
    },
    language: { type: 'string' },
    durationSeconds: { type: 'number' },
    hook: {
      type: 'object',
      properties: {
        whatHappens: { type: 'string' },
        strength: { type: 'string', enum: ['Strong', 'Moderate', 'Weak'] },
        why: { type: 'string' },
      },
      required: ['whatHappens', 'strength', 'why'],
    },
    pacingIssues: { type: 'array', items: { type: 'string' } },
    deadAir: {
      type: 'array',
      items: {
        type: 'object',
        properties: { startSeconds: { type: 'number' }, endSeconds: { type: 'number' } },
        required: ['startSeconds', 'endSeconds'],
      },
    },
    onScreenText: { type: 'string' },
    captionIssues: { type: 'array', items: { type: 'string' } },
    strongestMoment: {
      type: 'object',
      properties: { timestamp: { type: 'string' }, description: { type: 'string' } },
      required: ['timestamp', 'description'],
    },
    weakestMoment: {
      type: 'object',
      properties: { timestamp: { type: 'string' }, description: { type: 'string' } },
      required: ['timestamp', 'description'],
    },
    sceneChanges: { type: 'array', items: { type: 'string' } },
    moments: {
      type: 'array',
      description: 'Emotional/comedic beats useful for meme placement.',
      items: {
        type: 'object',
        properties: {
          startSeconds: { type: 'number' },
          endSeconds: { type: 'number' },
          type: {
            type: 'string',
            enum: ['joke', 'confusion', 'failure', 'shock', 'success', 'awkward_pause', 'claim', 'boring', 'realization'],
          },
          description: { type: 'string' },
        },
        required: ['startSeconds', 'endSeconds', 'type', 'description'],
      },
    },
    recommendedChanges: { type: 'array', items: { type: 'string' } },
    suggestedLengthSeconds: { type: 'number' },
    suggestedCta: { type: 'string' },
    suggestedEnding: { type: 'string' },
    versions: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string', enum: ['Hook-first', 'Relatable/meme', 'Fast-payoff'] },
          openingLine: { type: 'string' },
          editPlan: {
            type: 'array',
            items: {
              type: 'object',
              properties: { timecode: { type: 'string' }, instruction: { type: 'string' } },
              required: ['timecode', 'instruction'],
            },
          },
          onScreenText: { type: 'string' },
          caption: { type: 'string' },
          cta: { type: 'string' },
          whyItMayPerform: { type: 'string' },
        },
        required: ['name', 'openingLine', 'editPlan', 'onScreenText', 'caption', 'cta', 'whyItMayPerform'],
      },
    },
  },
  required: ['transcript', 'hook', 'pacingIssues', 'strongestMoment', 'weakestMoment', 'moments', 'recommendedChanges', 'versions'],
};

const PROMPT = `You are analyzing a real uploaded short-form video (Reel/TikTok/Short) for a creator tool. Watch and listen to the entire video, then respond ONLY with the requested JSON.

Ground every field in what actually happens in this specific video — do not invent generic advice. If the video has no speech, say so in the transcript field and leave transcriptSegments empty; base hook/moments analysis on visuals only. Break spoken audio into transcriptSegments of roughly 2-5 seconds each with your best-effort real timestamps grounded in the video — these will be burned in as captions, so accuracy matters more than granularity. Use qualitative strength labels (Strong/Moderate/Weak), never invented numeric percentages for retention or completion — those aren't knowable from this analysis. Identify concrete emotional/comedic moments (jokes, confusion, failure, shock, success, awkward pauses, claims, boring stretches, realizations) with real timestamps from the actual video, since these will be used to place reaction overlays at the correct moments. Provide three genuinely different rewritten versions (hook-first, relatable/meme, fast-payoff), each with a real shot-by-shot edit plan using timecodes that make sense for this video's actual length.`;

async function pollFileActive(fileUri, apiKey, signal) {
  // Gemini processes uploaded video asynchronously; poll briefly until ACTIVE.
  const name = fileUri.split('/files/')[1] ? `files/${fileUri.split('/files/')[1]}` : null;
  if (!name) return true; // can't poll without a name; let generateContent fail naturally if not ready
  for (let attempt = 0; attempt < 10; attempt++) {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/${name}`, {
      headers: { 'x-goog-api-key': apiKey },
      signal,
    });
    if (res.ok) {
      const data = await res.json();
      if (data.state === 'ACTIVE') return true;
      if (data.state === 'FAILED') return false;
    }
    await new Promise(r => setTimeout(r, 1500));
  }
  return false;
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return send(res, 405, { error: 'Use POST for this endpoint.' });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return send(res, 200, { configured: false, message: 'Video AI is not configured.' });
  }

  if (!rateLimit(`video-analyze:${clientKey(req)}`, { limit: 6, windowMs: 60_000 })) {
    return send(res, 429, { error: 'Too many analysis requests. Wait a moment and try again.' });
  }

  const body = parseBody(req);
  if (!body) return send(res, 400, { error: 'Invalid request body.' });

  const fileUri = String(body.fileUri || '');
  const mimeType = String(body.mimeType || '');
  const topic = String(body.topic || '').slice(0, 80);
  if (!fileUri.startsWith('https://generativelanguage.googleapis.com/')) {
    return send(res, 400, { error: 'Invalid file reference.' });
  }

  const { signal, clear } = withTimeout(55000);
  try {
    const ready = await pollFileActive(fileUri, apiKey, signal);
    if (!ready) {
      return send(res, 502, { error: 'The AI provider could not process this video file. Try a shorter or smaller file.' });
    }

    const requestBody = {
      contents: [{
        role: 'user',
        parts: [
          { file_data: { file_uri: fileUri, mime_type: mimeType } },
          { text: topic ? `${PROMPT}\n\nThe creator says this video is about: "${topic}"` : PROMPT },
        ],
      }],
      generationConfig: {
        responseMimeType: 'application/json',
        responseSchema: RESPONSE_SCHEMA,
      },
    };

    const genRes = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`, {
      method: 'POST',
      signal,
      headers: { 'x-goog-api-key': apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody),
    });

    if (!genRes.ok) {
      const errText = await genRes.text().catch(() => '');
      console.error('[video-analyze] Gemini generateContent failed', genRes.status, errText.slice(0, 500));
      const locationBlocked = /user location is not supported/i.test(errText);
      return send(res, 502, {
        error: locationBlocked
          ? 'Gemini is blocking requests from this server\u2019s region.'
          : 'The AI provider could not analyze this video.',
        detail: locationBlocked
          ? 'Change "regions" in vercel.json to a Gemini-supported region such as "iad1" and redeploy.'
          : `HTTP ${genRes.status}: ${errText.slice(0, 300)}`,
      });
    }

    const genData = await genRes.json();
    const text = genData?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) return send(res, 502, { error: 'The AI provider returned an empty analysis.' });

    let analysis;
    try {
      analysis = JSON.parse(text);
    } catch {
      return send(res, 502, { error: 'The AI provider returned a response TrendDrop could not parse.' });
    }

    return send(res, 200, { configured: true, model: MODEL, analysis });
  } catch (error) {
    if (error?.name === 'AbortError') return send(res, 504, { error: 'Video analysis took too long. Try a shorter video.' });
    return send(res, 500, { error: 'Video analysis failed.' });
  } finally {
    clear();
  }
};
