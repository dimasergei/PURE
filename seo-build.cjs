'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const pages = {
  '/': [
    'Research Compounds for Laboratories',
    'Explore research-use-only compounds, compare sizes and prices, and review supplier laboratory reports for controlled laboratory research.'
  ],
  '/shop': [
    'Research Compound Catalog',
    'Browse research-use-only compounds and supplies by size, category and price. Compare variants and prices, and find available supplier reports.'
  ],
  '/coas': [
    'Lab Testing & Certificates of Analysis',
    'Find supplier certificates of analysis for laboratory research products, match the reported sample and lot, and open available original documents.'
  ],
  '/about': [
    'About PURE',
    'Learn about PURE’s research-use-only catalog, supplier documentation and ordering resources for laboratories.'
  ],
  '/contact': [
    'Contact Support',
    'Contact PURE about a research compound, supplier documentation, an order or delivery.'
  ],
  '/bulk-orders': [
    'Bulk Research Orders & Volume Pricing',
    'Review volume pricing and select compounds, strengths and quantities for your laboratory’s bulk research order.'
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
    'Look up shipment updates for a PURE order using your order confirmation details.'
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
  '/spin-and-save': ['Spin & Save', 'View the availability and terms of the PURE Spin & Save promotion.'],
  '/404': ['Page Not Found', 'Find your way back to the PURE catalog or contact support about an unavailable page.']
};

