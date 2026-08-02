const path = require('path');
const { addonBuilder } = require('stremio-addon-sdk');
const pako = require('pako');
const axios = require('axios');
const { debugServer, sanitizeForLogging } = require('./lib/debug');
const { decodeSubtitleBuffer, getLanguageAliases, isCjkLanguage } = require('./encoding');
const {
  languageMap,
  getLanguageOptions,
  parseLangCode,
  getLanguageName
} = require('./languages');
const { alignAndMatch } = require('./lib/syncEngine');
const { generateCandidatePairs, filterByLanguage } = require('./lib/sourceSelection');
const { scrapeAllSources, generateSelectableDualPairs } = require('./scrapers');
const { singleflight } = require('./lib/singleflight');
const { translateSubtitleCues, isTranslationEnabled } = require('./lib/translator');

function stripHtmlTags(str) {
  return typeof str === 'string' ? str.replace(/<[^>]*>/g, '') : '';
}

function parseTimeToMs(timeString) {
  if (!timeString) return 0;
  const match = timeString.match(/(\d{1,2}):(\d{2}):(\d{2})[,.](\d{1,3})/);
  if (!match) return 0;
  const [, h, m, s, ms] = match;
  return (parseInt(h, 10) * 3600 + parseInt(m, 10) * 60 + parseInt(s, 10)) * 1000 + parseInt(ms.padEnd(3, '0'), 10);
}

function msToSrtTime(ms) {
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  const milli = ms % 1000;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')},${String(milli).padStart(3, '0')}`;
}

function parseTimestampLine(line) {
  if (!line?.includes('-->')) return null;
  const match = line.match(/(\d{1,2}:\d{2}:\d{2}[,.]\d{1,3})\s*-->\s*(\d{1,2}:\d{2}:\d{2}[,.]\d{1,3})/);
  if (!match) return null;
  const startMs = parseTimeToMs(match[1]);
  const endMs = parseTimeToMs(match[2]);
  if (endMs <= startMs) return null;
  return { startTime: msToSrtTime(startMs), endTime: msToSrtTime(endMs) };
}

function parseSrtSimple(srtText) {
  const lines = srtText.trim().split('\n');
  const subtitles = [];
  let current = null;
  let pendingId = null;

  const pushCurrent = () => {
    if (current?.startTime && current?.endTime && current?.text?.trim()) {
      subtitles.push(current);
    }
    current = null;
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    const timing = parseTimestampLine(line);

    if (!line) {
      pushCurrent();
      pendingId = null;
      continue;
    }

    if (timing) {
      pushCurrent();
      current = {
        id: pendingId || String(subtitles.length + 1),
        startTime: timing.startTime,
        endTime: timing.endTime,
        text: ''
      };
      pendingId = null;
      continue;
    }

    const nextLine = i + 1 < lines.length ? lines[i + 1].trim() : '';
    if (parseTimestampLine(nextLine)) {
      if (current) pushCurrent();
      pendingId = line;
      continue;
    }

    if (!current) continue;
    if (current.text) current.text += '\n';
    current.text += line;
  }

  pushCurrent();
  return subtitles;
}

function formatSrtSimple(subtitles, mainLang = '', transLang = '') {
  const lines = [];
  let idx = 1;
  const mainName = getLanguageName(mainLang) || (mainLang ? String(mainLang).toUpperCase() : '');
  const transName = getLanguageName(transLang) || (transLang ? String(transLang).toUpperCase() : '');

  if (mainName && transName) {
    lines.push(String(idx++));
    lines.push('00:00:00,100 --> 00:00:04,500');
    lines.push(`<b>[Dual Subtitles] Active: ${mainName} + ${transName}</b>`);
    lines.push('');
  }

  for (const sub of subtitles || []) {
    if (!sub?.startTime || !sub?.endTime || !sub?.text) continue;
    lines.push(String(idx++));
    lines.push(`${sub.startTime} --> ${sub.endTime}`);
    lines.push(sub.text);
    lines.push('');
  }

  return lines.join('\n');
}

