import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeUsage, usageLedger } from '../src/monitoring/usage.js';

const usage = { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12 };
const at = new Date(2026, 10, 6, 12).getTime();
function memory(initial = {}) {
  let data = structuredClone(initial);
  return { async get(key) { return { [key]: structuredClone(data[key]) }; }, async set(value) { Object.assign(data, structuredClone(value)); }, data: () => data };
}
const event = (id, kind = 'started', extra = {}) => ({ id, kind, scope: 'account-a', provider: 'deepseek', model: 'deepseek-chat', role: 'answer', taskId: 'task-a', ...extra });
const query = { scopes: ['account-a'], taskId: 'task-a', period: 'task' };
const create = (storage = memory(), options = {}) => usageLedger(storage, { now: () => at, ...options });

test('normalizes base usage and does not double count subsets', () => {
  assert.deepEqual(normalizeUsage({ ...usage, prompt_cache_hit_tokens: 7, completion_tokens_details: { reasoning_tokens: 1 } }), { inputTokens: 10, outputTokens: 2, totalTokens: 12, cachedInputTokens: 7, reasoningTokens: 1 });
  assert.equal(normalizeUsage({ ...usage, prompt_tokens_details: { cached_tokens: 4 } }).cachedInputTokens, 4);
  assert.equal(normalizeUsage({ prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 }).totalTokens, 0);
});
test('rejects malformed base counters and contradictory totals', () => {
  for (const bad of [-1, 1.5, NaN, Infinity, '10', null, undefined, Number.MAX_SAFE_INTEGER + 1]) assert.equal(normalizeUsage({ ...usage, prompt_tokens: bad }), null);
  assert.equal(normalizeUsage({ ...usage, total_tokens: 11 }), null);
  assert.equal(normalizeUsage({ prompt_tokens: Number.MAX_SAFE_INTEGER, completion_tokens: 1, total_tokens: Number.MAX_SAFE_INTEGER }), null);
  assert.equal(normalizeUsage(null), null);
});
test('invalid optional counters do not discard valid base usage', () => {
  assert.deepEqual(normalizeUsage({ ...usage, prompt_cache_hit_tokens: 11, prompt_tokens_details: { cached_tokens: -1 }, completion_tokens_details: { reasoning_tokens: 3 } }), { inputTokens: 10, outputTokens: 2, totalTokens: 12 });
});
test('serializes events, deduplicates IDs and never downgrades confirmed usage', async () => {
  const ledger = create();
  await Promise.all([ledger.record(event('1')), ledger.record(event('1', 'received', { usage })), ledger.record(event('1', 'failed')), ledger.record(event('1', 'received', { usage }))]);
  await ledger.record(event('retry', 'failed'));
  await ledger.record(event('pending'));
  await ledger.record(event('missing', 'received'));
  const result = await ledger.report(query);
  assert.deepEqual(result.rows, [{ provider: 'deepseek', model: 'deepseek-chat', inputTokens: 10, outputTokens: 2, totalTokens: 12, requestCount: 4, confirmedRequests: 1, unknownRequests: 3, pendingRequests: 1 }]);
  assert.equal(result.hasData, true);
  assert.equal(result.incomplete, false);
});
test('separates accounts and tasks and rejects identity collision', async () => {
  const ledger = create();
  await ledger.record(event('1', 'received', { usage }));
  assert.equal((await ledger.record(event('1', 'received', { scope: 'account-b', model: 'other', usage }))).saved, false);
  await ledger.record(event('2', 'received', { scope: 'account-b', usage }));
  await ledger.record(event('3', 'received', { taskId: 'other-task', provider: 'qwen', model: 'qwen-plus', usage }));
  assert.equal((await ledger.report(query)).rows[0].requestCount, 1);
  assert.equal((await ledger.report({ ...query, scopes: ['account-b'] })).rows[0].totalTokens, 12);
  const today = await ledger.report({ scopes: ['account-a'], period: 'today' });
  assert.equal(today.rows.length, 2);
  assert.equal(JSON.stringify(today).includes('account-a'), false);
  assert.equal(JSON.stringify(today).includes('task-a'), false);
});
test('counts against the start date across midnight and restart', async () => {
  const storage = memory();
  const before = new Date(2026, 10, 5, 23, 59).getTime();
  const ledger = create(storage);
  await ledger.record(event('1', 'started', { at: before }));
  await ledger.record(event('1', 'received', { usage, at }));
  await ledger.flush();
  const restarted = create(storage);
  assert.equal((await restarted.report({ scopes: ['account-a'], period: 'today' })).hasData, false);
  assert.equal((await restarted.report(query)).rows[0].totalTokens, 12);
});
test('persists strictly allowlisted fields', async () => {
  const storage = memory();
  const ledger = create(storage);
  await ledger.record(event('1', 'received', { usage: { ...usage, reasoning: 'private-answer' }, apiKey: 'private-key', question: 'private-question', response: 'private-response' }));
  await ledger.flush();
  assert.doesNotMatch(JSON.stringify(storage.data()), /private/);
  assert.deepEqual(Object.keys(storage.data()), ['aaV4monitorUsage']);
});
test('retains seven local calendar dates, caps attempts, and reports truncation', async () => {
  const storage = memory();
  const ledger = create(storage, { maxRecords: 2 });
  for (let i = 0; i < 3; i++) await ledger.record(event(String(i), 'received', { usage }));
  assert.equal((await ledger.report(query)).rows[0].requestCount, 2);
  assert.equal((await ledger.report(query)).incomplete, true);
  const old = create(memory());
  await old.record(event('expired', 'received', { usage, at: new Date(2026, 9, 30, 12).getTime() }));
  await old.record(event('retained', 'received', { usage, at: new Date(2026, 9, 31, 12).getTime() }));
  assert.equal((await old.report(query)).rows[0].requestCount, 1);
});
test('storage write failure stays isolated and received can recover a failed start', async () => {
  const storage = memory();
  const set = storage.set;
  let failed = true;
  storage.set = async value => { if (failed) throw new Error('secret'); await set(value); };
  const ledger = create(storage);
  assert.equal((await ledger.record(event('1'))).saved, false);
  failed = false;
  assert.equal((await ledger.record(event('1', 'received', { usage }))).saved, true);
  assert.equal((await ledger.report(query)).rows[0].confirmedRequests, 1);
  assert.equal((await create(storage).report(query)).incomplete, true);
});
test('read failure is isolated, invalid events and timestamps are not retained', async () => {
  const ledger = create({ async get() { throw new Error('private'); }, async set() {} });
  assert.equal((await ledger.report(query)).incomplete, true);
  assert.equal((await ledger.record(event('1', 'received', { usage }))).saved, false);
  for (const extra of [{ at: NaN }, { at: -1 }, { at: at + 1 }, { provider: 'other' }, { role: 'other' }, { scope: '' }]) assert.equal((await ledger.record(event('invalid', 'started', extra))).saved, false);
  assert.equal((await ledger.report(query)).rows[0].requestCount, 1);
});
test('received alone recovers usage, preserves first confirmation, and retries count independently', async () => {
  const ledger = create();
  await ledger.record(event('1', 'received', { usage }));
  await ledger.record(event('1', 'received', { usage: { prompt_tokens: 20, completion_tokens: 4, total_tokens: 24 } }));
  await ledger.record(event('2', 'received', { usage }));
  const row = (await ledger.report(query)).rows[0];
  assert.equal(row.totalTokens, 24);
  assert.equal(row.requestCount, 2);
  assert.equal(row.confirmedRequests, 2);
});
test('restores pending and unknown attempts and strips untrusted persisted extras', async () => {
  const storage = memory({ aaV4monitorUsage: { version: 1, incomplete: false, records: [
    { ...event('pending'), at, apiKey: 'private-key' },
    { ...event('failed', 'failed'), at },
    { ...event('received', 'received'), at, usage: { inputTokens: 10, outputTokens: 2, totalTokens: 12, secret: 'private' } }
  ] } });
  const ledger = create(storage);
  const row = (await ledger.report(query)).rows[0];
  assert.equal(row.pendingRequests, 1);
  assert.equal(row.unknownRequests, 2);
  assert.equal(row.totalTokens, 12);
  await ledger.flush();
  assert.doesNotMatch(JSON.stringify(storage.data()), /private|apiKey|secret/);
});
test('malformed persisted state is unknown and cannot masquerade as a complete empty ledger', async () => {
  for (const stored of [{ records: [] }, { version: 1, records: [{ ...event('future'), at: at + 1 }] }, { version: 1, records: [{ ...event('invalid', 'received'), at, usage: { inputTokens: '10', outputTokens: 2, totalTokens: 12 } }] }]) {
    const ledger = create(memory({ aaV4monitorUsage: stored }));
    assert.equal((await ledger.report(query)).incomplete, true);
    await ledger.record(event('valid', 'received', { usage }));
    assert.equal((await ledger.report(query)).rows[0].confirmedRequests, 1);
  }
});
test('aggregate integer overflow is bounded and explicitly incomplete', async () => {
  const ledger = create();
  const maximum = { prompt_tokens: Number.MAX_SAFE_INTEGER, completion_tokens: 0, total_tokens: Number.MAX_SAFE_INTEGER };
  await ledger.record(event('1', 'received', { usage: maximum }));
  await ledger.record(event('2', 'received', { usage: maximum }));
  const report = await ledger.report(query);
  assert.equal(report.incomplete, true);
  assert.equal(Number.isSafeInteger(report.rows[0].totalTokens), true);
});
test('uses injected local day key and keeps models grouped across roles', async () => {
  const ledger = create(memory(), { dayKey: () => 'local-today' });
  await ledger.record(event('1', 'received', { usage, role: 'answer' }));
  await ledger.record(event('2', 'received', { usage, role: 'review' }));
  const report = await ledger.report({ scopes: ['account-a'], period: 'today' });
  assert.equal(report.rows.length, 1);
  assert.equal(report.rows[0].totalTokens, 24);
  assert.equal((await ledger.report({ scopes: ['account-a'], period: 'invalid' })).incomplete, true);
});

