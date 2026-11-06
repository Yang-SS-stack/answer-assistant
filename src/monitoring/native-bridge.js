// Browser-side transport only. Credentials and HTTP requests remain in the native host.
const HOST = 'com.answer_assistant.quota';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MODEL = /^[A-Za-z0-9][A-Za-z0-9._-]{0,159}$/;
const NATIVE_CODES = new Set([
  'NATIVE_PROTOCOL', 'QWEN_AUTH_INVALID', 'QWEN_AUTH_EXPIRED', 'QWEN_SCOPE_UNSUPPORTED',
  'QWEN_LOGIN_FAILED', 'QWEN_LOGIN_CANCELLED', 'QWEN_LOGIN_TIMEOUT', 'QWEN_CREDENTIAL_UNAVAILABLE',
  'QUOTA_FORMAT', 'QUOTA_FORBIDDEN', 'QUOTA_RATE_LIMIT', 'QUOTA_QUERY_FAILED',
  'QUOTA_CANCELLED', 'QUOTA_TIMEOUT', 'QUOTA_NETWORK', 'QUOTA_STALE'
]);
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const protocol = () => Error('BRIDGE_PROTOCOL');
const validSession = value => typeof value === 'string' && UUID.test(value);
const count = value => value === null || (Number.isSafeInteger(value) && value >= 0);

