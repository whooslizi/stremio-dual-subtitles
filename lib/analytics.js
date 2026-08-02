const analytics = {
  totalPageViews: 0,
  totalInstalls: 0,
  totalSubtitleRequests: 0,
  totalSubtitlesServed: 0,
  hourlyStats: new Array(24).fill(null).map(() => ({ pageViews: 0, installs: 0, subtitleRequests: 0, timestamp: null })),
  languageStats: {},
  dailyStats: new Array(7).fill(null).map(() => ({ pageViews: 0, installs: 0, subtitleRequests: 0, date: null })),
  recentActivity: [],
  serverStartTime: Date.now(),
  uniqueVisitors: new Set(),
  contentStats: {}
};

function hashIP(ip) {
  let hash = 0;
  for (let i = 0; i < ip.length; i++) {
    hash = ((hash << 5) - hash) + ip.charCodeAt(i);
    hash |= 0;
  }
  return hash.toString(16);
}

function updateHourlyStats(field) {
  const hourIndex = new Date().getHours();
  const currentHour = new Date().setMinutes(0, 0, 0);
  if (analytics.hourlyStats[hourIndex].timestamp !== currentHour) {
    analytics.hourlyStats[hourIndex] = { pageViews: 0, installs: 0, subtitleRequests: 0, timestamp: currentHour };
  }
  analytics.hourlyStats[hourIndex][field]++;
}

function updateDailyStats(field) {
  const dayIndex = new Date().getDay();
  const today = new Date().toDateString();
  if (analytics.dailyStats[dayIndex].date !== today) {
    analytics.dailyStats[dayIndex] = { pageViews: 0, installs: 0, subtitleRequests: 0, date: today };
  }
  analytics.dailyStats[dayIndex][field]++;
}

function addActivity(type, details) {
  analytics.recentActivity.unshift({ type, details, timestamp: Date.now() });
  if (analytics.recentActivity.length > 100) analytics.recentActivity.pop();
}

function trackPageView(ip, page) {
  analytics.totalPageViews++;
  updateHourlyStats('pageViews');
  updateDailyStats('pageViews');
  analytics.uniqueVisitors.add(hashIP(ip || 'unknown'));
  addActivity('pageView', { page });
}

function trackInstall(ip, mainLang, transLang) {
  analytics.totalInstalls++;
  updateHourlyStats('installs');
  updateDailyStats('installs');
  const langPair = `${mainLang}+${transLang}`;
  analytics.languageStats[langPair] = (analytics.languageStats[langPair] || 0) + 1;
  analytics.languageStats[mainLang] = (analytics.languageStats[mainLang] || 0) + 1;
  analytics.languageStats[transLang] = (analytics.languageStats[transLang] || 0) + 1;
  addActivity('install', { mainLang, transLang });
}

function trackSubtitleRequest(mainLang, transLang, contentType, contentId) {
  analytics.totalSubtitleRequests++;
  updateHourlyStats('subtitleRequests');
  updateDailyStats('subtitleRequests');

  if (contentId) {
    const imdbId = contentId.split(':')[0];
    const key = `${contentType}/${imdbId}`;
    if (!analytics.contentStats[key]) {
      analytics.contentStats[key] = { type: contentType, imdbId, count: 0, lastSeen: null };
    }
    analytics.contentStats[key].count++;
    analytics.contentStats[key].lastSeen = Date.now();
  }

  addActivity('subtitleRequest', { mainLang, transLang, contentType, contentId: contentId?.split(':')[0] || null });
}

function trackSubtitleServed() {
  analytics.totalSubtitlesServed++;
}

function formatUptime(seconds) {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (days > 0) return `${days}d ${hours}h ${minutes}m`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

async function getAnalyticsSummary() {
  const uptime = Math.floor((Date.now() - analytics.serverStartTime) / 1000);
  const todayIndex = new Date().getDay();
  const todayStats = analytics.dailyStats[todayIndex].date === new Date().toDateString()
    ? analytics.dailyStats[todayIndex]
    : { pageViews: 0, installs: 0, subtitleRequests: 0 };

  const totals = {
    totalPageViews: analytics.totalPageViews,
    totalInstalls: analytics.totalInstalls,
    totalSubtitleRequests: analytics.totalSubtitleRequests,
    totalSubtitlesServed: analytics.totalSubtitlesServed,
    uniqueVisitors: analytics.uniqueVisitors.size
  };

  const topLanguages = Object.entries(analytics.languageStats).filter(([k]) => !k.includes('+')).sort((a, b) => b[1] - a[1]).slice(0, 10);
  const topPairs = Object.entries(analytics.languageStats).filter(([k]) => k.includes('+')).sort((a, b) => b[1] - a[1]).slice(0, 10);

  const currentHour = new Date().getHours();
  const hourlyChart = Array.from({ length: 24 }, (_, i) => {
    const hourIndex = (currentHour - 23 + i + 24) % 24;
    return { hour: hourIndex, ...analytics.hourlyStats[hourIndex] };
  });

  const popularContent = Object.values(analytics.contentStats).sort((a, b) => b.count - a.count).slice(0, 20);

  return {
    overview: { ...totals, uptime: formatUptime(uptime), persistenceEnabled: false },
    today: todayStats,
    topLanguages,
    topPairs,
    popularContent,
    hourlyChart,
    recentActivity: analytics.recentActivity.slice(0, 20)
  };
}

async function getPublicStats() {
  return {
    totalSubtitlesServed: analytics.totalSubtitlesServed,
    totalInstalls: analytics.totalInstalls,
    totalPageViews: analytics.totalPageViews,
    uniqueVisitors: analytics.uniqueVisitors.size,
    topPairs: Object.entries(analytics.languageStats).filter(([k]) => k.includes('+')).sort((a, b) => b[1] - a[1]).slice(0, 5),
    live: false
  };
}

module.exports = {
  trackPageView,
  trackInstall,
  trackSubtitleRequest,
  trackSubtitleServed,
  getAnalyticsSummary,
  getPublicStats
};
