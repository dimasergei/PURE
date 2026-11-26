'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const pages = {
  '/': [
    'Research Compounds for Laboratories',
    'Explore PURE research-use-only compounds, compare sizes and prices, and review supplier laboratory reports before ordering.'
  ],
  '/shop': [
    'Research Compound Catalog',
    'Browse research-use-only compounds and supplies by size, category and price. Compare variants and prices, and find available supplier reports.'
  ],
  '/coas': [
    'Lab Testing & Certificates of Analysis',
    'Search supplier certificates of analysis by compound, lot, date or laboratory. Open each original report and check the sample details.'
  ],
  '/about': [
    'About PURE',
    'Learn about PURE’s research-use-only catalog, supplier documentation and ordering resources for laboratories.'
  ],
  '/contact': [
    'Contact Support',
    'Contact PURE about a research compound, supplier documentation, an order or delivery. Find support information and answers to common questions.'
  ],
  '/bulk-orders': [
    'Bulk Research Orders & Volume Pricing',
    'Compare volume pricing, select compounds and quantities, or ask about a bulk order for your laboratory.'
  ],
  '/subscribe-and-save': [
    'Subscribe & Save on Research Orders',
    'Review recurring order savings, delivery terms and available compounds. Build a monthly research order and manage eligible changes.'
  ],
  '/memberships': [
    'Membership Benefits & Terms',
    'Compare PURE membership benefits, prepaid terms and available savings for research orders. Manage your membership through your account.'
  ],
  '/partner-program': [
    'Partner Program',
    'Review partner eligibility and terms, apply to the PURE Partner Program and access your partner account.'
  ],
  '/gift-cards': [
    'Gift Cards',
    'Choose a PURE gift card for eligible research orders. Review available values, delivery information and redemption terms.'
  ],
  '/track-order': [
    'Track Your PURE Order',
    'Find shipment updates for a PURE order with the order details from your confirmation. Contact support if tracking is unavailable.'
  ],
  '/faq': [
    'Frequently Asked Questions',
    'Find answers about research-use-only orders, product documentation, account features, shipping policies and where to contact PURE support.'
  ],
  '/learn': [
    'Laboratory Documentation Guides',
    'Read PURE guides to certificates of analysis, reported purity, storage documentation and research recordkeeping.'
  ],
  '/learn/reading-a-coa': [
    'How to Read a Certificate of Analysis',
    'Identify a sample, laboratory, report date and reported results on a supplier certificate of analysis. Learn how to check a report against its source.'
  ],
  '/learn/understanding-purity-results': [
    'Understanding Reported Purity Results',
    'Read reported purity results in the context of the sample, method and limits stated on its laboratory certificate.'
  ],
  '/learn/storage-and-records': [
    'Storage Documentation and Laboratory Records',
    'Find product-specific storage documentation and record the source, identifier and conditions associated with a research material.'
  ],
  '/research-documentation': [
    'Research Documentation',
    'Find resources for checking research product identifiers, reviewing supplier-issued reports and requesting documentation from PURE.'
  ],
  '/commercial-terms': [
    'Commercial Order Terms',
    'Read the payment, ordering and fulfillment terms that apply to PURE research orders.'
  ],
  '/corrections-policy': [
    'Corrections Policy',
    'See how to report a potential error in PURE product information or documentation and how corrections are handled.'
  ],
  '/medical-disclaimer': [
    'Research Use and Medical Disclaimer',
    'Read the limitations on use for PURE laboratory research materials and the information published on this site.'
  ],
  '/membership-terms': [
    'Membership Terms',
    'Review the rules for PURE memberships, qualifying benefits and access to your membership account.'
  ],
  '/partner-terms': [
    'Partner Program Terms',
    'Read the eligibility, disclosure and participation terms for the PURE Partner Program.'
  ],
  '/payment-options': [
    'Payment Options for PURE Orders',
    'Review payment information for PURE research orders. Available methods and applicable currency are shown at checkout.'
  ],
  '/privacy-policy': [
    'Privacy Policy',
    'Learn how PURE handles information provided when you browse, contact support, create an account or place an order.'
  ],
  '/refund-policy': [
    'Returns and Refund Policy',
    'Read PURE’s published return and refund conditions and learn how to contact support about an order issue.'
  ],
  '/research-use-policy': [
    'Research Use Only Policy',
    'Review PURE’s research-use-only policy, purchaser eligibility and restrictions on the use of laboratory materials.'
  ],
  '/shipping-policy': [
    'Shipping and Delivery Policy',
    'Review shipping destinations, service availability, dispatch information and tracking details for PURE research orders.'
  ],
  '/shipping-protection': [
    'Shipping Protection Terms',
    'Read the conditions and claim process for optional shipping protection on eligible PURE orders.'
  ],
  '/terms-and-conditions': [
    'Website Terms and Conditions',
    'Read the terms for using PURE’s website, ordering research-use-only materials and accessing account features.'
  ],
  '/my-account': [
    'My Account',
    'Sign in to access your PURE order history, addresses, rewards, membership and recurring orders.'
  ],
  '/cart': [
    'Shopping Cart',
    'Review the products, selected sizes and quantities in your PURE cart before checkout.'
  ],
  '/checkout': ['Checkout', 'Review your PURE order and provide delivery details at checkout.'],
  '/bulk-orders/checkout': [
    'Bulk Order Checkout',
    'Review your volume-priced research order, enter delivery information and confirm the final total.'
  ],
  '/subscribe-and-save/checkout': [
    'Subscribe & Save Checkout',
    'Review the delivery schedule, selected products and billing terms for your recurring order.'
  ],
  '/monthly-orders': [
    'Manage Monthly Orders',
    'Sign in to view and manage your PURE monthly orders and eligible delivery changes.'
  ],
  '/spin-and-save': [
    'Spin & Save',
    'View the current availability and rules for the PURE Spin & Save promotion.'
  ],
  '/404': [
    'Page Not Found',
    'Find PURE research products, laboratory documentation or support after following an unavailable link.'
  ]
};

