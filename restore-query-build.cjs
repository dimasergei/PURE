'use strict';

const fs = require('node:fs');
const path = require('node:path');

// The shared header, footer, age gate, shopping cart and asset URLs come from
// the finished baseline page. Its client-side router owns elements named
// ap-main. Query results instead navigate through ordinary server GET forms.
function buildQueries(out, site) {
  const source = fs.readFileSync(path.join(out, 'shop.html'), 'utf8');
  const main = /<main\b[^>]*\bid=["']ap-main["'][^>]*>[\s\S]*?<\/main>/i;
  if (!main.test(source)) throw new Error('Shop shell is missing the catalog main element.');
  if (!site?.origin || !site?.currency?.base) throw new Error('Catalog site facts are unavailable.');
  const queryShell = source
    .replace(main, '<main id="pure-query-main"><!-- public-catalog-results --></main>')
    .replace(/href=(["'])#ap-main\1/g, 'href="#pure-query-main"')
    .replace('</head>', '<link rel="stylesheet" href="/catalog-query.css"><noscript><style>[data-pc-enhance]{display:none!important}</style></noscript></head>')
    .replace('</body>', '<script src="/catalog-query.js" defer></script></body>');
  fs.writeFileSync(path.join(__dirname, 'lib/public-catalog-shell.html'), queryShell);
  for (const file of ['catalog-query.css', 'catalog-query.js']) {
    fs.copyFileSync(path.join(__dirname, file), path.join(out, file));
  }
}
module.exports = {buildQueries};
