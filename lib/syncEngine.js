function buildPresenceSignal(subs, cells, stepMs) {
  const sig = new Uint8Array(cells);
  for (const s of subs) {
    if (!s || s.endMs <= s.startMs) continue;
    const start = Math.max(0, Math.floor(s.startMs / stepMs));
    const end = Math.min(cells - 1, Math.floor((s.endMs - 1) / stepMs));
    for (let i = start; i <= end; i++) sig[i] = 1;
  }
  return sig;
}

function countActive(sig) {
  let n = 0;
  for (let i = 0; i < sig.length; i++) if (sig[i]) n++;
  return n;
}

function estimateOffsetMs(mainSubs, transSubs, options = {}) {
  const { maxOffsetMs = 30000, stepMs = 100, minConfidence = 0.25 } = options;

  if (!mainSubs?.length || !transSubs?.length || mainSubs.length < 5 || transSubs.length < 5) return 0;

  const maxMain = mainSubs[mainSubs.length - 1].endMs || 0;
  const maxTrans = transSubs[transSubs.length - 1].endMs || 0;
  const totalDuration = Math.max(maxMain, maxTrans) + maxOffsetMs;
  if (totalDuration <= 0) return 0;

  const cells = Math.ceil(totalDuration / stepMs) + 1;
  const main = buildPresenceSignal(mainSubs, cells, stepMs);
  const trans = buildPresenceSignal(transSubs, cells, stepMs);

  const mainActive = countActive(main);
  const transActive = countActive(trans);
  if (!mainActive || !transActive) return 0;

  const mainActiveIdxs = [];
  for (let i = 0; i < cells; i++) {
    if (main[i]) mainActiveIdxs.push(i);
  }

  const maxLag = Math.floor(maxOffsetMs / stepMs);
  let bestLag = 0;
  let bestScore = -1;
  let zeroScore = 0;

  for (let lag = -maxLag; lag <= maxLag; lag++) {
    let score = 0;
    if (lag >= 0) {
      for (let k = 0; k < mainActiveIdxs.length; k++) {
        const j = mainActiveIdxs[k] + lag;
        if (j < cells && trans[j]) score++;
      }
    } else {
      for (let k = 0; k < mainActiveIdxs.length; k++) {
        const j = mainActiveIdxs[k] + lag;
        if (j >= 0 && trans[j]) score++;
      }
    }
    if (lag === 0) zeroScore = score;
    if (score > bestScore) {
      bestScore = score;
      bestLag = lag;
    }
  }

  const maxPossible = Math.min(mainActive, transActive);
  if (bestScore < minConfidence * maxPossible) return 0;
  if (bestLag !== 0 && bestScore < zeroScore * 1.05) return 0;

  return -bestLag * stepMs;
}

function applyOffset(subs, offsetMs) {
  if (!offsetMs) return subs;
  return subs.map(s => ({
    ...s,
    startMs: s.startMs + offsetMs,
    endMs: s.endMs + offsetMs
  }));
}

function findAnchorPairs(mainSubs, transSubs, anchorThresholdMs) {
  const anchors = [];
  let j = 0;
  for (const m of mainSubs) {
    while (j < transSubs.length && transSubs[j].endMs < m.startMs - anchorThresholdMs) j++;
    let bestK = -1;
    let bestD = Infinity;
    let secondD = Infinity;
    for (let k = j; k < transSubs.length; k++) {
      const t = transSubs[k];
      if (t.startMs > m.endMs + anchorThresholdMs) break;
      const d = Math.abs(t.startMs - m.startMs);
      if (d < bestD) {
        secondD = bestD;
        bestD = d;
        bestK = k;
      } else if (d < secondD) {
        secondD = d;
      }
    }
    if (bestK >= 0 && bestD <= anchorThresholdMs && secondD > bestD * 1.5) {
      anchors.push([m.startMs, transSubs[bestK].startMs]);
    }
  }
  return anchors;
}

