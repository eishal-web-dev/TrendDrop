/**
 * Original TrendDrop overlay templates. Every entry here is a text +
 * emoji + color/animation recipe TrendDrop renders itself on a <canvas> —
 * never a scraped or licensed pop-culture meme clip. This keeps Meme
 * Remix legally clean out of the box while still producing a real,
 * emotion-matched reaction overlay in the exported video.
 *
 * The owner can extend this library later with:
 *   - properly licensed GIF/video provider assets (add a `videoUrl` and
 *     `license` field to a template and the renderer will composite that
 *     clip instead of the canvas text card)
 *   - user-uploaded meme clips (handled separately in meme-remix.html —
 *     those are the user's own content, so no licensing concern)
 *
 * Fields:
 *   id            unique key
 *   emotion       matches an api/video-analyze.js moment `type`
 *   text          short on-screen line (kept punchy, under ~28 chars)
 *   emoji         one or two emoji, rendered large
 *   style         which "meme style" tags this fits (see TAG_DATA below)
 *   familySafe    true = safe for "Clean family-friendly"
 *   bg            canvas background gradient stops
 *   accent        text/emoji accent color
 */
const MEME_TEMPLATES = [
  // confusion
  { id: 'confused-01', emotion: 'confusion', text: 'wait what', emoji: '\u{1F9D0}', style: ['global-genz', 'deadpan', 'clean'], familySafe: true, bg: ['#1f2937', '#0f172a'], accent: '#c9ff3d' },
  { id: 'confused-02', emotion: 'confusion', text: 'kya ho raha hai', emoji: '\u{1F615}\u2753', style: ['desi-chaotic', 'pakistani-drama', 'hinglish'], familySafe: true, bg: ['#3b0a2a', '#1a0713'], accent: '#ff3d8a' },
  { id: 'confused-03', emotion: 'confusion', text: 'hold on...', emoji: '\u{1F937}', style: ['cinematic-comedy', 'clean'], familySafe: true, bg: ['#0b1f3a', '#050b16'], accent: '#55d8ff' },

  // failure
  { id: 'fail-01', emotion: 'failure', text: 'instant regret', emoji: '\u{1F480}', style: ['global-genz', 'savage', 'maximum-chaos'], familySafe: false, bg: ['#3a0a0a', '#160303'], accent: '#ff8a3d' },
  { id: 'fail-02', emotion: 'failure', text: 'yeh nahi hona chahiye tha', emoji: '\u{1F62C}', style: ['desi-chaotic', 'pakistani-drama'], familySafe: true, bg: ['#2b0a3a', '#120316'], accent: '#ff3d8a' },
  { id: 'fail-03', emotion: 'failure', text: 'oh no.', emoji: '\u{1F625}', style: ['cute', 'clean'], familySafe: true, bg: ['#3a2a0a', '#160f03'], accent: '#c9ff3d' },

  // shock
  { id: 'shock-01', emotion: 'shock', text: 'NO WAY', emoji: '\u{1F631}', style: ['global-genz', 'maximum-chaos'], familySafe: true, bg: ['#3a0a2a', '#160313'], accent: '#ff3d8a' },
  { id: 'shock-02', emotion: 'shock', text: 'bhai ye kya tha', emoji: '\u{1F62E}', style: ['desi-chaotic', 'hinglish'], familySafe: true, bg: ['#0a2a3a', '#031316'], accent: '#55d8ff' },
  { id: 'shock-03', emotion: 'shock', text: 'plot twist.', emoji: '\u{1F3AC}', style: ['bollywood', 'cinematic-comedy'], familySafe: true, bg: ['#2a0a3a', '#130316'], accent: '#8b3dff' },

  // success / flex
  { id: 'success-01', emotion: 'success', text: 'main character energy', emoji: '\u2728', style: ['global-genz', 'cinematic-comedy'], familySafe: true, bg: ['#1a3a0a', '#0a1603'], accent: '#c9ff3d' },
  { id: 'success-02', emotion: 'success', text: 'victory hai bhai', emoji: '\u{1F3C6}', style: ['bollywood', 'desi-chaotic'], familySafe: true, bg: ['#3a2a0a', '#160f03'], accent: '#ff8a3d' },
  { id: 'success-03', emotion: 'success', text: 'nailed it', emoji: '\u{1F4AF}', style: ['savage', 'clean'], familySafe: true, bg: ['#0a3a2a', '#031610'], accent: '#55d8ff' },

  // awkward pause
  { id: 'awkward-01', emotion: 'awkward_pause', text: '...', emoji: '\u{1F636}', style: ['deadpan', 'global-genz'], familySafe: true, bg: ['#1a1a2a', '#0a0a13'], accent: '#9695a9' },
  { id: 'awkward-02', emotion: 'awkward_pause', text: 'silence.', emoji: '\u{1F440}', style: ['deadpan', 'cinematic-comedy'], familySafe: true, bg: ['#0f0f1a', '#05050a'], accent: '#55d8ff' },

  // joke / relatable
  { id: 'joke-01', emotion: 'joke', text: 'bro thought', emoji: '\u{1F602}', style: ['global-genz', 'savage'], familySafe: true, bg: ['#3a1a0a', '#160a03'], accent: '#ff8a3d' },
  { id: 'joke-02', emotion: 'joke', text: 'hasna mana hai', emoji: '\u{1F923}', style: ['desi-chaotic', 'pakistani-drama'], familySafe: true, bg: ['#2a0a3a', '#130316'], accent: '#ff3d8a' },
  { id: 'joke-03', emotion: 'joke', text: 'lol okay', emoji: '\u{1F602}', style: ['cute', 'clean'], familySafe: true, bg: ['#0a2a3a', '#031316'], accent: '#c9ff3d' },

  // claim (raised eyebrow / suspicion)
  { id: 'claim-01', emotion: 'claim', text: 'source: trust me bro', emoji: '\u{1F928}', style: ['global-genz', 'savage'], familySafe: true, bg: ['#1a1a2a', '#0a0a13'], accent: '#c9ff3d' },
  { id: 'claim-02', emotion: 'claim', text: 'suspicious hai', emoji: '\u{1F9D0}', style: ['desi-chaotic', 'hinglish'], familySafe: true, bg: ['#0a2a3a', '#031316'], accent: '#55d8ff' },

  // realization
  { id: 'realize-01', emotion: 'realization', text: 'OH.', emoji: '\u{1F4A1}', style: ['global-genz', 'clean'], familySafe: true, bg: ['#1a3a0a', '#0a1603'], accent: '#c9ff3d' },
  { id: 'realize-02', emotion: 'realization', text: 'ab samajh aaya', emoji: '\u{1F4A1}', style: ['desi-chaotic', 'hinglish'], familySafe: true, bg: ['#3a2a0a', '#160f03'], accent: '#ff8a3d' },

  // boring (used sparingly, to mark where a cut is suggested rather than always overlaying)
  { id: 'boring-01', emotion: 'boring', text: 'skip?', emoji: '\u23E9', style: ['global-genz', 'clean'], familySafe: true, bg: ['#1a1a1a', '#0a0a0a'], accent: '#9695a9' },
];

