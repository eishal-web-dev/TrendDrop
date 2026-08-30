const INSTAGRAM_WEB_APP_ID = '936619743392459';
const MAX_MEDIA = 12;

function send(res, status, payload) {
  res.status(status);
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', status === 200
    ? 'public, s-maxage=300, stale-while-revalidate=900'
    : 'no-store');
  return res.end(JSON.stringify(payload));
}

function cleanUsername(value) {
  if (typeof value !== 'string') return null;
  const input = value.trim();
  if (!input) return null;

  if (/^@?[a-z0-9._]{1,30}$/i.test(input)) {
    return input.replace(/^@/, '').toLowerCase();
  }

  let parsed;
  try {
    parsed = new URL(input.startsWith('http') ? input : `https://${input}`);
  } catch {
    return null;
  }

  const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
  if (host !== 'instagram.com' && host !== 'ig.me') return null;
  const parts = parsed.pathname.split('/').filter(Boolean);
  if (!parts.length) return null;
  const reserved = new Set(['p', 'reel', 'reels', 'stories', 'explore', 'accounts', 'direct']);
  if (reserved.has(parts[0].toLowerCase())) return null;
  return /^[a-z0-9._]{1,30}$/i.test(parts[0]) ? parts[0].toLowerCase() : null;
}

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
    .replace(/&#x2022;/g, '•')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

function compactMetric(value) {
  const match = String(value || '').trim().match(/^([\d,.]+)\s*([kmb])?$/i);
  if (!match) return 0;
  const base = Number(match[1].replace(/,/g, ''));
  const scale = { k: 1e3, m: 1e6, b: 1e9 }[(match[2] || '').toLowerCase()] || 1;
  return Number.isFinite(base) ? Math.round(base * scale) : 0;
}

async function reelPreviewFromUrl(value, signal) {
  let parsed;
  try {
    parsed = new URL(value.startsWith('http') ? value : `https://${value}`);
  } catch {
    return null;
  }

  const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
  if (host !== 'instagram.com' && host !== 'ig.me') return null;
  const parts = parsed.pathname.split('/').filter(Boolean);
  if (!['p', 'reel', 'reels'].includes((parts[0] || '').toLowerCase())) return null;

  const shortcode = parts[1] || '';
  const isVideo = ['reel', 'reels'].includes((parts[0] || '').toLowerCase());
  const oembedUrl = new URL('https://www.instagram.com/api/v1/oembed/');
  oembedUrl.searchParams.set('url', parsed.toString());
  const oembedResponse = await fetch(oembedUrl, {
    signal,
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; TrendDrop/1.0; +https://trenddrop-delta.vercel.app)',
      'Accept': 'application/json',
      'Accept-Language': 'en-US,en;q=0.9'
    }
  });

  if (oembedResponse.ok) {
    const oembed = await oembedResponse.json();
    const username = String(oembed.author_name || '').replace(/^@/, '').toLowerCase();
    if (/^[a-z0-9._]{1,30}$/i.test(username)) {
      const caption = String(oembed.title || '').trim();
      const media = {
        shortcode,
        url: parsed.toString(),
        kind: isVideo ? 'Reel' : 'Post',
        isVideo,
        thumbnail: String(oembed.thumbnail_url || ''),
        caption: caption.slice(0, 700),
        firstLine: caption.split('\n').find(Boolean)?.slice(0, 180) || 'Visual-first post',
        likes: 0,
        comments: 0,
        views: 0,
        duration: 0,
        timestamp: 0,
        audio: '',
        opening: openingType(caption),
        performance: caption.length
      };
      return {
        username,
        profile: {
          username,
          fullName: username,
          biography: '',
          profilePicture: '',
          followers: 0,
          following: 0,
          totalPosts: 0,
          isVerified: false,
          isProfessional: false
        },
        media
      };
    }
  }

  const response = await fetch(parsed.toString(), {
    signal,
    redirect: 'follow',
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; TrendDrop/1.0; +https://trenddrop-delta.vercel.app)',
      'Accept-Language': 'en-US,en;q=0.9'
    }
  });
  if (!response.ok) return null;
  const html = await response.text();
  const canonical = decodeEntities(getMeta(html, 'og:url'));
  const canonicalMatch = canonical.match(/instagram\.com\/([^/]+)\/(?:p|reel|reels)\//i);
  const title = decodeEntities(getMeta(html, 'twitter:title'));
  const titleMatch = title.match(/\(@([a-z0-9._]+)\)/i);
  const username = (canonicalMatch?.[1] || titleMatch?.[1] || '').toLowerCase();
  if (!username) return null;

  const description = decodeEntities(getMeta(html, 'og:description') || getMeta(html, 'description'));
  const metricMatch = description.match(/^([\d,.]+\s*[kmb]?) likes,\s*([\d,.]+\s*[kmb]?) comments\s*-\s*[^:]+:\s*["“]?([\s\S]*)/i);
  const caption = String(metricMatch?.[3] || description || '').replace(/["”]\s*$/, '').trim();
  const media = {
    shortcode,
    url: parsed.toString(),
    kind: isVideo ? 'Reel' : 'Post',
    isVideo,
    thumbnail: decodeEntities(getMeta(html, 'og:image') || getMeta(html, 'twitter:image')),
    caption: caption.slice(0, 700),
    firstLine: caption.split('\n').find(Boolean)?.slice(0, 180) || 'Visual-first post',
    likes: compactMetric(metricMatch?.[1]),
    comments: compactMetric(metricMatch?.[2]),
    views: 0,
    duration: 0,
    timestamp: 0,
    audio: '',
    opening: openingType(caption),
    performance: compactMetric(metricMatch?.[1]) + compactMetric(metricMatch?.[2]) * 4
  };

  return {
    username,
    profile: {
      username,
      fullName: title.split('(')[0].trim() || username,
      biography: '',
      profilePicture: '',
      followers: 0,
      following: 0,
      totalPosts: 0,
      isVerified: false,
      isProfessional: false
    },
    media
  };
}

function number(value) {
  return Number.isFinite(Number(value)) ? Number(value) : 0;
}

function captionFor(node) {
  return String(node?.edge_media_to_caption?.edges?.[0]?.node?.text || '').trim();
}

function openingType(text) {
  const value = String(text || '').trim().toLowerCase();
  if (!value) return 'Visual-first';
  if (/^pov\b/.test(value)) return 'POV';
  if (/^(stop|don['’]?t|never|avoid|warning)\b/.test(value)) return 'Contrarian';
  if (/^(how|here['’]?s|this is|the way)\b/.test(value)) return 'How-to';
  if (/^(\d+|one|two|three|four|five)\b/.test(value)) return 'List';
  if (/\?/.test(value.split('\n')[0])) return 'Question';
  if (/^(comment|save|send|share|tag)\b/.test(value)) return 'CTA-first';
  return 'Bold statement';
}

function shareTrigger(captions) {
  const text = captions.join(' ').toLowerCase();
  if (/send (this|it)|share (this|it)|tag (a|your|someone)/.test(text)) return 'Send-to-a-friend CTA';
  if (/save (this|it)|bookmark/.test(text)) return 'Save-worthy guide';
  if (/comment\b|drop\b.*comment/.test(text)) return 'Comment keyword';
  if (/pov\b|relatable|when you/.test(text)) return 'Relatable moment';
  return 'Useful takeaway';
}

function median(values) {
  const sorted = values.filter(value => value > 0).sort((a, b) => a - b);
  if (!sorted.length) return 0;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : Math.round((sorted[middle - 1] + sorted[middle]) / 2);
}

function formatMedia(node) {
  const isVideo = Boolean(node?.is_video || node?.product_type === 'clips');
  const likes = number(node?.edge_liked_by?.count ?? node?.edge_media_preview_like?.count);
  const comments = number(node?.edge_media_to_comment?.count);
  const views = number(node?.video_view_count ?? node?.video_play_count);
  const caption = captionFor(node);
  const shortcode = String(node?.shortcode || '');
  return {
    shortcode,
    url: shortcode ? `https://www.instagram.com/${isVideo ? 'reel' : 'p'}/${shortcode}/` : '',
    kind: isVideo ? 'Reel' : (node?.__typename === 'GraphSidecar' ? 'Carousel' : 'Post'),
    isVideo,
    thumbnail: String(node?.thumbnail_src || node?.display_url || ''),
    caption: caption.slice(0, 700),
    firstLine: caption.split('\n').find(Boolean)?.slice(0, 180) || 'Visual-first post',
    likes,
    comments,
    views,
    duration: number(node?.video_duration),
    timestamp: number(node?.taken_at_timestamp),
    audio: String(node?.clips_music_attribution_info?.song_name || ''),
    opening: openingType(caption),
    performance: likes + comments * 4 + Math.round(views * 0.015)
  };
}

function buildInsights(user, media) {
  const followers = number(user?.edge_followed_by?.count);
  const videos = media.filter(item => item.isVideo);
  const ranked = [...media].sort((a, b) => b.performance - a.performance);
  const top = ranked[0] || null;
  const captions = media.map(item => item.caption).filter(Boolean);
  const openingCounts = media.reduce((counts, item) => {
    counts[item.opening] = (counts[item.opening] || 0) + 1;
    return counts;
  }, {});
  const bestOpening = Object.entries(openingCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || 'Visual-first';
  const averageLikes = Math.round(media.reduce((sum, item) => sum + item.likes, 0) / Math.max(1, media.length));
  const averageComments = Math.round(media.reduce((sum, item) => sum + item.comments, 0) / Math.max(1, media.length));
  const averageViews = Math.round(videos.reduce((sum, item) => sum + item.views, 0) / Math.max(1, videos.filter(item => item.views).length));
  const averageEngagement = media.reduce((sum, item) => sum + item.likes + item.comments, 0) / Math.max(1, media.length);
  const engagementRate = followers ? Number(((averageEngagement / followers) * 100).toFixed(2)) : 0;
  const topCaption = top?.caption || user?.biography || '';
  const topWords = topCaption
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/[#@][\w.]+/g, ' ')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter(word => word.length > 3)
    .slice(0, 8)
    .join(' ');

  return {
    strongestPattern: `${bestOpening} opening + ${top?.kind?.toLowerCase() || 'short-form'} payoff`,
    bestLength: median(videos.map(item => item.duration)) || null,
    bestOpening,
    shareTrigger: shareTrigger(captions),
    averageLikes,
    averageComments,
    averageViews,
    engagementRate,
    topTopic: topWords || 'your strongest public topic',
    topMedia: ranked.slice(0, 3).map(({ performance, ...item }) => item)
  };
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return send(res, 405, { error: 'Use POST for this endpoint.' });
  }

  let submitted = {};
  try {
    submitted = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
  } catch {
    return send(res, 400, { error: 'Invalid request body.' });
  }
  const source = String(submitted.url || submitted.username || '').trim();
  if (!source || source.length > 250) {
    return send(res, 400, { error: 'Paste an Instagram profile or Reel link.' });
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);

  try {
    let username = cleanUsername(source);
    let reelPreview = null;
    if (!username) {
      reelPreview = await reelPreviewFromUrl(source, controller.signal);
      username = reelPreview?.username || null;
    }
    if (!username) {
      return send(res, 400, { error: 'Use a valid Instagram profile or public Reel link.' });
    }

    const endpoint = `https://www.instagram.com/api/v1/users/web_profile_info/?username=${encodeURIComponent(username)}`;
    const response = await fetch(endpoint, {
      signal: controller.signal,
      headers: {
        'X-IG-App-ID': INSTAGRAM_WEB_APP_ID,
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/140.0.0.0 Safari/537.36',
        'Accept': 'application/json',
        'Accept-Language': 'en-US,en;q=0.9'
      }
    });

    if (!response.ok && reelPreview) {
      const media = [reelPreview.media];
      return send(res, 200, {
        profile: reelPreview.profile,
        scannedPosts: 1,
        media,
        insights: buildInsights({ edge_followed_by: { count: 0 }, biography: '' }, media),
        availability: 'single-reel-fallback',
        limitations: 'Instagram limited the profile scan, so this result uses the pasted public Reel only. No retention, saves, shares or private insights.'
      });
    }
    if (response.status === 404) return send(res, 404, { error: 'Instagram profile not found.' });
    if (response.status === 429) return send(res, 429, { error: 'Instagram is rate-limiting profile scans. Paste one of your public Reel links or try again in a few minutes.' });
    if (!response.ok) return send(res, 502, { error: 'Instagram did not return this public profile.' });

    const payload = await response.json();
    const user = payload?.data?.user;
    if (!user) return send(res, 404, { error: 'Instagram profile not found.' });
    if (user.is_private) {
      return send(res, 403, { error: 'This account is private. TrendDrop only scans public profiles.' });
    }

    const media = (user?.edge_owner_to_timeline_media?.edges || [])
      .slice(0, MAX_MEDIA)
      .map(edge => formatMedia(edge.node));

    if (!media.length) {
      return send(res, 422, { error: 'No public posts were visible for this profile. Try a public Reel link.' });
    }

    const insights = buildInsights(user, media);
    return send(res, 200, {
      profile: {
        username: String(user.username || username),
        fullName: String(user.full_name || user.username || username),
        biography: String(user.biography || '').slice(0, 360),
        profilePicture: String(user.profile_pic_url || ''),
        followers: number(user?.edge_followed_by?.count),
        following: number(user?.edge_follow?.count),
        totalPosts: number(user?.edge_owner_to_timeline_media?.count),
        isVerified: Boolean(user.is_verified),
        isProfessional: Boolean(user.is_professional_account || user.is_business_account)
      },
      scannedPosts: media.length,
      media,
      insights,
      limitations: 'Public profile data only. No retention, saves, shares, private insights or full watch-time curve.'
    });
  } catch (error) {
    if (error?.name === 'AbortError') {
      return send(res, 504, { error: 'Instagram took too long to answer. Try again.' });
    }
    return send(res, 500, { error: 'The public scan failed. Try the profile link again.' });
  } finally {
    clearTimeout(timer);
  }
};
