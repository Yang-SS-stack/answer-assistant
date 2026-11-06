const STORAGE_KEY = 'aaV4monitorUsage';
const MAX_TIME = 8640000000000000;
const counter = value => Number.isSafeInteger(value) && value >= 0;
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const text = value => typeof value === 'string' && value.length > 0 && value.length <= 256 && !/[\u0000-\u001f\u007f]/.test(value);

/** Only official token counts are accepted; cache/reasoning counts are subsets. */
export function normalizeUsage(raw) {
  if (!object(raw)) return null;
  const inputTokens = raw.prompt_tokens;
  const outputTokens = raw.completion_tokens;
  const totalTokens = raw.total_tokens;
  if (![inputTokens, outputTokens, totalTokens].every(counter)
      || !Number.isSafeInteger(inputTokens + outputTokens)
      || inputTokens + outputTokens !== totalTokens) return null;
  const result = { inputTokens, outputTokens, totalTokens };
  const cacheCandidates = [raw.prompt_cache_hit_tokens, raw.prompt_tokens_details?.cached_tokens];
  const cachedInputTokens = cacheCandidates.find(value => counter(value) && value <= inputTokens);
  const reasoningTokens = raw.completion_tokens_details?.reasoning_tokens;
  if (cachedInputTokens !== undefined) result.cachedInputTokens = cachedInputTokens;
  if (counter(reasoningTokens) && reasoningTokens <= outputTokens) result.reasoningTokens = reasoningTokens;
  return result;
}

function storedUsage(raw) {
  if (!object(raw)) return null;
  return normalizeUsage({ prompt_tokens: raw.inputTokens, completion_tokens: raw.outputTokens,
    total_tokens: raw.totalTokens, prompt_cache_hit_tokens: raw.cachedInputTokens,
    completion_tokens_details: { reasoning_tokens: raw.reasoningTokens } });
}

