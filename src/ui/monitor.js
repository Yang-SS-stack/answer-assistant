const PROVIDER = { deepseek: 'DeepSeek', qwen: 'Qwen' };
const QWEN_STATUS = {
  unconfigured: '未配置 Qwen API Key，请到设置中配置。', inactive: '当前答题与复核未使用 Qwen 模型。',
  permission_required: '尚未连接：请安装本机组件，再授权连接。', not_installed: '未找到本机组件，请先下载并安装。',
  connecting: '正在等待官网授权，可取消连接。', disconnected: '尚未连接千问额度。',
  needs_association: '官网授权已完成，请确认账号关联后查询额度。', empty: '账号已关联，等待查询免费余量。',
  ready: '中国站北京 · 免费 Token 余量', error: '额度暂不可用，请检查连接或稍后重试。', changed: '配置已变化，正在读取。'
};
const ERROR_TEXT = {
  BRIDGE_NOT_INSTALLED: '未找到本机组件，请先下载并安装。', BRIDGE_NOT_ALLOWED: '未获得本机组件连接权限，请点击连接并允许权限。',
  BRIDGE_PROTOCOL: '本机组件响应不兼容，请安装随扩展提供的组件。', BRIDGE_TIMEOUT: '本机组件响应超时，请稍后重试。',
  BRIDGE_DISCONNECTED: '本机组件已断开，请重新连接。', BRIDGE_BUSY: '本机组件繁忙，请稍后重试。',
  QWEN_AUTH_EXPIRED: '官网授权已过期，请重新连接。', QWEN_AUTH_INVALID: '官网授权无效，请重新连接。',
  QWEN_LOGIN_CANCELLED: '官网授权已取消。', QWEN_LOGIN_TIMEOUT: '官网授权超时，请重新连接。',
  QWEN_MODEL_REQUIRED: '请先配置当前使用的 Qwen 模型与 API Key。',
  MONITOR_BUSY: '请先停止当前答题，再连接额度。', ASSOCIATION_CHANGED: '授权账号已变化，请重新核对账号归属。',
  ASSOCIATION_REQUIRED: '请先确认账号归属一致。', QUOTA_RATE_LIMIT: '额度查询频繁，请稍后重试。',
  QUOTA_STORAGE_ERROR: '额度未能保存，请稍后重试。'
};
const safeCount = n => Number.isSafeInteger(n) && n >= 0;
const number = n => safeCount(n) ? n.toLocaleString('en-US') : '未确认';
const remaining = row => row.status === 'valid' ? number(row.remaining) : row.status === 'expired' ? '已过期' : row.status === 'none' ? '暂无免费额度' : '未确认';
const money = (currency, value) => `${currency === 'CNY' ? '¥' : currency === 'USD' ? '$' : currency + ' '}${typeof value === 'string' ? value : '未确认'}`;
const errorText = code => ERROR_TEXT[code] || '查询失败，请稍后重试。';
const updated = at => Number.isFinite(at) ? new Date(at).toLocaleTimeString('zh-CN', { hour12: false }) + ' 更新' : '尚未更新';
const expiry = at => safeCount(at) && at <= 8640000000000000 ? new Date(at).toLocaleDateString('zh-CN') : '未确认';

