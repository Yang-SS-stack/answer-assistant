const CACHE_KEY = 'aaV4monitorBalance';
const MAX_BODY_BYTES = 16384;
const INVALID = 'BALANCE_INVALID_RESPONSE';
const clone = value => structuredClone(value);
const decimal = value => typeof value === 'string' && value.length <= 128 && /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(value);

export function parseDeepSeekBalance(raw) {
  if (!raw || typeof raw !== 'object' || typeof raw.is_available !== 'boolean' ||
      !Array.isArray(raw.balance_infos) || raw.balance_infos.length < 1 || raw.balance_infos.length > 2) throw new Error(INVALID);
  const currencies = new Set();
  const balances = raw.balance_infos.map(row => {
    if (!row || !['CNY', 'USD'].includes(row.currency) || currencies.has(row.currency) ||
        !decimal(row.total_balance) || !decimal(row.granted_balance) || !decimal(row.topped_up_balance)) throw new Error(INVALID);
    currencies.add(row.currency);
    return {currency: row.currency, total: row.total_balance, granted: row.granted_balance, toppedUp: row.topped_up_balance};
  });
  return {available: raw.is_available, balances};
}

function validateData(data) {
  return parseDeepSeekBalance({is_available: data?.available, balance_infos: data?.balances?.map(row => ({
    currency: row.currency, total_balance: row.total, granted_balance: row.granted, topped_up_balance: row.toppedUp
  }))});
}

async function readResponse(response) {
  if (!response.ok) throw new Error(response.status === 401 || response.status === 403 ? 'BALANCE_UNAUTHORIZED' :
    response.status === 429 ? 'BALANCE_RATE_LIMITED' : 'BALANCE_HTTP_ERROR');
  const advertised = Number(response.headers?.get('content-length'));
  if (advertised > MAX_BODY_BYTES) throw new Error(INVALID);
  // Read a bounded stream instead of buffering an untrusted response with json()/text().
  if (!response.body?.getReader) throw new Error(INVALID);
  const reader = response.body.getReader();
  const decoder = new TextDecoder('utf-8', {fatal: true});
  let bytes = 0, text = '';
  try {
    for (;;) {
      const {done, value} = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_BODY_BYTES) throw new Error(INVALID);
      text += decoder.decode(value, {stream: true});
    }
    text += decoder.decode();
    return parseDeepSeekBalance(JSON.parse(text));
  } catch {
    // Do not await an untrusted stream's cancellation callback.
    Promise.resolve(reader.cancel()).catch(() => {});
    throw new Error(INVALID);
  } finally { reader.releaseLock(); }
}

