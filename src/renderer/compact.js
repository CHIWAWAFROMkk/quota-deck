(function () {
  'use strict';

  let snapshot = null;
  let expandedProvider = null;
  let modelFilter = 'all';
  const selectedAgents = new Set();
  let runningCollaboration = false;

  const $ = (selector) => document.querySelector(selector);
  const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[char]);

  function showToast(message) {
    const toast = $('#toast');
    toast.textContent = message;
    toast.classList.add('show');
    setTimeout(() => toast.classList.remove('show'), 1800);
  }

  function burnText(rate) {
    if (!Number.isFinite(rate)) return '采样中';
    if (rate < 0.01) return '当前稳定';
    return `近 1 小时采样：下降 ${rate.toFixed(2)} 个百分点 / 小时（估算）`;
  }

  function modelNamesForPool(provider, poolName) {
    return provider.models.filter((model) => model.pool === poolName).map((model) => model.name);
  }

  const SEAL = { healthy: '澄', low: '惜', critical: '慎', error: '误', stale: '旧', disconnected: '未', unsupported: '未', loading: '候' };
  const clampPercent = (value) => Math.max(0, Math.min(100, value));
  const tone = (percent) => (percent <= 10 ? 'critical' : percent <= 30 ? 'low' : 'healthy');
  const fmtPercent = (value) => `${value.toFixed(1)}%`;
  // "5d 后重置" + resetsAt -> "5 天后重置 · 9/30 19:06"
  function resetText(window) {
    const relative = String(window?.reset || '').replace(/^(\d+)d /, '$1 天后').replace(/^(\d+)h /, '$1 小时后').replace(/^(\d+)m /, '$1 分钟后').replace('后后', '后');
    const at = new Date(window?.resetsAt || NaN);
    if (!Number.isFinite(at.getTime())) return relative;
    const pad = (n) => String(n).padStart(2, '0');
    return `${relative} · ${at.getMonth() + 1}/${at.getDate()} ${pad(at.getHours())}:${pad(at.getMinutes())}`;
  }

  function windowRow(window, stale) {
    const known = Number.isFinite(window.remainingPercent);
    const fill = known ? `<i class="${tone(window.remainingPercent)}" style="width:${clampPercent(window.remainingPercent)}%"></i>` : '';
    const label = { 300: '5 小时', 10080: '每周' }[window.windowDurationMins] || window.label;
    return `<div class="window-row">
      <span>${escapeHtml(label)}</span>
      <div class="track ${known ? (stale ? 'stale' : '') : 'unknown'}" aria-hidden="true">${fill}</div>
      <span class="window-value">${known ? fmtPercent(window.remainingPercent) : '未知'}</span>
    </div>`;
  }

  function chips(names) {
    return names.length ? `<div class="chips">${names.map((name) => `<span class="chip">${escapeHtml(name)}</span>`).join('')}</div>` : '';
  }

  function renderPools(provider) {
    const stale = provider.gauge?.provenance === 'stale';
    if (provider.pools?.length) {
      const unassigned = provider.models.filter((model) => !provider.pools.some((pool) => pool.name === model.pool)).map((model) => model.name);
      return provider.pools.map((pool) => `<section class="pool">
          <div class="pool-head"><strong>${escapeHtml(pool.name)}</strong><span>${pool.modelCount} 个模型共用</span></div>
          ${pool.windows.map((window) => `${windowRow(window, stale)}<div class="burn">${window.samplingSupported ? `${stale ? '旧数据 · 暂停估算' : escapeHtml(burnText(window.burnPerHour))} · ` : ''}${Number.isFinite(window.estimatedHoursLeft) ? `按近期速度约 ${window.estimatedHoursLeft.toFixed(1)} 小时耗尽 · ` : ''}${escapeHtml(resetText(window))}</div>`).join('')}
          ${chips(modelNamesForPool(provider, pool.name))}
        </section>`).join('') + (unassigned.length ? `<section class="pool"><div class="pool-head"><strong>额度归属待确认</strong><span>${unassigned.length} 个模型</span></div>${chips(unassigned)}</section>` : '');
    }

    const pools = new Map();
    for (const model of provider.models || []) {
      const key = model.poolType === 'shared' ? model.pool : `${model.pool}:${model.id}`;
      if (!pools.has(key)) pools.set(key, []);
      pools.get(key).push(model);
    }
    return [...pools.values()].map((models) => {
      const head = models[0];
      const windows = head.windows?.length
        ? head.windows.map((window) => `${windowRow(window, stale)}<div class="burn">${escapeHtml(resetText(window))}</div>`).join('')
        : '';
      return `<section class="pool">
        <div class="pool-head"><strong>${escapeHtml(head.poolType === 'shared' ? head.pool : head.name)}</strong><span>${head.poolType === 'shared' ? `${models.length} 个模型共用` : '共享关系未合并'}</span></div>
        ${windows}${chips(models.map((model) => model.name))}
      </section>`;
    }).join('');
  }

  function renderEfficiency(provider) {
    const ranked = [...(provider.models || [])].filter((model) => Number.isFinite(model.consumeMultiplier)).sort((a, b) => a.consumeMultiplier - b.consumeMultiplier);
    if (!ranked.length) return '';
    return `<div class="efficiency">
      <div class="eff-row head"><span>模型</span><span>消耗</span><span>相对可用</span></div>
      ${ranked.map((model) => {
        const free = model.consumeMultiplier === 0;
        const capacity = free ? '不扣积分' : `${(1 / model.consumeMultiplier).toFixed(1)}×`;
        return `<div class="eff-row"><strong title="${escapeHtml(model.name)}">${escapeHtml(model.name)}</strong><span class="${free || model.consumeMultiplier <= .1 ? 'speed-good' : ''}">${free ? '免费' : `${model.consumeMultiplier.toFixed(2)}×`}</span><span>${capacity}</span></div>`;
      }).join('')}
    </div><p class="source-note">相对可用以 1× 消耗为基准，仅比较同等计费工作量；不是剩余次数，也不表示免费模型无限使用。</p>`;
  }

  // "10.0%" -> ["10.0", "%"]; "1,228.29 积分" -> ["1,228.29", "积分"]; "¥ 9.70" stays whole.
  function splitHero(hero) {
    const match = /^([¥$]?\s?[\d,]+(?:\.\d+)?)\s*(%|\S.*)?$/.exec(String(hero ?? ''));
    return match ? [match[1].replace(/\s/g, ''), match[2] || ''] : [String(hero ?? ''), ''];
  }

  function readout(provider) {
    const gauge = provider.gauge || {};
    if (gauge.kind === 'unknown' || !gauge.kind) {
      return `<div class="quota-main"><strong class="unknown">${escapeHtml(provider.quotaHero)}</strong></div>`;
    }
    const [value, unit] = splitHero(provider.quotaHero);
    const caption = gauge.kind === 'window' ? `剩余${gauge.windows?.[0]?.label ? ` · ${gauge.windows[0].label}` : ''}` : provider.quotaSub;
    return `<div class="quota-main"><strong>${escapeHtml(value)}${unit ? `<small>${escapeHtml(unit)}</small>` : ''}</strong><span>${escapeHtml(caption)}</span></div>`;
  }

  function meter(provider) {
    const gauge = provider.gauge || {};
    if (gauge.kind === 'balance') {
      return `<div class="meter"><div class="meter-note"><span>余额制 · 按调用量扣费</span><span>${escapeHtml(provider.freshness || '')}</span></div></div>`;
    }
    if (gauge.kind === 'window' || gauge.kind === 'ratio') {
      const percent = clampPercent(gauge.remainingPercent);
      const stale = gauge.provenance === 'stale';
      const reset = gauge.windows?.[0] ? resetText(gauge.windows[0]) : provider.quotaSub;
      const left = stale ? `剩 ${fmtPercent(percent)} · 旧快照` : `已用 ${fmtPercent(100 - percent)}`;
      const right = stale ? '不代表当前余额' : gauge.kind === 'window' ? reset : provider.freshness;
      return `<div class="meter">
        <div class="track ${stale ? 'stale' : ''}" role="img" aria-label="剩余 ${fmtPercent(percent)}${stale ? '，旧快照' : ''}"><i class="${tone(percent)}" style="width:${Math.max(percent, 1.5)}%"></i></div>
        <div class="meter-note"><span>${escapeHtml(left)}</span><span>${escapeHtml(right)}</span></div>
      </div>`;
    }
    return `<div class="meter"><div class="track unknown" role="img" aria-label="额度未知"></div></div>`;
  }

  function renderProvider(provider) {
    const open = provider.id === expandedProvider;
    const unknown = (provider.gauge?.kind || 'unknown') === 'unknown';
    const body = provider.id === 'workbuddy' ? renderEfficiency(provider) : renderPools(provider);
    const setupLabel = {
      'claude-connect': '一键接入（保留现有状态栏）',
      'claude-disconnect': '断开接入，恢复原状态栏',
      'open-workbuddy': '打开官方用量页面重新采集',
    }[provider.setupAction];
    const setup = setupLabel
      ? `<button class="setup-button ${provider.setupAction === 'claude-disconnect' ? 'quiet' : ''}" type="button" data-action="${escapeHtml(provider.setupAction)}">${setupLabel}</button>`
      : '';
    return `<article class="provider ${open ? 'open' : ''}" data-provider="${escapeHtml(provider.id)}">
      <button class="provider-summary" type="button" aria-expanded="${open}" aria-controls="body-${escapeHtml(provider.id)}">
        <span class="seal ${escapeHtml(provider.status)}" aria-hidden="true">${SEAL[provider.status] || '？'}</span>
        <span class="who">
          <span class="provider-name">${escapeHtml(provider.name)}<span class="state-word ${escapeHtml(provider.status)}">${escapeHtml(provider.statusText)}</span></span>
          <span class="provider-plan">${escapeHtml(provider.plan)}</span>
        </span>
        ${readout(provider)}
        ${meter(provider)}
        ${unknown ? `<span class="row-note">${escapeHtml(provider.quotaSub)}</span>` : ''}
      </button>
      <div class="provider-body" id="body-${escapeHtml(provider.id)}">
        <div class="inner"><div class="pad">
          ${body}
          ${provider.sharedNotice && !(unknown && provider.sharedNotice.startsWith(provider.quotaSub)) ? `<p class="source-note">${escapeHtml(provider.sharedNotice)}</p>` : `<p class="source-note">${escapeHtml(provider.freshness || '')}</p>`}
          ${setup}
        </div></div>
      </div>
    </article>`;
  }

  function renderQuota() {
    $('#providerList').innerHTML = snapshot?.providers?.map(renderProvider).join('') || '<div class="empty">未读取到数据</div>';
  }

  // One sentence that answers "which account can I still work on", computed only from the snapshot.
  function renderVerdict() {
    const providers = snapshot?.providers || [];
    const live = (provider) => provider.gauge?.provenance === 'live';
    const usable = providers.filter((provider) => ['healthy', 'low'].includes(provider.status) && live(provider));
    const critical = providers.filter((provider) => ['critical', 'error'].includes(provider.status));
    const stale = providers.filter((provider) => provider.status === 'stale');
    const pending = providers.filter((provider) => ['disconnected', 'unsupported'].includes(provider.status));
    const main = usable.length
      ? `可用：${usable.map((provider) => `<b>${escapeHtml(provider.name)}</b> ${escapeHtml(provider.quotaHero)}${provider.status === 'low' ? '（偏低）' : ''}`).join('、')}`
      : '暂时没有确认可用的额度';
    const notes = [
      ...critical.map((provider) => `${provider.name} ${provider.statusText}${provider.gauge?.kind === 'window' ? `，剩 ${provider.quotaHero}，${provider.gauge.windows?.[0] ? resetText(provider.gauge.windows[0]) : provider.quotaSub}` : ''}`),
      ...stale.map((provider) => `${provider.name} 是旧数据`),
      ...pending.map((provider) => `${provider.name} ${provider.statusText}`),
    ].filter(Boolean);
    $('#verdict .verdict-main').innerHTML = main;
    $('#verdict .verdict-sub').textContent = notes.join('；');
  }

  function metricForModel(model) {
    if (Number.isFinite(model.consumeMultiplier)) {
      if (model.consumeMultiplier === 0) return ['免费', '不消耗积分'];
      return [`${model.consumeMultiplier.toFixed(2)}×`, `相对可用 ${(1 / model.consumeMultiplier).toFixed(1)}×`];
    }
    return [model.val || '共享池', model.pool || '共享额度'];
  }

  function allModels() {
    return (snapshot?.providers || []).flatMap((provider) => (provider.models || []).map((model) => ({ ...model, providerId: provider.id, providerName: provider.name })));
  }

  function renderModels() {
    const providers = (snapshot?.providers || []).filter((provider) => provider.models?.length);
    $('#modelFilters').innerHTML = `<button data-filter="all" class="${modelFilter === 'all' ? 'active' : ''}">全部</button>${providers.map((provider) => `<button data-filter="${provider.id}" class="${modelFilter === provider.id ? 'active' : ''}">${escapeHtml(provider.name)}</button>`).join('')}`;
    const query = $('#modelSearch').value.trim().toLowerCase();
    const models = allModels().filter((model) => (modelFilter === 'all' || model.providerId === modelFilter) && `${model.name} ${model.strengths?.join(' ')}`.toLowerCase().includes(query));
    $('#modelCount').textContent = `${allModels().length} 个已检测模型 · 当前显示 ${models.length}`;
    $('#modelCatalog').innerHTML = models.map((model) => {
      const [main, sub] = metricForModel(model);
      return `<article class="model-row"><div><h3>${escapeHtml(model.name)}<span>${escapeHtml(model.providerName)}</span></h3><p>${escapeHtml((model.strengths || []).join('、'))} · ${escapeHtml(model.guidanceSource)}</p><p>${escapeHtml(model.source)} · ${escapeHtml(model.sync)}</p></div><div class="model-metric"><strong>${escapeHtml(main)}</strong><span>${escapeHtml(sub)}</span></div></article>`;
    }).join('') || '<div class="empty">没有匹配模型</div>';
  }

  function renderAgentChoices() {
    const names = { codex: 'Codex', claude: 'Claude Code', antigravity: 'Antigravity', workbuddy: 'WorkBuddy' };
    $('#agentChoices').innerHTML = Object.entries(names).map(([id, name]) => {
      const provider = snapshot?.providers?.find((item) => item.id === id);
      const ready = snapshot?.agents?.[id] === true;
      return `<label class="agent-choice"><input type="checkbox" value="${id}" ${selectedAgents.has(id) ? 'checked' : ''} ${!ready || runningCollaboration ? 'disabled' : ''}><strong>${name}</strong><span>${ready ? `额度 ${escapeHtml(provider?.quotaHero || '未知')}${provider && provider.status !== 'healthy' ? ` · ${escapeHtml(provider.statusText)}` : ''}` : '未找到本机 CLI'}</span></label>`;
    }).join('');
  }

  function renderAll() {
    if (!snapshot) return;
    $('#syncMeta').textContent = [`${snapshot.lastUpdated} 更新`, snapshot.summaryRatio || snapshot.globalStatus].filter(Boolean).join(' · ');
    renderVerdict();
    renderQuota();
    renderModels();
    renderAgentChoices();
  }

  function renderCollaborationState(state) {
    runningCollaboration = state.running === true;
    const button = $('#runCollabBtn');
    button.disabled = runningCollaboration;
    button.textContent = runningCollaboration ? 'Agent 并行执行中…' : '开始并行协作';
    renderAgentChoices();
    if (runningCollaboration) {
      $('#collabResults').innerHTML = '<div class="empty">任务仍在执行；重新加载界面不会重复提交。请等待结果。</div>';
    } else if (state.result) {
      $('#collabResults').innerHTML = state.result.results.map((item) => `<article class="result"><h3>${escapeHtml(item.id)} · ${item.status === 'done' ? '完成' : '失败'}</h3><pre>${escapeHtml(item.output || item.error)}</pre></article>`).join('');
    } else if (state.error) {
      $('#collabResults').innerHTML = `<div class="empty">${escapeHtml(state.error)}</div>`;
    }
  }

  document.addEventListener('click', (event) => {
    const action = event.target.closest('[data-action]');
    if (action) {
      const api = window.quotaDeck;
      const calls = {
        'claude-connect': [api?.connectClaude, (result) => result?.status === 'already-connected' ? '已经接入过了' : '已接入，Claude 下一次回复后显示额度', '接入失败'],
        'claude-disconnect': [api?.disconnectClaude, () => '已断开，原状态栏已恢复', '断开失败'],
        'claude-help': [api?.openClaudeHelp, () => '', '打开失败，请查看项目 docs/claude-setup.md'],
        'open-workbuddy': [api?.openWorkBuddy, () => '', '打开失败，请稍后重试'],
      }[action.dataset.action];
      if (!calls?.[0]) return showToast('请在桌面软件中操作');
      const [call, done, failed] = calls;
      action.disabled = true;
      Promise.resolve(call())
        .then((result) => { const message = done(result); if (message) showToast(message); })
        .catch((error) => showToast(`${failed}：${error?.message || '未知原因'}`))
        .finally(() => { action.disabled = false; });
      return;
    }
    const nav = event.target.closest('[data-view]');
    if (nav) {
      document.querySelectorAll('.nav button').forEach((button) => button.classList.toggle('active', button === nav));
      document.querySelectorAll('.view').forEach((view) => view.classList.toggle('active', view.id === `${nav.dataset.view}View`));
      return;
    }
    const summary = event.target.closest('.provider-summary');
    if (summary) {
      // Toggle classes in place so the drawer can animate; a full re-render would snap it open.
      const id = summary.closest('.provider').dataset.provider;
      expandedProvider = expandedProvider === id ? null : id;
      document.querySelectorAll('#providerList .provider').forEach((item) => {
        const open = item.dataset.provider === expandedProvider;
        item.classList.toggle('open', open);
        item.querySelector('.provider-summary').setAttribute('aria-expanded', String(open));
      });
    }
    const filter = event.target.closest('[data-filter]');
    if (filter) { modelFilter = filter.dataset.filter; renderModels(); }
  });
  $('#agentChoices').addEventListener('change', event => {
    const input = event.target;
    if (input.matches('input[type="checkbox"]')) input.checked ? selectedAgents.add(input.value) : selectedAgents.delete(input.value);
  });

  $('#modelSearch').addEventListener('input', renderModels);
  $('#aboutBtn').addEventListener('click', async () => {
    $('#aboutDialog').showModal();
    try {
      const info = await window.quotaDeck?.openSettings?.();
      $('#appVersion').textContent = info ? `QuotaDeck ${info.version}` : '浏览器预览 · 版本信息请在桌面软件查看';
    } catch { $('#appVersion').textContent = '版本信息暂不可用'; }
  });
  $('#hideBtn').addEventListener('click', () => {
    if (!window.quotaDeck?.hide) return showToast('请在桌面软件中使用托盘');
    window.quotaDeck.hide().catch(() => showToast('隐藏失败，请重试'));
  });
  $('#refreshBtn').addEventListener('click', async () => {
    if (!window.quotaDeck) return showToast('请在桌面软件中使用');
    $('#refreshBtn').disabled = true;
    try { snapshot = await window.quotaDeck.refreshAll(); renderAll(); showToast(snapshot.globalStatus); }
    catch (error) { showToast(error.message || '刷新失败'); }
    finally { $('#refreshBtn').disabled = false; }
  });

  $('#runCollabBtn').addEventListener('click', async () => {
    const task = $('#collabTask').value.trim();
    const agents = [...selectedAgents].filter(id => snapshot?.agents?.[id] === true);
    if (!task) return showToast('请输入共同任务');
    if (agents.length < 2) return showToast('请选择至少两个 Agent');
    if (!window.quotaDeck?.runCollaboration) return showToast('请在桌面软件中运行');
    const button = $('#runCollabBtn');
    button.disabled = true;
    runningCollaboration = true;
    renderAgentChoices();
    button.textContent = 'Agent 并行执行中…';
    $('#collabResults').innerHTML = '<div class="empty">正在分工；完成前请保持网络连接。</div>';
    try {
      const result = await window.quotaDeck.runCollaboration({ task, agents });
      $('#collabResults').innerHTML = result.results.map((item) => `<article class="result"><h3>${escapeHtml(item.id)} · ${item.status === 'done' ? '完成' : '失败'}</h3><pre>${escapeHtml(item.output || item.error)}</pre></article>`).join('');
    } catch (error) {
      $('#collabResults').innerHTML = `<div class="empty">${escapeHtml(error.message || '协作失败')}</div>`;
    } finally {
      button.disabled = false;
      runningCollaboration = false;
      renderAgentChoices();
      button.textContent = '开始并行协作';
    }
  });

  if (window.quotaDeck) {
    window.quotaDeck.onCollaborationState?.(renderCollaborationState);
    window.quotaDeck.collaborationState?.().then(renderCollaborationState).catch(() => showToast('协作状态读取失败，请重新加载界面'));
    window.quotaDeck.onSnapshot((value) => { snapshot = value; renderAll(); });
    window.quotaDeck.refreshAll().then((value) => { snapshot = value; renderAll(); }).catch((error) => { $('#providerList').innerHTML = `<div class="empty">${escapeHtml(error.message)}</div>`; });
  } else {
    fetch('/snapshot').then((response) => response.json()).then((value) => { snapshot = value; renderAll(); }).catch(() => {
      $('#providerList').innerHTML = '<div class="empty">请打开桌面软件读取真实额度。</div>';
    });
  }
})();
