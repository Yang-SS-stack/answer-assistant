import test from 'node:test';
import assert from 'node:assert/strict';
import { nativeBridge, validateLoginUrl } from '../src/monitoring/native-bridge.js';

const sessionId = 'd9fd9697-8657-4f53-baf3-42ee1c6ab344';
const scope = { region: 'cn-beijing', site: 'domestic' };
const status = () => ({ bridgeVersion: '4.12.0', authenticated: true, connecting: false, sessionId, scope });
const loginUrl = `https://bailian.console.aliyun.com/console-login?notice=${encodeURIComponent('127.0.0.1:15321?state=' + 'a'.repeat(48))}`;
function fakeChrome() {
  const ports = [];
  const runtime = { lastError: undefined, connectNative(host) {
    assert.equal(host, 'com.answer_assistant.quota');
    const listeners = () => ({ handlers: new Set(), addListener(fn) { this.handlers.add(fn); }, removeListener(fn) { this.handlers.delete(fn); }, emit(value) { for (const fn of [...this.handlers]) fn(value); } });
    const port = { onMessage: listeners(), onDisconnect: listeners(), sent: [], disconnected: false, postMessage(value) { this.sent.push(value); }, disconnect() { this.disconnected = true; this.onDisconnect.emit(); } };
    ports.push(port); return port;
  } };
  return { runtime, ports };
}
const reply = (port, index, data, extra = {}) => port.onMessage.emit({ version: 1, id: port.sent[index].id, ok: true, data, ...extra });
const rejectsCode = (promise, code) => assert.rejects(promise, error => error.message === code && !error.message.includes('secret'));

test('one persistent port routes concurrent unique requests and strips extra fields', async () => {
  const chrome = fakeChrome(), bridge = nativeBridge(chrome);
  const one = bridge.request('status'), two = bridge.request('quota', { models: ['qwen-plus', 'qwen-max'] });
  assert.equal(chrome.ports.length, 1);
  const port = chrome.ports[0];
  assert.equal(new Set(port.sent.map(r => r.id)).size, 2);
  assert.deepEqual(port.sent.map(r => r.version), [1, 1]);
  reply(port, 1, { sessionId, scope: { ...scope, token: 'secret' }, source: 'secret', models: ['qwen-plus', 'qwen-max'].map(model => ({ model, remaining: 1, total: 3, expiresAt: null, status: 'valid', api_key: 'secret' })) });
  reply(port, 0, { ...status(), headers: 'secret', scope: { ...scope, token: 'secret' } });
  assert.deepEqual(await one, status());
  assert.equal(JSON.stringify(await two).includes('secret'), false);
  bridge.close();
});

test('invalid operations/options/models are rejected before a port is opened', async () => {
  const chrome = fakeChrome(), bridge = nativeBridge(chrome);
  for (const [op, options] of [['exec', {}], ['status', { models: [] }], ['logout', { path: 'secret' }], ['quota', {}], ['quota', { models: [] }], ['login', { models: ['a', 'a'] }], ['quota', { models: ['a', 'b', 'c'] }], ['quota', { models: ['路径'] }], ['quota', { models: ['a'.repeat(161)] }], ['quota', { models: ['a'], extra: true }], ['status', null], ['status', []]]) await rejectsCode(bridge.request(op, options), 'BRIDGE_PROTOCOL');
  assert.equal(chrome.ports.length, 0);
  bridge.close();
});

test('pending limit rejects only request 21', async () => {
  const chrome = fakeChrome(), bridge = nativeBridge(chrome);
  const pending = Array.from({ length: 20 }, () => bridge.request('status'));
  const outcomes = pending.map(p => rejectsCode(p, 'BRIDGE_DISCONNECTED'));
  await rejectsCode(bridge.request('status'), 'BRIDGE_BUSY');
  assert.equal(chrome.ports[0].sent.length, 20);
  bridge.close(); await Promise.all(outcomes);
});

test('timeout retires old port without logout, permits reconnect and ignores its late events', async () => {
  const chrome = fakeChrome(), bridge = nativeBridge(chrome, { timeoutMs: 15 });
  await rejectsCode(bridge.request('status'), 'BRIDGE_TIMEOUT');
  const old = chrome.ports[0]; assert.equal(old.disconnected, true);
  const next = bridge.request('status'), port = chrome.ports[1];
  old.onMessage.emit({ version: 99 }); old.onDisconnect.emit();
  reply(port, 0, status()); assert.deepEqual(await next, status());
  assert.equal(old.sent.some(r => r.op === 'logout'), false);
  bridge.close();
});

