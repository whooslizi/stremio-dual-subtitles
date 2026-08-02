const axios = require('axios');
const { debugServer, sanitizeForLogging } = require('../lib/debug');

async function fetchVietsub(imdbId, type, season = null, episode = null) {
  if (!imdbId) return [];

  const cleanImdb = String(imdbId).replace(/^tt/, '');
  const results = [];

  try {
    const url = `https://api.subdl.com/api/v1/subtitles?imdb_id=tt${cleanImdb}&languages=vie,vi`;
    const { data } = await axios.get(url, {
      timeout: 4000,
      headers: { 'User-Agent': 'Stremio Dual Subtitles Addon/1.0.0' }
    });

    if (Array.isArray(data?.subtitles)) {
      for (const sub of data.subtitles) {
        if (sub?.url) {
          results.push({
            id: `vietsub-subdl-${sub.id || Math.random().toString(36).substring(2, 9)}`,
            originalId: sub.id,
            url: sub.url.startsWith('http') ? sub.url : `https://dl.subdl.com${sub.url}`,
            lang: 'vie',
            source: 'Vietsub (Subdl)',
            encoding: 'UTF-8',
            g: 'vietsub-subdl'
          });
        }
      }
    }
  } catch (err) {
    debugServer.warn('Vietsub subdl error:', sanitizeForLogging(err.message));
  }

  try {
    let proxyUrl = `https://opensubtitles-v3.strem.io/subtitles/${type}/tt${cleanImdb}`;
    if (type === 'series' && season && episode) proxyUrl += `:${season}:${episode}`;
    proxyUrl += '.json';

    const { data } = await axios.get(proxyUrl, {
      timeout: 4000,
      headers: { 'User-Agent': 'Stremio Dual Subtitles Addon/1.0.0' }
    });

    if (Array.isArray(data?.subtitles)) {
      const vieSubs = data.subtitles.filter(s => s.lang === 'vie' || s.lang === 'vie-VN' || s.lang === 'vietnamese');
      for (const s of vieSubs) {
        results.push({
          id: `vietsub-stremio-${s.id}`,
          originalId: s.id,
          url: s.url,
          lang: 'vie',
          source: 'Vietsub (Community)',
          encoding: s.SubEncoding || 'UTF-8',
          g: s.g || 'vietsub-stremio'
        });
      }
    }
  } catch (err) {
    debugServer.warn('Vietsub community error:', sanitizeForLogging(err.message));
  }

  return results;
}

module.exports = { fetchVietsub };
