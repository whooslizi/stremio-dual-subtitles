const axios = require('axios');
const { debugServer, sanitizeForLogging } = require('../lib/debug');

function normalizeVideoParams(params = {}) {
  if (!params || typeof params !== 'object') return {};
  const normalized = {};
  for (const key of ['filename', 'videoSize', 'videoHash']) {
    const val = Array.isArray(params[key]) ? params[key][0] : params[key];
    if (val != null && String(val).trim()) normalized[key] = String(val).trim();
  }
  return normalized;
}

function buildUrls(mediaId, type, season, episode, videoParams) {
  const rawId = String(mediaId);
  if (rawId.startsWith('kitsu:')) {
    return [
      `https://anime-kitsu.strem.fun/subtitles/anime/${rawId}.json`,
      `https://opensubtitles-v3.strem.io/subtitles/anime/${rawId}.json`
    ];
  }
  if (rawId.startsWith('mal:') || rawId.startsWith('anilist:')) {
    return [`https://opensubtitles-v3.strem.io/subtitles/anime/${rawId}.json`];
  }

  const cleanImdb = rawId.replace(/^tt/, '');
  const mainType = type === 'series' ? 'series' : 'movie';
  let baseId = `tt${cleanImdb}`;
  if (type === 'series' && season && episode && season !== '0' && episode !== '0') {
    baseId += `:${season}:${episode}`;
  }

  const norm = normalizeVideoParams(videoParams);
  const extraParts = [];
  if (norm.videoHash) extraParts.push(`videoHash=${norm.videoHash}`);
  if (norm.videoSize) extraParts.push(`videoSize=${norm.videoSize}`);
  if (norm.filename) extraParts.push(`filename=${encodeURIComponent(norm.filename)}`);

  const urls = [];
  if (extraParts.length > 0) {
    urls.push(`https://opensubtitles-v3.strem.io/subtitles/${mainType}/${baseId}/${extraParts.join('/')}.json`);
  }
  urls.push(`https://opensubtitles-v3.strem.io/subtitles/${mainType}/${baseId}.json`);
  if (type === 'series' && season && episode) {
    urls.push(`https://opensubtitles-v3.strem.io/subtitles/series/tt${cleanImdb}.json`);
  }
  urls.push(`https://opensubtitles.strem.io/stremio/v1/subtitles/${mainType}/tt${cleanImdb}.json`);
  return urls;
}

async function fetchOpenSubtitles(mediaId, type, season = null, episode = null, videoParams = {}) {
  if (!mediaId) return [];

  const urls = buildUrls(mediaId, type, season, episode, videoParams);
  const isKitsu = String(mediaId).startsWith('kitsu:');
  const results = [];
  const seenIds = new Set();

  for (const url of urls) {
    try {
      const { data } = await axios.get(url, {
        timeout: 6000,
        headers: { 'User-Agent': 'Stremio Dual Subtitles Addon/1.0.0' }
      });

      if (!Array.isArray(data?.subtitles)) continue;

      for (const sub of data.subtitles) {
        const sid = sub?.id || sub?.url;
        if (!sid || seenIds.has(sid)) continue;
        seenIds.add(sid);
        results.push({
          id: `os-${sid}`,
          originalId: sub.id || sid,
          url: sub.url,
          lang: sub.lang,
          source: isKitsu ? 'Anime Kitsu' : 'OpenSubtitles v3',
          encoding: sub.SubEncoding || 'UTF-8',
          g: sub.g || null
        });
      }
    } catch (err) {
      debugServer.warn(`OpenSubtitles scraper fetch notice for ${url}:`, sanitizeForLogging(err.message));
    }
  }

  return results;
}

module.exports = { fetchOpenSubtitles };
