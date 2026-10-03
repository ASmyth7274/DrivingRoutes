// fetch() with a timeout, JSON parsing and readable errors.

export class NetError extends Error {
  constructor(message, { code = null, status = 0 } = {}) {
    super(message);
    this.name = 'NetError';
    this.code = code;
    this.status = status;
  }
}

export function isOffline() {
  return typeof navigator !== 'undefined' && navigator.onLine === false;
}

export async function fetchJson(url, { timeout = 20000, signal, init = {} } = {}) {
  if (isOffline()) throw new NetError('You appear to be offline', { code: 'offline' });
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  const onAbort = () => ctrl.abort();
  signal?.addEventListener('abort', onAbort);
  let res;
  try {
    res = await fetch(url, { ...init, signal: ctrl.signal });
  } catch (err) {
    if (signal?.aborted) throw err;
    throw new NetError(ctrl.signal.aborted ? 'The request timed out' : 'Network request failed', {
      code: ctrl.signal.aborted ? 'timeout' : 'network',
    });
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
  let body = null;
  const text = await res.text();
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = null;
  }
  if (!res.ok) {
    const msg = body?.message || body?.error || `HTTP ${res.status}`;
    throw new NetError(msg, { code: body?.code || body?.error_code || `http_${res.status}`, status: res.status });
  }
  if (body == null) throw new NetError('Unexpected response from server', { code: 'parse', status: res.status });
  return body;
}

export function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