export function deepSeekBalance({storage, getProfile, getScope, fetchImpl = fetch, now = Date.now,
  minIntervalMs = 60000, timeoutMs = 10000}) {
  const interval = Math.max(60000, Number.isFinite(minIntervalMs) ? minIntervalMs : 60000);
  const timeout = Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 10000;
  let generation = 0, identity, inflight, control = Promise.resolve(), writes = Promise.resolve();
  let state = {status: 'empty', stale: false};
  let nextRefreshAt = 0;
  const snapshot = () => clone(state);
  const serial = operation => {
    const task = control.then(operation, operation);
    control = task.catch(() => {});
    return task;
  };
  const persist = (value, epoch) => {
    const task = writes.then(async () => {
      if (epoch !== generation) return true;
      try { await storage.set({[CACHE_KEY]: value}); return true; } catch { return false; }
    });
    writes = task.catch(() => {});
    return task;
  };
  const reset = () => {
    generation++;
    identity = undefined;
    inflight = undefined;
    nextRefreshAt = 0;
    state = {status: 'empty', stale: false};
  };
  const fail = code => {
    state = {...state, status: 'error', stale: Boolean(state.data), error: code};
  };
  const unverifiedIdentity = () => {
    // Keeping stale data requires a positively verified account identity.
    reset();
    persist(null, generation);
    fail('BALANCE_CONFIG_ERROR');
  };
  async function ensureIdentity() {
    const start = generation;
    let profile, scope;
    try { [profile, scope] = await Promise.all([getProfile(), getScope()]); }
    catch { if (start === generation) unverifiedIdentity(); return false; }
    if (start !== generation) return false;
    const key = typeof profile?.apiKey === 'string' ? profile.apiKey.trim() : '';
    if (key && (typeof scope !== 'string' || !scope || scope.length > 256)) { unverifiedIdentity(); return false; }
    if (identity && identity.key === key && identity.scope === scope) return true;
    const initial = identity === undefined && generation === 0;
    if (identity) {
      reset();
      persist(null, generation);
    }
    identity = {key, scope};
    state = {status: key ? 'empty' : 'unconfigured', stale: false};
    if (!initial || !key) return true;
    const epoch = generation;
    let cached, readFailed = false;
    try { cached = (await storage.get(CACHE_KEY))?.[CACHE_KEY]; }
    catch { readFailed = true; }
    if (epoch !== generation) return false;
    // A direct configuration change need not call invalidate(). Recheck after
    // the asynchronous read, before publishing even a correctly scoped cache.
    if (!await ensureIdentity() || epoch !== generation) return false;
    if (readFailed) { fail('BALANCE_STORAGE_ERROR'); return true; }
    if (!cached || cached.scope !== scope || cached.version !== 1) return true;
    try {
      const stamp = now();
      if (!Number.isFinite(cached.fetchedAt) || cached.fetchedAt < 0 || cached.fetchedAt > stamp ||
          !Number.isFinite(cached.nextRefreshAt) || cached.nextRefreshAt < cached.fetchedAt ||
          cached.nextRefreshAt > stamp + interval) return true;
      const data = validateData(cached.data);
      nextRefreshAt = cached.nextRefreshAt;
      state = {status: 'ready', data, fetchedAt: cached.fetchedAt, nextRefreshAt, stale: stamp >= nextRefreshAt};
    } catch { /* Invalid cache is never shown or copied to a public state. */ }
    return true;
  }
  async function query(epoch, currentIdentity) {
    const controller = new AbortController();
    let timer;
    let data, error;
    try {
      data = await Promise.race([
        (async () => {
          let response;
          try {
            response = await fetchImpl('https://api.deepseek.com/user/balance', {
              method: 'GET', headers: {Authorization: `Bearer ${currentIdentity.key}`},
              redirect: 'error', credentials: 'omit', cache: 'no-store', signal: controller.signal
            });
          } catch { throw new Error('BALANCE_NETWORK_ERROR'); }
          return readResponse(response);
        })(),
        new Promise((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new Error('BALANCE_TIMEOUT')); }, timeout); })
      ]);
    } catch (caught) {
      const allowed = [INVALID, 'BALANCE_TIMEOUT', 'BALANCE_UNAUTHORIZED', 'BALANCE_RATE_LIMITED', 'BALANCE_HTTP_ERROR', 'BALANCE_NETWORK_ERROR'];
      error = allowed.includes(caught?.message) ? caught.message : INVALID;
    } finally { clearTimeout(timer); }
    return serial(async () => {
      if (epoch !== generation) return snapshot();
      if (!await ensureIdentity() || epoch !== generation) return snapshot();
      if (error) { fail(error); return snapshot(); }
      state = {status: 'ready', data, fetchedAt: now(), nextRefreshAt, stale: false};
      const saved = await persist({version: 1, scope: currentIdentity.scope, data, fetchedAt: state.fetchedAt, nextRefreshAt}, epoch);
      // Configuration may change while the asynchronous disk write is pending.
      if (epoch !== generation || !await ensureIdentity() || epoch !== generation) return snapshot();
      if (epoch === generation && !saved) fail('BALANCE_STORAGE_ERROR');
      return snapshot();
    });
  }
  function refresh() {
    return serial(async () => {
      if (!await ensureIdentity() || !identity?.key) return {result: snapshot()};
      if (inflight) return {task: inflight};
      if (now() < nextRefreshAt) return {result: snapshot()};
      nextRefreshAt = now() + interval;
      state = {...state, status: 'loading', nextRefreshAt};
      delete state.error;
      const epoch = generation;
      const task = query(epoch, identity);
      inflight = task;
      task.finally(() => { if (inflight === task) inflight = undefined; }).catch(() => {});
      return {task};
    }).then(result => result.task ?? result.result).catch(() => {
      // Fail closed at this observational boundary; never reject into the answer flow.
      return {status: 'error', stale: false, error: 'BALANCE_CONFIG_ERROR'};
    });
  }
  function status() {
    return serial(async () => {
      await ensureIdentity();
      if (state.data && state.status === 'ready') state.stale = now() >= nextRefreshAt;
      return snapshot();
    }).catch(() => ({status: 'error', stale: false, error: 'BALANCE_CONFIG_ERROR'}));
  }
  function invalidate() {
    reset();
    const epoch = generation;
    return persist(null, epoch).then(saved => {
      if (!saved && epoch === generation) fail('BALANCE_STORAGE_ERROR');
      return snapshot();
    });
  }
  return {refresh, status, invalidate};
}
