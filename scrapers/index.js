const { fetchOpenSubtitles } = require('./opensubtitles');
const { fetchVietsub } = require('./vietsub');
const { fetchSubdl } = require('./subdl');
const { getLanguageAliases } = require('../encoding');
const { debugServer } = require('../lib/debug');

function filterByLang(subtitles, langId) {
  if (!Array.isArray(subtitles) || !langId) return [];
  const aliases = getLanguageAliases(langId);
  return subtitles.filter(s => s?.url && aliases.includes(s.lang));
}

async function scrapeAllSources(imdbId, type, season = null, episode = null, videoParams = {}) {
  const [osSubs, vietSubs, subdlSubs] = await Promise.all([
    fetchOpenSubtitles(imdbId, type, season, episode, videoParams).catch(() => []),
    fetchVietsub(imdbId, type, season, episode).catch(() => []),
    fetchSubdl(imdbId, type, season, episode).catch(() => [])
  ]);

  const combined = [...osSubs, ...vietSubs, ...subdlSubs];
  debugServer.log(`Scraped ${combined.length} total subtitles`);
  return combined;
}

function generateSelectableDualPairs(allSubtitles, mainLang, transLang) {
  const mainList = filterByLang(allSubtitles, mainLang);
  const transList = filterByLang(allSubtitles, transLang);

  if (!mainList.length && !transList.length) return [];

  const mainCode = (getLanguageAliases(mainLang)[0] || 'eng').toUpperCase();
  const transCode = (getLanguageAliases(transLang)[0] || 'vie').toUpperCase();

  const pairs = [];
  const seenKeys = new Set();
  let matchNum = 1;

  for (const m of mainList) {
    for (const t of transList) {
      if (m.source === t.source || (m.g && t.g && m.g === t.g)) {
        const key = `${m.id}:${t.id}`;
        if (!seenKeys.has(key)) {
          seenKeys.add(key);
          pairs.push({
            id: `dual-${m.id}-${t.id}`,
            main: m,
            trans: t,
            title: `Dual [${m.source}] #${matchNum} (${mainCode}+${transCode})`,
            subtitleName: `Dual [${m.source}] #${matchNum} - ${mainCode} + ${transCode}`
          });
          matchNum++;
        }
      }
    }
  }

  for (const m of mainList) {
    for (const t of transList) {
      const key = `${m.id}:${t.id}`;
      if (!seenKeys.has(key)) {
        seenKeys.add(key);
        pairs.push({
          id: `dual-${m.id}-${t.id}`,
          main: m,
          trans: t,
          title: `Dual [${m.source}+${t.source}] (${mainCode}+${transCode})`,
          subtitleName: `Dual [${m.source}+${t.source}] - ${mainCode} + ${transCode}`
        });
      }
    }
  }

  return pairs.slice(0, 6);
}

module.exports = {
  scrapeAllSources,
  generateSelectableDualPairs,
  fetchOpenSubtitles,
  fetchVietsub,
  fetchSubdl
};