export function validateLoginUrl(value) {
  if (typeof value !== 'string' || value.length > 512 || !/^https:\/\/bailian\.console\.aliyun\.com\/console-login\?/.test(value) || /[\s#]/u.test(value)) throw protocol();
  let url;
  try { url = new URL(value); } catch { throw protocol(); }
  if (url.origin !== 'https://bailian.console.aliyun.com' || url.pathname !== '/console-login' || url.username || url.password || url.port || url.hash) throw protocol();
  const params = [...url.searchParams];
  if (params.length !== 1 || params[0][0] !== 'notice') throw protocol();
  const match = /^127\.0\.0\.1:([1-9][0-9]{3,4})\?state=([0-9a-f]{48})$/i.exec(params[0][1]);
  if (!match || Number(match[1]) < 1024 || Number(match[1]) > 65535) throw protocol();
  return value;
}

function publicScope(value) {
  if (!record(value) || value.region !== 'cn-beijing' || value.site !== 'domestic') throw protocol();
  const result = { region: 'cn-beijing', site: 'domestic' };
  if (value.workspaceHint !== undefined) {
    if (typeof value.workspaceHint !== 'string' || !/^[\p{L}\p{N} ._…@-]{1,64}$/u.test(value.workspaceHint)) throw protocol();
    result.workspaceHint = value.workspaceHint;
  }
  return result;
}

function publicData(op, value, models) {
  if (!record(value)) throw protocol();
  if (op === 'login') {
    if (value.connecting !== true) throw protocol();
    return { connecting: true, loginUrl: validateLoginUrl(value.loginUrl) };
  }
  if (op === 'quota') {
    if (!validSession(value.sessionId) || !Array.isArray(value.models) || value.models.length !== models.length) throw protocol();
    const rows = Array.from(value.models, (row, index) => {
      if (!record(row) || row.model !== models[index] || !['valid', 'expired', 'none', 'unknown'].includes(row.status) ||
          !count(row.remaining) || !count(row.total) || !count(row.expiresAt) ||
          (row.expiresAt !== null && row.expiresAt > 8640000000000000) ||
          (row.remaining !== null && row.total !== null && row.remaining > row.total)) throw protocol();
      return { model: row.model, remaining: row.remaining, total: row.total, expiresAt: row.expiresAt, status: row.status };
    });
    return { sessionId: value.sessionId, scope: publicScope(value.scope), models: rows };
  }
  if (value.bridgeVersion !== '4.12.0' || typeof value.authenticated !== 'boolean' || typeof value.connecting !== 'boolean') throw protocol();
  if (value.authenticated && (!validSession(value.sessionId) || !record(value.scope))) throw protocol();
  if (op === 'logout' && (value.authenticated || value.connecting)) throw protocol();
  const result = { bridgeVersion: value.bridgeVersion, authenticated: value.authenticated, connecting: value.connecting };
  if (value.sessionId !== undefined) {
    if (!validSession(value.sessionId)) throw protocol();
    result.sessionId = value.sessionId;
  }
  if (value.scope !== undefined) result.scope = publicScope(value.scope);
  if (value.error !== undefined) {
    if (!NATIVE_CODES.has(value.error)) throw protocol();
    result.error = value.error;
  }
  return result;
}

function requestModels(op, options) {
  if (!['status', 'login', 'quota', 'logout'].includes(op) || !record(options)) throw protocol();
  const needsModels = op === 'login' || op === 'quota';
  if (Reflect.ownKeys(options).some(key => key !== 'models' || !needsModels)) throw protocol();
  if (!needsModels) return undefined;
  const models = options.models;
  if (!Array.isArray(models) || models.length < 1 || models.length > 2 || new Set(models).size !== models.length || Array.from(models).some(model => typeof model !== 'string' || !MODEL.test(model))) throw protocol();
  return [...models];
}

function disconnectCode(error) {
  const message = typeof error?.message === 'string' ? error.message : '';
  if (/specified native messaging host not found|native messaging host.*not (?:found|registered)|host manifest.*not found/i.test(message)) return 'BRIDGE_NOT_INSTALLED';
  if (/access to.*native messaging host.*forbidden|native messaging.*(?:not allowed|permission)|requires.*nativeMessaging|nativeMessaging.*permission/i.test(message)) return 'BRIDGE_NOT_ALLOWED';
  return 'BRIDGE_DISCONNECTED';
}

export function nativeBridge(chromeApi, { timeoutMs = 15000 } = {}) {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 2147483647) throw protocol();
  const pending = new Map();
  let active = null, closed = false;

  function settle(id, error, data) {
    const entry = pending.get(id);
    if (!entry) return;
    pending.delete(id);
    clearTimeout(entry.timer);
    if (error) entry.reject(Error(error)); else entry.resolve(data);
  }

  function retire(connection, code) {
    if (active !== connection) return;
    active = null;
    try { connection.port.onMessage.removeListener(connection.message); } catch { /* Port already closed. */ }
    try { connection.port.onDisconnect.removeListener(connection.disconnect); } catch { /* Port already closed. */ }
    for (const id of [...pending.keys()]) settle(id, code);
    try { connection.port.disconnect(); } catch { /* No credentials are cleared here. */ }
  }

  function connect() {
    if (active) return active;
    if (typeof chromeApi?.runtime?.connectNative !== 'function') throw Error('BRIDGE_NOT_ALLOWED');
    let port;
    try { port = chromeApi.runtime.connectNative(HOST); }
    catch (error) { throw Error(disconnectCode(error)); }
    const connection = { port };
    connection.message = response => {
      if (active !== connection) return;
      try {
        if (!record(response) || response.version !== 1 || typeof response.id !== 'string' || !pending.has(response.id) || typeof response.ok !== 'boolean') throw protocol();
        const entry = pending.get(response.id);
        if (!response.ok) {
          if (!record(response.error) || !NATIVE_CODES.has(response.error.code)) throw protocol();
          settle(response.id, response.error.code);
        } else {
          const data = publicData(entry.op, response.data, entry.models);
          settle(response.id, null, data);
        }
      } catch { retire(connection, 'BRIDGE_PROTOCOL'); }
    };
    connection.disconnect = () => {
      // Chrome exposes lastError only while the event is being delivered.
      const error = chromeApi.runtime.lastError;
      if (active === connection) retire(connection, disconnectCode(error));
    };
    active = connection;
    try {
      port.onMessage.addListener(connection.message);
      port.onDisconnect.addListener(connection.disconnect);
    } catch {
      retire(connection, 'BRIDGE_DISCONNECTED');
      throw Error('BRIDGE_DISCONNECTED');
    }
    return connection;
  }

  return {
    request(op, options = {}) {
      return new Promise((resolve, reject) => {
        if (closed) { reject(Error('BRIDGE_DISCONNECTED')); return; }
        let models;
        try { models = requestModels(op, options); } catch { reject(protocol()); return; }
        if (pending.size >= 20) { reject(Error('BRIDGE_BUSY')); return; }
        let connection, id;
        try { id = crypto.randomUUID(); connection = connect(); }
        catch (error) { reject(Error(['BRIDGE_NOT_INSTALLED', 'BRIDGE_NOT_ALLOWED', 'BRIDGE_DISCONNECTED'].includes(error?.message) ? error.message : 'BRIDGE_DISCONNECTED')); return; }
        const timer = setTimeout(() => {
          settle(id, 'BRIDGE_TIMEOUT');
          retire(connection, 'BRIDGE_DISCONNECTED');
        }, timeoutMs);
        pending.set(id, { op, models, resolve, reject, timer });
        try { connection.port.postMessage({ version: 1, id, op, ...(models ? { models } : {}) }); }
        catch (error) { retire(connection, disconnectCode(error)); }
      });
    },
    close() {
      closed = true;
      if (active) retire(active, 'BRIDGE_DISCONNECTED');
    }
  };
}
