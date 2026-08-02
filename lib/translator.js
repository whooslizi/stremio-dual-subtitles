const { debugServer, sanitizeForLogging } = require('./debug');

const LINGVA_API_URL = (process.env.LINGVA_API_URL || 'https://lingva.ml').replace(/\/$/, '');
const TRANSLATION_ENABLED = process.env.TRANSLATION_ENABLED !== 'false';

const BATCH_SEP = ' ||| ';
const BATCH_SIZE = 25;
const TRANSLATE_TIMEOUT = 8000;

const LANG_CODE_MAP = {
  eng: 'en', vie: 'vi', tur: 'tr', spa: 'es', fre: 'fr', fra: 'fr',
  ger: 'de', deu: 'de', ita: 'it', por: 'pt', rus: 'ru', jpn: 'ja',
  kor: 'ko', zho: 'zh', chi: 'zh', ara: 'ar', hin: 'hi', tha: 'th',
  pol: 'pl', nld: 'nl', dut: 'nl', swe: 'sv', nor: 'no', nob: 'no',
  dan: 'da', fin: 'fi', ces: 'cs', cze: 'cs', ron: 'ro', rum: 'ro',
  hun: 'hu', ell: 'el', gre: 'el', bul: 'bg', hrv: 'hr', srp: 'sr',
  slk: 'sk', slo: 'sk', ukr: 'uk', cat: 'ca', glg: 'gl', eus: 'eu',
  baq: 'eu', ind: 'id', may: 'ms', msa: 'ms', fil: 'tl', heb: 'he',
  per: 'fa', fas: 'fa', ben: 'bn', tam: 'ta', tel: 'te', mal: 'ml',
  kan: 'kn', mar: 'mr', guj: 'gu', urd: 'ur', mya: 'my', bur: 'my'
};

function toIso1(langCode) {
  if (!langCode) return null;
  const code = String(langCode).toLowerCase().trim();
  return code.length === 2 ? code : LANG_CODE_MAP[code] || null;
}

async function fetchWithTimeout(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TRANSLATE_TIMEOUT);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'Stremio Dual Subtitles/1.0' }
    });
    return res.ok ? res.json() : null;
  } catch (err) {
    debugServer.warn(`Translation request failed: ${sanitizeForLogging(err.message)}`);
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

async function translateViaLingva(text, fromLang, toLang) {
  const data = await fetchWithTimeout(`${LINGVA_API_URL}/api/v1/${fromLang}/${toLang}/${encodeURIComponent(text)}`);
  return data?.translation || null;
}

async function translateViaMyMemory(text, fromLang, toLang) {
  const data = await fetchWithTimeout(`https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=${fromLang}|${toLang}`);
  return data?.responseStatus === 200 ? data.responseData?.translatedText || null : null;
}

async function translateBatch(text, fromLang, toLang) {
  return (await translateViaLingva(text, fromLang, toLang)) || (await translateViaMyMemory(text, fromLang, toLang));
}

async function translateSubtitleCues(cues, fromLang, toLang) {
  if (!TRANSLATION_ENABLED || !cues?.length) return null;

  const from1 = toIso1(fromLang);
  const to1 = toIso1(toLang);
  if (!from1 || !to1 || from1 === to1) return null;

  const translated = new Array(cues.length);
  let successCount = 0;

  for (let batchStart = 0; batchStart < cues.length; batchStart += BATCH_SIZE) {
    const batchEnd = Math.min(batchStart + BATCH_SIZE, cues.length);
    const batchTexts = cues.slice(batchStart, batchEnd).map(c => (c.text || '').replace(/\r?\n/g, ' ').trim() || '...');
    const batchResult = await translateBatch(batchTexts.join(BATCH_SEP), from1, to1);

    if (batchResult) {
      const parts = batchResult.split(BATCH_SEP.trim());
      for (let i = 0; i < batchEnd - batchStart; i++) {
        const idx = batchStart + i;
        const translatedText = parts[i]?.trim();
        if (translatedText && translatedText !== '...') {
          translated[idx] = { ...cues[idx], text: translatedText };
          successCount++;
        } else {
          translated[idx] = { ...cues[idx] };
        }
      }
    } else {
      for (let i = batchStart; i < batchEnd; i++) {
        translated[i] = { ...cues[i] };
      }
    }
  }

  // Discard translation if less than 30% of cues succeeded
  if (successCount < cues.length * 0.3) {
    debugServer.warn('Translation quality too low, discarding');
    return null;
  }

  return translated;
}

function isTranslationEnabled() {
  return TRANSLATION_ENABLED;
}

module.exports = {
  translateSubtitleCues,
  isTranslationEnabled,
  toIso1,
  _test: {
    translateViaLingva,
    translateViaMyMemory,
    translateBatch
  }
};
