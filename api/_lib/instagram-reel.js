function getMeta(html, key) {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const first = new RegExp(`<meta[^>]+(?:property|name)=["']${escaped}["'][^>]+content=["']([^"']*)["'][^>]*>`, 'i');
  const second = new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]+(?:property|name)=["']${escaped}["'][^>]*>`, 'i');
  const match = html.match(first) || html.match(second);
  return match ? match[1] : '';
}

function decodeEntities(value) {
  return String(value || '')
    .replace(/&quot;|&#34;/g, '"')
    .replace(/&#x27;|&#39;|&apos;/g, "'")
    .replace(/&#064;/g, '@')
    .replace(/&#x2022;/g, '\u2022')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

function compactMetric(value) {
  const match = String(value || '').trim().match(/^([\d,.]+)\s*([kmb])?$/i);
  if (!match) return null;
  const base = Number(match[1].replace(/,/g, ''));
  const scale = { k: 1e3, m: 1e6, b: 1e9 }[(match[2] || '').toLowerCase()] || 1;
  return Number.isFinite(base) ? Math.round(base * scale) : null;
}

function openingType(text) {
  const value = String(text || '').trim().toLowerCase();
  if (!value) return 'Visual-first';
  if (/^pov\b/.test(value)) return 'POV';
  if (/^(stop|don['\u2019]?t|never|avoid|warning)\b/.test(value)) return 'Contrarian';
  if (/^(how|here['\u2019]?s|this is|the way)\b/.test(value)) return 'How-to';
  if (/^(\d+|one|two|three|four|five)\b/.test(value)) return 'List';
  if (/\?/.test(value.split('\n')[0])) return 'Question';
  if (/^(comment|save|send|share|tag)\b/.test(value)) return 'CTA-first';
  return 'Bold statement';
}

/** Parses an Instagram Reel/post URL into { username, shortcode } or null. */
function parseReelUrl(rawUrl) {
  let parsed;
  try {
    parsed = new URL(rawUrl.startsWith('http') ? rawUrl : `https://${rawUrl}`);
  } catch {
    return null;
  }
  const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
  if (host !== 'instagram.com' && host !== 'ig.me') return null;
  const parts = parsed.pathname.split('/').filter(Boolean);
  if (!['p', 'reel', 'reels'].includes((parts[0] || '').toLowerCase())) return null;
  return { shortcode: parts[1] || '', isVideo: ['reel', 'reels'].includes((parts[0] || '').toLowerCase()), url: parsed.toString() };
}

/**
 * Fetches safe public metadata for a single Reel/post link. Never touches
 * private accounts or bypasses Instagram restrictions — uses the same
 * public oEmbed / page-meta approach as the existing profile scanner.
 *
 * Returns { ok:true, media, username } or { ok:false, reason }. Fields
 * Instagram doesn't expose are `null`, never `0` (the caller renders null
 * as "Unavailable" rather than a fabricated zero).
 */
async function fetchReelMetadata(rawUrl, signal) {
  const parsedLink = parseReelUrl(rawUrl);
  if (!parsedLink) return { ok: false, reason: 'Not a public Instagram Reel or post link.' };

  const { shortcode, isVideo, url } = parsedLink;

  try {
    const oembedUrl = new URL('https://www.instagram.com/api/v1/oembed/');
    oembedUrl.searchParams.set('url', url);
    const oembedResponse = await fetch(oembedUrl, {
      signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; TrendDrop/1.0; +https://trenddrop-delta.vercel.app)',
        Accept: 'application/json',
        'Accept-Language': 'en-US,en;q=0.9',
      },
    });

    if (oembedResponse.ok) {
      const oembed = await oembedResponse.json();
      const username = String(oembed.author_name || '').replace(/^@/, '').toLowerCase();
      if (/^[a-z0-9._]{1,30}$/i.test(username)) {
        const caption = String(oembed.title || '').trim();
        return {
          ok: true,
          username,
          media: {
            shortcode,
            url,
            kind: isVideo ? 'Reel' : 'Post',
            isVideo,
            thumbnail: String(oembed.thumbnail_url || ''),
            caption: caption.slice(0, 700),
            firstLine: caption.split('\n').find(Boolean)?.slice(0, 180) || 'Visual-first post',
            likes: null,
            comments: null,
            views: null,
            duration: null,
            opening: openingType(caption),
          },
        };
      }
    }

    const response = await fetch(url, {
      signal,
      redirect: 'follow',
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; TrendDrop/1.0; +https://trenddrop-delta.vercel.app)',
        'Accept-Language': 'en-US,en;q=0.9',
      },
    });
    if (!response.ok) return { ok: false, reason: `Instagram returned ${response.status} for this link.` };

    const html = await response.text();
    const canonical = decodeEntities(getMeta(html, 'og:url'));
    const canonicalMatch = canonical.match(/instagram\.com\/([^/]+)\/(?:p|reel|reels)\//i);
    const title = decodeEntities(getMeta(html, 'twitter:title'));
    const titleMatch = title.match(/\(@([a-z0-9._]+)\)/i);
    const username = (canonicalMatch?.[1] || titleMatch?.[1] || '').toLowerCase();
    if (!username) return { ok: false, reason: 'Could not read this Reel — it may be private, deleted, or age-restricted.' };

    const description = decodeEntities(getMeta(html, 'og:description') || getMeta(html, 'description'));
    const metricMatch = description.match(/^([\d,.]+\s*[kmb]?) likes,\s*([\d,.]+\s*[kmb]?) comments\s*-\s*[^:]+:\s*["\u201c]?([\s\S]*)/i);
    const caption = String(metricMatch?.[3] || description || '').replace(/["\u201d]\s*$/, '').trim();

    return {
      ok: true,
      username,
      media: {
        shortcode,
        url,
        kind: isVideo ? 'Reel' : 'Post',
        isVideo,
        thumbnail: decodeEntities(getMeta(html, 'og:image') || getMeta(html, 'twitter:image')),
        caption: caption.slice(0, 700),
        firstLine: caption.split('\n').find(Boolean)?.slice(0, 180) || 'Visual-first post',
        likes: compactMetric(metricMatch?.[1]),
        comments: compactMetric(metricMatch?.[2]),
        views: null,
        duration: null,
        opening: openingType(caption),
      },
    };
  } catch (error) {
    if (error?.name === 'AbortError') return { ok: false, reason: 'Instagram took too long to respond.' };
    return { ok: false, reason: 'Could not read this Reel link.' };
  }
}

module.exports = { fetchReelMetadata, parseReelUrl, openingType };
