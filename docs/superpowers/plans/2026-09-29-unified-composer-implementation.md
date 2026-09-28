# LUNEX Unified Composer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the separate library, composer, and slideshow screens with one sortable composer that supports unrestricted image stepping, inserted pages, category-aware randomization, inline cloud likes, and filtered review results.

**Architecture:** Move the embedded asset catalog into `app-data.js`, and put all deterministic composer, migration, progress, and result-filter behavior in a DOM-free UMD module named `app-state.js`. Keep browser rendering, drag-and-drop, local persistence, and Supabase calls in `app.js`; reduce `index.html` to markup and CSS. Test the state module with Node's built-in test runner before wiring the browser UI.

**Tech Stack:** Static HTML/CSS, browser JavaScript, Node.js `node:test`, native HTML drag-and-drop, Local Storage, Supabase JS v2, GitHub Pages.

---

## File map

- Create `app-data.js`: the existing 154-item asset list, category order, and category labels.
- Create `app-state.js`: pure state creation, migration, stepping, insertion, removal, movement, randomization, seen tracking, filtering, and sorting.
- Create `app.js`: DOM rendering, event delegation, drag-and-drop, persistence, Supabase authentication, likes, and realtime refresh.
- Create `tests/app-state.test.cjs`: deterministic state and filter tests using small fixtures.
- Modify `index.html`: two-screen markup, composer controls, drawer filters, result filters, responsive styles, and script loading.
- Preserve `supabase-config.js`: current public Supabase URL and publishable key.

### Task 1: Extract the catalog and establish a testable state module

**Files:**
- Create: `app-data.js`
- Create: `app-state.js`
- Create: `tests/app-state.test.cjs`
- Modify: `index.html`

- [ ] **Step 1: Write the failing module smoke test**

Create `tests/app-state.test.cjs`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const State = require('../app-state.js');

test('exports the composer state API', () => {
  assert.equal(typeof State.createDefaultState, 'function');
  assert.equal(typeof State.migrateLegacyState, 'function');
  assert.equal(typeof State.stepBlock, 'function');
  assert.equal(typeof State.filterResults, 'function');
});
```

- [ ] **Step 2: Run the smoke test and verify RED**

Run: `node --test tests/app-state.test.cjs`

Expected: FAIL because `app-state.js` does not exist.

- [ ] **Step 3: Add the UMD module shell**

Create `app-state.js`:

```js
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.LunexState = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  function createDefaultState() {}
  function migrateLegacyState() {}
  function stepBlock() {}
  function filterResults() {}
  return { createDefaultState, migrateLegacyState, stepBlock, filterResults };
});
```

- [ ] **Step 4: Move catalog data without changing its values**

Use `apply_patch` to cut the complete existing `const all=[...]` declaration from `index.html` and paste it unchanged after the opening line below. Do the same for `categoryOrder` and `categoryNames`; do not regenerate or retype the 154 records. Add the wrapper lines shown here around those three declarations:

```js
(function (root) {
  // The existing all, categoryOrder, and categoryNames declarations sit here unchanged.
  root.LUNEX_DATA = { all, categoryOrder, categoryNames };
})(globalThis);
```

Load scripts at the end of `index.html` in this exact order:

```html
<script src="supabase-config.js"></script>
<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
<script src="app-data.js"></script>
<script src="app-state.js"></script>
<script src="app.js"></script>
```

- [ ] **Step 5: Verify the extracted catalog and module shell**

Run:

```powershell
node --test tests/app-state.test.cjs
node -e "globalThis.window=globalThis; require('./app-data.js'); if(LUNEX_DATA.all.length!==154) process.exit(1); console.log(LUNEX_DATA.all.length)"
```

Expected: test PASS and catalog output `154`.

- [ ] **Step 6: Commit the extraction**

```powershell
git add app-data.js app-state.js tests/app-state.test.cjs index.html
git commit -m "refactor: extract LUNEX catalog and state module"
```

### Task 2: Implement composer state, legacy migration, and seen progress with TDD

**Files:**
- Modify: `app-state.js`
- Modify: `tests/app-state.test.cjs`

- [ ] **Step 1: Add failing tests for defaults and legacy migration**

Append fixtures and tests:

```js
const items = [
  {file:'01-hero/a.png', category:'01-hero', version:'1'},
  {file:'01-hero/b.png', category:'01-hero', version:'2'},
  {file:'02-product/c.png', category:'02-product', version:'1'},
  {file:'02-product/d.png', category:'02-product', version:'2'}
];
const categories = ['01-hero', '02-product'];