const specialFiles = {
  'index.html': '/',
  'account.html': '/my-account',
  'bulk-checkout.html': '/bulk-orders/checkout',
  'monthly-checkout.html': '/subscribe-and-save/checkout',
  'learn/index.html': '/learn'
};
const noindex = new Set([
  '/my-account',
  '/checkout',
  '/cart',
  '/404',
  '/spin-and-save',
  '/monthly-orders',
  '/bulk-orders/checkout',
  '/subscribe-and-save/checkout'
]);
const leaves = Object.keys(pages)
  .filter((p) => !noindex.has(p) && p !== '/')
  .map((p) => p.slice(1));
const htmlEsc = (value) =>
  String(value).replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]
  );
const jsonLD = (obj) =>
  '<script type="application/ld+json">' + JSON.stringify(obj).replace(/</g, '\\u003c') + '</script>';
const textOf = (e) => (e?.textContent || '').replace(/\s+/g, ' ').trim();

function pageUrl(file) {
  return specialFiles[file] || '/' + file.replace(/\/index\.html$/, '').replace(/\.html$/, '');
}

function cleanLink(value, origin) {
  if (!value || (!value.startsWith('/') && !value.startsWith(origin + '/'))) return value;
  const url = new URL(value, origin);
  if (url.origin !== origin) return value;
  const old = url.pathname;
  if (old === '/bulk-checkout.html') url.pathname = '/bulk-orders/checkout';
  else if (old === '/monthly-checkout.html') url.pathname = '/subscribe-and-save/checkout';
  else if (old === '/index.html' || old === '/storefront-v2.html') url.pathname = '/';
  else if (old === '/account' || old === '/account.html') url.pathname = '/my-account';
  else if (old === '/rewards' || old === '/rewards.html') url.pathname = '/my-account/points';
  else if (old === '/research-builder' || old === '/research-builder.html')
    url.pathname = '/subscribe-and-save';
  else if (old === '/research-checkout' || old === '/research-checkout.html') url.pathname = '/memberships';
  else if (old.endsWith('.html') && (leaves.includes(old.slice(1, -5)) || /^\/(?:product|learn)\//.test(old)))
    url.pathname = old.slice(0, -5);
  if (url.pathname === '/my-account' && /^#(?:rewards|rewards-and-credit)$/.test(url.hash)) {
    url.pathname = '/my-account/points';
    url.hash = '';
  }
  return value.startsWith(origin) ? url.href : url.pathname + url.search + url.hash;
}

function faqSchema(main, canonical) {
  const entries = new Map();
  for (const box of main?.querySelectorAll('details') || []) {
    const question = textOf(box.querySelector(':scope > summary'));
    if (!question.endsWith('?') || entries.has(question)) continue;
    const text = [...box.children]
      .filter((el) => el.tagName !== 'SUMMARY')
      .map(textOf)
      .filter(Boolean)
      .join(' ');
    if (text)
      entries.set(question, {
        '@type': 'Question',
        name: question,
        acceptedAnswer: { '@type': 'Answer', text }
      });
  }
  return entries.size
    ? { '@type': 'FAQPage', '@id': canonical + '#faq', mainEntity: [...entries.values()] }
    : null;
}

function breadcrumbs(url, title, origin) {
  const trail = [['Home', '/']];
  if (url.startsWith('/product/')) trail.push(['Research Catalog', '/shop']);
  if (url.startsWith('/learn/')) trail.push(['Laboratory Documentation Guides', '/learn']);
  trail.push([title, url]);
  return {
    '@type': 'BreadcrumbList',
    '@id': origin + url + '#breadcrumbs',
    itemListElement: trail.map(([name, p], i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name,
      item: origin + p
    }))
  };
}

function productData(main, fallback) {
  const candidate = main?.querySelector('img[src^="/"]')?.getAttribute('src');
  return candidate && /\.(?:webp|avif|png|jpe?g)(?:[?#]|$)/i.test(candidate) ? candidate : fallback;
}

function buildSEO(out, site) {
  const origin = new URL(site.origin).origin,
    brand = site.name;
  const artwork = '/assets/pure-packaging-studio.webp';
  const indexed = [];
  const files = fs.readdirSync(out, { recursive: true }).filter((f) => f.endsWith('.html'));
  for (const file of files) {
    const route = pageUrl(file);
    const isProduct = route.startsWith('/product/');
    if (!pages[route] && !isProduct) continue;
    const filename = path.join(out, file),
      source = fs.readFileSync(filename, 'utf8'),
      dom = new JSDOM(source);
    try {
      const d = dom.window.document,
        main = d.querySelector('main'),
        canonical = origin + route;
      const originalProduct = [...d.querySelectorAll('script[type="application/ld+json"]')]
        .flatMap((el) => {
          try {
            const value = JSON.parse(el.textContent);
            return Array.isArray(value) ? value : value['@graph'] || [value];
          } catch {
            return [];
          }
        })
        .find((v) => v['@type'] === 'Product');
      const singleOffer = originalProduct?.offers?.length === 1 && originalProduct.offers[0];
      const productName = isProduct
        ? singleOffer?.name || originalProduct?.name || textOf(main?.querySelector('h1'))
        : null;
      const [label, defaultDescription] = isProduct
        ? [
            productName,
            `View ${productName} pricing, supplier documentation and related products for laboratory research.`
          ]
        : pages[route];
      const partnerSummary =
        route === '/partner-program' && d.querySelector('meta[name="description"]')?.content;
      const description = partnerSummary && partnerSummary.length < 155 ? partnerSummary : defaultDescription;
      const title = label.endsWith(brand) ? label : label + ' | ' + brand;
      const socialImage = isProduct ? productData(main, artwork) : artwork;
      const srcUrl = new URL(socialImage, origin).href;
      const nodes = [];
      if (route === '/') {
        nodes.push({
          '@type': 'Organization',
          '@id': origin + '/#organization',
          name: brand,
          url: origin + '/',
          logo: origin + '/brand-logo.png',
          email: site.support.email
        });
        nodes.push({
          '@type': 'WebSite',
          '@id': origin + '/#website',
          name: brand,
          url: origin + '/',
          publisher: { '@id': origin + '/#organization' },
          potentialAction: {
            '@type': 'SearchAction',
            target: { '@type': 'EntryPoint', urlTemplate: origin + '/shop/browse?q={search_term_string}' },
            'query-input': 'required name=search_term_string'
          }
        });
      } else if (!noindex.has(route)) nodes.push(breadcrumbs(route, label, origin));
      if (route.startsWith('/learn/'))
        nodes.push({
          '@type': 'Article',
          '@id': canonical + '#article',
          headline: textOf(main?.querySelector('h1')) || label,
          description,
          url: canonical,
          mainEntityOfPage: canonical,
          publisher: { '@id': origin + '/#organization' }
        });
      if (originalProduct && isProduct)
        nodes.push({ ...originalProduct, '@id': canonical + '#product', url: canonical });
      const faq = faqSchema(main, canonical);
      if (faq && !noindex.has(route)) nodes.push(faq);
      const meta = (attr, key, val) => `<meta ${attr}="${htmlEsc(key)}" content="${htmlEsc(val)}">`;
      const tags = ['<title data-pure-page-title>' + htmlEsc(title) + '</title>', meta('name', 'description', description)];
      if (route !== '/404') tags.push('<link rel="canonical" href="' + htmlEsc(canonical) + '">');
      if (noindex.has(route)) tags.push(meta('name', 'robots', 'noindex, follow'));
      else indexed.push(route);
      for (const [key, val] of Object.entries({
        'og:title': title,
        'og:description': description,
        'og:type': isProduct ? 'product' : route.startsWith('/learn/') ? 'article' : 'website',
        'og:url': canonical,
        'og:site_name': brand,
        'og:image': srcUrl,
        'og:image:alt':
          socialImage === artwork
            ? 'Black PURE packaging on a white background'
            : productName + ' research product'
      }))
        tags.push(meta('property', key, val));
      for (const [key, val] of Object.entries({
        'twitter:card': 'summary_large_image',
        'twitter:title': title,
        'twitter:description': description,
        'twitter:image': srcUrl
      }))
        tags.push(meta('name', key, val));
      if (nodes.length) tags.push(jsonLD({ '@context': 'https://schema.org', '@graph': nodes }));
      const head = source.match(/<head\b[^>]*>([\s\S]*?)<\/head>/i);
      if (!head) throw Error('Missing head on ' + route);
      const clean = head[1]
        .replace(/<title\b[^>]*>[\s\S]*?<\/title>/gi, '')
        .replace(
          /<meta\b(?=[^>]*\s(?:name|property)\s*=\s*["'](?:description|robots|og:[^"']+|twitter:[^"']+)["'])[^>]*>/gi,
          ''
        )
        .replace(/<link\b(?=[^>]*\srel\s*=\s*["']canonical["'])[^>]*>/gi, '');
      // Existing structured data can appear in either the head or body.
      const schemaRE =
        /<script\b(?=[^>]*\stype\s*=\s*["']application\/ld\+json["'])[^>]*>[\s\S]*?<\/script>/gi;
      let result = source
        .replace(schemaRE, '')
        .replace(
          /<head\b[^>]*>[\s\S]*?<\/head>/i,
          () => '<head>' + clean.replace(schemaRE, '') + tags.join('') + '</head>'
        );
      // Leave scripts and inline templates intact. Only normalize actual hyperlink attributes.
      result = result.replace(/<script\b[^>]*>[\s\S]*?<\/script>|<a\b[^>]*>/gi, (tag) =>
        /^<a\s/i.test(tag)
          ? tag.replace(/\shref=(["'])(.*?)\1/i, (match, q, href) => {
              const normalized = cleanLink(href.replace(/&amp;/g, '&'), origin);
              return normalized === href.replace(/&amp;/g, '&')
                ? match
                : ' href=' + q + htmlEsc(normalized) + q;
            })
          : tag
      );
      fs.writeFileSync(filename, result);
    } finally {
      dom.window.close();
    }
  }
  indexed.sort();
  const xml =
    '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
    indexed.map((url) => '  <url><loc>' + htmlEsc(origin + url) + '</loc></url>').join('\n') +
    '\n</urlset>\n';
  fs.writeFileSync(path.join(out, 'sitemap.xml'), xml);
  const blocked = ['/admin-', '/api/', '/pay.html', '/guest-interac-pay.html', '/checkout-result.html'];
  fs.writeFileSync(
    path.join(out, 'robots.txt'),
    'User-agent: *\n' +
      blocked.map((prefix) => 'Disallow: ' + prefix).join('\n') +
      '\n\nSitemap: ' +
      origin +
      '/sitemap.xml\n'
  );
  return indexed;
}

// Query results share the optimized storefront shell. The handler supplies its own
// canonical, noindex, search metadata and result content on each response.
function captureSearchShell(out) {
  const shop = fs.readFileSync(path.join(out, 'shop.html'), 'utf8');
  const main = /(<main\b[^>]*\bid=["']ap-main["'][^>]*>)[\s\S]*?<\/main>/i;
  if (!main.test(shop)) throw new Error('Missing main element in shop search shell');
  const shell = shop
    .replace(main, '$1<!-- public-catalog-results --></main>')
    .replace(/<script\b(?=[^>]*\stype\s*=\s*["']application\/ld\+json["'])[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<template\b[^>]*\bid=["']pure-shop-filters["'][^>]*>[\s\S]*?<\/template>/gi, '')
    .replace(/<link\b(?=[^>]*\brel=["']preload["'])(?=[^>]*\bas=["']image["'])[^>]*>/gi, '');
  fs.writeFileSync(path.join(__dirname, 'lib', 'public-catalog-shell.html'), shell);
}

module.exports = { buildSEO, captureSearchShell };
