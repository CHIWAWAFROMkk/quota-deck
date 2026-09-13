(function () {
  'use strict';

  let snapshot = null;
  let expandedProvider = 'antigravity';
  let modelFilter = 'all';

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
    return `下降 ${rate.toFixed(2)}% / 小时`;
  }

  function modelNamesForPool(provider, poolName) {
    return provider.models.filter((model) => model.pool === poolName).map((model) => model.name);
  }

  function renderPools(provider) {
    if (provider.pools?.length) {
      return provider.pools.map((pool) => {
        const names = modelNamesForPool(provider, pool.name);
        return `<section class="pool">
          <div class="pool-head"><strong>${escapeHtml(pool.name)}</strong><span>${pool.modelCount} 个模型共享</span></div>
          ${pool.windows.map((window) => `<div class="window-row">
            <span>${escapeHtml(window.label)}</span>
            <div class="bar" aria-hidden="true"><i style="width:${Math.max(0, Math.min(100, window.remainingPercent))}%"></i></div>
            <span class="window-value">${window.remainingPercent.toFixed(1)}%</span>
          </div><div class="burn">${escapeHtml(burnText(window.burnPerHour))} · ${escapeHtml(window.reset)}</div>`).join('')}
          <details class="model-names"><summary>查看 ${names.length} 个模型</summary>${escapeHtml(names.join('、'))}</details>
        </section>`;
      }).join('');
    }

    const pools = new Map();
    for (const model of provider.models || []) {
      if (!pools.has(model.pool)) pools.set(model.pool, []);
      pools.get(model.pool).push(model);
    }
    return [...pools.entries()].map(([name, models]) => `<section class="pool">
      <div class="pool-head"><strong>${escapeHtml(name)}</strong><span>${models.length} 个模型共享</span></div>
      <div class="window-row"><span>剩余</span><div class="bar"><i style="width:${models[0]?.percent || 0}%"></i></div><span class="window-value">${escapeHtml(models[0]?.val || '未知')}</span></div>
      <details class="model-names"><summary>查看模型</summary>${escapeHtml(models.map((model) => model.name).join('、'))}</details>
    </section>`).join('');
  }

  function renderEfficiency(provider) {
    const ranked = [...(provider.models || [])].filter((model) => Number.isFinite(model.consumeMultiplier)).sort((a, b) => a.consumeMultiplier - b.consumeMultiplier);
    if (!ranked.length) return '';
    return `<div class="efficiency">
      <div class="eff-row head"><span>模型</span><span>消耗</span><span>相对可用</span></div>
      ${ranked.map((model) => {
        const free = model.consumeMultiplier === 0;
        const capacity = free ? '∞' : `${(1 / model.consumeMultiplier).toFixed(1)}×`;
        return `<div class="eff-row"><strong title="${escapeHtml(model.name)}">${escapeHtml(model.name)}</strong><span class="${free || model.consumeMultiplier <= .1 ? 'speed-good' : ''}">${free ? '免费' : `${model.consumeMultiplier.toFixed(2)}×`}</span><span>${capacity}</span></div>`;
      }).join('')}
    </div>`;
  }

  function renderProvider(provider) {
    const open = provider.id === expandedProvider;
    const usefulBody = provider.id === 'workbuddy' ? renderEfficiency(provider) : renderPools(provider);
    return `<article class="provider ${open ? 'open' : ''}" data-provider="${provider.id}">
      <button class="provider-summary" type="button" aria-expanded="${open}">
        <div><span class="provider-name"><i class="dot ${provider.status}"></i>${escapeHtml(provider.name)}</span><span class="provider-plan">${escapeHtml(provider.plan)}</span></div>
        <div class="quota-main"><strong>${escapeHtml(provider.quotaHero)}</strong><span>${escapeHtml(provider.quotaSub)}</span></div>
        <span class="chevron">⌄</span>
      </button>
      <div class="provider-body">${usefulBody || `<div class="empty">${escapeHtml(provider.sharedNotice || '暂无可用数据')}</div>`}<p class="source-note">${escapeHtml(provider.sharedNotice || '')}</p></div>
    </article>`;
  }

  function renderQuota() {
    $('#providerList').innerHTML = snapshot?.providers?.map(renderProvider).join('') || '<div class="empty">未读取到数据</div>';
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
      return `<article class="model-row"><div><h3>${escapeHtml(model.name)} · ${escapeHtml(model.providerName)}</h3><p>${escapeHtml((model.strengths || []).join('、'))} · ${escapeHtml(model.guidanceSource)}</p></div><div class="model-metric"><strong>${escapeHtml(main)}</strong><span>${escapeHtml(sub)}</span></div></article>`;
    }).join('') || '<div class="empty">没有匹配模型</div>';
  }

  function renderAgentChoices() {
    const names = { codex: 'Codex', antigravity: 'Antigravity', workbuddy: 'WorkBuddy' };
    $('#agentChoices').innerHTML = Object.entries(names).map(([id, name]) => {
      const provider = snapshot?.providers?.find((item) => item.id === id);
      const ready = provider && !['disconnected', 'error'].includes(provider.status);
      return `<label class="agent-choice"><input type="checkbox" value="${id}" ${ready ? 'checked' : 'disabled'}><strong>${name}</strong><span>${ready ? '可调用' : '未连接'}</span></label>`;
    }).join('');
  }

  function renderAll() {
    if (!snapshot) return;
    $('#syncMeta').textContent = `${snapshot.globalStatus} · ${snapshot.lastUpdated} 更新`;
    renderQuota();
    renderModels();
    renderAgentChoices();
  }

  document.addEventListener('click', (event) => {
    const nav = event.target.closest('[data-view]');
    if (nav) {
      document.querySelectorAll('.nav button').forEach((button) => button.classList.toggle('active', button === nav));
      document.querySelectorAll('.view').forEach((view) => view.classList.toggle('active', view.id === `${nav.dataset.view}View`));
      return;
    }
    const summary = event.target.closest('.provider-summary');
    if (summary) {
      const id = summary.closest('.provider').dataset.provider;
      expandedProvider = expandedProvider === id ? null : id;
      renderQuota();
    }
    const filter = event.target.closest('[data-filter]');
    if (filter) { modelFilter = filter.dataset.filter; renderModels(); }
  });

  $('#modelSearch').addEventListener('input', renderModels);
  $('#refreshBtn').addEventListener('click', async () => {
    if (!window.quotaDeck) return showToast('请在桌面软件中使用');
    $('#refreshBtn').disabled = true;
    try { snapshot = await window.quotaDeck.refreshAll(); renderAll(); showToast('额度已更新'); }
    catch (error) { showToast(error.message || '刷新失败'); }
    finally { $('#refreshBtn').disabled = false; }
  });

  $('#runCollabBtn').addEventListener('click', async () => {
    const task = $('#collabTask').value.trim();
    const agents = [...document.querySelectorAll('#agentChoices input:checked')].map((input) => input.value);
    if (!window.quotaDeck?.runCollaboration) return showToast('请在桌面软件中运行');
    const button = $('#runCollabBtn');
    button.disabled = true;
    button.textContent = 'Agent 并行执行中…';
    $('#collabResults').innerHTML = '<div class="empty">正在分工；完成前请保持网络连接。</div>';
    try {
      const result = await window.quotaDeck.runCollaboration({ task, agents });
      $('#collabResults').innerHTML = result.results.map((item) => `<article class="result"><h3>${escapeHtml(item.id)} · ${item.status === 'done' ? '完成' : '失败'}</h3><pre>${escapeHtml(item.output || item.error)}</pre></article>`).join('');
    } catch (error) {
      $('#collabResults').innerHTML = `<div class="empty">${escapeHtml(error.message || '协作失败')}</div>`;
    } finally {
      button.disabled = false;
      button.textContent = '开始并行协作';
    }
  });

  if (window.quotaDeck) {
    window.quotaDeck.onSnapshot((value) => { snapshot = value; renderAll(); });
    window.quotaDeck.refreshAll().then((value) => { snapshot = value; renderAll(); }).catch((error) => { $('#providerList').innerHTML = `<div class="empty">${escapeHtml(error.message)}</div>`; });
  } else {
    fetch('/snapshot').then((response) => response.json()).then((value) => { snapshot = value; renderAll(); }).catch(() => {
      $('#providerList').innerHTML = '<div class="empty">请打开桌面软件读取真实额度。</div>';
    });
  }
})();
