'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {test} = require('node:test');
const {JSDOM} = require('jsdom');
const {buildLearnPages, getPublishedGuides} = require('../scripts/editorial-guides.cjs');

const site = {name: 'PURE', origin: 'https://getpurelabs.com'};

test('a reviewed release has static guide pages, source links, and no draft or purchase paths', t => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'pure-editorial-'));
  t.after(() => fs.rmSync(out, {recursive: true, force: true}));
  const published = getPublishedGuides();
  const draft = {slug: 'private-guide', status: 'draft', title: 'Unpublished draft'};
  const stale = path.join(out, 'learn', draft.slug + '.html');
  fs.mkdirSync(path.dirname(stale), {recursive: true});
  fs.writeFileSync(stale, 'Stale draft output');
  buildLearnPages(out, site, [...published, draft]);

  assert.equal(fs.existsSync(stale), false);
  assert.ok(fs.existsSync(path.join(out, 'learn.css')));
  const hub = new JSDOM(fs.readFileSync(path.join(out, 'learn.html'), 'utf8'));
  assert.deepEqual([...hub.window.document.querySelectorAll('main li a')].map(a => a.getAttribute('href')),
    published.map(guide => '/learn/' + guide.slug));
  hub.window.close();

  for (const guide of published) {
    const {window} = new JSDOM(fs.readFileSync(path.join(out, 'learn', guide.slug + '.html'), 'utf8'));
    const doc = window.document;
    assert.equal(doc.querySelector('link[rel="canonical"]').href, site.origin + '/learn/' + guide.slug);
    assert.equal(doc.querySelectorAll('h1').length, 1);
    assert.equal(doc.querySelector('h1').textContent, guide.title);
    assert.equal(doc.querySelector('body script'), null);
    assert.equal(doc.querySelector('a[href^="/shop"], a[href^="/product"], a[href^="/coas"], a[href^="/cart"]'), null);
    for (const link of doc.querySelectorAll('.learn-contents a')) assert.ok(doc.querySelector(link.hash));
    assert.deepEqual([...doc.querySelectorAll('.learn-references a')].map(a => a.getAttribute('href')),
      guide.sources.map(source => source.url));
    assert.doesNotMatch(doc.body.textContent, /Unpublished draft/);
    window.close();
  }
});

test('the editorial build rejects accidental publication and invalid citations', () => {
  const [approved] = getPublishedGuides();
  assert.throws(() => getPublishedGuides([{...approved, status: 'pending'}]), /publication status/);
  assert.throws(() => getPublishedGuides([approved, {...approved, status: 'draft'}]), /duplicate guide slug/);
  assert.throws(() => getPublishedGuides([{...approved, sources: [{title: 'Invalid', url: 'javascript:alert(1)'}]}]), /HTTPS source/);
  assert.throws(() => getPublishedGuides([{...approved, publishedOn: '2026-02-30'}]), /publication or review date/);
});