const VIDEO_PARAM_KEYS = ['filename', 'videoSize', 'videoHash', 'marker', 'primarySize', 'secondarySize', 'color'];

function normalizeVideoParams(params = {}) {
  if (!params || typeof params !== 'object') return {};
  const normalized = {};
  for (const key of VIDEO_PARAM_KEYS) {
    const val = Array.isArray(params[key]) ? params[key][0] : params[key];
    if (val != null && String(val).trim()) normalized[key] = String(val).trim();
  }
  return normalized;
}

function serializeVideoParams(params = {}) {
  const normalized = normalizeVideoParams(params);
  const search = new URLSearchParams();
  for (const key of VIDEO_PARAM_KEYS) {
    if (normalized[key]) search.set(key, normalized[key]);
  }
  return search.toString();
}

const QUALITY_GATE_THRESHOLD = 0.85;
const MAX_PAIR_ATTEMPTS = 3;
const ADDON_NAME = process.env.ADDON_NAME || 'Dual Subtitles';
const ADDON_VERSION = '1.0.0';

const manifest = {
  id: 'community.dualsubtitles',
  version: ADDON_VERSION,
  name: ADDON_NAME,
  description: 'Watch movies and series with dual subtitles - see two languages simultaneously for better language learning!',
  resources: ['subtitles'],
  types: ['movie', 'series', 'anime'],
  idPrefixes: ['tt', 'kitsu', 'mal', 'anilist', 'tmdb'],
  catalogs: [],
  logo: '/logo.png',
  behaviorHints: {
    configurable: true,
    configurationRequired: true
  },
  stremioAddonsConfig: {
    issuer: 'https://stremio-addons.net',
    signature: 'eyJhbGciOiJkaXIiLCJlbmMiOiJBMTI4Q0JDLUhTMjU2In0..0dhMmLAGB8GgrgR0k_QVag.QvSVlwg-SctRXOgQgdIhydZx55LSndygGe4uCb2VrwGzHfQm5hyH0j3BxQOMrMZWuBxFkMkVYt9QF4jNx6yyffbx1ub8KJCjnKl9SfBCkI9aFk9RrD7T0FbuPurxIbrd.OH-8gvJWWzw6O7QtreVs_w'
  },
  config: [
    {
      key: 'mainLang',
      type: 'select',
      title: 'Primary Language (Audio/Learning Language)',
      options: getLanguageOptions(),
      required: true,
      default: 'English [eng]'
    },
    {
      key: 'transLang',
      type: 'select',
      title: 'Secondary Language (Your Native Language)',
      options: getLanguageOptions(),
      required: true,
      default: 'Turkish [tur]'
    },
    {
      key: 'autoTranslate',
      type: 'checkbox',
      title: 'Auto-translate when secondary language subtitles unavailable',
      default: 'true'
    },
    {
      key: 'marker',
      type: 'select',
      title: 'Secondary Subtitle Marker',
      options: ['None (No prefix symbol)', 'Angle Symbol (›)', 'Dash (-)', 'Dot (•)'],
      default: 'None (No prefix symbol)'
    },
    {
      key: 'primarySize',
      type: 'select',
      title: 'Primary Subtitle Size',
      options: ['Normal', 'Large', 'Small'],
      default: 'Normal'
    },
    {
      key: 'secondarySize',
      type: 'select',
      title: 'Secondary Subtitle Size',
      options: ['Small', 'Normal', 'Extra Small'],
      default: 'Small'
    },
    {
      key: 'color',
      type: 'select',
      title: 'Secondary Subtitle Color',
      options: ['Slate Gray (#94a3b8)', 'Soft Yellow (#fef08a)', 'Cyan (#a5f3fc)', 'White (#ffffff)'],
      default: 'Slate Gray (#94a3b8)'
    }
  ]
};

const builder = new addonBuilder(manifest);

