const REDACT_KEYS = new Set([
  'authorization', 'token', 'access_token', 'refresh_token',
  'cookie', 'set-cookie', 'api_key', 'apikey', 'key', 'password'
]);

function isDebugEnabled() {
  return process.env.DEBUG_MODE === 'true' || process.env.NEXT_PUBLIC_DEBUG_MODE === 'true';
}

function sanitizeForLogging(data) {
  if (data == null) return data;
  if (typeof data === 'string') return data.length > 500 ? `${data.slice(0, 500)}…` : data;
  if (Array.isArray(data)) return data.map(sanitizeForLogging);
  if (typeof data === 'object') {
    const sanitized = {};
    for (const [k, v] of Object.entries(data)) {
      sanitized[k] = REDACT_KEYS.has(k.toLowerCase()) ? '[REDACTED]' : sanitizeForLogging(v);
    }
    return sanitized;
  }
  return data;
}

function createLogger(prefix) {
  const enabled = isDebugEnabled();
  const write = (method, args) => {
    if (enabled) console[method](prefix, ...args.map(sanitizeForLogging));
  };
  return {
    log: (...args) => write('log', args),
    info: (...args) => write('info', args),
    warn: (...args) => write('warn', args),
    error: (...args) => write('error', args),
    apiRequest: (message, meta = {}) => write('log', [message, meta])
  };
}

module.exports = {
  debug: createLogger('[debug]'),
  debugServer: createLogger('[server]'),
  sanitizeForLogging
};
