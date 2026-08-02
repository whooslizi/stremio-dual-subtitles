const chardet = require('chardet');
const iconv = require('iconv-lite');

const CHARDET_SAMPLE_SIZE = 4096;

const ISO639_3_TO_1 = {
  'ara': 'ar', 'chi': 'zh', 'zho': 'zh', 'eng': 'en',
  'fre': 'fr', 'fra': 'fr', 'ger': 'de', 'deu': 'de',
  'hin': 'hi', 'ita': 'it', 'jpn': 'ja', 'kor': 'ko',
  'por': 'pt', 'rus': 'ru', 'spa': 'es', 'tur': 'tr',
  'alb': 'sq', 'sqi': 'sq', 'arm': 'hy', 'hye': 'hy',
  'aze': 'az', 'baq': 'eu', 'eus': 'eu', 'bel': 'be',
  'bos': 'bs', 'bul': 'bg', 'cat': 'ca', 'cze': 'cs',
  'ces': 'cs', 'dan': 'da', 'dut': 'nl', 'nld': 'nl',
  'ell': 'el', 'gre': 'el', 'est': 'et', 'fin': 'fi',
  'geo': 'ka', 'kat': 'ka', 'hrv': 'hr', 'hun': 'hu',
  'ice': 'is', 'isl': 'is', 'lav': 'lv', 'lit': 'lt',
  'mac': 'mk', 'mkd': 'mk', 'nor': 'no', 'nob': 'no',
  'pol': 'pl', 'rum': 'ro', 'ron': 'ro', 'scc': 'sr',
  'srp': 'sr', 'slo': 'sk', 'slk': 'sk', 'slv': 'sl',
  'swe': 'sv', 'ukr': 'uk', 'wel': 'cy', 'cym': 'cy',
  'heb': 'he', 'per': 'fa', 'fas': 'fa', 'urd': 'ur',
  'hat': 'ht', 'ben': 'bn', 'tha': 'th', 'vie': 'vi',
  'ind': 'id', 'may': 'ms', 'msa': 'ms', 'tgl': 'tl',
  'zht': 'zh-tw', 'zhc': 'zh',
  'pob': 'pt', 'pom': 'pt', 'spl': 'es', 'spn': 'es',
};

const LANGUAGE_ALIASES = {
  'alb': ['alb', 'sqi'], 'sqi': ['sqi', 'alb'],
  'chi': ['chi', 'zho'], 'zho': ['zho', 'chi'],
  'cze': ['cze', 'ces'], 'ces': ['ces', 'cze'],
  'dut': ['dut', 'nld'], 'nld': ['nld', 'dut'],
  'fre': ['fre', 'fra'], 'fra': ['fra', 'fre'],
  'ger': ['ger', 'deu'], 'deu': ['deu', 'ger'],
  'gre': ['gre', 'ell'], 'ell': ['ell', 'gre'],
  'rum': ['rum', 'ron'], 'ron': ['ron', 'rum'],
  'slo': ['slo', 'slk'], 'slk': ['slk', 'slo'],
  'per': ['per', 'fas'], 'fas': ['fas', 'per'],
  'mac': ['mac', 'mkd'], 'mkd': ['mkd', 'mac'],
  'ice': ['ice', 'isl'], 'isl': ['isl', 'ice'],
  'scc': ['scc', 'srp'], 'srp': ['srp', 'scc'],
};

function getLanguageAliases(languageCode) {
  if (!languageCode) return [];
  let code = String(languageCode).toLowerCase().trim();
  const match = code.match(/\[([a-z]{2,3})\]/);
  if (match) code = match[1];
  code = code.split('-')[0].split('_')[0];

  const aliases = new Set([code, String(languageCode)]);
  const alt = ISO639_3_TO_1[code];
  if (alt) aliases.add(alt);
  for (const [k, v] of Object.entries(ISO639_3_TO_1)) {
    if (v === code || v === alt) aliases.add(k);
  }
  if (LANGUAGE_ALIASES[code]) {
    for (const a of LANGUAGE_ALIASES[code]) aliases.add(a);
  }
  return Array.from(aliases);
}

function normalizeLanguageCode(lang) {
  if (!lang) return null;
  const lower = lang.toLowerCase();
  return lower.length === 2 ? lower : ISO639_3_TO_1[lower] || null;
}

