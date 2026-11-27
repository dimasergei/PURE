'use strict';

const fs = require('node:fs');
const path = require('node:path');
const guideManifest = require('../data/editorial-guides.json');

const entities = {'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'};
const escapeHtml = value => String(value).replace(/[&<>"']/g, character => entities[character]);
const isText = value => typeof value === 'string' && value.trim().length > 0;
const isSlug = value => typeof value === 'string' && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value);
const isDate = value => /^\d{4}-\d{2}-\d{2}$/.test(value) &&
  Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
const dateLabel = new Intl.DateTimeFormat('en', {dateStyle: 'long', timeZone: 'UTC'});

function getPublishedGuides(manifest = guideManifest) {
  const slugs = new Set();
  const published = [];
  for (const guide of manifest) {
    if (!isSlug(guide.slug) || slugs.has(guide.slug)) throw new Error('Invalid or duplicate guide slug: ' + guide.slug);
    slugs.add(guide.slug);
    if (guide.status === 'draft') continue;
    if (guide.status !== 'published') throw new Error('Invalid publication status for ' + guide.slug);
    if (![guide.title, guide.description, guide.seoTitle, guide.seoDescription].every(isText)) {
      throw new Error('Missing guide metadata for ' + guide.slug);
    }
    if ([guide.publishedOn, guide.reviewedOn].some(value => value != null && !isDate(value))) {
      throw new Error('Invalid publication or review date for ' + guide.slug);
    }
    if (!Array.isArray(guide.sections) || !guide.sections.length || guide.sections.some(section =>
      !isText(section.heading) || !Array.isArray(section.paragraphs) || !section.paragraphs.length ||
      !section.paragraphs.every(isText))) {
      throw new Error('Missing guide sections for ' + guide.slug);
    }
    if (!Array.isArray(guide.sources) || !guide.sources.length || guide.sources.some(source => {
      if (!isText(source.title) || !isText(source.url)) return true;
      try {
        const url = new URL(source.url);
        return url.protocol !== 'https:' || Boolean(url.username || url.password);
      } catch {
        return true;
      }
    })) {
      throw new Error('Invalid or missing HTTPS source for ' + guide.slug);
    }
    published.push(guide);
  }
  return published;
}

function learnLayout({title, description, canonical, article, content}, site) {
  const brand = escapeHtml(site.name);
  return `<!doctype html>
<html lang="en">
<head>
 <meta charset="utf-8">
 <meta name="viewport" content="width=device-width, initial-scale=1">
 <title>${escapeHtml(title)} | ${brand}</title>
 <meta name="description" content="${escapeHtml(description)}">
 <link rel="canonical" href="${escapeHtml(canonical)}">
 <link rel="icon" href="/favicon-pure.svg" type="image/svg+xml">
 <meta name="theme-color" content="#ffffff">
 <link rel="stylesheet" href="/learn.css?v=1">
</head>
<body>
 <a class="learn-skip" href="#pure-learn-main">Skip to content</a>
 <header class="learn-banner">
  <div class="learn-wrap learn-banner-inner">
   <a href="/learn" aria-label="${brand} research guides"><img src="/assets/pure-wordmark.svg" alt="" width="104" height="24"></a>
   <nav aria-label="Research guide navigation"><a href="/learn"${article ? '' : ' aria-current="page"'}>Research guides</a></nav>
  </div>
 </header>
 <main id="pure-learn-main" class="learn-wrap" aria-labelledby="learn-title" tabindex="-1">${content}</main>
 <footer class="learn-footer"><div class="learn-wrap"><span>${brand}</span> <a href="/corrections-policy">Corrections policy</a></div></footer>
</body>
</html>
`;
}

function renderIndex(guides) {
  const links = guides.map(guide => `
   <li><h2><a href="/learn/${guide.slug}">${escapeHtml(guide.title)}</a></h2>
    <p>${escapeHtml(guide.description)}</p></li>`).join('');
  return `
  <div class="learn-intro">
   <h1 id="learn-title">Research documentation guides</h1>
   <p>Read laboratory reports, compare measurements and keep traceable records.</p>
  </div>
  <ul class="learn-guide-list">${links}
  </ul>`;
}

function renderGuide(guide, guides) {
  const sectionLinks = guide.sections.map(({heading}, index) =>
    `<li><a href="#section-${index + 1}">${escapeHtml(heading)}</a></li>`).join('');
  const sections = guide.sections.map(({heading, paragraphs}, index) =>
    `<section aria-labelledby="section-${index + 1}">
    <h2 id="section-${index + 1}">${escapeHtml(heading)}</h2>
    ${paragraphs.map(paragraph => '<p>' + escapeHtml(paragraph) + '</p>').join('\n    ')}
   </section>`).join('\n   ');
  const sources = guide.sources.map(({title, url}) =>
    `<li><a href="${escapeHtml(url)}">${escapeHtml(title)}</a></li>`).join('');
  const related = guides.filter(other => other !== guide).slice(0, 3).map(other =>
    `<li><a href="/learn/${other.slug}">${escapeHtml(other.title)}</a></li>`).join('');
  const dates = [
    ['Published', guide.publishedOn],
    ['Reviewed', guide.reviewedOn]
  ].filter(([, date]) => date).map(([label, date]) =>
    `<p class="learn-date">${label} <time datetime="${date}">${dateLabel.format(Date.parse(date))}</time></p>`).join('');
  return `
  <article>
   <header class="learn-intro">
    <h1 id="learn-title">${escapeHtml(guide.title)}</h1>
    <p>${escapeHtml(guide.description)}</p>
    ${dates}
   </header>
   <nav class="learn-contents" aria-labelledby="learn-contents-title">
    <h2 id="learn-contents-title">On this page</h2><ol>${sectionLinks}</ol>
   </nav>
   ${sections}
   <section class="learn-references" aria-labelledby="learn-references">
    <h2 id="learn-references">Sources</h2><ul>${sources}</ul>
   </section>
  </article>
  ${related ? '<nav class="learn-related" aria-labelledby="learn-related"><h2 id="learn-related">Related guides</h2><ul>' +
    related + '</ul></nav>' : ''}`;
}

function buildLearnPages(out, site, manifest = guideManifest) {
  const guides = getPublishedGuides(manifest);
  const root = path.join(out, 'learn');
  fs.mkdirSync(root, {recursive: true});
  const expected = new Set(guides.map(guide => guide.slug + '.html'));
  for (const file of fs.readdirSync(root, {withFileTypes: true})) {
    if (file.isFile() && file.name.endsWith('.html') && !expected.has(file.name)) fs.unlinkSync(path.join(root, file.name));
  }
  fs.copyFileSync(path.join(__dirname, '..', 'learn.css'), path.join(out, 'learn.css'));
  fs.writeFileSync(path.join(out, 'learn.html'), learnLayout({
    title: 'Laboratory Documentation Guides',
    description: 'Read PURE guides to certificates of analysis, reported purity, storage documentation and research recordkeeping.',
    canonical: new URL('/learn', site.origin).href,
    article: false,
    content: renderIndex(guides)
  }, site));
  for (const guide of guides) {
    fs.writeFileSync(path.join(root, guide.slug + '.html'), learnLayout({
      title: guide.seoTitle, description: guide.seoDescription,
      canonical: new URL('/learn/' + guide.slug, site.origin).href,
      article: true,
      content: renderGuide(guide, guides)
    }, site));
  }
}

module.exports = {buildLearnPages, getPublishedGuides};
