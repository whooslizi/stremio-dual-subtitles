const inflight = new Map();

async function singleflight(key, fn) {
  if (inflight.has(key)) return inflight.get(key);

  const promise = fn().finally(() => inflight.delete(key));
  inflight.set(key, promise);
  return promise;
}

function inflightCount() {
  return inflight.size;
}

module.exports = { singleflight, inflightCount };
