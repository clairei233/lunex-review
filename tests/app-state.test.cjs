const test = require('node:test');
const assert = require('node:assert/strict');
const State = require('../app-state.js');

test('exports the composer state API', () => {
  assert.equal(typeof State.createDefaultState, 'function');
  assert.equal(typeof State.migrateLegacyState, 'function');
  assert.equal(typeof State.stepBlock, 'function');
  assert.equal(typeof State.filterResults, 'function');
});

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

test('selects an exact catalog file for one block and marks it seen', () => {
  const state = State.createDefaultState(items, categories);
  const next = State.selectBlockFile(state, state.blocks[0].id, items[2].file, items);
  assert.equal(next.blocks[0].file, items[2].file);
  assert.equal(next.activeBlockId, state.blocks[0].id);
  assert.deepEqual(next.seen, [items[2].file]);
});

test('inserts a custom page after the active block and permits duplicate files', () => {
  let state = State.createDefaultState(items, categories);
  state = State.insertBlock(state, items[0].file, 'custom-1');
  state = State.insertBlock(state, items[0].file, 'custom-2');
  assert.deepEqual(state.blocks.filter(x => x.kind === 'custom').map(x => x.file), [items[0].file, items[0].file]);
});

test('moves blocks and never removes the final block', () => {
  let state = State.createDefaultState(items, categories);
  const first = state.blocks[0].id;
  state = State.moveBlock(state, first, 1);
  assert.equal(state.blocks[1].id, first);
  state = {...state, blocks:[state.blocks[0]]};
  assert.equal(State.removeBlock(state, state.blocks[0].id).blocks.length, 1);
});

test('moves a dragged block to an exact index without losing blocks', () => {
  const state = State.createDefaultState(items, categories);
  const lastId = state.blocks.at(-1).id;
  const next = State.moveBlockTo(state, lastId, 0);
  assert.equal(next.blocks[0].id, lastId);
  assert.deepEqual(new Set(next.blocks.map(x => x.id)), new Set(state.blocks.map(x => x.id)));
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