test('creates one newest default block per category', () => {
  const state = State.createDefaultState(items, categories);
  assert.deepEqual(state.blocks.map(x => [x.sourceCategory, x.file, x.kind]), [
    ['01-hero', '01-hero/b.png', 'default'],
    ['02-product', '02-product/d.png', 'default']
  ]);
});

test('migrates valid legacy selections and recovers invalid ones', () => {
  const state = State.migrateLegacyState(
    {'01-hero':'01-hero/a.png', '02-product':'missing.png'}, items, categories
  );
  assert.deepEqual(state.blocks.map(x => x.file), ['01-hero/a.png', '02-product/d.png']);
});
```

- [ ] **Step 2: Run tests and verify RED**

Run: `node --test tests/app-state.test.cjs`

Expected: FAIL because the shell functions return `undefined`.

- [ ] **Step 3: Implement normalized version-2 state**

Implement these exact state fields and helpers in `app-state.js`:

```js
const STATE_VERSION = 2;
const newestFor = (items, category) => items
  .filter(x => x.category === category)
  .sort((a, b) => Number(b.version) - Number(a.version))[0];
const makeId = (category, index) => `${category}-${index + 1}`;

function createDefaultState(items, categories) {
  return {
    version: STATE_VERSION,
    blocks: categories.map((category, index) => ({
      id: makeId(category, index), kind: 'default', sourceCategory: category,
      file: newestFor(items, category).file
    })),
    activeBlockId: makeId(categories[0], 0),
    seen: [],
    resultFilters: {category:'all', version:'all', likeStatus:'all', sort:'likes-desc'}
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
```

Export `STATE_VERSION` alongside the functions.

- [ ] **Step 4: Run tests and verify GREEN**

Run: `node --test tests/app-state.test.cjs`

Expected: all tests PASS.

- [ ] **Step 5: Add failing tests for unrestricted stepping and seen de-duplication**

```js
test('steps across the complete catalog and wraps in both directions', () => {
  let state = State.createDefaultState(items, categories);
  state.blocks[0].file = items[0].file;
  state = State.stepBlock(state, state.blocks[0].id, 1, items);
  assert.equal(state.blocks[0].file, items[1].file);
  state = State.stepBlock(state, state.blocks[0].id, 3, items);
  assert.equal(state.blocks[0].file, items[0].file);
  state = State.stepBlock(state, state.blocks[0].id, -1, items);
  assert.equal(state.blocks[0].file, items[3].file);
});

test('marks viewed files once', () => {
  let state = State.createDefaultState(items, categories);
  state = State.markSeen(state, items[0].file);
  state = State.markSeen(state, items[0].file);
  assert.deepEqual(state.seen, [items[0].file]);
});
```

- [ ] **Step 6: Run tests and verify RED**

Expected: FAIL because `markSeen` is not exported and `stepBlock` is not implemented.

- [ ] **Step 7: Implement immutable stepping and seen tracking**

```js
const clone = state => JSON.parse(JSON.stringify(state));

function markSeen(state, file) {
  const next = clone(state);
  if (!next.seen.includes(file)) next.seen.push(file);
  return next;
}

function stepBlock(state, blockId, delta, items) {
  const next = clone(state);
  const block = next.blocks.find(x => x.id === blockId);
  if (!block || !items.length) return next;
  const current = Math.max(0, items.findIndex(x => x.file === block.file));
  block.file = items[(current + delta % items.length + items.length) % items.length].file;
  next.activeBlockId = blockId;
  return markSeen(next, block.file);
}
```

- [ ] **Step 8: Run all state tests and commit**

Run: `node --test tests/app-state.test.cjs`

Expected: all tests PASS.

```powershell
git add app-state.js tests/app-state.test.cjs
git commit -m "feat: add composer state migration and image stepping"
```

### Task 3: Implement insertion, deletion, ordering, and category-aware randomization with TDD

**Files:**
- Modify: `app-state.js`
- Modify: `tests/app-state.test.cjs`

- [ ] **Step 1: Add failing structure-editing tests**

```js
test('inserts a custom page after the active block and permits duplicate files', () => {
  let state = State.createDefaultState(items, categories);
  state = State.insertBlock(state, items[0].file, 'custom-1');
  state = State.insertBlock(state, items[0].file, 'custom-2');
  assert.deepEqual(state.blocks.slice(1, 3).map(x => [x.kind, x.file]), [
    ['custom', items[0].file], ['custom', items[0].file]
  ]);
});

test('moves blocks and never removes the final block', () => {
  let state = State.createDefaultState(items, categories);
  const first = state.blocks[0].id;
  state = State.moveBlock(state, first, 1);
  assert.equal(state.blocks[1].id, first);
  state = {...state, blocks:[state.blocks[0]]};
  assert.equal(State.removeBlock(state, state.blocks[0].id).blocks.length, 1);
});

test('randomizes defaults inside source category without touching custom pages or order', () => {
  let state = State.createDefaultState(items, categories);
  state = State.insertBlock(state, items[0].file, 'custom-1');
  const beforeOrder = state.blocks.map(x => x.id);
  const customFile = state.blocks.find(x => x.kind === 'custom').file;
  state = State.randomizeDefaults(state, items, () => 0);
  assert.deepEqual(state.blocks.map(x => x.id), beforeOrder);
  assert.equal(state.blocks.find(x => x.kind === 'custom').file, customFile);
  state.blocks.filter(x => x.kind === 'default').forEach(block => {
    assert.equal(items.find(x => x.file === block.file).category, block.sourceCategory);
  });
});
```

- [ ] **Step 2: Run tests and verify RED**

Expected: FAIL because the four editing functions do not exist.

- [ ] **Step 3: Implement the four editing functions**

Implement and export:

```js
function insertBlock(state, file, id) {
  const next = clone(state);
  const at = Math.max(0, next.blocks.findIndex(x => x.id === next.activeBlockId));
  const item = {id, kind:'custom', sourceCategory:null, file};
  next.blocks.splice(at + 1, 0, item);
  next.activeBlockId = id;
  return markSeen(next, file);
}

function removeBlock(state, id) {
  const next = clone(state);
  if (next.blocks.length === 1) return next;
  const at = next.blocks.findIndex(x => x.id === id);
  if (at < 0) return next;
  next.blocks.splice(at, 1);
  next.activeBlockId = next.blocks[Math.min(at, next.blocks.length - 1)].id;
  return next;
}

function moveBlock(state, id, delta) {
  const next = clone(state);
  const from = next.blocks.findIndex(x => x.id === id);
  const to = Math.max(0, Math.min(next.blocks.length - 1, from + delta));
  if (from < 0 || from === to) return next;
  next.blocks.splice(to, 0, next.blocks.splice(from, 1)[0]);
  return next;
}

function randomizeDefaults(state, items, random = Math.random) {
  const next = clone(state);
  next.blocks.filter(x => x.kind === 'default').forEach(block => {
    const choices = items.filter(item => item.category === block.sourceCategory);
    block.file = choices[Math.floor(random() * choices.length)].file;
  });
  return next;
}
```

- [ ] **Step 4: Add and test the direct-index drag helper**

Append this test:

```js
test('moves a dragged block to an exact index without losing blocks', () => {
  const state = State.createDefaultState(items, categories);
  const lastId = state.blocks.at(-1).id;
  const next = State.moveBlockTo(state, lastId, 0);
  assert.equal(next.blocks[0].id, lastId);
  assert.deepEqual(new Set(next.blocks.map(x => x.id)), new Set(state.blocks.map(x => x.id)));
});
```

Implement and export:

```js
function moveBlockTo(state, id, targetIndex) {
  const next = clone(state);
  const from = next.blocks.findIndex(x => x.id === id);
  if (from < 0) return next;
  const [block] = next.blocks.splice(from, 1);
  const to = Math.max(0, Math.min(next.blocks.length, targetIndex));
  next.blocks.splice(to, 0, block);
  return next;
}
```

Run: `node --test tests/app-state.test.cjs`

Expected: all tests PASS.

- [ ] **Step 5: Commit structure editing**

```powershell
git add app-state.js tests/app-state.test.cjs
git commit -m "feat: add sortable custom pages and random composer"
```

### Task 4: Implement result filtering and state recovery with TDD

**Files:**
- Modify: `app-state.js`
- Modify: `tests/app-state.test.cjs`

- [ ] **Step 1: Add failing result-filter tests**

```js
const counts = new Map([
  ['01-hero/a.png', 3], ['01-hero/b.png', 0],
  ['02-product/c.png', 1], ['02-product/d.png', 3]
]);
const mine = new Set(['02-product/c.png']);

test('combines category, version, and my-like filters', () => {
  const filtered = State.filterResults(items, counts, mine, {
    category:'02-product', version:'1', likeStatus:'mine', sort:'likes-desc'
  });
  assert.deepEqual(filtered.map(x => x.file), ['02-product/c.png']);
});

test('supports zero-vote and all four sorts', () => {
  const zero = State.filterResults(items, counts, mine, {
    category:'all', version:'all', likeStatus:'zero', sort:'version-asc'
  });
  assert.deepEqual(zero.map(x => x.file), ['01-hero/b.png']);
  const least = State.filterResults(items, counts, mine, {
    category:'all', version:'all', likeStatus:'all', sort:'likes-asc'
  });
  assert.equal(least[0].file, '01-hero/b.png');
});
```

- [ ] **Step 2: Run tests and verify RED**

Expected: FAIL because `filterResults` is still empty.

- [ ] **Step 3: Implement composable filtering and deterministic sorting**

Implement `filterResults` so it adds `like_count`, applies category and version first, then applies `positive`, `mine`, or `zero`, then sorts using these comparators:

```js
const sorters = {
  'likes-desc': (a,b) => b.like_count-a.like_count || Number(b.version)-Number(a.version) || a.file.localeCompare(b.file),
  'likes-asc': (a,b) => a.like_count-b.like_count || Number(a.version)-Number(b.version) || a.file.localeCompare(b.file),
  'version-desc': (a,b) => Number(b.version)-Number(a.version) || a.file.localeCompare(b.file),
  'version-asc': (a,b) => Number(a.version)-Number(b.version) || a.file.localeCompare(b.file)
};

function filterResults(items, counts, mine, filters) {
  const filtered = items.map(item => ({...item, like_count: counts.get(item.file) || 0}))
    .filter(item => filters.category === 'all' || item.category === filters.category)
    .filter(item => filters.version === 'all' || String(item.version) === filters.version)
    .filter(item => filters.likeStatus === 'all'
      || (filters.likeStatus === 'positive' && item.like_count > 0)
      || (filters.likeStatus === 'mine' && mine.has(item.file))
      || (filters.likeStatus === 'zero' && item.like_count === 0));
  return filtered.sort(sorters[filters.sort] || sorters['likes-desc']);
}
```

- [ ] **Step 4: Add and pass recovery tests**

Add this representative recovery test:

```js
test('normalizes invalid files, duplicate ids, seen entries, and filters', () => {
  const candidate = {
    version: 2,
    blocks: [
      {id:'same', kind:'default', sourceCategory:'01-hero', file:'missing.png'},
      {id:'same', kind:'custom', sourceCategory:null, file:'02-product/c.png'},
      {id:'bad', kind:'custom', sourceCategory:null, file:'missing.png'}
    ],
    activeBlockId: 'missing-id', seen:['01-hero/a.png', 'missing.png'],
    resultFilters:{category:'bogus', version:'999', likeStatus:'bogus', sort:'bogus'}
  };
  const state = State.normalizeState(candidate, items, categories);
  assert.equal(state.blocks[0].file, '01-hero/b.png');
  assert.equal(state.blocks.length, 2);
  assert.equal(new Set(state.blocks.map(x => x.id)).size, 2);
  assert.equal(state.activeBlockId, state.blocks[0].id);
  assert.deepEqual(state.seen, ['01-hero/a.png']);
  assert.deepEqual(state.resultFilters, {
    category:'all', version:'all', likeStatus:'all', sort:'likes-desc'
  });
});
```

Implement and export `normalizeState(candidate, items, categories)`. Start from `createDefaultState`, accept only blocks whose `kind` is `default` or `custom`, recover an invalid default file with `newestFor(items, sourceCategory)`, discard a custom block whose file is absent, suffix duplicate IDs with `-2`, `-3`, and so on, keep only valid seen files, whitelist filter values, and choose the first block when the active ID is missing. If no candidate block survives, return the complete default state.

Run: `node --test tests/app-state.test.cjs`

Expected: all tests PASS with no warnings.

- [ ] **Step 5: Commit result logic and recovery**

```powershell
git add app-state.js tests/app-state.test.cjs
git commit -m "feat: add result filters and resilient state recovery"
```

### Task 5: Build the unified composer and filtered results UI

**Files:**
- Create: `app.js`
- Modify: `index.html`

- [ ] **Step 1: Replace the four-view header and body with two screens**

Use these stable IDs in `index.html`:

```html
<header>
  <div class="brand">LUNEX SECTION LIBRARY</div>
  <div class="header-tools">
    <div class="view-switch">
      <button id="showComposer" class="active">拼装</button>
      <button id="showResults">评审结果</button>
    </div>
    <div class="cloud-state" id="cloudStatus">正在连接云端评审…</div>
  </div>
</header>

<section id="composerView">
  <aside class="composer-nav">
    <button id="addCustomPage">＋ 自选页</button>
    <button id="randomizeComposer">🎲 随机拼装</button>
    <button id="restoreDefaults">恢复默认</button>
    <p id="seenProgress"></p>
  </aside>
  <main class="composer-main">
    <div class="composer-frame" id="composerCanvas"></div>
  </main>
</section>

<section id="resultsView" hidden>
  <div class="results-filters">
    <select id="resultCategory"></select>
    <select id="resultVersion"></select>
    <select id="resultLikeStatus">
      <option value="all">全部点赞状态</option>
      <option value="positive">有人点赞</option>
      <option value="mine">我点赞的</option>
      <option value="zero">零票</option>
    </select>
    <select id="resultSort">
      <option value="likes-desc">点赞最多</option>
      <option value="likes-asc">点赞最少</option>
      <option value="version-desc">版本新到旧</option>
      <option value="version-asc">版本旧到新</option>
    </select>
    <button id="clearResultFilters">清除筛选</button>
  </div>
  <p id="resultSummary"></p>
  <div class="ranking-grid" id="resultGrid"></div>
  <div id="resultEmpty" hidden>没有符合条件的图片。<button>清除筛选</button></div>
</section>

<aside id="assetDrawer" class="asset-drawer" aria-hidden="true">
  <div class="drawer-head"><h2 id="drawerTitle"></h2><button id="closeDrawer">×</button></div>
  <div class="drawer-filters"><select id="drawerCategory"></select><select id="drawerVersion"></select></div>
  <div class="drawer-grid" id="drawerGrid"></div>
</aside>
```

- [ ] **Step 2: Add composer styling and responsive behavior**

Retain the existing dark visual language. Define `.composer-section` as `position:relative`, `.section-toolbar` as a sticky/overlay flex row revealed by hover, focus-within, or `.active`, `.dragging` at `opacity:.45`, and `.drop-before`/`.drop-after` with orange insertion lines. At `max-width:780px`, keep the toolbar visible, allow it to wrap, turn the left controls into a horizontal sticky strip, and make the drawer a bottom sheet.

- [ ] **Step 3: Load, migrate, normalize, and save version-2 state in `app.js`**

Use these keys:

```js
const STATE_KEY = 'lunex-composer-state-v2';
const LEGACY_COMPOSER_KEY = 'lunex-homepage-composer-v1';
const LEGACY_REVIEW_KEY = 'lunex-review-progress-v1';
```

Load `STATE_KEY`; when absent, migrate `LEGACY_COMPOSER_KEY`, then merge valid `seen` values from `LEGACY_REVIEW_KEY`. Pass every loaded value through `LunexState.normalizeState`. Persist after every state change with `localStorage.setItem(STATE_KEY, JSON.stringify(state))` inside `try/catch`.

- [ ] **Step 4: Render actionable blocks through event delegation**

Each block must render with `data-block-id`, `draggable="true"`, an image, metadata, and buttons with `data-action` values `prev`, `like`, `next`, `up`, `down`, `insert`, and `remove`. Clicking the section sets `activeBlockId`. Actions call the corresponding `LunexState` function, save, and re-render. The like button uses the block's current file and displays `♥ 已点赞 · N` or `♡ 点赞 · N`.

- [ ] **Step 5: Implement the shared asset drawer**

Track `drawerMode` as either `replace` or `insert`. `replace` updates the active block file; `insert` calls `insertBlock` with an ID generated from `crypto.randomUUID()` when available and a timestamp/random fallback otherwise. Drawer category and version filters operate on all 154 items. Selecting a drawer item marks it seen, saves, renders, and closes the drawer.

- [ ] **Step 6: Implement random, reset, and drag interactions**

`randomizeComposer` calls `randomizeDefaults`; `restoreDefaults` replaces state blocks with `createDefaultState(...).blocks` but preserves `seen` and `resultFilters`. Native drag events store the dragged block ID, calculate the target block index, call `moveBlockTo`, save, and render. Dragging does not alter images or likes.

- [ ] **Step 7: Implement results controls and return-to-composer behavior**

All four controls write to `state.resultFilters`, save, and call `renderResults`. Render the output of `filterResults`. Summary text uses `筛选结果 N 张 · 最高 M 票`. Clicking a result card sets the recently active block's image, marks it seen, saves, switches to composer mode, renders, and scrolls the active section into view.

- [ ] **Step 8: Run static checks before cloud wiring**

Run:

```powershell
node --check app-data.js
node --check app-state.js
node --check app.js
node --test tests/app-state.test.cjs
```

Expected: syntax checks exit `0`; all state tests PASS.

- [ ] **Step 9: Commit the unified local UI**

```powershell
git add index.html app.js
git commit -m "feat: unify browsing and review in sortable composer"
```

### Task 6: Preserve cloud likes, verify the browser, and deploy

**Files:**
- Modify: `app.js`
- Modify: `index.html` only if browser validation exposes a UI defect

- [ ] **Step 1: Reconnect existing Supabase behavior to block likes**

Keep anonymous `getSession`/`signInAnonymously`, `lunex_like_counts`, current-user `image_likes`, and the `postgres_changes` subscription. Replace `toggleLike()`'s dependency on `currentReviewItem()` with `toggleLike(file)`. During cloud loading, disable every `[data-action="like"]`; after reload, render both composer and results. Do not change `supabase-config.js` or database schema.

- [ ] **Step 2: Run the complete automated suite**

Run:

```powershell
node --check app-data.js
node --check app-state.js
node --check app.js
node --test tests/app-state.test.cjs
git diff --check
```

Expected: every command exits `0`, all tests PASS, and `git diff --check` prints nothing.

- [ ] **Step 3: Serve and verify the desktop workflow in a real browser**

Run a local static server from the repository root. Verify visibly:

1. header contains only `拼装` and `评审结果`;
2. seven default blocks render in order;
3. next/previous crosses category boundaries and wraps;
4. inserting a selected existing asset places it after the active block;
5. drag, up, down, and delete persist after reload;
6. randomization changes only default blocks within their source category;
7. likes update and `云端评审已连接 · 实时同步` appears;
8. all four result filters combine correctly;
9. a result card returns to and updates the active composer block.

- [ ] **Step 4: Verify the narrow-screen workflow**

Set the browser viewport near `390×844`. Verify the toolbar remains usable without hover, the control strip scrolls horizontally, the drawer opens as a bottom sheet, blocks preserve full image width, and results become one column.

- [ ] **Step 5: Commit browser fixes and final implementation**

```powershell
git add index.html app.js app-state.js app-data.js tests/app-state.test.cjs
git commit -m "fix: finish responsive cloud review workflow"
```

If Step 3 and Step 4 require no changes, do not create an empty commit.

- [ ] **Step 6: Push and verify GitHub Pages**

```powershell
git push origin main
```

Wait for the Pages build to report `built`, then verify:

```powershell
(Invoke-WebRequest 'https://clairei233.github.io/lunex-review/' -UseBasicParsing).StatusCode
(Invoke-WebRequest 'https://clairei233.github.io/lunex-review/app.js' -UseBasicParsing).StatusCode
(Invoke-WebRequest 'https://clairei233.github.io/lunex-review/01-hero/v01-hero.png' -Method Head -UseBasicParsing).StatusCode
```

Expected: `200`, `200`, `200`. Open the public site and verify the cloud status text is connected and the two-screen UI is present.

## Final acceptance checklist

- Only two main views remain.
- Every block can step through all 154 images.
- Custom pages use existing assets and can be inserted between default sections.
- All blocks are reorderable and removable while one always remains.
- Randomization respects default source categories and preserves custom pages/order.
- Seen progress is de-duplicated and local.
- Likes remain realtime and cloud-synchronized.
- Results combine category, version, like-status, and sorting filters.
- Existing local selections and seen progress migrate without deleting old keys.
- Automated, desktop, narrow-screen, public-site, asset, and cloud checks pass.