function localDay(time) {
  const date = new Date(time);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

/** Serialized, failure-isolated ledger. Storage is the chrome.storage.local promise API. */
export function usageLedger(storage, { now = Date.now, dayKey = localDay, maxRecords = 2000, retentionDays = 7 } = {}) {
  const limit = Number.isSafeInteger(maxRecords) && maxRecords > 0 ? Math.min(maxRecords, 2000) : 2000;
  const days = Number.isSafeInteger(retentionDays) && retentionDays > 0 ? Math.min(retentionDays, 7) : 7;
  let records = new Map();
  let incomplete = false;
  let loaded = false;
  let queue = Promise.resolve();

  function timeNow() {
    const value = now();
    if (!Number.isSafeInteger(value) || value < 0 || value > MAX_TIME) throw new Error('Invalid clock');
    return value;
  }

  function cleanEvent(event, current, restoring = false) {
    if (!object(event) || !['started', 'received', 'failed'].includes(event.kind)
        || !['deepseek', 'qwen'].includes(event.provider)
        || !['answer', 'independent', 'review'].includes(event.role)
        || !['id', 'scope', 'model', 'taskId'].every(key => text(event[key]))) return null;
    const at = event.at === undefined && !restoring ? current : event.at;
    if (!Number.isSafeInteger(at) || at < 0 || at > current || at > MAX_TIME) return null;
    const result = { id: event.id, kind: event.kind, scope: event.scope, provider: event.provider,
      model: event.model, role: event.role, taskId: event.taskId, at };
    if (event.kind === 'received') {
      const usage = restoring ? storedUsage(event.usage) : normalizeUsage(event.usage);
      if (usage) result.usage = usage;
    }
    return result;
  }

  function prune(current) {
    // Calendar-day retention is independent of DST and elapsed 24-hour periods.
    const cutoff = new Date(current);
    cutoff.setHours(0, 0, 0, 0);
    cutoff.setDate(cutoff.getDate() - days + 1);
    for (const [id, record] of records) if (record.at < cutoff.getTime()) records.delete(id);
    if (records.size > limit) {
      const ordered = [...records.values()].sort((a, b) => a.at - b.at);
      for (const record of ordered.slice(0, records.size - limit)) records.delete(record.id);
      incomplete = true;
    }
  }

  async function load(current) {
    if (loaded) return;
    try {
      const stored = (await storage.get(STORAGE_KEY))?.[STORAGE_KEY];
      const restored = new Map();
      if (stored !== undefined) {
        if (!object(stored) || stored.version !== 1 || !Array.isArray(stored.records)) incomplete = true;
        else {
          incomplete ||= stored.incomplete === true;
          for (const raw of stored.records) {
            const record = cleanEvent(raw, current, true);
            if (!record || restored.has(record.id)) { incomplete = true; continue; }
            if (raw.usage && !record.usage) incomplete = true;
            restored.set(record.id, record);
          }
        }
      }
      // A failed read leaves events only in memory. Recover the persisted baseline
      // first, then replay these summaries with the same identity/confirmation rules.
      const pending = records;
      records = restored;
      for (const record of pending.values()) mergeRecord(record);
      prune(current);
      loaded = true;
    } catch { incomplete = true; }
  }

  async function save() {
    // Never replace a key until its prior contents have actually been read.
    if (!loaded) return { saved: false };
    try {
      await storage.set({ [STORAGE_KEY]: { version: 1, records: [...records.values()], incomplete } });
      return { saved: true };
    } catch { incomplete = true; return { saved: false }; }
  }

  function serial(action, fallback) {
    const result = queue.then(async () => {
      try {
        const current = timeNow();
        await load(current);
        prune(current);
        return await action(current);
      } catch { incomplete = true; return fallback(); }
    });
    queue = result.then(() => undefined, () => undefined);
    return result;
  }

  function mergeRecord(incoming) {
    const previous = records.get(incoming.id);
    if (previous) {
      if (!['scope', 'provider', 'model', 'role', 'taskId'].every(key => previous[key] === incoming[key])) {
        incomplete = true;
        return false;
      }
      // Keep the original start time, and never downgrade an acknowledged response.
      if (!previous.usage && incoming.kind === 'received') records.set(incoming.id, { ...incoming, at: previous.at });
      else if (previous.kind === 'started' && incoming.kind === 'failed') records.set(incoming.id, { ...previous, kind: 'failed' });
    } else records.set(incoming.id, incoming);
    return true;
  }

  return {
    record(event) {
      return serial(async current => {
        const incoming = cleanEvent(event, current);
        if (!incoming) { incomplete = true; return { saved: false }; }
        if (!mergeRecord(incoming)) return { saved: false };
        prune(current);
        return save();
      }, () => ({ saved: false }));
    },
    report(query = {}) {
      return serial(current => {
        const rows = new Map();
        const scopes = new Set(Array.isArray(query.scopes) ? query.scopes.filter(text) : []);
        if (!['task', 'today'].includes(query.period) || (query.period === 'task' && !text(query.taskId))) {
          return { rows: [], hasData: false, incomplete: true };
        }
        for (const record of records.values()) {
          if (!scopes.has(record.scope) || (query.period === 'task' ? record.taskId !== query.taskId : dayKey(record.at) !== dayKey(current))) continue;
          const key = JSON.stringify([record.provider, record.model]);
          if (!rows.has(key)) rows.set(key, { provider: record.provider, model: record.model,
            inputTokens: 0, outputTokens: 0, totalTokens: 0, requestCount: 0, confirmedRequests: 0, unknownRequests: 0, pendingRequests: 0 });
          const row = rows.get(key);
          row.requestCount++;
          if (record.usage) {
            row.confirmedRequests++;
            for (const key of ['inputTokens', 'outputTokens', 'totalTokens']) {
              const sum = row[key] + record.usage[key];
              if (!Number.isSafeInteger(sum)) incomplete = true;
              row[key] = Math.min(sum, Number.MAX_SAFE_INTEGER);
            }
          } else {
            row.unknownRequests++;
            if (record.kind === 'started') row.pendingRequests++;
          }
        }
        return { rows: [...rows.values()].sort((a, b) => a.provider.localeCompare(b.provider) || a.model.localeCompare(b.model)), hasData: rows.size > 0, incomplete };
      }, () => ({ rows: [], hasData: false, incomplete: true }));
    },
    flush() { return serial(() => save(), () => ({ saved: false })); }
  };
}
