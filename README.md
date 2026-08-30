# TrendDrop 🔥

**What should I post today?**

TrendDrop is a daily-use tool for creators: pick a region, niche, and platform, and it hands you one ready-to-film video idea — trend, hook, 30-sec structure, caption, and hashtags — built from what's actually rising today.

## Status

This repo currently contains a **static frontend demo** — a fully working, click-through prototype of the product flow with realistic mock trend data. No backend yet.

- `index.html`: daily trend finder, trend score, hooks, scripts, saves and share cards
- `viral-brain.html`: public Instagram profile/Reel Quick Scan, local draft upload, creator-pattern summary, three scored edit variants, downloadable edit brief and Trial Reel plan
- `api/instagram-scan.js`: no-login public profile scanner that returns a small, sanitized set of visible account/media signals

Open `index.html` directly in a browser, or serve it:

```bash
npx serve .
```

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
