const axios = require('axios');
const { debugServer, sanitizeForLogging } = require('../lib/debug');

async function fetchSubdl(imdbId, type, season = null, episode = null, languages = []) {
  if (!imdbId) return [];

  const cleanImdb = String(imdbId).replace(/^tt/, '');
  const langQuery = languages.length > 0 ? languages.join(',') : 'eng,vie,tur,spa,fre,ger';

  try {
    const url = `https://api.subdl.com/api/v1/subtitles?imdb_id=tt${cleanImdb}&languages=${encodeURIComponent(langQuery)}`;
    const { data } = await axios.get(url, {
      timeout: 4000,
      headers: { 'User-Agent': 'Stremio Dual Subtitles Addon/1.0.0' }
    });

    if (!Array.isArray(data?.subtitles)) return [];

    return data.subtitles.map(sub => ({
      id: `subdl-${sub.id || Math.random().toString(36).substring(2, 9)}`,
      originalId: sub.id,
      url: sub.url && sub.url.startsWith('http') ? sub.url : `https://dl.subdl.com${sub.url}`,
      lang: sub.lang || sub.language || 'eng',
      source: 'Subdl',
      encoding: 'UTF-8',
      g: 'subdl'
    }));
  } catch (err) {
    debugServer.warn('Subdl fetch error:', sanitizeForLogging(err.message));
    return [];
  }
}

module.exports = { fetchSubdl };