const TAG_DATA = {
  platform: ['Instagram Reels', 'TikTok', 'YouTube Shorts'],
  audience: ['Pakistan', 'India', 'South Asia', 'Global'],
  language: ['Urdu', 'Hindi', 'Hinglish', 'English', 'Mixed'],
  memeStyle: [
    { id: 'pakistani-drama', label: 'Pakistani drama' },
    { id: 'bollywood', label: 'Bollywood' },
    { id: 'desi-chaotic', label: 'Desi chaotic' },
    { id: 'global-genz', label: 'Global Gen Z' },
    { id: 'savage', label: 'Savage' },
    { id: 'deadpan', label: 'Deadpan' },
    { id: 'cute', label: 'Cute' },
    { id: 'cinematic-comedy', label: 'Cinematic comedy' },
    { id: 'clean', label: 'Clean family-friendly' },
    { id: 'maximum-chaos', label: 'Maximum chaos' },
  ],
  videoType: ['Talking head', 'Story', 'Tutorial', 'Screen recording', 'Product video', 'Vlog', 'Reaction', 'Business content'],
  intensity: ['Light', 'Balanced', 'Maximum'],
  goal: ['More watch time', 'More shares', 'More comments', 'More followers', 'More sales'],
  captionStyle: ['Meme subtitles', 'Bold viral captions', 'Minimal clean', 'Cinematic', 'MrBeast-style emphasis', 'Urdu/Hindi subtitles'],
};

/**
 * Picks a template for a detected moment, matching emotion first and then
 * preferring the user's selected meme-style tags. Falls back to any
 * family-safe template for the emotion if no style tag matches, and never
 * returns a non-family-safe template when "clean" is selected.
 */
function pickTemplateForMoment(moment, selectedStyles, familySafeOnly) {
  const candidates = MEME_TEMPLATES.filter(t => t.emotion === moment.type && (!familySafeOnly || t.familySafe));
  if (candidates.length === 0) return null;

  const styleMatch = candidates.find(t => t.style.some(s => selectedStyles.includes(s)));
  return styleMatch || candidates[0];
}

if (typeof module !== 'undefined') module.exports = { MEME_TEMPLATES, TAG_DATA, pickTemplateForMoment };
if (typeof window !== 'undefined') {
  // `const` at classic-script top level does NOT become a window property
  // automatically (only `var` does) — attach explicitly so meme-remix-app.js
  // (a module script, separate scope) can read these.
  window.MEME_TEMPLATES = MEME_TEMPLATES;
  window.TAG_DATA = TAG_DATA;
  window.pickTemplateForMoment = pickTemplateForMoment;
}