function estimateAffineMapping(mainSubs, transSubs, options = {}) {
  const { anchorThresholdMs = 1500, minAnchors = 8 } = options;

  const anchors = findAnchorPairs(mainSubs, transSubs, anchorThresholdMs);
  if (anchors.length < minAnchors) return null;

  let sumX = 0, sumY = 0, sumXY = 0, sumXX = 0;
  for (const [x, y] of anchors) {
    sumX += x;
    sumY += y;
    sumXY += x * y;
    sumXX += x * x;
  }
  const n = anchors.length;
  const denom = n * sumXX - sumX * sumX;
  if (denom === 0) return null;

  const a = (n * sumXY - sumX * sumY) / denom;
  const b = (sumY - a * sumX) / n;

  if (!Number.isFinite(a) || !Number.isFinite(b) || a < 0.85 || a > 1.15) return null;

  return { a, b, anchors: n };
}

function applyAffine(subs, mapping) {
  const { a, b } = mapping;
  return subs.map(s => ({
    ...s,
    startMs: Math.round((s.startMs - b) / a),
    endMs: Math.round((s.endMs - b) / a)
  }));
}

function estimateLocalOffsets(mainSubs, transSubs, options = {}) {
  const { windowMs = 300000, stepMs = 150000, minCuesPerWindow = 5, maxLocalOffsetMs = 15000 } = options;

  if (!mainSubs?.length || !transSubs?.length) return [];

  const total = Math.max(
    mainSubs[mainSubs.length - 1].endMs || 0,
    transSubs[transSubs.length - 1].endMs || 0
  );
  if (total <= 0) return [];

  const anchors = [];
  for (let winStart = 0; winStart < total; winStart += stepMs) {
    const winEnd = winStart + windowMs;
    const mainSlice = mainSubs.filter(s => s.startMs >= winStart && s.startMs < winEnd);
    const transSlice = transSubs.filter(
      s => s.startMs >= winStart - maxLocalOffsetMs && s.startMs < winEnd + maxLocalOffsetMs
    );
    if (mainSlice.length < minCuesPerWindow || transSlice.length < minCuesPerWindow) continue;

    const localOffset = estimateOffsetMs(mainSlice, transSlice, {
      maxOffsetMs: maxLocalOffsetMs,
      stepMs: 100,
      minConfidence: 0.3
    });

    if (localOffset !== 0) {
      anchors.push({ centerMs: winStart + windowMs / 2, offsetMs: localOffset });
    }
  }
  return anchors;
}

function applyLocalOffsets(subs, anchors) {
  if (!anchors?.length) return subs;
  const sorted = [...anchors].sort((a, b) => a.centerMs - b.centerMs);

  function offsetAt(t) {
    if (t <= sorted[0].centerMs) return sorted[0].offsetMs;
    if (t >= sorted[sorted.length - 1].centerMs) return sorted[sorted.length - 1].offsetMs;
    for (let i = 0; i < sorted.length - 1; i++) {
      const a = sorted[i];
      const b = sorted[i + 1];
      if (t >= a.centerMs && t <= b.centerMs) {
        const ratio = (t - a.centerMs) / (b.centerMs - a.centerMs);
        return Math.round(a.offsetMs + ratio * (b.offsetMs - a.offsetMs));
      }
    }
    return 0;
  }

  return subs.map(s => {
    const o = offsetAt(s.startMs);
    return { ...s, startMs: s.startMs + o, endMs: s.endMs + o };
  });
}

function overlapScore(m, t) {
  const overlapStart = Math.max(m.startMs, t.startMs);
  const overlapEnd = Math.min(m.endMs, t.endMs);
  const overlap = overlapEnd - overlapStart;
  if (overlap <= 0) return 0;
  const unionStart = Math.min(m.startMs, t.startMs);
  const unionEnd = Math.max(m.endMs, t.endMs);
  const union = unionEnd - unionStart;
  return union > 0 ? overlap / union : 0;
}

function pairScore(m, t, threshold) {
  const o = overlapScore(m, t);
  if (o > 0) return o;
  const startDiff = Math.abs(t.startMs - m.startMs);
  return startDiff < threshold ? 0.001 + 1 / (1 + startDiff) : 0;
}

