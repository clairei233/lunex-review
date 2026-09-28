(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.LunexState = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const STATE_VERSION = 2;
  const defaultFilters = () => ({category:'all', version:'all', likeStatus:'all', sort:'likes-desc'});
  const newestFor = (items, category) => items
    .filter(item => item.category === category)
    .sort((a, b) => Number(b.version) - Number(a.version))[0];
  const makeId = (category, index) => `${category}-${index + 1}`;

  function createDefaultState(items, categories) {
    return {
      version: STATE_VERSION,
      blocks: categories.map((category, index) => ({
        id: makeId(category, index),
        kind: 'default',
        sourceCategory: category,
        file: newestFor(items, category).file
      })),
      activeBlockId: makeId(categories[0], 0),
      seen: [],
      resultFilters: defaultFilters()
    };
  }

  function migrateLegacyState(legacy, items, categories) {
    const state = createDefaultState(items, categories);
    state.blocks.forEach(block => {
      const candidate = legacy && legacy[block.sourceCategory];
      if (items.some(item => item.category === block.sourceCategory && item.file === candidate)) {
        block.file = candidate;
      }
    });
    return state;
  }
  const clone = state => JSON.parse(JSON.stringify(state));

  function markSeen(state, file) {
    const next = clone(state);
    if (!next.seen.includes(file)) next.seen.push(file);
    return next;
  }

  function selectBlockFile(state, blockId, file, items) {
    const next = clone(state);
    const block = next.blocks.find(item => item.id === blockId);
    if (!block || !items.some(item => item.file === file)) return next;
    block.file = file;
    next.activeBlockId = blockId;
    return markSeen(next, file);
  }

  function stepBlock(state, blockId, delta, items) {
    const block = state.blocks.find(item => item.id === blockId);
    if (!block || !items.length) return clone(state);
    const current = Math.max(0, items.findIndex(item => item.file === block.file));
    const index = (current + (delta % items.length) + items.length) % items.length;
    return selectBlockFile(state, blockId, items[index].file, items);
  }

  function insertBlock(state, file, id) {
    const next = clone(state);
    const activeIndex = next.blocks.findIndex(item => item.id === next.activeBlockId);
    const at = activeIndex < 0 ? next.blocks.length : activeIndex + 1;
    next.blocks.splice(at, 0, {id, kind:'custom', sourceCategory:null, file});
    next.activeBlockId = id;
    return markSeen(next, file);
  }

  function removeBlock(state, id) {
    const next = clone(state);
    if (next.blocks.length <= 1) return next;
    const at = next.blocks.findIndex(item => item.id === id);
    if (at < 0) return next;
    next.blocks.splice(at, 1);
    next.activeBlockId = next.blocks[Math.min(at, next.blocks.length - 1)].id;
    return next;
  }

  function moveBlock(state, id, delta) {
    const from = state.blocks.findIndex(item => item.id === id);
    if (from < 0) return clone(state);
    return moveBlockTo(state, id, from + delta);
  }

  function moveBlockTo(state, id, targetIndex) {
    const next = clone(state);
    const from = next.blocks.findIndex(item => item.id === id);
    if (from < 0) return next;
    const [block] = next.blocks.splice(from, 1);
    const to = Math.max(0, Math.min(next.blocks.length, targetIndex));
    next.blocks.splice(to, 0, block);
    return next;
  }

  function dropIndex(fromIndex, targetIndex, placeAfter) {
    let index = targetIndex + (placeAfter ? 1 : 0);
    if (fromIndex < index) index -= 1;
    return Math.max(0, index);
  }

  function randomizeDefaults(state, items, random = Math.random) {
    const next = clone(state);
    next.blocks.filter(block => block.kind === 'default').forEach(block => {
      const choices = items.filter(item => item.category === block.sourceCategory);
      if (choices.length) block.file = choices[Math.floor(random() * choices.length)].file;
    });
    return next;
  }

  const sorters = {
    'likes-desc': (a,b) => b.like_count-a.like_count || Number(b.version)-Number(a.version) || a.file.localeCompare(b.file),
    'likes-asc': (a,b) => a.like_count-b.like_count || Number(a.version)-Number(b.version) || a.file.localeCompare(b.file),
    'version-desc': (a,b) => Number(b.version)-Number(a.version) || a.file.localeCompare(b.file),
    'version-asc': (a,b) => Number(a.version)-Number(b.version) || a.file.localeCompare(b.file)
  };

  function filterResults(items, counts, mine, filters) {
    return items.map(item => ({...item, like_count: counts.get(item.file) || 0}))
      .filter(item => filters.category === 'all' || item.category === filters.category)
      .filter(item => filters.version === 'all' || String(item.version) === String(filters.version))
      .filter(item => filters.likeStatus === 'all'
        || (filters.likeStatus === 'positive' && item.like_count > 0)
        || (filters.likeStatus === 'mine' && mine.has(item.file))
        || (filters.likeStatus === 'zero' && item.like_count === 0))
      .sort(sorters[filters.sort] || sorters['likes-desc']);
  }

  function normalizeState(candidate, items, categories) {
    const fallback = createDefaultState(items, categories);
    if (!candidate || typeof candidate !== 'object' || !Array.isArray(candidate.blocks)) return fallback;
    const files = new Set(items.map(item => item.file));
    const ids = new Map();
    const uniqueId = raw => {
      const base = String(raw || 'block');
      const count = (ids.get(base) || 0) + 1;
      ids.set(base, count);
      return count === 1 ? base : `${base}-${count}`;
    };
    const blocks = [];
    candidate.blocks.forEach((block, index) => {
      if (!block || !['default', 'custom'].includes(block.kind)) return;
      if (block.kind === 'custom') {
        if (!files.has(block.file)) return;
        blocks.push({id:uniqueId(block.id), kind:'custom', sourceCategory:null, file:block.file});
        return;
      }
      if (!categories.includes(block.sourceCategory)) return;
      const replacement = newestFor(items, block.sourceCategory);
      if (!replacement) return;
      const validFile = files.has(block.file);
      blocks.push({
        id:uniqueId(block.id || makeId(block.sourceCategory, index)),
        kind:'default', sourceCategory:block.sourceCategory,
        file:validFile ? block.file : replacement.file
      });
    });
    if (!blocks.length) return fallback;
    const validIds = new Set(blocks.map(block => block.id));
    const validCategories = new Set(['all', ...categories]);
    const validVersions = new Set(['all', ...items.map(item => String(item.version))]);
    const candidateFilters = candidate.resultFilters || {};
    return {
      version: STATE_VERSION,
      blocks,
      activeBlockId: validIds.has(candidate.activeBlockId) ? candidate.activeBlockId : blocks[0].id,
      seen: [...new Set(Array.isArray(candidate.seen) ? candidate.seen.filter(file => files.has(file)) : [])],
      resultFilters: {
        category: validCategories.has(candidateFilters.category) ? candidateFilters.category : 'all',
        version: validVersions.has(String(candidateFilters.version)) ? String(candidateFilters.version) : 'all',
        likeStatus: ['all','positive','mine','zero'].includes(candidateFilters.likeStatus) ? candidateFilters.likeStatus : 'all',
        sort: Object.hasOwn(sorters, candidateFilters.sort) ? candidateFilters.sort : 'likes-desc'
      }
    };
  }

  return {
    STATE_VERSION, createDefaultState, migrateLegacyState, normalizeState,
    markSeen, selectBlockFile, stepBlock, insertBlock, removeBlock, moveBlock,
    moveBlockTo, dropIndex, randomizeDefaults, filterResults
  };
});