test('host missing/blocked errors are normalized and raw text is never returned', async () => {
  for (const [raw, expected] of [['Specified native messaging host not found. C:\\secret', 'BRIDGE_NOT_INSTALLED'], ['Access to the specified native messaging host is forbidden. secret', 'BRIDGE_NOT_ALLOWED'], ['secret arbitrary error', 'BRIDGE_DISCONNECTED']]) {
    const chrome = fakeChrome(), bridge = nativeBridge(chrome), p = bridge.request('status');
    const outcome = rejectsCode(p, expected);
    chrome.runtime.lastError = { message: raw }; chrome.ports[0].onDisconnect.emit(); chrome.runtime.lastError = undefined;
    await outcome; bridge.close();
  }
  const chrome = fakeChrome(); chrome.runtime.connectNative = () => { throw Error('secret path'); };
  await rejectsCode(nativeBridge(chrome).request('status'), 'BRIDGE_DISCONNECTED');
  await rejectsCode(nativeBridge({ runtime: {} }).request('status'), 'BRIDGE_NOT_ALLOWED');
});

test('malformed responses, unknown IDs, versions and unknown error codes invalidate the port', async () => {
  const cases = [p => ({ version: 2, id: p.sent[0].id, ok: true, data: status() }), () => ({ version: 1, id: 'unknown', ok: true, data: status() }), p => ({ version: 1, id: p.sent[0].id, ok: false, error: { code: 'secret path' } }), p => ({ version: 1, id: p.sent[0].id, ok: true, data: { ...status(), bridgeVersion: '9.0.0' } }), p => ({ version: 1, id: p.sent[0].id, ok: true, data: { ...status(), sessionId: 'secret' } })];
  for (const make of cases) {
    const chrome = fakeChrome(), bridge = nativeBridge(chrome), p = bridge.request('status');
    const outcome = rejectsCode(p, 'BRIDGE_PROTOCOL'); chrome.ports[0].onMessage.emit(make(chrome.ports[0])); await outcome;
    assert.equal(chrome.ports[0].disconnected, true); bridge.close();
  }
});

test('fixed native errors are forwarded by code and the port remains usable', async () => {
  const chrome = fakeChrome(), bridge = nativeBridge(chrome), p = bridge.request('quota', { models: ['qwen-plus'] }), port = chrome.ports[0];
  port.onMessage.emit({ version: 1, id: port.sent[0].id, ok: false, error: { code: 'QUOTA_RATE_LIMIT', source: 'secret' } });
  await rejectsCode(p, 'QUOTA_RATE_LIMIT');
  const next = bridge.request('status'); reply(port, 1, status()); await next; bridge.close();
});

test('quota validates requested models, safe counts, expiry and scope', async () => {
  const good = { sessionId, scope, models: [{ model: 'qwen-plus', remaining: null, total: null, expiresAt: null, status: 'unknown' }] };
  const malformed = [ { ...good, scope: { region: 'us', site: 'domestic' } }, { ...good, models: [] }, { ...good, models: [{ ...good.models[0], model: 'other' }] }, ...[{ remaining: -1 }, { total: 0.5 }, { remaining: 3, total: 2 }, { expiresAt: 8640000000000001 }, { status: 'ready' }].map(change => ({ ...good, models: [{ ...good.models[0], ...change }] })) ];
  for (const value of [good, ...malformed]) {
    const chrome = fakeChrome(), bridge = nativeBridge(chrome), p = bridge.request('quota', { models: ['qwen-plus'] });
    const outcome = value === good ? p.then(data => assert.deepEqual(data, good)) : rejectsCode(p, 'BRIDGE_PROTOCOL');
    reply(chrome.ports[0], 0, value); await outcome; bridge.close();
  }
});