async function fetchWithRetry(url, options = {}, retries = 1, backoffMs = 200) {
  try {
    return await axios.get(url, {
      timeout: 5000,
      headers: { 'User-Agent': 'Stremio Dual Subtitles Addon/1.0.0 (https://stremio-addons.net)' },
      ...options
    });
  } catch (error) {
    const status = error?.response?.status;
    if (retries > 0 && [429, 469, 503, 504].includes(status)) {
      await new Promise(resolve => setTimeout(resolve, backoffMs));
      return fetchWithRetry(url, options, retries - 1, backoffMs * 2);
    }
    throw error;
  }
}

async function fetchSubtitleContent(url, languageCode = null) {
  try {
    const response = await fetchWithRetry(url, {
      responseType: 'arraybuffer',
      timeout: 10000,
      maxContentLength: 10 * 1024 * 1024
    });

    const disposition = response.headers?.['content-disposition'];
    if (disposition?.toLowerCase().includes('forced')) return null;

    let buffer = Buffer.from(response.data);
    if (url.endsWith('.gz') || (buffer.length > 2 && buffer[0] === 0x1f && buffer[1] === 0x8b)) {
      try {
        buffer = Buffer.from(pako.ungzip(buffer));
      } catch (e) {
        debugServer.error('Error decompressing gzip:', sanitizeForLogging(e.message));
        return null;
      }
    }

    return decodeSubtitleBuffer(buffer, languageCode);
  } catch (error) {
    debugServer.error('Error fetching subtitle:', sanitizeForLogging(error.message));
    return null;
  }
}

function normalizeVttToSrt(text) {
  const lines = text.split('\n');
  const output = [];
  let cueIndex = 0;
  let inHeader = true;
  let inStyleBlock = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    if (inHeader) {
      if (['', 'WEBVTT'].includes(line) || line.startsWith('Kind:') || line.startsWith('Language:') || line.startsWith('NOTE')) {
        continue;
      }
      inHeader = false;
    }

    if (line.startsWith('STYLE') || line.startsWith('::cue')) {
      inStyleBlock = true;
      continue;
    }
    if (inStyleBlock) {
      if (line === '') inStyleBlock = false;
      continue;
    }

    if (line.includes('-->')) {
      cueIndex++;
      output.push('', String(cueIndex), line.replace(/\./g, ','));
      continue;
    }

    if (/^\d+$/.test(line) && i + 1 < lines.length && lines[i + 1].includes('-->')) {
      continue;
    }

    output.push(line);
  }

  return output.join('\n');
}

function parseSrt(srtText) {
  if (!srtText || typeof srtText !== 'string') return null;

  try {
    srtText = srtText.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    if (srtText.charCodeAt(0) === 0xFEFF) srtText = srtText.substring(1);

    if (srtText.trimStart().startsWith('WEBVTT')) {
      srtText = normalizeVttToSrt(srtText);
    }

    srtText = srtText.replace(/(\d{1,2}:\d{2}:\d{2})\.(\d{1,3})/g, '$1,$2');
    const parsed = parseSrtSimple(srtText);
    if (!Array.isArray(parsed) || !parsed.length) return null;

    const adKeywords = ['OpenSubtitles.org', 'OpenSubtitles.com', 'osdb.link', 'Advertise your'];
    return parsed.filter(sub => !adKeywords.some(keyword => sub.text?.includes(keyword)));
  } catch (error) {
    debugServer.error('Error parsing SRT:', sanitizeForLogging(error.message));
    return null;
  }
}

