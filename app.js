(() => {
  'use strict';

  const {all, categoryOrder, categoryNames} = window.LUNEX_DATA;
  const S = window.LunexState;
  const STATE_KEY = 'lunex-composer-state-v2';
  const LEGACY_COMPOSER_KEY = 'lunex-homepage-composer-v1';
  const LEGACY_REVIEW_KEY = 'lunex-review-progress-v1';
  const byId = id => document.getElementById(id);
  const itemByFile = new Map(all.map(item => [item.file, item]));
  const versions = [...new Map(all.map(item => [String(item.version), item.version_name]))];

  let state = loadState();
  let mode = 'composer';
  let drawerMode = 'replace';
  let drawerCategory = 'all';
  let drawerVersion = 'all';
  let draggedBlockId = null;
  let cloudClient = null;
  let cloudConnected = false;
  let cloudLoading = false;
  let currentUserLikes = new Set();
  let likeCounts = new Map();
  let realtimeChannel = null;
  let realtimeTimer = null;
  let toastTimer = null;

  function parseStorage(key, fallback) {
    try { return JSON.parse(localStorage.getItem(key) || JSON.stringify(fallback)); }
    catch { return fallback; }
  }

  function loadState() {
    const saved = parseStorage(STATE_KEY, null);
    if (saved) return S.normalizeState(saved, all, categoryOrder);
    const legacyComposer = parseStorage(LEGACY_COMPOSER_KEY, {});
    const migrated = S.migrateLegacyState(legacyComposer, all, categoryOrder);
    const legacyReview = parseStorage(LEGACY_REVIEW_KEY, {});
    if (Array.isArray(legacyReview.seen)) migrated.seen = legacyReview.seen;
    return S.normalizeState(migrated, all, categoryOrder);
  }

  function saveState() {
    try { localStorage.setItem(STATE_KEY, JSON.stringify(state)); }
    catch { showToast('浏览器无法保存当前拼装'); }
  }

  function updateState(next, render = true) {
    state = S.normalizeState(next, all, categoryOrder);
    saveState();
    if (render) renderAll();
  }

  function activeBlock() {
    return state.blocks.find(block => block.id === state.activeBlockId) || state.blocks[0];
  }

  function newBlockId() {
    return window.crypto?.randomUUID?.() || `custom-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>"]/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[char]));
  }

  function showToast(message) {
    const toast = byId('toast');
    toast.textContent = message;
    toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove('show'), 1800);
  }

  function setCloudStatus(kind, message) {
    const status = byId('cloudStatus');
    status.className = `cloud-state ${kind}`;
    status.textContent = message;
  }

  function renderComposer() {
    const canvas = byId('composerCanvas');
    canvas.innerHTML = state.blocks.map((block, index) => {
      const item = itemByFile.get(block.file);
      if (!item) return '';
      const liked = currentUserLikes.has(item.file);
      const likes = likeCounts.get(item.file) || 0;
      const active = block.id === state.activeBlockId ? ' active' : '';
      const removeDisabled = state.blocks.length === 1 ? ' disabled' : '';
      return `<section class="composer-section${active}" data-block-id="${escapeHtml(block.id)}" draggable="true" tabindex="0">
        <div class="section-toolbar">
          <button class="drag-handle" data-action="drag" title="拖动排序">↕</button>
          <div class="section-meta">${escapeHtml(item.category_name)} · V${String(item.version).padStart(2,'0')}<small>${escapeHtml(item.version_name)} · 第 ${all.findIndex(x => x.file === item.file)+1} / ${all.length} 张${block.kind === 'custom' ? ' · 自选页' : ''}</small></div>
          <button data-action="prev" title="上一张">‹</button>
          <button data-action="choose" title="打开全部素材">选图</button>
          <button class="like-button${liked?' liked':''}" data-action="like" ${!cloudConnected||cloudLoading?'disabled':''}>${liked?'♥ 已点赞':'♡ 点赞'} · ${likes}</button>
          <button data-action="next" title="下一张">›</button>
          <button data-action="up" ${index===0?'disabled':''} title="上移">↑</button>
          <button data-action="down" ${index===state.blocks.length-1?'disabled':''} title="下移">↓</button>
          <button data-action="insert" title="在后面插入自选页">＋</button>
          <button data-action="remove" ${removeDisabled} title="删除区块">×</button>
        </div>
        <img src="${escapeHtml(item.file)}" alt="${escapeHtml(item.category_name)} · ${escapeHtml(item.version_name)}">
      </section>`;
    }).join('');
    byId('seenProgress').textContent = `${state.seen.length} / ${all.length}`;
    byId('composerSummary').textContent = `${state.blocks.length} 个页面区块 · 可拖动排序`;
  }

  function renderResults() {
    const filtered = S.filterResults(all, likeCounts, currentUserLikes, state.resultFilters);
    byId('resultGrid').innerHTML = filtered.map(item => `<button class="rank-card" data-file="${escapeHtml(item.file)}">
      <img src="${escapeHtml(item.file)}" alt="${escapeHtml(item.category_name)} · ${escapeHtml(item.version_name)}">
      <span class="rank-meta"><span>${escapeHtml(item.category_name)} · V${String(item.version).padStart(2,'0')}<br>${escapeHtml(item.version_name)}</span><strong>♥ ${item.like_count}</strong></span>
    </button>`).join('');
    const highest = filtered.reduce((max, item) => Math.max(max, item.like_count), 0);
    byId('resultSummary').textContent = `筛选结果 ${filtered.length} 张 · 最高 ${highest} 票`;
    byId('resultEmpty').hidden = filtered.length > 0;
    byId('resultGrid').hidden = filtered.length === 0;
    byId('resultCategory').value = state.resultFilters.category;
    byId('resultVersion').value = state.resultFilters.version;
    byId('resultLikeStatus').value = state.resultFilters.likeStatus;
    byId('resultSort').value = state.resultFilters.sort;
  }

  function renderAll() {
    renderComposer();
    renderResults();
  }

  function setMode(nextMode) {
    mode = nextMode;
    byId('composerView').hidden = mode !== 'composer';
    byId('resultsView').hidden = mode !== 'results';
    byId('showComposer').classList.toggle('active', mode === 'composer');
    byId('showResults').classList.toggle('active', mode === 'results');
    closeDrawer();
    if (mode === 'results') renderResults(); else renderComposer();
    window.scrollTo({top:0, behavior:'smooth'});
  }

  function openDrawer(nextMode) {
    drawerMode = nextMode;
    const block = activeBlock();
    const item = itemByFile.get(block.file);
    drawerCategory = nextMode === 'insert' ? 'all' : 'all';
    drawerVersion = 'all';
    byId('drawerTitle').textContent = nextMode === 'insert' ? '选择要插入的自选页' : `替换当前区块 · ${item?.category_name || ''}`;
    byId('drawerCategory').value = drawerCategory;
    byId('drawerVersion').value = drawerVersion;
    renderDrawer();
    byId('assetDrawer').classList.add('open');
    byId('assetDrawer').setAttribute('aria-hidden','false');
  }

  function closeDrawer() {
    byId('assetDrawer').classList.remove('open');
    byId('assetDrawer').setAttribute('aria-hidden','true');
  }

  function renderDrawer() {
    const selectedFile = activeBlock()?.file;
    const items = all.filter(item => (drawerCategory === 'all' || item.category === drawerCategory)
      && (drawerVersion === 'all' || String(item.version) === drawerVersion));
    byId('drawerGrid').innerHTML = items.map(item => `<button class="asset-option${drawerMode==='replace'&&item.file===selectedFile?' selected':''}" data-file="${escapeHtml(item.file)}">
      <img src="${escapeHtml(item.file)}" alt=""><span><strong>${escapeHtml(item.category_name)} · V${String(item.version).padStart(2,'0')}</strong>${escapeHtml(item.version_name)}</span>
    </button>`).join('');
  }

  function chooseDrawerItem(file) {
    if (drawerMode === 'insert') updateState(S.insertBlock(state, file, newBlockId()));
    else updateState(S.selectBlockFile(state, activeBlock().id, file, all));
    closeDrawer();
    requestAnimationFrame(() => document.querySelector(`[data-block-id="${CSS.escape(state.activeBlockId)}"]`)?.scrollIntoView({behavior:'smooth',block:'center'}));
  }

  async function toggleLike(file) {
    if (!cloudClient || !cloudConnected || cloudLoading) return;
    cloudLoading = true;
    renderComposer();
    try {
      const result = currentUserLikes.has(file)
        ? await cloudClient.from('image_likes').delete().eq('image_key', file)
        : await cloudClient.from('image_likes').insert({image_key:file});
      if (result.error) throw result.error;
      await reloadCloudData();
    } catch {
      setCloudStatus('error','提交失败，请重试');
      showToast('点赞没有提交成功');
    } finally {
      cloudLoading = false;
      renderAll();
    }
  }

  async function reloadCloudData() {
    if (!cloudClient) return;
    cloudLoading = true;
    try {
      const [countsResult, likesResult] = await Promise.all([
        cloudClient.rpc('lunex_like_counts'),
        cloudClient.from('image_likes').select('image_key')
      ]);
      if (countsResult.error) throw countsResult.error;
      if (likesResult.error) throw likesResult.error;
      likeCounts = new Map((countsResult.data || []).map(row => [row.image_key, Number(row.like_count)]));
      currentUserLikes = new Set((likesResult.data || []).map(row => row.image_key));
      cloudConnected = true;
      setCloudStatus('connected','云端评审已连接 · 实时同步');
    } catch {
      cloudConnected = false;
      setCloudStatus('error','云端评审未连接 · 本地拼装仍可用');
    } finally {
      cloudLoading = false;
      renderAll();
    }
  }

  function subscribeRealtime() {
    realtimeChannel = cloudClient.channel('lunex-like-changes')
      .on('postgres_changes',{event:'*',schema:'public',table:'image_likes'},() => {
        clearTimeout(realtimeTimer);
        realtimeTimer = setTimeout(reloadCloudData, 400);
      })
      .subscribe(status => {
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          setCloudStatus('error','实时更新暂不可用 · 可继续本地拼装');
        }
      });
  }

  async function initCloudReview() {
    const config = window.LUNEX_SUPABASE || {};
    if (!config.url || !config.publishableKey || !window.supabase) {
      setCloudStatus('error','云端评审未配置 · 本地拼装仍可用');
      renderAll();
      return;
    }
    try {
      cloudClient = window.supabase.createClient(config.url, config.publishableKey);
      const sessionResult = await cloudClient.auth.getSession();
      if (sessionResult.error) throw sessionResult.error;
      if (!sessionResult.data.session) {
        const signInResult = await cloudClient.auth.signInAnonymously();
        if (signInResult.error) throw signInResult.error;
      }
      await reloadCloudData();
      subscribeRealtime();
    } catch {
      cloudClient = null;
      cloudConnected = false;
      setCloudStatus('error','云端评审连接失败 · 本地拼装仍可用');
      renderAll();
    }
  }

  function clearResultFilters() {
    const next = JSON.parse(JSON.stringify(state));
    next.resultFilters = {category:'all',version:'all',likeStatus:'all',sort:'likes-desc'};
    updateState(next);
  }

  function fillSelects() {
    const categoryOptions = `<option value="all">全部分类</option>${categoryOrder.map(key => `<option value="${key}">${categoryNames[key]}</option>`).join('')}`;
    const versionOptions = `<option value="all">全部版本</option>${versions.map(([value,name]) => `<option value="${value}">V${value.padStart(2,'0')} · ${escapeHtml(name)}</option>`).join('')}`;
    byId('drawerCategory').innerHTML = categoryOptions;
    byId('resultCategory').innerHTML = categoryOptions;
    byId('drawerVersion').innerHTML = versionOptions;
    byId('resultVersion').innerHTML = versionOptions;
  }

  byId('showComposer').addEventListener('click', () => setMode('composer'));
  byId('showResults').addEventListener('click', () => setMode('results'));
  byId('addCustomPage').addEventListener('click', () => openDrawer('insert'));
  byId('closeDrawer').addEventListener('click', closeDrawer);
  byId('randomizeComposer').addEventListener('click', () => {
    updateState(S.randomizeDefaults(state, all));
    showToast('已按区块类型随机拼装');
  });
  byId('restoreDefaults').addEventListener('click', () => {
    const defaults = S.createDefaultState(all, categoryOrder);
    defaults.seen = state.seen;
    defaults.resultFilters = state.resultFilters;
    updateState(defaults);
    showToast('已恢复七个默认区块');
  });

  byId('composerCanvas').addEventListener('click', event => {
    const section = event.target.closest('[data-block-id]');
    if (!section) return;
    const id = section.dataset.blockId;
    const action = event.target.closest('[data-action]')?.dataset.action;
    if (!action) {
      const next = JSON.parse(JSON.stringify(state));
      next.activeBlockId = id;
      updateState(next);
      return;
    }
    if (action === 'drag') return;
    const block = state.blocks.find(item => item.id === id);
    if (action === 'prev') updateState(S.stepBlock(state,id,-1,all));
    if (action === 'next') updateState(S.stepBlock(state,id,1,all));
    if (action === 'choose') { state.activeBlockId=id; saveState(); renderComposer(); openDrawer('replace'); }
    if (action === 'like') toggleLike(block.file);
    if (action === 'up') updateState(S.moveBlock(state,id,-1));
    if (action === 'down') updateState(S.moveBlock(state,id,1));
    if (action === 'insert') { state.activeBlockId=id; saveState(); renderComposer(); openDrawer('insert'); }
    if (action === 'remove') updateState(S.removeBlock(state,id));
  });

  byId('composerCanvas').addEventListener('dragstart', event => {
    const section = event.target.closest('[data-block-id]');
    if (!section) return;
    draggedBlockId = section.dataset.blockId;
    section.classList.add('dragging');
    event.dataTransfer.effectAllowed = 'move';
  });
  byId('composerCanvas').addEventListener('dragover', event => {
    const section = event.target.closest('[data-block-id]');
    if (!section || section.dataset.blockId === draggedBlockId) return;
    event.preventDefault();
    document.querySelectorAll('.drop-before,.drop-after').forEach(node => node.classList.remove('drop-before','drop-after'));
    const after = event.clientY > section.getBoundingClientRect().top + section.offsetHeight / 2;
    section.classList.add(after ? 'drop-after' : 'drop-before');
  });
  byId('composerCanvas').addEventListener('drop', event => {
    const target = event.target.closest('[data-block-id]');
    if (!target || !draggedBlockId) return;
    event.preventDefault();
    const fromIndex = state.blocks.findIndex(block => block.id === draggedBlockId);
    const targetIndex = state.blocks.findIndex(block => block.id === target.dataset.blockId);
    const after = target.classList.contains('drop-after');
    updateState(S.moveBlockTo(state, draggedBlockId, S.dropIndex(fromIndex, targetIndex, after)));
  });
  byId('composerCanvas').addEventListener('dragend', () => {
    draggedBlockId = null;
    document.querySelectorAll('.dragging,.drop-before,.drop-after').forEach(node => node.classList.remove('dragging','drop-before','drop-after'));
  });

  byId('drawerGrid').addEventListener('click', event => {
    const option = event.target.closest('[data-file]');
    if (option) chooseDrawerItem(option.dataset.file);
  });
  byId('drawerCategory').addEventListener('change', event => { drawerCategory=event.target.value; renderDrawer(); });
  byId('drawerVersion').addEventListener('change', event => { drawerVersion=event.target.value; renderDrawer(); });

  ['resultCategory','resultVersion','resultLikeStatus','resultSort'].forEach(id => {
    byId(id).addEventListener('change', event => {
      const key = {resultCategory:'category',resultVersion:'version',resultLikeStatus:'likeStatus',resultSort:'sort'}[id];
      const next = JSON.parse(JSON.stringify(state));
      next.resultFilters[key] = event.target.value;
      updateState(next);
    });
  });
  byId('clearResultFilters').addEventListener('click', clearResultFilters);
  byId('emptyClearFilters').addEventListener('click', clearResultFilters);
  byId('resultGrid').addEventListener('click', event => {
    const card = event.target.closest('[data-file]');
    if (!card) return;
    updateState(S.selectBlockFile(state, activeBlock().id, card.dataset.file, all), false);
    setMode('composer');
    requestAnimationFrame(() => document.querySelector(`[data-block-id="${CSS.escape(state.activeBlockId)}"]`)?.scrollIntoView({behavior:'smooth',block:'center'}));
  });
  document.addEventListener('keydown', event => { if (event.key === 'Escape') closeDrawer(); });

  fillSelects();
  saveState();
  renderAll();
  initCloudReview();
})();
