# TrendDrop 🔥

**What should I post today?**

TrendDrop is a daily-use tool for creators: pick a region, niche, and platform, and it hands you one ready-to-film video idea — trend, hook, 30-sec structure, caption, and hashtags — built from what's actually rising today.

## Status

`index.html` remains a **static frontend demo** with mock trend data — that part is unchanged.

`viral-brain.html` and the new `meme-remix.html` are genuine, working features backed by real serverless functions:

- `viral-brain.html` — three real analysis modes:
  - **Reel links**: paste 1–10 public Instagram Reel URLs, deduped and validated server-side, each fetched individually with honest per-link success/failure and a real cross-Reel comparison (repeated openings, CTA usage). Never presented as your full account history.
  - **Connect IG**: real Instagram Business Login OAuth (`api.instagram.com` / `graph.instagram.com`, the current direct-login flow — not the deprecated Basic Display API). Tokens are AES-256-GCM encrypted into an httpOnly cookie server-side; never exposed to browser JS. Shows a clear "not configured" state without `META_APP_ID`/`META_APP_SECRET`/`META_REDIRECT_URI`/`COOKIE_SECRET`.
  - **Upload video**: real Gemini 2.5 Flash video analysis via the Files API resumable-upload protocol — the API key never leaves the server, and the video itself never passes through a Vercel function body (avoiding the ~4.5MB payload limit). Returns real hook/pacing/moment analysis with qualitative Strong/Moderate/Weak labels, never fabricated percentages.
- `meme-remix.html` — tag-based UI (platform/audience/language/meme style/video type/intensity/goal/caption style), reuses the same real Gemini video analysis, then genuinely renders a downloadable MP4 in the browser with `@ffmpeg/ffmpeg` (WASM): real burned-in captions from the actual transcript, real emotion-matched reaction overlays (original TrendDrop templates — no scraped/licensed meme clips), real zoom pattern interrupts, and real dead-air trimming via `silencedetect`. See **Meme Remix architecture notes** below for what's intentionally scoped down for v1.
- `api/instagram-scan.js`: the original single-link/profile scanner, unchanged, still used as a fallback code path

Open `index.html` directly in a browser, or serve it:

```bash
npx serve .
```

Deploy on Vercel as before; set the environment variables in `.env.example` under Project Settings for Modes B/C and Meme Remix to go live. Without them, both features run in an honest degraded state (Reel-link mode always works; Connect IG and Video AI show "not configured" instead of faking a result).

### Meme Remix architecture notes

- **Rendering happens entirely in the browser** via `@ffmpeg/ffmpeg` (WASM, loaded from jsDelivr, no server upload of the edited video) — this is the realistic free-tier architecture for actual video rendering; Vercel Functions cannot reliably render video within current payload/duration limits.
- **Meme library**: ships with an original TrendDrop template set (`js/meme-templates.js`) — text + emoji reaction cards rendered on canvas, tagged by emotion and style (Pakistani drama, Bollywood, Desi chaotic, Global Gen Z, Savage, Deadpan, Cute, Cinematic comedy, Clean family-friendly, Maximum chaos). This is copyright-safe by construction. It does **not** include licensed Bollywood/desi pop-culture clips — sourcing and licensing those is a business decision for the repo owner, not something this build can do unilaterally. The template schema supports adding a `videoUrl` + `license` field per entry later to composite a real licensed clip instead of the canvas card.
- **Dead-air trimming** is capped at 6 removed segments per render to keep the browser-side filter graph tractable; longer/more-frequent-pause videos will have some dead air remain.
- **"Re-render with changes"** re-runs the full pipeline rather than patching just the edited section — genuine, just not incremental yet.
- Known edge case: a completely silent source video combined with "remove dead air" intensity settings can fail the render (the audio-trim filter assumes an audio stream exists); documented rather than silently faking a fix.

## Product flow

1. Choose region → niche → platform
2. TrendDrop scores what's rising today
3. Get one free video idea: trend, why-now, hook, structure, caption, hashtags
4. Unlock more with Pro ($4.99/mo): 10–20 trends/day, all regions, full scripts, low-competition picks, save + alerts

## Viral Brain flow

1. Paste a public Instagram profile, @username or Reel URL
2. Learn patterns from up to 12 currently visible public posts/Reels
3. Upload a new Reel draft
4. Generate three creator-specific hook/edit variants
5. Prepare the selected variant for a real-audience Instagram Trial Reel
6. Feed watch time, completion, shares and saves back into the personal model

Quick Scan is a beta public-data feature and can be limited or rate-limited by Instagram. It only uses visible profile/media fields such as captions, public likes/comments/views and duration when exposed; it cannot read retention, shares, saves, audience breakdowns or private accounts. The local draft currently supplies its topic and duration to the edit-variant generator. Full frame/audio AI, Instagram OAuth, private insights ingestion and Trial Reel publishing remain later phases.

## Trend scoring model (planned)

```
Trend Score = growth speed + search interest + social activity + freshness − competition
```

Signal sources (planned): Google Trends, YouTube trending/search velocity, Reddit discussion volume, news velocity, optionally TikTok signals.

## Roadmap

- [ ] FastAPI/Node backend + daily trend collector
- [ ] Wire real signals (Google Trends via pytrends, YouTube Data API, Reddit via PRAW)
- [ ] Gemini/LLM pass to turn raw signals into structured video ideas (trend → hook → script → caption → hashtags)
- [ ] Postgres/Supabase for caching daily results per region/niche/platform
- [ ] Stripe for Pro subscriptions
- [ ] Shareable trend cards (viral loop)
- [ ] "Predict tomorrow's trend" (Pro feature)
- [x] Viral Brain frontend product flow
- [x] No-login public Instagram profile/Reel Quick Scan (beta)
- [ ] Instagram OAuth + Professional account connection for private insights
- [ ] Media analysis pipeline (speech, on-screen text, cuts, pauses, safe zones)
- [ ] Creator-specific ranking model trained from Reel insights
- [ ] Trial Reel publishing + 24–72 hour experiment evaluation

## Stack (planned)

- Frontend: React/Vite
- Backend: Node or FastAPI
- DB: Postgres/Supabase
- Payments: Stripe
- AI: Gemini (or similar) for idea/script generation

## License

TBD.