const schemaContext = 'https://schema.org';
const brandArtwork = '/assets/pure-packaging-studio.webp';
const noindex = new Set(['/404', '/spin-and-save']);
const entities = {'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'};
const escape = value => String(value).replace(/[&<>"']/g, character => entities[character]);
const textOf = element => (element?.textContent || '').replace(/\s+/g, ' ').trim();

function visibleFAQs(main, canonical) {
  const questions = new Map();
  for (const details of main?.querySelectorAll('details') || []) {
    if (details.closest('[hidden], [aria-hidden="true"], template')) continue;
    const summary = details.querySelector(':scope > summary');
    const question = textOf(summary);
    if (!question.endsWith('?') || questions.has(question)) continue;
    const response = details.cloneNode(true);
    response.querySelector('summary')?.remove();
    for (const hidden of response.querySelectorAll('script, style, [hidden], [aria-hidden="true"]')) hidden.remove();
    const answer = textOf(response);
    if (answer) questions.set(question, {'@type': 'Question', name: question, acceptedAnswer: {'@type': 'Answer', text: answer}});
  }
  if (questions.size) return {'@type': 'FAQPage', '@id': canonical + '#faq', mainEntity: [...questions.values()]};
}

function breadcrumbs(route, name, origin) {
  const chain = [['Home', '/']];
  if (route.startsWith('/product/')) chain.push(['Research Catalog', '/shop']);
  if (route.startsWith('/learn/')) chain.push(['Laboratory Documentation Guides', '/learn']);
  chain.push([name, route]);
  return {
    '@type': 'BreadcrumbList', '@id': origin + route + '#breadcrumbs',
    itemListElement: chain.map(([label, url], index) => ({
      '@type': 'ListItem', position: index + 1, name: label, item: origin + url
    }))
  };
}

function productSchema(product, canonical, currency, image, brand) {
  const offers = product.variants.map(variant => {
    if (!variant.size || !Number.isFinite(variant.price) || variant.price < 0) {
      throw new Error('Invalid catalog variant for ' + product.id);
    }
    return {
      '@type': 'Offer', name: product.name + ' ' + variant.size, price: variant.price.toFixed(2),
      priceCurrency: currency, url: canonical + '?size=' + encodeURIComponent(variant.size)
    };
  });
  return {
    '@type': 'Product', '@id': canonical + '#product', name: product.name, sku: product.sku_code || product.id,
    brand: {'@type': 'Brand', name: brand}, url: canonical, offers, ...(image ? {image} : {})
  };
}

function siteSchema(site, home, searchRoute) {
  const organization = {
    '@type': 'Organization', '@id': home + '#organization', name: site.name, url: home,
    logo: home + 'brand-logo.png', email: site.support.email
  };
  const website = {'@type': 'WebSite', '@id': home + '#website', name: site.name, url: home, publisher: {'@id': organization['@id']}};
  if (searchRoute) website.potentialAction = {
    '@type': 'SearchAction', target: {'@type': 'EntryPoint', urlTemplate: home + 'shop/browse?q={search_term_string}'},
    'query-input': 'required name=search_term_string'
  };
  return [organization, website];
}

function applyHead(source, dom, markup) {
  const head = dom.window.document.head;
  const location = dom.nodeLocation(head);
  if (!location?.endTag) throw new Error('Expected an explicit head closing tag');
  const owned = [];
  for (const tag of head.children) {
    const key = (tag.getAttribute('name') || tag.getAttribute('property') || '').toLowerCase();
    if (tag.localName === 'title' ||
      (tag.localName === 'meta' && /^(?:description$|robots$|og:|twitter:)/.test(key)) ||
      (tag.localName === 'link' && tag.relList.contains('canonical')) ||
      (tag.localName === 'script' && !tag.hasAttribute('src') && tag.type === 'application/ld+json')) {
      owned.push(dom.nodeLocation(tag));
    }
  }
  // Slice the original source rather than serializing the DOM. Every unowned byte,
  // including inline JS, styles, head ordering, preload attributes and the body, survives.
  const segments = [];
  let cursor = 0;
  for (const node of owned) {
    segments.push(source.slice(cursor, node.startOffset));
    cursor = node.endOffset;
  }
  segments.push(source.slice(cursor, location.endTag.startOffset), markup, source.slice(location.endTag.startOffset));
  return segments.join('');
}

function buildHeadSEO(out, site) {
  const origin = new URL(site.origin).origin;
  const currency = site.currency.base.toUpperCase();
  const catalog = JSON.parse(fs.readFileSync(path.join(__dirname, 'lib', 'catalog.json'), 'utf8'));
  const products = new Map(catalog.map(product => [product.id, product]));
  const manifest = require('./assets/products-pure/manifest.json');
  const images = new Map(manifest.map(image => [image.product_id + ':' + image.size, '/' + image.file]));
  const searchRoute = require('./vercel.json').rewrites?.some(rule => rule.source === '/shop/browse');
  const indexed = new Set();
  if (!fs.existsSync(path.join(out, brandArtwork))) throw new Error('Missing release social artwork ' + brandArtwork);
  const meta = (attr, key, value) => '<meta ' + attr + '="' + key + '" content="' + escape(value) + '">';

  for (const relative of fs.readdirSync(out, {recursive: true}).filter(file => file.endsWith('.html'))) {
    const route = relative === 'index.html' ? '/' : '/' + relative.replace(/\/index\.html$/, '').replace(/\.html$/, '');
    const product = route.startsWith('/product/') && products.get(route.slice('/product/'.length));
    if (!product && !Object.hasOwn(pages, route)) continue;
    const file = path.join(out, relative);
    const source = fs.readFileSync(file, 'utf8');
    const dom = new JSDOM(source, {includeNodeLocations: true});
    try {
      const document = dom.window.document;
      const main = document.querySelector('main');
      const canonical = origin + route;
      const label = product
        ? product.name + (product.variants.length === 1 ? ' ' + product.variants[0].size : '')
        : pages[route][0];
      const title = label + ' | ' + site.name;
      const description = product
        ? 'View ' + label + ' pricing, catalog sizes and documentation for laboratory research.'
        : pages[route][1];
      const graph = [];
      if (route === '/') graph.push(...siteSchema(site, origin + '/', searchRoute));
      else if (!noindex.has(route)) graph.push(breadcrumbs(route, label, origin));
      if (product) {
        const productImage = images.get(product.id + ':' + product.variants[0].size);
        const image = productImage && fs.existsSync(path.join(out, productImage)) ? origin + productImage : null;
        graph.push(productSchema(product, canonical, currency, image, site.name));
      }
      const article = route.startsWith('/learn/') && main?.querySelector('article, h2');
      if (article) graph.push({
        '@type': 'Article', '@id': canonical + '#article', headline: textOf(main.querySelector('h1')),
        description, url: canonical, mainEntityOfPage: canonical, publisher: {'@id': origin + '/#organization'}
      });
      const faq = visibleFAQs(main, canonical);
      if (faq && !noindex.has(route)) graph.push(faq);
      const tags = ['<title>' + escape(title) + '</title>', meta('name', 'description', description)];
      if (route !== '/404') tags.push('<link rel="canonical" href="' + escape(canonical) + '">');
      if (noindex.has(route)) tags.push(meta('name', 'robots', 'noindex, follow'));
      else indexed.add(route);
      const imageURL = origin + brandArtwork;
      const openGraph = {
        'og:type': product ? 'product' : article ? 'article' : 'website', 'og:url': canonical, 'og:title': title,
        'og:description': description, 'og:site_name': site.name, 'og:image': imageURL,
        'og:image:alt': 'Black PURE packaging on a white background'
      };
      for (const [key, value] of Object.entries(openGraph)) tags.push(meta('property', key, value));
      for (const [key, value] of Object.entries({
        'twitter:card': 'summary_large_image', 'twitter:title': title, 'twitter:description': description, 'twitter:image': imageURL
      })) tags.push(meta('name', key, value));
      if (graph.length) {
        const schema = JSON.stringify({'@context': schemaContext, '@graph': graph}).replace(/</g, '\\u003c');
        tags.push('<script type="application/ld+json">' + schema + '</script>');
      }
      fs.writeFileSync(file, applyHead(source, dom, tags.join('')));
    } finally {
      dom.window.close();
    }
  }
  const urls = [...indexed].sort();
  const xml = ['<?xml version="1.0" encoding="UTF-8"?>', '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'];
  for (const route of urls) xml.push('  <url><loc>' + escape(origin + route) + '</loc></url>');
  fs.writeFileSync(path.join(out, 'sitemap.xml'), [...xml, '</urlset>', ''].join('\n'));
  return urls;
}

module.exports = {buildHeadSEO};