export function createMonitor({ document, chromeApi, rpc, getTabId, isBusy, openUsage, now = () => Date.now() }) {
  const $ = id => document.getElementById(id);
  let period = 'task', visible = false, state, timer, reading, refreshing, operation = false;
  let lastRefresh = -Infinity, epoch = 0, sessionId, managed = null, feedbackText = '';
  const node = (tag, text, className) => { const e = document.createElement(tag); if (text !== undefined) e.textContent = text; if (className) e.className = className; return e; };

  function feedback(text) { feedbackText = text; $('monitorFeedback').textContent = text; $('monitorFeedback').hidden = !text; }
  function renderBalances(ds = {}) {
    const target = $('deepseekBalances'); target.replaceChildren();
    const balances = ds.data?.balances;
    if (Array.isArray(balances) && balances.length) {
      for (const b of balances) {
        const row = node('div', undefined, 'monitor-money-row'); row.append(node('span', b.currency, 'hint'), node('strong', money(b.currency, b.total), 'monitor-money'));
        const breakdown = node('div', undefined, 'monitor-breakdown'); breakdown.append(node('span', '赠送 ' + money(b.currency, b.granted)), node('span', '充值 ' + money(b.currency, b.toppedUp)));
        target.append(row, breakdown);
      }
    } else target.append(node('p', ds.status === 'unconfigured' ? '未配置' : ds.status === 'loading' ? '正在查询…' : ds.status === 'error' ? '查询失败' : '暂无官方余额', 'monitor-placeholder'));
    $('deepseekUpdated').textContent = [updated(ds.fetchedAt), ds.stale && ds.data ? '显示旧值' : '', ds.status === 'error' ? '刷新失败，请稍后重试' : '', ds.data?.available === false ? '账户当前不可用' : ''].filter(Boolean).join(' · ');
    $('runDeepseekBalance').textContent = Array.isArray(balances) && balances.length ? balances.map(b => money(b.currency, b.total)).join(' / ') + (ds.stale ? '（旧值）' : '') : ds.status === 'unconfigured' ? '未配置' : ds.status === 'error' ? '查询失败' : '待更新';
  }

  function renderQwen(q = {}) {
    const nextSession = q.status === 'needs_association' ? q.sessionId : undefined;
    if (sessionId !== nextSession) { sessionId = nextSession; $('qwenAccountConfirmed').checked = false; }
    $('qwenStatus').textContent = q.error ? errorText(q.error) : QWEN_STATUS[q.status] || '正在读取连接状态…';
    const models = Array.isArray(q.data?.models) ? q.data.models : [];
    const target = $('qwenModels'); target.replaceChildren();
    for (const r of models) {
      const row = node('div', undefined, 'monitor-quota-row'), value = node('div', remaining(r), 'monitor-quota-value');
      if (!['expired', 'none'].includes(r.status)) value.append(node('span', ' / ' + (r.status === 'valid' ? number(r.total) : '未确认') + ' Token'));
      row.append(value, node('span', r.model, 'monitor-model'), node('span', '到期 ' + expiry(r.expiresAt), 'monitor-model')); target.append(row);
    }
    $('qwenUpdated').textContent = [updated(q.fetchedAt), q.stale && q.data ? '显示旧值' : '', '官方额度可能延迟数分钟', '用量页每 60 秒尝试刷新'].filter(Boolean).join(' · ');
    $('runQwenQuota').textContent = models.length === 1 ? remaining(models[0]) + (models[0].status === 'valid' ? ' Token' : '') + (q.stale ? '（旧值）' : '') : models.length > 1 ? `${models.length} 个模型，查看明细` : q.status === 'unconfigured' ? '未配置' : q.status === 'inactive' ? '未启用' : q.status === 'connecting' ? '授权中' : q.status === 'needs_association' ? '待关联' : q.status === 'error' ? '连接异常' : q.status === 'empty' ? '待更新' : '未连接';
    const needsGuide = ['permission_required', 'not_installed', 'connecting', 'disconnected', 'needs_association', 'error'].includes(q.status);
    $('qwenConnection').hidden = managed === null ? !needsGuide : !managed;
    $('qwenManage').setAttribute('aria-expanded', String(!$('qwenConnection').hidden));
    $('qwenManage').textContent = $('qwenConnection').hidden ? '管理连接' : '收起连接指引';
    $('qwenAssociation').hidden = q.status !== 'needs_association';
    $('qwenAssociate').disabled = operation || !$('qwenAccountConfirmed').checked || !sessionId;
    const running = isBusy();
    $('qwenConnect').disabled = operation || running || ['connecting', 'unconfigured', 'inactive'].includes(q.status);
    $('qwenConnect').textContent = ['ready', 'empty', 'error'].includes(q.status) ? '重新授权' : '连接千问额度';
    $('qwenDisconnect').hidden = !['connecting', 'ready', 'empty', 'needs_association', 'error'].includes(q.status);
    $('qwenDisconnect').disabled = operation;
    $('qwenDisconnect').textContent = q.status === 'connecting' ? '取消连接' : '断开连接';
    $('qwenBusyHint').hidden = !running;
  }

  function renderUsage(usage = {}) {
    const rows = Array.isArray(usage.rows) ? usage.rows : []; $('usageRows').replaceChildren();
    let unknown = 0, pending = 0;
    for (const r of rows) {
      const tr = node('tr'), model = node('td', PROVIDER[r.provider] || '模型'); model.append(node('span', r.model, 'monitor-model'));
      const confirmed = safeCount(r.confirmedRequests) && r.confirmedRequests > 0;
      tr.append(model, node('td', confirmed ? number(r.inputTokens) : '未确认'), node('td', confirmed ? number(r.outputTokens) : '未确认')); $('usageRows').append(tr);
      unknown += safeCount(r.unknownRequests) ? r.unknownRequests : 0; pending += safeCount(r.pendingRequests) ? r.pendingRequests : 0;
    }
    $('usageEmpty').hidden = rows.length > 0;
    $('usageEmpty').textContent = period === 'task' ? '本次任务暂无记录。开始答题后显示本插件收到的用量。' : '今日暂无记录。仅统计本插件启用后的请求。';
    $('usageUnconfirmed').hidden = unknown === 0;
    $('usageUnconfirmed').textContent = `另有 ${number(unknown)} 次请求用量未确认，可能已计费。` + (pending ? `其中 ${number(pending)} 次尚在等待响应。` : '');
    $('usageIncomplete').hidden = !usage.incomplete;
  }

  function render() {
    if (!state) return;
    renderBalances(state.deepseek); renderQwen(state.qwen); renderUsage(state.usage);
    const future = [lastRefresh + 60000, state.deepseek?.nextRefreshAt, state.qwen?.nextRefreshAt].filter(Number.isFinite);
    const seconds = Math.max(0, Math.ceil((Math.max(...future) - now()) / 1000));
    $('monitorRefresh').disabled = !!refreshing || operation || seconds > 0;
    $('monitorRefresh').textContent = refreshing ? '正在刷新…' : seconds > 0 ? `${seconds} 秒后可刷新` : '刷新余额';
    document.querySelectorAll('[data-period]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.period === period)));
  }

  async function read() {
    if (reading) return reading;
    const version = epoch;
    reading = (async () => {
      try { const data = await rpc({ action: 'MONITOR_STATUS', tabId: getTabId(), period, refreshNative: false }); if (version === epoch) { state = data; render(); } }
      catch { if (version === epoch && !feedbackText) feedback('用量暂时无法读取，请稍后重试；答题可继续。'); }
    })().finally(() => { reading = undefined; });
    return reading;
  }

  async function refresh() {
    if (refreshing) return refreshing;
    if (now() - lastRefresh < 60000) { render(); return; }
    const version = epoch; lastRefresh = now(); feedback('');
    refreshing = (async () => {
      try { const data = await rpc({ action: 'MONITOR_REFRESH', tabId: getTabId(), period, refreshNative: false }); if (version === epoch) state = data; }
      catch { if (version === epoch) feedback('余额刷新失败，已保留原值，请稍后重试。'); }
    })().finally(() => { refreshing = undefined; render(); });
    render(); return refreshing;
  }

  async function control(action, payload) {
    if (operation) return;
    operation = true; epoch++; feedback(''); render();
    try { await rpc({ action, ...payload }); if (reading) await reading; await read(); }
    catch (error) { feedback(errorText(error?.message)); }
    finally { operation = false; render(); }
  }

  $('openUsage').onclick = openUsage;
  $('monitorRefresh').onclick = () => { refresh().catch(() => {}); };
  $('qwenManage').onclick = () => { managed = $('qwenConnection').hidden; render(); };
  $('bridgeDownload').href = chromeApi.runtime.getURL('bridge/answer-assistant-quota-bridge.zip');
  $('bridgeCommand').textContent = 'powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\\Install.ps1 -ExtensionId ' + chromeApi.runtime.id;
  $('bridgeCopy').onclick = async () => {
    try { await document.defaultView.navigator.clipboard.writeText($('bridgeCommand').textContent); feedback('安装命令已复制。'); }
    catch { feedback('复制未完成，请选中上方安装命令手动复制。'); }
  };
  $('qwenConnect').onclick = async () => {
    if (operation || isBusy()) { feedback(errorText('MONITOR_BUSY')); return; }
    try {
      // This call remains directly inside the user's click; status polling never requests permission.
      const granted = await chromeApi.permissions.request({ permissions: ['nativeMessaging'] });
      if (!granted) { feedback('未授予连接权限。可再次点击连接并允许权限。'); return; }
      managed = true;
      await control('MONITOR_QWEN_CONNECT', { tabId: getTabId(), reconnect: ['ready', 'empty', 'error'].includes(state?.qwen?.status) });
    } catch { feedback(errorText('BRIDGE_NOT_ALLOWED')); }
  };
  $('qwenDisconnect').onclick = () => { control('MONITOR_QWEN_DISCONNECT', {}).catch(() => {}); };
  $('qwenAccountConfirmed').onchange = () => render();
  $('qwenAssociate').onclick = async () => {
    if (!$('qwenAccountConfirmed').checked || !sessionId) return;
    await control('MONITOR_QWEN_ASSOCIATE', { confirmed: true, sessionId });
    if (state?.qwen?.status === 'empty') { lastRefresh = -Infinity; await refresh(); }
  };
  document.querySelectorAll('[data-period]').forEach(button => button.onclick = async () => {
    if (period === button.dataset.period) return;
    period = button.dataset.period; epoch++; if (reading) await reading; await read();
  });

  return {
    setVisible(value) { visible = value; if (visible) { read().catch(() => {}); refresh().catch(() => {}); } },
    start() {
      if (timer) return;
      read().catch(() => {});
      timer = document.defaultView.setInterval(() => {
        if (document.hidden) return;
        read().catch(() => {});
        if (visible && !operation && now() - lastRefresh >= 60000) refresh().catch(() => {});
      }, 1000);
    },
    stop() { document.defaultView.clearInterval(timer); timer = undefined; }
  };
}
