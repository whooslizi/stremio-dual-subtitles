#!/usr/bin/env node

const path = require('path');
const express = require('express');
const compression = require('compression');
const { getRouter } = require('stremio-addon-sdk');
const { debugServer, sanitizeForLogging } = require('./lib/debug');
const {
  trackPageView,
  trackInstall,
  trackSubtitleRequest,
  trackSubtitleServed,
  getAnalyticsSummary,
  getPublicStats
} = require('./lib/analytics');
const { generateStatsHTML, generatePrivacyHTML, generateErrorHTML } = require('./lib/templates');
const { builder, manifest, getSubtitle, subtitlesHandler, generateDynamicSubtitle } = require('./addon');
const generateLandingHTML = require('./landingTemplate');
const { parseLangCode } = require('./languages');

const PORT = process.env.PORT || 7000;
const HOST = process.env.HOST || '0.0.0.0';

function getExternalUrl(req) {
  if (process.env.EXTERNAL_URL) return process.env.EXTERNAL_URL;
  const protocol = req.headers['x-forwarded-proto'] || req.protocol || 'http';
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  return `${protocol}://${host}`;
}

function getClientIP(req) {
  return (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').toString().split(',')[0].trim();
}

function getManifestWithLogo(req) {
  const baseUrl = getExternalUrl(req);
  return {
    ...manifest,
    logo: manifest.logo.startsWith('http') ? manifest.logo : `${baseUrl}${manifest.logo}`
  };
}

const app = express();

app.use(compression());
app.use(express.json());

app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition, Content-Type');
  res.setHeader('Vary', 'Origin');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    debugServer.log(`${req.method} ${req.path} - ${res.statusCode} (${Date.now() - start}ms)`);
  });
  next();
});

app.use(express.static(path.join(__dirname, 'public'), { maxAge: '1d', etag: true }));

const RATE_LIMIT_WINDOW_MS = Number(process.env.RATE_LIMIT_WINDOW_MS || 60000);
const RATE_LIMIT_MAX = Number(process.env.RATE_LIMIT_MAX || 60);
const rateLimitStore = new Map();

app.use((req, res, next) => {
  if (req.path.startsWith('/logo') || req.path === '/health') return next();

  const ip = getClientIP(req);
  const now = Date.now();

  if (!rateLimitStore.has(ip)) {
    rateLimitStore.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return next();
  }

  const entry = rateLimitStore.get(ip);
  if (now > entry.resetAt) {
    entry.count = 1;
    entry.resetAt = now + RATE_LIMIT_WINDOW_MS;
    return next();
  }

  if (entry.count >= RATE_LIMIT_MAX) {
    return res.status(429).send(generateErrorHTML(429, 'Too many requests', getExternalUrl(req), getManifestWithLogo(req)));
  }

  entry.count += 1;
  next();
});

app.post('/api/track', (req, res) => {
  try {
    const { event, page, mainLang, transLang, contentType } = req.body;
    const ip = getClientIP(req);
    if (event === 'pageView') trackPageView(ip, page);
    else if (event === 'install') trackInstall(ip, mainLang, transLang);
    else if (event === 'subtitleRequest') trackSubtitleRequest(mainLang, transLang, contentType);
    res.json({ success: true });
  } catch (_) {
    res.json({ success: false });
  }
});

app.get('/api/stats/public', async (req, res) => {
  try {
    const stats = await getPublicStats();
    res.setHeader('Cache-Control', 'public, max-age=10, s-maxage=30, stale-while-revalidate=60');
    res.json(stats);
  } catch (_) {
    res.json({ totalSubtitlesServed: 0, totalInstalls: 0, totalPageViews: 0, uniqueVisitors: 0, topPairs: [], live: false });
  }
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok', version: manifest.version, uptime: process.uptime() });
});

app.get(['/', '/configure'], (req, res) => {
  const baseUrl = getExternalUrl(req);
  const html = generateLandingHTML(getManifestWithLogo(req), baseUrl);
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(html);
});

