import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { PAGE_FILES } from '../src/lib/pages.js';

const dir = new URL('../pages/', import.meta.url);

test('pages: every page file is loaded and holds its tab', () => {
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.html')).map((f) => f.slice(0, -5));
  assert.deepEqual([...files].sort(), [...PAGE_FILES].sort());
  for (const name of PAGE_FILES) {
    const html = fs.readFileSync(new URL(`${name}.html`, dir), 'utf8');
    assert.match(html, new RegExp(`<div id="tab-${name}" class="tab`), name);
  }
});

test('pages: no id is used twice across the shell and the pages', () => {
  const sources = ['../index.html', ...PAGE_FILES.map((n) => `../pages/${n}.html`)];
  const seen = new Map();
  for (const src of sources) {
    for (const [, id] of fs.readFileSync(new URL(src, import.meta.url), 'utf8').matchAll(/\sid="([^"]+)"/g)) {
      assert.ok(!seen.has(id), `${id} in ${src} and ${seen.get(id)}`);
      seen.set(id, src);
    }
  }
});
