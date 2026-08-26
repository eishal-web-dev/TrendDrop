# TrendDrop 🔥

**What should I post today?**

TrendDrop is a daily-use tool for creators: pick a region, niche, and platform, and it hands you one ready-to-film video idea — trend, hook, 30-sec structure, caption, and hashtags — built from what's actually rising today.

## Status

This repo currently contains a **static frontend demo** (`index.html`) — a fully working, click-through prototype of the product flow with realistic mock trend data. No backend yet.

Open `index.html` directly in a browser, or serve it:

```bash
npx serve .
```

## Product flow

1. Choose region → niche → platform
2. TrendDrop scores what's rising today
3. Get one free video idea: trend, why-now, hook, structure, caption, hashtags
4. Unlock more with Pro ($4.99/mo): 10–20 trends/day, all regions, full scripts, low-competition picks, save + alerts

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

## Stack (planned)

- Frontend: React/Vite
- Backend: Node or FastAPI
- DB: Postgres/Supabase
- Payments: Stripe
- AI: Gemini (or similar) for idea/script generation

## License

TBD.