function assignMatches(mainSubs, transSubs, options = {}) {
  const { threshold = 1500, minOverlapFraction = 0.1, allowMultiTrans = true, maxTransPerMain = 3 } = options;

  const matches = new Map();
  const usedMain = new Set();
  const usedTrans = new Set();

  const pairs = [];
  let transStart = 0;
  for (let mi = 0; mi < mainSubs.length; mi++) {
    const m = mainSubs[mi];
    while (transStart < transSubs.length && transSubs[transStart].endMs < m.startMs - threshold) {
      transStart++;
    }
    for (let ti = transStart; ti < transSubs.length; ti++) {
      const t = transSubs[ti];
      if (t.startMs > m.endMs + threshold) break;
      const score = pairScore(m, t, threshold);
      if (score > 0) pairs.push({ mi, ti, score });
    }
  }

  pairs.sort((a, b) => b.score - a.score);
  for (const p of pairs) {
    if (usedMain.has(p.mi) || usedTrans.has(p.ti)) continue;
    usedMain.add(p.mi);
    usedTrans.add(p.ti);
    matches.set(p.mi, [p.ti]);
  }

  if (!allowMultiTrans) return matches;

  for (const [mi, picked] of matches) {
    if (picked.length >= maxTransPerMain) continue;
    const m = mainSubs[mi];
    const anchor = picked[0];

    for (const dir of [1, -1]) {
      let ti = anchor + dir;
      while (ti >= 0 && ti < transSubs.length && picked.length < maxTransPerMain && !usedTrans.has(ti)) {
        const t = transSubs[ti];
        if (overlapScore(m, t) < minOverlapFraction) break;
        picked.push(ti);
        usedTrans.add(ti);
        ti += dir;
      }
    }
    picked.sort((a, b) => a - b);
  }

  return matches;
}

function alignAndMatch(mainSubs, transSubs, options = {}) {
  const {
    enableOffset = true,
    enableDrift = true,
    enableLocalOffsets = true,
    matchThreshold = 1500,
    allowMultiTrans = true,
    log = () => {}
  } = options;

  let trans = transSubs;
  let offsetMs = 0;
  let drift = null;
  let localAnchors = [];

  if (enableOffset && trans.length > 0 && mainSubs.length > 0) {
    offsetMs = estimateOffsetMs(mainSubs, trans);
    if (offsetMs !== 0) {
      trans = applyOffset(trans, offsetMs);
      log(`syncEngine: applied global offset ${offsetMs}ms`);
    }
  }

  if (enableDrift && trans.length >= 8 && mainSubs.length >= 8) {
    drift = estimateAffineMapping(mainSubs, trans);
    if (drift && Math.abs(drift.a - 1) > 0.001) {
      trans = applyAffine(trans, drift);
      log(`syncEngine: applied affine drift a=${drift.a.toFixed(5)} b=${drift.b.toFixed(0)} from ${drift.anchors} anchors`);
    } else {
      drift = null;
    }
  }

  if (enableLocalOffsets && trans.length >= 20 && mainSubs.length >= 20) {
    localAnchors = estimateLocalOffsets(mainSubs, trans);
    if (localAnchors.length >= 2) {
      const range = localAnchors.reduce(
        (acc, a) => ({
          min: Math.min(acc.min, a.offsetMs),
          max: Math.max(acc.max, a.offsetMs)
        }),
        { min: Infinity, max: -Infinity }
      );
      if (range.max - range.min >= 500) {
        trans = applyLocalOffsets(trans, localAnchors);
        log(`syncEngine: applied ${localAnchors.length} local offset anchors (spread ${range.min}..${range.max} ms)`);
      } else {
        localAnchors = [];
      }
    } else {
      localAnchors = [];
    }
  }

  const matches = assignMatches(mainSubs, trans, {
    threshold: matchThreshold,
    allowMultiTrans
  });

  const matchRate = mainSubs.length > 0 ? matches.size / mainSubs.length : 0;
  log(`syncEngine: matched ${matches.size}/${mainSubs.length} (${(matchRate * 100).toFixed(1)}%)`);

  return {
    matches,
    transAdjusted: trans,
    offsetMs,
    drift,
    localAnchors,
    matchRate
  };
}

module.exports = {
  estimateOffsetMs,
  applyOffset,
  estimateAffineMapping,
  applyAffine,
  estimateLocalOffsets,
  applyLocalOffsets,
  assignMatches,
  alignAndMatch,
  overlapScore,
  _internal: {
    buildPresenceSignal,
    findAnchorPairs,
    countActive
  }
};
