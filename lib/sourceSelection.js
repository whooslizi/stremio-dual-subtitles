const { getLanguageAliases } = require('../encoding');

function filterByLanguage(allSubtitles, languageId) {
  if (!Array.isArray(allSubtitles) || !languageId) return [];
  const aliases = getLanguageAliases(languageId);
  return allSubtitles.filter(s => s && aliases.includes(s.lang));
}

function selfScore(sub) {
  if (!sub) return 0;
  let s = 0;
  if (sub.m === 'i') s += 10;
  if (sub.SubEncoding === 'UTF-8') s += 5;
  else if (sub.SubEncoding === 'CP1254' || sub.SubEncoding === 'CP1251') s += 2;
  return s;
}

function rankCandidatesForLanguage(allSubtitles, languageId) {
  const list = filterByLanguage(allSubtitles, languageId);
  return list
    .map((sub, idx) => ({ sub, idx }))
    .sort((a, b) => (selfScore(b.sub) - selfScore(a.sub)) || (a.idx - b.idx))
    .map(x => x.sub);
}

function generateCandidatePairs(allSubtitles, mainLang, transLang, options = {}) {
  const { maxPairs = 6, maxPerGroup = 2 } = options;

  const mainList = rankCandidatesForLanguage(allSubtitles, mainLang);
  const transList = rankCandidatesForLanguage(allSubtitles, transLang);
  if (!mainList.length || !transList.length) return [];

  const seen = new Set();
  const pairKey = (m, t) => `${m.id}:${t.id}`;

  const transByG = new Map();
  for (const t of transList) {
    if (!t.g) continue;
    if (!transByG.has(t.g)) transByG.set(t.g, []);
    transByG.get(t.g).push(t);
  }

  const groupQueue = [];
  for (const m of mainList) {
    const peers = transByG.get(m.g);
    if (!peers?.length) continue;
    let count = 0;
    for (const t of peers) {
      const key = pairKey(m, t);
      if (seen.has(key)) continue;
      groupQueue.push({ main: m, trans: t, sameGroup: true, group: m.g, source: 'group' });
      seen.add(key);
      if (++count >= maxPerGroup) break;
    }
  }

  const zipQueue = [];
  const zipLen = Math.min(mainList.length, transList.length);
  for (let i = 0; i < zipLen; i++) {
    const key = pairKey(mainList[i], transList[i]);
    if (seen.has(key)) continue;
    const sameG = mainList[i].g === transList[i].g && mainList[i].g != null;
    zipQueue.push({
      main: mainList[i],
      trans: transList[i],
      sameGroup: sameG,
      group: sameG ? mainList[i].g : null,
      source: 'fallback'
    });
    seen.add(key);
  }

  const pairs = [];
  const queues = [groupQueue, zipQueue, groupQueue, zipQueue, groupQueue, zipQueue];
  for (const q of queues) {
    if (pairs.length >= maxPairs) break;
    if (q.length) pairs.push(q.shift());
  }

  while (pairs.length < maxPairs && (groupQueue.length || zipQueue.length)) {
    if (groupQueue.length) pairs.push(groupQueue.shift());
    if (pairs.length >= maxPairs) break;
    if (zipQueue.length) pairs.push(zipQueue.shift());
  }

  for (let i = 1; i < transList.length && pairs.length < maxPairs; i++) {
    const key = pairKey(mainList[0], transList[i]);
    if (seen.has(key)) continue;
    pairs.push({
      main: mainList[0],
      trans: transList[i],
      sameGroup: mainList[0].g === transList[i].g && mainList[0].g != null,
      group: null,
      source: 'fallback'
    });
    seen.add(key);
  }

  for (let i = 1; i < mainList.length && pairs.length < maxPairs; i++) {
    const key = pairKey(mainList[i], transList[0]);
    if (seen.has(key)) continue;
    pairs.push({
      main: mainList[i],
      trans: transList[0],
      sameGroup: mainList[i].g === transList[0].g && mainList[0].g != null,
      group: null,
      source: 'fallback'
    });
    seen.add(key);
  }

  return pairs;
}

module.exports = {
  filterByLanguage,
  rankCandidatesForLanguage,
  generateCandidatePairs,
  _internal: { selfScore }
};
