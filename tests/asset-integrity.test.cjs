const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');

function manifestRows() {
  const [header, ...lines] = fs.readFileSync(path.join(root, 'manifest.csv'), 'utf8').trim().split(/\r?\n/);
  const keys = header.split(',');
  return lines.map(line => Object.fromEntries(line.split(',').map((value, index) => [keys[index], value])));
}

test('known section boundaries do not include the neighboring section', () => {
  const rows = manifestRows();
  const find = (version, category) => rows.find(row => row.version === String(version) && row.category === category);
  assert.equal(find(8, '04-in-the-box').source_bottom, '1461');
  assert.equal(find(8, '05-purchase').source_top, '1461');
  assert.equal(find(15, '05-purchase').source_bottom, '1810');
  assert.equal(find(15, '06-benefits').source_top, '1810');
  assert.equal(find(8, '03-scenarios').source_bottom, '1150');
  assert.equal(find(8, '04-in-the-box').source_top, '1150');
  assert.equal(find(9, '05-purchase').source_top, '1580');
  assert.equal(find(6, '06-benefits'), undefined);
});

test('desktop section toolbar occupies layout space instead of covering artwork', () => {
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const rule = html.match(/\.section-toolbar\{([^}]*)\}/)?.[1] || '';
  assert.match(rule, /position:relative/);
  assert.doesNotMatch(rule, /position:absolute/);
});
