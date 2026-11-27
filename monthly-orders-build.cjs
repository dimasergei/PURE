'use strict';

const fs = require('node:fs');
const path = require('node:path');

const output = 'public-build';
const shell = fs.readFileSync(path.join(output, 'shop.html'), 'utf8');
const page = fs.readFileSync('monthly-orders.html', 'utf8');
const shopMain = /<main id="ap-main">[\s\S]*?<\/main>/;
const monthlyMain = page.match(/<main id="monthly-main"[^>]*>[\s\S]*?<\/main>/)?.[0];
const title = page.match(/<title>[\s\S]*?<\/title>/)?.[0];
const privatePage = page.match(/<meta name="robots"[^>]*>/)?.[0];
const styles = [...page.matchAll(/<link rel="stylesheet"[^>]*>/g)].map(([tag]) => tag).join('');
const scripts = [...page.matchAll(/<script defer src="\/[^"]+"><\/script>/g)].map(([tag]) => tag).join('');

if (!shopMain.test(shell) || !monthlyMain || !title || !privatePage || !styles || !scripts) {
  throw Error('Monthly checkout or the shared storefront shell is incomplete.');
}

const html = shell
  .replace(/<title>[\s\S]*?<\/title>/, title)
  .replace(/<meta name="description"[^>]*>/, '<meta name="description" content="Manage your subscription and review your Subscribe &amp; Save deliveries at PURE.">')
  .replace(/<meta property="og:[^"]+"[^>]*>/g, '')
  .replace(/<link rel="canonical"[^>]*>/, '')
  .replace('href="#ap-main"', 'href="#monthly-main"')
  .replace(shopMain, () => monthlyMain)
  .replace('</head>', privatePage + styles + '</head>')
  .replace('</body>', scripts + '</body>');

fs.writeFileSync(path.join(output, 'monthly-orders.html'), html);