const LANGUAGE_ENCODINGS = {
  'ru': ['win1251', 'koi8-r'], 'uk': ['win1251', 'koi8-u'],
  'bg': ['win1251'], 'sr': ['win1251'], 'mk': ['win1251'], 'be': ['win1251'],
  'el': ['win1253', 'iso88597'], 'tr': ['win1254', 'iso88599'],
  'he': ['win1255', 'iso88598'], 'ar': ['win1256', 'iso88596'],
  'th': ['win874', 'tis620'], 'vi': ['win1258'],
  'pl': ['win1250', 'iso88592'], 'cs': ['win1250', 'iso88592'],
  'sk': ['win1250', 'iso88592'], 'hu': ['win1250', 'iso88592'],
  'ro': ['win1250', 'iso88592'], 'hr': ['win1250', 'iso88592'],
  'sl': ['win1250', 'iso88592'], 'lt': ['win1257'], 'lv': ['win1257'], 'et': ['win1257'],
  'de': ['win1252', 'iso88591'], 'fr': ['win1252', 'iso88591'],
  'es': ['win1252', 'iso88591'], 'it': ['win1252', 'iso88591'],
  'pt': ['win1252', 'iso88591'],
  'zh': ['gbk', 'gb2312', 'big5'], 'zh-tw': ['big5', 'gbk', 'gb2312'],
  'ja': ['shift_jis', 'euc-jp'], 'ko': ['euc-kr', 'cp949'],
};

function buildCodepageList(languageHint = null) {
  const defaultCodepages = [
    { name: 'win1252', desc: 'Windows-1252 (Western)' },
    { name: 'win1251', desc: 'Windows-1251 (Cyrillic)' },
    { name: 'win1253', desc: 'Windows-1253 (Greek)' },
    { name: 'win1254', desc: 'Windows-1254 (Turkish)' },
    { name: 'win1250', desc: 'Windows-1250 (Central European)' },
    { name: 'win1255', desc: 'Windows-1255 (Hebrew)' },
    { name: 'win1256', desc: 'Windows-1256 (Arabic)' },
    { name: 'win874', desc: 'Windows-874 (Thai)' },
    { name: 'win1258', desc: 'Windows-1258 (Vietnamese)' },
    { name: 'win1257', desc: 'Windows-1257 (Baltic)' },
  ];

  if (!languageHint) return defaultCodepages;

  const langEncodings = LANGUAGE_ENCODINGS[languageHint.toLowerCase()];
  if (!langEncodings?.length) return defaultCodepages;

  const descMap = {
    'win1250': 'Windows-1250 (Central European)', 'win1251': 'Windows-1251 (Cyrillic)',
    'win1252': 'Windows-1252 (Western)', 'win1253': 'Windows-1253 (Greek)',
    'win1254': 'Windows-1254 (Turkish)', 'win1255': 'Windows-1255 (Hebrew)',
    'win1256': 'Windows-1256 (Arabic)', 'win1257': 'Windows-1257 (Baltic)',
    'win1258': 'Windows-1258 (Vietnamese)', 'win874': 'Windows-874 (Thai)',
    'koi8-r': 'KOI8-R (Russian)', 'koi8-u': 'KOI8-U (Ukrainian)',
  };

  const prioritized = [];
  const usedNames = new Set();

  for (const encoding of langEncodings) {
    const name = encoding.toLowerCase();
    prioritized.push({ name, desc: descMap[name] || encoding.toUpperCase() });
    usedNames.add(name);
  }

  for (const cp of defaultCodepages) {
    if (!usedNames.has(cp.name)) prioritized.push(cp);
  }

  return prioritized;
}

