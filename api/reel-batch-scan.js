const { send, parseBody, withTimeout, rateLimit, clientKey } = require('./_lib/http');
const { fetchReelMetadata } = require('./_lib/instagram-reel');

const MAX_LINKS = 10;

// Briefly cache safe public metadata per URL to cut down repeated
// Instagram requests when the same link is pasted again shortly after.
const cache = new Map();
const CACHE_TTL_MS = 5 * 60 * 1000;

function fromCache(url) {
  const hit = cache.get(url);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.result;
  return null;
}
function toCache(url, result) {
  cache.set(url, { result, at: Date.now() });
}

function compareReels(scanned) {
  if (scanned.length < 2) return null;

  const openingCounts = {};
  for (const item of scanned) {
    openingCounts[item.media.opening] = (openingCounts[item.media.opening] || 0) + 1;
  }
  const repeatedOpenings = Object.entries(openingCounts)
    .filter(([, count]) => count > 1)
    .sort((a, b) => b[1] - a[1])
    .map(([opening, count]) => ({ opening, count }));

  const withLikes = scanned.filter(item => typeof item.media.likes === 'number');
  const ranked = [...withLikes].sort((a, b) => (b.media.likes || 0) - (a.media.likes || 0));
  const strongest = ranked[0] || null;

  const ctaWords = /(comment|save|send|share|tag|follow)\b/i;
  const withCta = scanned.filter(item => ctaWords.test(item.media.caption || '')).length;

  return {
    repeatedOpenings,
    strongestSuppliedReel: strongest
      ? { url: strongest.media.url, likes: strongest.media.likes, opening: strongest.media.opening }
      : null,
    strongestReelBasis: withLikes.length > 0
      ? `Based on visible like counts across the ${withLikes.length} of ${scanned.length} supplied links where Instagram exposed that field.`
      : 'Like counts were not visible on the supplied links, so no supplied Reel could be ranked by engagement.',
    ctaUsageRate: scanned.length ? Math.round((withCta / scanned.length) * 100) : 0,
    repeat: repeatedOpenings.length
      ? `${repeatedOpenings[0].opening} openings appear in ${repeatedOpenings[0].count} of your ${scanned.length} supplied Reels — that's a real repeated pattern in what you pasted.`
      : 'No single opening style repeats across the supplied Reels.',
    stop: withCta === 0
      ? 'None of the supplied captions include a clear call-to-action (comment, save, send, share). Consider testing one.'
      : null,
  };
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return send(res, 405, { error: 'Use POST for this endpoint.' });
  }

  if (!rateLimit(`reel-batch:${clientKey(req)}`, { limit: 12, windowMs: 60_000 })) {
    return send(res, 429, { error: 'Too many scans in a short time. Wait a moment and try again.' });
  }

  const body = parseBody(req);
  if (!body) return send(res, 400, { error: 'Invalid request body.' });

  const rawLinks = Array.isArray(body.urls) ? body.urls : [];
  const links = [...new Set(rawLinks.map(u => String(u || '').trim()).filter(Boolean))].slice(0, MAX_LINKS);

  if (links.length === 0) {
    return send(res, 400, { error: 'Paste at least one public Instagram Reel link.' });
  }
  if (rawLinks.length > MAX_LINKS) {
    return send(res, 400, { error: `TrendDrop reads up to ${MAX_LINKS} Reel links at once. Remove some and try again.` });
  }

  const { signal, clear } = withTimeout(20000);
  const results = [];
  try {
    for (const url of links) {
      const cached = fromCache(url);
      if (cached) {
        results.push({ url, ...cached });
        continue;
      }
      // Sequential, not parallel — a small courtesy to Instagram's
      // unofficial endpoints and a simple way to stay under function
      // timeouts predictably.
      const result = await fetchReelMetadata(url, signal);
      toCache(url, result);
      results.push({ url, ...result });
    }
  } finally {
    clear();
  }

  const succeeded = results.filter(r => r.ok);
  const failed = results.filter(r => !r.ok).map(r => ({ url: r.url, reason: r.reason }));

  if (succeeded.length === 0) {
    return send(res, 422, {
      error: 'None of the supplied links could be read.',
      failed,
    });
  }

  const mode = succeeded.length === 1 ? 'single-reel' : 'multi-reel-comparison';

  return send(res, 200, {
    mode,
    scannedCount: succeeded.length,
    requestedCount: links.length,
    reels: succeeded.map(r => ({ url: r.url, username: r.username, media: r.media })),
    failed,
    comparison: compareReels(succeeded),
    disclosure: mode === 'single-reel'
      ? 'This is a single-Reel analysis, not the account\u2019s complete history. Only the one link you pasted was read.'
      : `This compares the ${succeeded.length} Reel links you pasted, not the account\u2019s complete history or private insights.`,
  });
};