function decodeHtmlEntities(str) {
  if (!str || typeof str !== 'string') return '';
  let prev = '';
  let curr = String(str);
  let passes = 0;
  while (curr !== prev && passes < 3) {
    prev = curr;
    curr = curr
      .replace(/&quot;|&#34;|&#034;/gi, '"')
      .replace(/&apos;|&#39;|&#039;/gi, "'")
      .replace(/&lt;|&#60;/gi, '<')
      .replace(/&gt;|&#62;/gi, '>')
      .replace(/&nbsp;|&#160;/gi, ' ')
      .replace(/&amp;|&#38;/gi, '&');
    passes++;
  }
  return curr;
}

function joinSubtitleLines(text, langCode) {
  if (!text) return '';
  return text.replace(/\r?\n|\r/g, isCjkLanguage(langCode) ? '' : ' ').trim();
}

function cleanText(text, langCode) {
  if (!text) return '';
  let s = decodeHtmlEntities(text);
  s = stripHtmlTags(s);
  s = decodeHtmlEntities(s);
  return joinSubtitleLines(s, langCode);
}

const DUAL_SUB_TRANS_COLOR = '#94a3b8';

function mergeSubtitles(mainSubs, transSubs, options = {}) {
  const opts = typeof options === 'number' ? { matchThresholdMs: Math.max(options, 1500) } : options;
  const {
    mainLang = null,
    transLang = null,
    matchThresholdMs = 1500,
    allowMultiTrans = true,
    enableOffset = true,
    enableDrift = true,
    marker = 'angle',
    primarySize = 'normal',
    secondarySize = 'small',
    color = DUAL_SUB_TRANS_COLOR
  } = opts;

  const mainTimed = [];
  for (const s of mainSubs || []) {
    if (!s?.startTime || !s?.endTime) continue;
    const startMs = parseTimeToMs(s.startTime);
    const endMs = parseTimeToMs(s.endTime);
    if (endMs > startMs) mainTimed.push({ ...s, startMs, endMs });
  }

  const transTimed = [];
  for (const s of transSubs || []) {
    if (!s?.startTime || !s?.endTime) continue;
    const startMs = parseTimeToMs(s.startTime);
    const endMs = parseTimeToMs(s.endTime);
    if (endMs > startMs) transTimed.push({ ...s, startMs, endMs });
  }

  const alignment = alignAndMatch(mainTimed, transTimed, {
    enableOffset,
    enableDrift,
    matchThreshold: matchThresholdMs,
    allowMultiTrans,
    log: msg => debugServer.log(sanitizeForLogging(msg))
  });
  const { matches } = alignment;

  const transJoiner = isCjkLanguage(transLang) ? '' : ' ';
  const mergedSubs = [];

  for (let mi = 0; mi < mainTimed.length; mi++) {
    const mainSub = mainTimed[mi];
    const cleanMainText = cleanText(mainSub.text, mainLang);
    if (!cleanMainText) continue;

    let formattedMain = `<b>${cleanMainText}</b>`;
    if (primarySize === 'large') formattedMain = `<big>${formattedMain}</big>`;
    else if (primarySize === 'small') formattedMain = `<small>${formattedMain}</small>`;

    let mergedText;
    const transIdxs = matches.get(mi);
    if (transIdxs?.length) {
      const transParts = transIdxs
        .map(ti => cleanText(transTimed[ti]?.text, transLang))
        .filter(Boolean);

      if (transParts.length) {
        const cleanTransText = transParts.join(transJoiner);
        const prefix = marker === 'angle' ? '\u203a ' : marker === 'dash' ? '- ' : marker === 'dot' ? '• ' : '';
        let formattedTrans = `<i><font color="${color}">${prefix}${cleanTransText}</font></i>`;
        if (secondarySize === 'small') formattedTrans = `<small>${formattedTrans}</small>`;
        else if (secondarySize === 'x-small') formattedTrans = `<small><small>${formattedTrans}</small></small>`;

        mergedText = `${formattedMain}\n${formattedTrans}`;
      }
    }

    if (mergedText === undefined) {
      mergedText = formattedMain;
    }

    mergedSubs.push({
      id: mainSub.id,
      startTime: mainSub.startTime,
      endTime: mainSub.endTime,
      text: mergedText
    });
  }

  Object.defineProperty(mergedSubs, 'matchRate', { value: alignment.matchRate || 0, enumerable: false });
  Object.defineProperty(mergedSubs, 'alignment', {
    value: {
      offsetMs: alignment.offsetMs,
      drift: alignment.drift,
      localAnchors: alignment.localAnchors,
      matchedCount: matches.size,
      mainCount: mainTimed.length
    },
    enumerable: false
  });
  return mergedSubs;
}

function formatSrt(subtitleArray) {
  if (!Array.isArray(subtitleArray)) return null;
  try {
    return formatSrtSimple(subtitleArray);
  } catch (error) {
    debugServer.error('Error formatting SRT:', sanitizeForLogging(error.message));
    return null;
  }
}

const subtitleCache = new Map();
const CACHE_TTL = 6 * 60 * 60 * 1000;

function storeSubtitle(key, srtContent) {
  const now = Date.now();
  for (const [k, v] of subtitleCache.entries()) {
    if (now - v.timestamp > CACHE_TTL) subtitleCache.delete(k);
  }
  subtitleCache.set(key, { content: srtContent, timestamp: now });
  return key;
}

function getSubtitle(key) {
  const entry = subtitleCache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.timestamp > CACHE_TTL) {
    subtitleCache.delete(key);
    return null;
  }
  return entry.content;
}

async function selectAndMergeBestPair(candidatePairs, mainLang, transLang, options = {}) {
  if (!Array.isArray(candidatePairs) || !candidatePairs.length) return null;

  const parsedCache = new Map();
  async function getParsed(sub, lang) {
    if (parsedCache.has(sub.id)) return parsedCache.get(sub.id);
    const content = await fetchSubtitleContent(sub.url, lang);
    const parsed = content ? parseSrt(content) : null;
    parsedCache.set(sub.id, parsed);
    return parsed;
  }

  let best = null;
  const attempts = Math.min(candidatePairs.length, MAX_PAIR_ATTEMPTS);

  for (let i = 0; i < attempts; i++) {
    const pair = candidatePairs[i];
    const [mainParsed, transParsed] = await Promise.all([
      getParsed(pair.main, mainLang),
      getParsed(pair.trans, transLang)
    ]);
    if (!mainParsed?.length || !transParsed?.length) continue;

    const merged = mergeSubtitles(mainParsed, transParsed, { mainLang, transLang, ...options });
    const matchRate = merged?.matchRate || 0;

    if (!best || matchRate > best.matchRate) {
      best = {
        merged,
        mergedSrt: merged.length ? formatSrt(merged) : null,
        matchRate,
        mainSub: pair.main,
        transSub: pair.trans,
        attempts: i + 1,
        passedGate: matchRate >= QUALITY_GATE_THRESHOLD
      };
    }
    if (matchRate >= QUALITY_GATE_THRESHOLD) break;
  }

  return best;
}

const armCache = new Map();
const ARM_CACHE_TTL = 24 * 60 * 60 * 1000;

async function fetchArmMapping(source, id) {
  if (!id) return null;
  const cacheKey = `${source}:${id}`;
  const now = Date.now();
  const cached = armCache.get(cacheKey);
  if (cached && (now - cached.timestamp < ARM_CACHE_TTL)) return cached.data;

  try {
    const url = `https://arm.haglund.dev/api/v2/ids?source=${encodeURIComponent(source)}&id=${encodeURIComponent(id)}`;
    const response = await fetchWithRetry(url, { timeout: 5000 });
    if (response?.data?.imdb) {
      armCache.set(cacheKey, { data: response.data, timestamp: now });
      return response.data;
    }
  } catch (error) {
    debugServer.warn(`ARM mapping failed for ${source}:${id}:`, sanitizeForLogging(error.message));
  }

  if (source === 'kitsu') {
    try {
      const kitsuUrl = `https://kitsu.io/api/edge/anime/${encodeURIComponent(id)}/mappings`;
      const kitsuRes = await fetchWithRetry(kitsuUrl, { timeout: 5000 });
      const mappings = kitsuRes?.data?.data || [];
      const malMapping = mappings.find(m => m?.attributes?.externalSite === 'myanimelist/anime');
      if (malMapping?.attributes?.externalId) {
        const malData = await fetchArmMapping('myanimelist', malMapping.attributes.externalId);
        if (malData?.imdb) {
          armCache.set(cacheKey, { data: malData, timestamp: now });
          return malData;
        }
      }
    } catch (kitsuErr) {
      debugServer.warn(`Kitsu fallback mapping failed for ${id}:`, sanitizeForLogging(kitsuErr.message));
    }
  }

  return null;
}

async function resolveMediaId(id, type, extra = {}) {
  if (!id || typeof id !== 'string') return null;

  let season = extra?.season ? String(extra.season) : null;
  let episode = extra?.episode ? String(extra.episode) : null;
  let cleanId = extra?.imdbId || id;

  if (cleanId.startsWith('kitsu:') || cleanId.startsWith('mal:') || cleanId.startsWith('myanimelist:') || cleanId.startsWith('anilist:')) {
    const parts = cleanId.split(':');
    const prefix = parts[0];
    const source = prefix.startsWith('kitsu') ? 'kitsu' : prefix.startsWith('mal') || prefix.startsWith('myanimelist') ? 'myanimelist' : 'anilist';
    const sourceId = parts[1];
    const episodeNum = parts[2] || episode || '1';

    const mapped = await fetchArmMapping(source, sourceId);
    if (mapped?.imdb) {
      const imdbId = String(mapped.imdb).replace(/^tt/, '');
      const mappedSeason = mapped['thetvdb-season'] || mapped['themoviedb-season'] || 1;
      return {
        imdbId,
        type: 'series',
        season: season || String(mappedSeason),
        episode: episode || String(episodeNum)
      };
    }
    return {
      imdbId: null,
      ...(source === 'kitsu' ? { kitsuId: sourceId } : {}),
      type: 'series',
      season: season || '1',
      episode: episode || String(episodeNum)
    };
  }

  if (cleanId.includes(':')) {
    const parts = cleanId.split(':');
    cleanId = parts[0];
    if (parts.length >= 3) {
      season = season || parts[1];
      episode = episode || parts[2];
    }
  }

  cleanId = String(cleanId).replace(/^tt/, '');
  if (!cleanId) return null;

  return { imdbId: cleanId, type, season, episode };
}

async function subtitlesHandler({ type, id, extra, config }) {
  const mainLang = parseLangCode(config?.mainLang || 'English [eng]');
  const transLang = parseLangCode(config?.transLang || 'Turkish [tur]');

  if (mainLang === transLang) return { subtitles: [] };

  const resolved = await resolveMediaId(id, type, extra);
  const effectiveType = resolved?.type || type || 'series';
  const season = resolved?.season || extra?.season || '1';
  const episode = resolved?.episode || extra?.episode || '1';
  const targetId = resolved?.imdbId ? `tt${resolved.imdbId}` : (resolved?.kitsuId ? `kitsu:${resolved.kitsuId}:${episode}` : id);

  try {
    const videoParams = {
      filename: extra?.filename,
      videoSize: extra?.videoSize,
      videoHash: extra?.videoHash,
      marker: config?.marker,
      primarySize: config?.primarySize,
      secondarySize: config?.secondarySize,
      color: config?.color
    };
    const videoQuery = serializeVideoParams(videoParams);

    const allSubtitles = await scrapeAllSources(targetId, effectiveType, season, episode, videoParams);
    const selectablePairs = generateSelectableDualPairs(allSubtitles, mainLang, transLang);

    let finalSubtitles = [];

    if (selectablePairs.length > 0) {
      finalSubtitles = selectablePairs.map(pair => {
        const dynamicParams = [
          effectiveType, encodeURIComponent(targetId), season || '0', episode || '0',
          mainLang, transLang, encodeURIComponent(pair.main.id), encodeURIComponent(pair.trans.id)
        ].join('/');

        return {
          id: pair.id,
          url: `{{ADDON_URL}}/subs/${dynamicParams}.vtt${videoQuery ? `?${videoQuery}` : ''}`,
          lang: parseLangCode(mainLang),
          name: pair.title,
          SubtitlesName: pair.subtitleName
        };
      });
    } else {
      const autoTranslate = config?.autoTranslate !== 'false';
      const mainList = filterByLanguage(allSubtitles, mainLang);
      const transList = filterByLanguage(allSubtitles, transLang);

      if (autoTranslate && isTranslationEnabled() && mainList.length > 0 && transList.length === 0) {
        const trackTitle = `🤖 Dual [Auto-Translated] (${parseLangCode(mainLang).toUpperCase()}+${parseLangCode(transLang).toUpperCase()})`;
        const trackSubtitleName = `${trackTitle} - ${getLanguageName(mainLang)} → ${getLanguageName(transLang)}`;
        const dynamicParams = [
          effectiveType, encodeURIComponent(targetId), season || '0', episode || '0',
          mainLang, transLang, encodeURIComponent(mainList[0].id), 'translate'
        ].join('/');

        finalSubtitles = [{
          id: `dual-translate-${parseLangCode(mainLang)}-${parseLangCode(transLang)}`,
          url: `{{ADDON_URL}}/subs/${dynamicParams}.vtt${videoQuery ? `?${videoQuery}` : ''}`,
          lang: parseLangCode(mainLang),
          name: trackTitle,
          SubtitlesName: trackSubtitleName
        }];
      } else {
        const trackTitle = `Dual (${parseLangCode(mainLang).toUpperCase()}+${parseLangCode(transLang).toUpperCase()})`;
        const trackSubtitleName = `${trackTitle} - ${getLanguageName(mainLang)} + ${getLanguageName(transLang)}`;
        const dynamicParams = [
          effectiveType, encodeURIComponent(targetId), season || '0', episode || '0',
          mainLang, transLang, 'auto', 'auto'
        ].join('/');

        finalSubtitles = [{
          id: `dual-${parseLangCode(mainLang)}-${parseLangCode(transLang)}`,
          url: `{{ADDON_URL}}/subs/${dynamicParams}.vtt${videoQuery ? `?${videoQuery}` : ''}`,
          lang: parseLangCode(mainLang),
          name: trackTitle,
          SubtitlesName: trackSubtitleName
        }];
      }
    }

    return { subtitles: finalSubtitles, cacheMaxAge: 3600 };
  } catch (error) {
    debugServer.error('Error in subtitle handler:', sanitizeForLogging(error.message));
    return { subtitles: [] };
  }
}

builder.defineSubtitlesHandler(subtitlesHandler);

async function generateDynamicSubtitle(
  type, imdbId, season, episode, mainLang, transLang, mainSubId, transSubId, videoParams = {}
) {
  const resolved = await resolveMediaId(imdbId, type, { season, episode });
  const targetId = resolved?.imdbId ? `tt${resolved.imdbId}` : (resolved?.kitsuId ? `kitsu:${resolved.kitsuId}:${resolved.episode || '1'}` : String(imdbId));
  const effectiveType = resolved?.type || type || 'series';
  const effectiveSeason = resolved?.season || season;
  const effectiveEpisode = resolved?.episode || episode;

  const videoCacheFragment = serializeVideoParams(videoParams);
  const cacheKey = `${targetId}_${effectiveSeason || ''}_${effectiveEpisode || ''}_${mainLang}_${transLang}_${mainSubId}_${transSubId}_${videoCacheFragment || ''}`;

  const memCached = getSubtitle(cacheKey);
  if (memCached) return memCached;

  return singleflight(cacheKey, async () => {
    try {
      const normalizedVideoParams = normalizeVideoParams(videoParams);
      const allSubtitles = await scrapeAllSources(
        targetId, effectiveType, effectiveSeason !== '0' ? effectiveSeason : null,
        effectiveEpisode !== '0' ? effectiveEpisode : null, normalizedVideoParams
      );

      if (!allSubtitles?.length) {
        const mainName = getLanguageName(mainLang) || String(mainLang).toUpperCase();
        const transName = getLanguageName(transLang) || String(transLang).toUpperCase();
        return `WEBVTT\n\n1\n00:00:00.100 --> 00:00:10.000\n<b>[Dual Subtitles] 0 subtitles found on OpenSubtitles for ${mainName} + ${transName}</b>\n\n2\n00:00:10.100 --> 00:00:20.000\n<b>[Dual Subtitles] Try selecting another track in Stremio</b>\n`;
      }

      const decodedMainId = decodeURIComponent(mainSubId);
      const decodedTransId = decodeURIComponent(transSubId);
      const isTranslateRequest = decodedTransId === 'translate';

      const mainSub = allSubtitles.find(s => String(s.id) === String(decodedMainId));
      const transSub = isTranslateRequest ? null : allSubtitles.find(s => String(s.id) === String(decodedTransId));

      const mergeOptions = {
        mainLang,
        transLang,
        marker: videoParams?.marker || 'none',
        primarySize: videoParams?.primarySize || 'normal',
        secondarySize: videoParams?.secondarySize || 'small',
        color: videoParams?.color || DUAL_SUB_TRANS_COLOR
      };

      if (mainSub && transSub) {
        const [mainParsed, transParsed] = await Promise.all([
          fetchSubtitleContent(mainSub.url, mainLang).then(c => c ? parseSrt(c) : null),
          fetchSubtitleContent(transSub.url, transLang).then(c => c ? parseSrt(c) : null)
        ]);

        if (mainParsed?.length && transParsed?.length) {
          const merged = mergeSubtitles(mainParsed, transParsed, mergeOptions);
          if (merged?.length) {
            const srtContent = formatSrt(merged);
            if (srtContent) {
              storeSubtitle(cacheKey, srtContent);
              return srtContent;
            }
          }
        }
      }

      if (isTranslateRequest && mainSub) {
        const mainContent = await fetchSubtitleContent(mainSub.url, mainLang);
        const mainParsed = mainContent ? parseSrt(mainContent) : null;

        if (mainParsed?.length) {
          const translatedCues = await translateSubtitleCues(mainParsed, mainLang, transLang);
          if (translatedCues?.length) {
            const merged = mergeSubtitles(mainParsed, translatedCues, mergeOptions);
            if (merged?.length) {
              const srtContent = formatSrt(merged);
              if (srtContent) {
                storeSubtitle(cacheKey, srtContent);
                return srtContent;
              }
            }
          }
          const primaryOnly = mergeSubtitles(mainParsed, [], mergeOptions);
          const primarySrt = formatSrt(primaryOnly);
          if (primarySrt) {
            storeSubtitle(cacheKey, primarySrt);
            return primarySrt;
          }
        }
      }

      const candidatePairs = generateCandidatePairs(allSubtitles, mainLang, transLang);
      if (candidatePairs.length) {
        const best = await selectAndMergeBestPair(candidatePairs, mainLang, transLang, mergeOptions);
        if (best?.merged?.length && best.mergedSrt) {
          storeSubtitle(cacheKey, best.mergedSrt);
          return best.mergedSrt;
        }
      }

      const mainList = filterByLanguage(allSubtitles, mainLang) || [];
      const transList = filterByLanguage(allSubtitles, transLang) || [];
      const fallbackSub = mainSub || transSub || mainList[0] || transList[0] || allSubtitles[0];

      if (fallbackSub) {
        const subLang = fallbackSub.lang || mainLang;
        const content = await fetchSubtitleContent(fallbackSub.url, subLang);
        if (content) {
          const parsed = parseSrt(content);
          if (parsed?.length) {
            const merged = mergeSubtitles(parsed, [], { ...mergeOptions, mainLang: subLang });
            const fallbackSrt = formatSrt(merged);
            if (fallbackSrt) {
              storeSubtitle(cacheKey, fallbackSrt);
              return fallbackSrt;
            }
          }
        }
      }

      return '1\n00:00:00,000 --> 00:00:01,000\n \n';
    } catch (error) {
      debugServer.error('Error generating dynamic subtitle:', sanitizeForLogging(error.message));
      return '1\n00:00:00,000 --> 00:00:01,000\n \n';
    }
  });
}

module.exports = {
  builder,
  manifest,
  getSubtitle,
  subtitleCache,
  subtitlesHandler,
  generateDynamicSubtitle,
  resolveMediaId,
  fetchArmMapping,
  _test: {
    parseTimeToMs,
    parseSrt,
    parseSrtSimple,
    normalizeVttToSrt,
    mergeSubtitles,
    joinSubtitleLines,
    formatSrt,
    formatSrtSimple,
    msToSrtTime,
    resolveMediaId,
    fetchArmMapping
  }
};