function fixCharacterEncodings(text, languageHint = null) {
  const langCode = normalizeLanguageCode(languageHint);

  const patterns = {
    thaiCjk: /[\u00E0-\u00EF][\u0080-\u00BF]/g,
    accented: /\u00C3[\u0080-\u00BF]/g,
    special: /\u00C2[\u0080-\u00BF]/g,
    cyrillic: /[\u00D0-\u00D4][\u0080-\u00BF]/g,
    greek: /[\u00CC-\u00CF][\u0080-\u00BF]/g,
    hebrew: /\u00D7[\u0080-\u00BF]/g,
    arabic: /[\u00D8-\u00DB][\u0080-\u00BF]/g,
  };

  let totalMatches = 0;
  for (const pattern of Object.values(patterns)) {
    totalMatches += (text.match(pattern) || []).length;
  }

  if (totalMatches > 10) {
    const bytes = Buffer.from(text, 'latin1');

    const utf8Fixed = bytes.toString('utf8');
    if (!utf8Fixed.includes('\uFFFD')) {
      let fixedTotal = 0;
      for (const pattern of Object.values(patterns)) {
        fixedTotal += (utf8Fixed.match(pattern) || []).length;
      }
      if (fixedTotal < totalMatches * 0.2) return utf8Fixed;
    }

    const codepages = buildCodepageList(langCode);
    for (const { name } of codepages) {
      try {
        const fixed = iconv.decode(bytes, name);
        if (fixed.includes('\uFFFD')) continue;

        let fixedTotal = 0;
        for (const pattern of Object.values(patterns)) {
          fixedTotal += (fixed.match(pattern) || []).length;
        }
        if (fixedTotal < totalMatches * 0.2) return fixed;
      } catch (_) {}
    }
  }

  return text;
}

function normalizeEncoding(encoding) {
  if (!encoding) return 'utf8';
  const normalized = encoding.toLowerCase();
  switch (normalized) {
    case 'windows-1254': return 'win1254';
    case 'windows-1251': return 'win1251';
    case 'windows-1252': return 'win1252';
    case 'iso-8859-9': return 'iso88599';
    case 'utf-16le': return 'utf16le';
    case 'utf-16be': return 'utf16be';
    case 'ascii':
    case 'us-ascii':
    case 'utf-8':
      return 'utf8';
    default:
      return iconv.encodingExists(normalized) ? normalized : 'utf8';
  }
}

function decodeSubtitleBuffer(buffer, languageHint = null) {
  const langCode = normalizeLanguageCode(languageHint);
  let subtitleText;

  if (buffer.length >= 4 && buffer[0] === 0xC3 && buffer[1] === 0xBF && buffer[2] === 0xC3 && buffer[3] === 0xBE) {
    subtitleText = Buffer.from(buffer.toString('utf8'), 'latin1').slice(2).toString('utf16le');
  } else if (buffer.length >= 2 && buffer[0] === 0xFF && buffer[1] === 0xFE) {
    subtitleText = buffer.slice(2).toString('utf16le');
  } else if (buffer.length >= 2 && buffer[0] === 0xFE && buffer[1] === 0xFF) {
    const swapped = Buffer.alloc(buffer.length - 2);
    for (let i = 2; i < buffer.length; i += 2) {
      if (i + 1 < buffer.length) {
        swapped[i - 2] = buffer[i + 1];
        swapped[i - 1] = buffer[i];
      }
    }
    subtitleText = swapped.toString('utf16le');
  } else if (buffer.length >= 3 && buffer[0] === 0xEF && buffer[1] === 0xBB && buffer[2] === 0xBF) {
    subtitleText = buffer.slice(3).toString('utf8');
  } else {
    const sample = buffer.slice(0, Math.min(buffer.length, CHARDET_SAMPLE_SIZE));
    const detectedEncoding = chardet.detect(sample);
    const encoding = normalizeEncoding(detectedEncoding);
    try {
      subtitleText = encoding !== 'utf8' ? iconv.decode(buffer, encoding) : buffer.toString('utf8');
    } catch (_) {
      subtitleText = buffer.toString('utf8');
    }
  }

  subtitleText = fixCharacterEncodings(subtitleText, langCode);

  if (subtitleText.startsWith('\uFEFF')) subtitleText = subtitleText.slice(1);
  if (subtitleText.startsWith('ï»¿')) subtitleText = subtitleText.slice(3);

  return subtitleText;
}

const CJK_LANGUAGE_CODES = new Set(['zh', 'zh-tw', 'ja', 'ko', 'chi', 'zho', 'zht', 'zhc', 'jpn', 'kor']);

function isCjkLanguage(langCode) {
  return !!langCode && CJK_LANGUAGE_CODES.has(langCode.toLowerCase());
}

module.exports = {
  decodeSubtitleBuffer,
  normalizeLanguageCode,
  getLanguageAliases,
  fixCharacterEncodings,
  isCjkLanguage,
  ISO639_3_TO_1,
  LANGUAGE_ALIASES,
};
