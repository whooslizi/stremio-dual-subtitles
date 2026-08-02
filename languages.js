const languageMap = {
  'afr': 'Afrikaans', 'alb': 'Albanian', 'ara': 'Arabic', 'arm': 'Armenian', 'aze': 'Azerbaijani',
  'baq': 'Basque', 'bel': 'Belarusian', 'ben': 'Bengali', 'bos': 'Bosnian', 'bre': 'Breton',
  'bul': 'Bulgarian', 'bur': 'Burmese', 'cat': 'Catalan', 'chi': 'Chinese (Simplified)',
  'zht': 'Chinese (Traditional)', 'hrv': 'Croatian', 'cze': 'Czech', 'dan': 'Danish',
  'dut': 'Dutch', 'eng': 'English', 'epo': 'Esperanto', 'est': 'Estonian', 'fin': 'Finnish',
  'fre': 'French', 'geo': 'Georgian', 'ger': 'German', 'ell': 'Greek', 'hat': 'Haitian Creole',
  'heb': 'Hebrew', 'hin': 'Hindi', 'hun': 'Hungarian', 'ice': 'Icelandic', 'ind': 'Indonesian',
  'gle': 'Irish', 'ita': 'Italian', 'jpn': 'Japanese', 'kan': 'Kannada', 'kaz': 'Kazakh',
  'khm': 'Khmer', 'kor': 'Korean', 'kur': 'Kurdish', 'lav': 'Latvian', 'lit': 'Lithuanian',
  'ltz': 'Luxembourgish', 'mac': 'Macedonian', 'may': 'Malay', 'mal': 'Malayalam',
  'mlt': 'Maltese', 'mar': 'Marathi', 'mon': 'Mongolian', 'nep': 'Nepali', 'nor': 'Norwegian',
  'per': 'Persian', 'pol': 'Polish', 'por': 'Portuguese', 'pob': 'Portuguese (Brazil)',
  'rum': 'Romanian', 'rus': 'Russian', 'scc': 'Serbian', 'sin': 'Sinhala', 'slo': 'Slovak',
  'slv': 'Slovenian', 'som': 'Somali', 'spa': 'Spanish', 'spl': 'Spanish (Latin America)',
  'swa': 'Swahili', 'swe': 'Swedish', 'tgl': 'Tagalog', 'tam': 'Tamil', 'tel': 'Telugu',
  'tha': 'Thai', 'tur': 'Turkish', 'ukr': 'Ukrainian', 'urd': 'Urdu', 'uzb': 'Uzbek',
  'vie': 'Vietnamese', 'wel': 'Welsh'
};

const browserLanguageMap = {
  'en': 'eng', 'es': 'spa', 'fr': 'fre', 'de': 'ger', 'it': 'ita', 'pt': 'por', 'pt-br': 'pob',
  'ru': 'rus', 'ja': 'jpn', 'ko': 'kor', 'zh': 'chi', 'zh-cn': 'chi', 'zh-tw': 'zht',
  'ar': 'ara', 'hi': 'hin', 'bn': 'ben', 'te': 'tel', 'mr': 'mar', 'ta': 'tam', 'kn': 'kan',
  'ml': 'mal', 'pl': 'pol', 'uk': 'ukr', 'tr': 'tur', 'hu': 'hun', 'cs': 'cze', 'ro': 'rum',
  'nl': 'dut', 'sv': 'swe', 'da': 'dan', 'no': 'nor', 'fi': 'fin', 'el': 'ell', 'th': 'tha',
  'vi': 'vie', 'id': 'ind', 'ms': 'may', 'fil': 'tgl', 'he': 'heb', 'fa': 'per', 'ur': 'urd',
  'sq': 'alb', 'hr': 'hrv', 'sr': 'scc', 'bg': 'bul', 'sk': 'slo', 'sl': 'slv', 'et': 'est',
  'lv': 'lav', 'lt': 'lit', 'ca': 'cat', 'eu': 'baq', 'gl': 'glg', 'mk': 'mac', 'is': 'ice',
  'cy': 'wel', 'ga': 'gle', 'az': 'aze', 'ka': 'geo', 'hy': 'arm', 'be': 'bel', 'bs': 'bos',
  'ht': 'hat', 'km': 'khm', 'my': 'bur', 'ne': 'nep', 'si': 'sin', 'sw': 'swa', 'uz': 'uzb',
  'kk': 'kaz', 'mn': 'mon'
};

const popularLanguages = [
  'eng', 'spa', 'fre', 'ger', 'ita', 'por', 'pob', 'rus', 'tur',
  'ara', 'jpn', 'kor', 'chi', 'zht', 'hin', 'dut', 'pol', 'swe',
  'dan', 'nor', 'fin', 'ell', 'cze', 'hun', 'rum', 'ukr', 'vie',
  'tha', 'ind', 'heb', 'per', 'bul', 'hrv', 'scc', 'slo', 'slv'
];

function getLanguageOptions() {
  const entries = Object.entries(languageMap);
  const popular = [];
  const others = [];

  for (const [code, name] of entries) {
    if (popularLanguages.includes(code)) popular.push([code, name]);
    else others.push([code, name]);
  }

  popular.sort((a, b) => popularLanguages.indexOf(a[0]) - popularLanguages.indexOf(b[0]));
  others.sort((a, b) => a[1].localeCompare(b[1]));

  return [...popular, ...others].map(([code, name]) => `${name} [${code}]`);
}

function extractBrowserLanguage(acceptLanguageHeader) {
  if (!acceptLanguageHeader) return 'eng';
  const languages = acceptLanguageHeader.split(',').map(l => l.trim().split(';')[0].toLowerCase()).filter(Boolean);
  for (const lang of languages) {
    if (browserLanguageMap[lang]) return browserLanguageMap[lang];
    const base = lang.split('-')[0];
    if (browserLanguageMap[base]) return browserLanguageMap[base];
  }
  return 'eng';
}

function parseLangCode(lang) {
  if (!lang) return lang;
  const match = lang.match(/\[([^\]]+)\]$/);
  return match ? match[1] : lang;
}

function getLanguageName(code) {
  return languageMap[code] || code;
}

function getLanguageOption(code) {
  return `${languageMap[code] || code} [${code}]`;
}

module.exports = {
  languageMap,
  browserLanguageMap,
  popularLanguages,
  getLanguageOptions,
  extractBrowserLanguage,
  parseLangCode,
  getLanguageName,
  getLanguageOption
};