app.get('/stats', async (req, res) => {
  const secret = process.env.ANALYTICS_SECRET;
  if (secret && req.query.key !== secret) {
    return res.status(401).send(generateErrorHTML(401, 'Unauthorized', getExternalUrl(req), getManifestWithLogo(req)));
  }
  const stats = await getAnalyticsSummary();
  const html = generateStatsHTML(stats, getExternalUrl(req), getManifestWithLogo(req));
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(html);
});

app.get('/privacy', (req, res) => {
  const html = generatePrivacyHTML(getExternalUrl(req), getManifestWithLogo(req));
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(html);
});

app.get('/robots.txt', (req, res) => {
  const baseUrl = getExternalUrl(req);
  res.setHeader('Content-Type', 'text/plain');
  res.send(`User-agent: *\nAllow: /\nAllow: /configure\nAllow: /privacy\n\nDisallow: /stats\nDisallow: /api/\nDisallow: /subtitles/\nDisallow: /subs/\n\nSitemap: ${baseUrl}/sitemap.xml\n`);
});

app.get('/sitemap.xml', (req, res) => {
  const baseUrl = getExternalUrl(req);
  const today = new Date().toISOString().split('T')[0];
  res.setHeader('Content-Type', 'application/xml');
  res.send(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n  <url><loc>${baseUrl}/configure</loc><lastmod>${today}</lastmod><changefreq>weekly</changefreq><priority>1.0</priority></url>\n  <url><loc>${baseUrl}/privacy</loc><lastmod>${today}</lastmod><changefreq>monthly</changefreq><priority>0.5</priority></url>\n</urlset>`);
});

app.get('/subtitles/:filename', (req, res) => {
  const { filename } = req.params;
  const content = getSubtitle(filename.replace('.srt', ''));

  if (!content) {
    debugServer.warn(`Subtitle not found in cache: ${filename}`);
    return res.status(404).send('Subtitle not found or expired');
  }

  trackSubtitleServed();
  res.setHeader('Content-Type', 'text/srt; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=21600');
  res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
  res.send(content);
});

app.get('/subs/:type/:imdbId/:season/:episode/:mainLang/:transLang/:mainSubId/:transSubId.:ext?', async (req, res) => {
  const { type, imdbId, season, episode, mainLang, transLang, mainSubId, transSubId } = req.params;
  const videoParams = {
    filename: req.query?.filename,
    videoSize: req.query?.videoSize,
    videoHash: req.query?.videoHash,
    marker: req.query?.marker,
    primarySize: req.query?.primarySize,
    secondarySize: req.query?.secondarySize,
    color: req.query?.color
  };

  try {
    const content = await generateDynamicSubtitle(
      type, imdbId, season, episode, mainLang, transLang, mainSubId, transSubId, videoParams
    );

    if (!content) return res.status(404).send('Subtitle generation failed');

    trackSubtitleServed();
    let finalContent = content.startsWith('WEBVTT') ? content : `WEBVTT\n\n${content.replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, '$1.$2')}`;

    res.setHeader('Content-Type', 'text/vtt; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=3600, s-maxage=21600, stale-while-revalidate=86400');
    res.setHeader('Content-Disposition', `inline; filename="dual_${mainLang}_${transLang}.vtt"`);
    res.send(finalContent);
  } catch (error) {
    debugServer.error('Dynamic subtitle error:', error.message);
    res.status(500).send('Internal server error');
  }
});

function parseConfigParam(configStr) {
  if (!configStr) return {};
  try {
    const decoded = decodeURIComponent(configStr);
    if (decoded.includes('|')) {
      const parts = decoded.split('|');
      return {
        mainLang: parts[0],
        transLang: parts[1],
        marker: parts[2] || 'none',
        primarySize: parts[3] || 'normal',
        secondarySize: parts[4] || 'small',
        color: parts[5] || '#94a3b8'
      };
    }
    const params = new URLSearchParams(decoded);
    return {
      mainLang: params.get('mainLang') || 'English [eng]',
      transLang: params.get('transLang') || 'Vietnamese [vie]',
      marker: params.get('marker') || 'none',
      primarySize: params.get('primarySize') || 'normal',
      secondarySize: params.get('secondarySize') || 'small',
      color: params.get('color') || '#94a3b8'
    };
  } catch (_) {
    return {
      mainLang: 'English [eng]',
      transLang: 'Vietnamese [vie]',
      marker: 'none',
      primarySize: 'normal',
      secondarySize: 'small',
      color: '#94a3b8'
    };
  }
}

app.get('/:config/configure', (req, res) => res.redirect('/configure'));

app.get('/:config/manifest.json', (req, res) => {
  try {
    const { mainLang, transLang } = parseConfigParam(req.params.config);
    if (!mainLang || !transLang) return res.status(400).json({ error: 'Invalid configuration' });

    const mainCode = parseLangCode(mainLang);
    const transCode = parseLangCode(transLang);
    const baseUrl = getExternalUrl(req);

    res.json({
      ...manifest,
      id: `${manifest.id}.${mainCode}.${transCode}`,
      name: `${manifest.name} (${mainCode.toUpperCase()}+${transCode.toUpperCase()})`,
      logo: manifest.logo.startsWith('http') ? manifest.logo : `${baseUrl}${manifest.logo}`,
      behaviorHints: { ...manifest.behaviorHints, configurationRequired: false }
    });
  } catch (error) {
    debugServer.error('Error generating manifest:', sanitizeForLogging(error.message));
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/:config/subtitles/:type/:id/:extra?.json', async (req, res) => {
  try {
    const { mainLang, transLang } = parseConfigParam(req.params.config);
    if (!mainLang || !transLang) return res.status(400).json({ subtitles: [] });

    const { type, id } = req.params;
    const extra = req.params.extra ? parseExtra(req.params.extra) : {};

    trackSubtitleRequest(parseLangCode(mainLang), parseLangCode(transLang), type, id);
    const result = await subtitlesHandler({ type, id, extra, config: { mainLang, transLang } });

    const baseUrl = getExternalUrl(req);
    if (result.subtitles) {
      result.subtitles = result.subtitles.map(sub => ({
        ...sub,
        url: sub.url.replace('{{ADDON_URL}}', baseUrl)
      }));
    }

    res.setHeader('Cache-Control', 'public, max-age=600, s-maxage=3600, stale-while-revalidate=21600');
    res.json(result);
  } catch (error) {
    debugServer.error('Error handling subtitle request:', sanitizeForLogging(error.message));
    res.json({ subtitles: [] });
  }
});

function parseExtra(extraStr) {
  const extra = {};
  if (!extraStr) return extra;
  const normalized = extraStr.replace(/\.(?=(?:videoHash|videoSize|filename|imdbId|season|episode)=)/g, '&');
  const params = new URLSearchParams(normalized);
  for (const [key, value] of params.entries()) {
    if (key && value != null) extra[key] = value;
  }
  return extra;
}

app.get('/manifest.json', (req, res) => {
  res.json(getManifestWithLogo(req));
});

const addonInterface = builder.getInterface();
app.use(getRouter(addonInterface));

app.use((req, res) => {
  res.status(404).send(generateErrorHTML(404, 'Page not found', getExternalUrl(req), getManifestWithLogo(req)));
});

app.use((err, req, res, next) => {
  debugServer.error('Server error:', sanitizeForLogging(err?.message || err));
  res.status(500).send(generateErrorHTML(500, 'Internal server error', getExternalUrl(req), getManifestWithLogo(req)));
});

if (!process.env.VERCEL) {
  app.listen(PORT, HOST, () => {
    debugServer.log(`Dual Subtitles Addon Started on http://localhost:${PORT}/configure`);
  });
}

module.exports = app;
