// In-memory analytics persistence (no external services).

function incrementCounter() { }
function addToSet() { }
function incrementSortedSet() { }
function isEnabled() { return false; }

async function getPublicCounters() {
  return {
    totalPageViews: 0,
    totalInstalls: 0,
    totalSubtitleRequests: 0,
    totalSubtitlesServed: 0,
    uniqueVisitors: 0,
    topLanguages: [],
    topPairs: []
  };
}

module.exports = {
  incrementCounter,
  addToSet,
  incrementSortedSet,
  getPublicCounters,
  isEnabled
};