test('login URL accepts only exact official origin/path and a single safe callback', async () => {
  assert.equal(validateLoginUrl(loginUrl), loginUrl);
  const bad = [loginUrl.replace('https:', 'http:'), loginUrl.replace('bailian.console.aliyun.com', 'evil.example'), loginUrl.replace('/console-login', '/console-login/'), loginUrl + '&needapikey=true', loginUrl + '&notice=duplicate', loginUrl + '#fragment', loginUrl.replace('https://', 'https://user@'), 'https://bailian.console.aliyun.com/console-login?notice=' + encodeURIComponent('localhost:15321?state=' + 'a'.repeat(48)), 'https://bailian.console.aliyun.com/console-login?notice=' + encodeURIComponent('127.0.0.1:80?state=' + 'a'.repeat(48)), loginUrl.replace('a'.repeat(48), 'a'.repeat(47)), 'https://bailian.console.aliyun.com/console-login?notice=' + encodeURIComponent('127.0.0.1:15321?state=' + 'a'.repeat(48) + '&token=secret')];
  for (const value of bad) assert.throws(() => validateLoginUrl(value), /^Error: BRIDGE_PROTOCOL$/);
  const chrome = fakeChrome(), bridge = nativeBridge(chrome), p = bridge.request('login', { models: ['qwen-plus'] });
  reply(chrome.ports[0], 0, { connecting: true, loginUrl, token: 'secret' });
  assert.deepEqual(await p, { connecting: true, loginUrl }); bridge.close();
});

test('close cancels pending requests and permanently closes this client', async () => {
  const chrome = fakeChrome(), bridge = nativeBridge(chrome), p = bridge.request('status');
  const outcome = rejectsCode(p, 'BRIDGE_DISCONNECTED'); bridge.close(); bridge.close(); await outcome;
  await rejectsCode(bridge.request('status'), 'BRIDGE_DISCONNECTED'); assert.equal(chrome.ports.length, 1);
});

test('sparse model arrays are invalid rather than silently omitting validation', async () => {
  const chrome = fakeChrome(), bridge = nativeBridge(chrome);
  await rejectsCode(bridge.request('quota', { models: Array(1) }), 'BRIDGE_PROTOCOL');
  assert.equal(chrome.ports.length, 0);
  const p = bridge.request('quota', { models: ['qwen-plus'] });
  const outcome = rejectsCode(p, 'BRIDGE_PROTOCOL');
  reply(chrome.ports[0], 0, { sessionId, scope, models: Array(1) });
  await outcome; bridge.close();
});

test('already queued callbacks from retired port cannot resolve or disconnect the new port', async () => {
  const chrome = fakeChrome(), bridge = nativeBridge(chrome), initial = bridge.request('status');
  const old = chrome.ports[0], message = [...old.onMessage.handlers][0], disconnect = [...old.onDisconnect.handlers][0];
  const initialOutcome = rejectsCode(initial, 'BRIDGE_DISCONNECTED');
  old.onDisconnect.emit(); await initialOutcome;
  const next = bridge.request('status'), port = chrome.ports[1];
  message({ version: 1, id: port.sent[0].id, ok: true, data: { ...status(), authenticated: false } });
  chrome.runtime.lastError = { message: 'secret' }; disconnect(); chrome.runtime.lastError = undefined;
  reply(port, 0, status()); assert.deepEqual(await next, status()); assert.equal(port.disconnected, false); bridge.close();
});

test('timeout settles all requests and late frames cannot revive a closed client', async () => {
  const chrome = fakeChrome(), bridge = nativeBridge(chrome, { timeoutMs: 15 });
  const one = bridge.request('status'), two = bridge.request('status');
  const outcomes = [rejectsCode(one, 'BRIDGE_TIMEOUT'), rejectsCode(two, 'BRIDGE_DISCONNECTED')];
  await Promise.all(outcomes); bridge.close();
  reply(chrome.ports[0], 0, status());
  assert.equal(chrome.ports[0].sent.length, 2);
});

test('logout and pending login status carry only approved public fields', async () => {
  const chrome = fakeChrome(), bridge = nativeBridge(chrome), one = bridge.request('status'), port = chrome.ports[0];
  reply(port, 0, { bridgeVersion: '4.12.0', authenticated: false, connecting: true, error: 'QWEN_LOGIN_TIMEOUT', token: 'secret' });
  assert.deepEqual(await one, { bridgeVersion: '4.12.0', authenticated: false, connecting: true, error: 'QWEN_LOGIN_TIMEOUT' });
  const two = bridge.request('logout');
  reply(port, 1, { bridgeVersion: '4.12.0', authenticated: false, connecting: false });
  assert.deepEqual(await two, { bridgeVersion: '4.12.0', authenticated: false, connecting: false }); bridge.close();
});