test('retries a transient initial read and never replaces an unread persisted ledger', async () => {
  const storage = memory();
  await create(storage).record(event('old', 'received', { usage }));
  const get = storage.get;
  let reads = 0;
  storage.get = async key => { if (++reads === 1) throw new Error('temporary'); return get(key); };
  const ledger = create(storage);
  assert.equal((await ledger.report(query)).incomplete, true);
  assert.equal((await ledger.record(event('new', 'received', { usage }))).saved, true);
  assert.deepEqual(storage.data().aaV4monitorUsage.records.map(record => record.id).sort(), ['new', 'old']);
  assert.equal((await ledger.report(query)).rows[0].totalTokens, 24);
});

test('buffers failed-read events without writes and merges them after read recovery', async () => {
  const storage = memory();
  await create(storage).record(event('old', 'received', { usage }));
  const get = storage.get;
  const set = storage.set;
  let blocked = true;
  let writes = 0;
  storage.get = async key => { if (blocked) throw new Error('temporary'); return get(key); };
  storage.set = async value => { writes++; return set(value); };
  const ledger = create(storage);
  assert.equal((await ledger.record(event('new'))).saved, false);
  assert.equal((await ledger.record(event('new', 'received', { usage }))).saved, false);
  assert.equal((await ledger.flush()).saved, false);
  assert.equal(writes, 0);
  assert.deepEqual(storage.data().aaV4monitorUsage.records.map(record => record.id), ['old']);
  blocked = false;
  assert.equal((await ledger.flush()).saved, true);
  const report = await create(storage).report(query);
  assert.equal(report.rows[0].requestCount, 2);
  assert.equal(report.rows[0].confirmedRequests, 2);
  assert.equal(report.incomplete, true);
});

test('read recovery preserves original start date, confirmed usage and stored identity', async () => {
  const storage = memory();
  const before = new Date(2026, 10, 5, 23, 59).getTime();
  const original = create(storage);
  await original.record(event('started', 'started', { at: before }));
  await original.record(event('confirmed', 'received', { usage }));
  await original.record(event('identity', 'received', { usage }));
  const get = storage.get;
  let blocked = true;
  storage.get = async key => { if (blocked) throw new Error('temporary'); return get(key); };
  const ledger = create(storage);
  await ledger.record(event('started', 'received', { usage }));
  await ledger.record(event('confirmed', 'failed'));
  await ledger.record(event('identity', 'received', { scope: 'account-b', usage }));
  blocked = false;
  await ledger.flush();
  const today = await ledger.report({ scopes: ['account-a'], period: 'today' });
  assert.equal(today.rows[0].requestCount, 2);
  assert.equal(today.rows[0].confirmedRequests, 2);
  assert.equal((await ledger.report(query)).rows[0].confirmedRequests, 3);
  assert.equal((await ledger.report({ ...query, scopes: ['account-b'] })).hasData, false);
});
