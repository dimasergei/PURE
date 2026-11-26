'use strict';
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {createHash} = require('node:crypto');
const {gateDialog} = require('../lib/age-consent');
const {promoVisible} = require('../config/site.ts');
const root = path.resolve(__dirname, '..');
const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
const number = cents => (cents / 100).toLocaleString('en-US',{style:'currency',currency:'USD'});
const features = ['retatrutide','bpc-157','ghk-cu','ipamorelin','nad','tb-500','tirzepatide','semaglutide'];
const report = require('../data/supplier-coas.json').reports.find(row=>row.id==='p99-0285-opt-260727-r1');
const preview = '/assets/reports/ipamorelin-0285-opt-260727-r1';
const images = require('../assets/products-pure/manifest.json');
const catalog = vm.runInNewContext(fs.readFileSync(path.join(root,'products.js'),'utf8')+'; CATALOG',{}, {timeout:1000});
function productImage(product,variant) {
  const record = images.find(row=>row.product_id===product.id && row.size===variant.size);
  if (!record) throw new Error('Missing homepage product image '+product.id);
  return '/assets/catalog-webp/'+path.basename(record.file,'.svg')+'.webp';
}
function homeFaq(site) {
  return [
    ['Who can order from PURE?', 'Orders are for laboratory research by purchasers aged '+site.minimumAge+' or older who meet applicable local requirements. '+site.ruo],
    ['Where can I find a certificate of analysis?', 'Search Lab Testing & COAs by compound, strength, laboratory or report ID. The archive links to original supplier reports.'],
    ['Does a supplier report identify my fulfillment lot?', site.testing.scope+' Contact support with your order number to request documentation for your assigned lot.'],
    ['How do I compare sizes and prices?', 'Select Compare on up to four compounds. Open the comparison to review their available sizes and listed prices together.'],
    ['Which destinations qualify for free shipping?', site.shipping.freeSummary],
    ['When should I expect my order?', site.shipping.processingEstimate+' '+site.shipping.transitEstimate],
    ['Is shipping protection optional?',site.shipping.protectionSummary],
    ['Where can I review quantity pricing?', 'Bulk Orders lets you select quantities by compound and strength and review the applicable merchandise tier before checkout.'],
    ['Can I see my subscription or order history?', 'Sign in to Account with the email used for your order. Open Monthly orders to manage recurring orders or Orders to review purchases.'],
    ['What is the returns window?', site.returns.summary]
  ].map(([question,answer])=>({question,answer}));
}
function card(product) {
  const variants=product.variants, lowest=variants.reduce((a,b)=>a.price<=b.price?a:b);
  const prices=Math.round(lowest.price*100), multi=variants.length>1;
  const sizes=multi ? variants[0].size+' – '+variants[variants.length-1].size : lowest.size;
  const url='/product/'+encodeURIComponent(product.id), name=esc(product.name);
  return `<article class="ph-card" data-product="${esc(product.id)}">
    <a class="ph-image" href="${url}" aria-label="View ${name}"><img src="${productImage(product,lowest)}" width="360" height="484" loading="lazy" decoding="async" alt="${name} ${esc(lowest.size)} research vial"></a>
    <span class="ph-sale" data-home-sale hidden></span><h3><a href="${url}">${name}</a></h3><p class="ph-size">${esc(sizes)}</p>
    <p class="ph-price">${multi?'From ':''}<strong data-usd-cents="${prices}"><span class="pure-price-value">${number(prices)}</span></strong></p>
    <div class="ph-card-actions"><button type="button" class="ap-button ap-catalog-action" data-action="${multi?'catalog-options':'add'}" data-id="${esc(product.id)}" ${multi?'aria-haspopup="dialog"':`data-size="${esc(lowest.size)}" data-open-cart`} aria-label="Add ${name} to cart">Add to cart</button>
    <label><input type="checkbox" data-compare="${esc(product.id)}" aria-label="Compare ${name}"> Compare</label></div><noscript><a class="ph-text" href="${url}">View sizes and prices</a></noscript></article>`;
}
function hero(products) {
  const stage=[products[1],products[3],products[0],products[2],products[4]];
  return `<section class="ph-hero"><div class="ph-wrap ph-hero-inner"><div class="ph-intro"><h1>Research compounds for labs<span>.</span> <small>With original supplier reports</small></h1>
    <p>Compare vial sizes and prices, review the documentation and choose the materials for your lab.</p>
    <div class="ph-actions"><a class="ph-primary" href="/shop">Shop compounds <span aria-hidden="true">↗</span></a><a class="ph-secondary" href="/coas">Lab Testing &amp; COAs</a></div></div>
    <div class="ph-stage" aria-hidden="true"><svg width="0" height="0" focusable="false"><defs><clipPath id="ph-vial" clipPathUnits="objectBoundingBox"><path d="M .296 .127 C .296 .094 .409 .079 .499 .079 C .592 .079 .705 .095 .705 .128 L .705 .168 Q .705 .179 .691 .186 L .691 .239 Q .691 .259 .648 .267 L .648 .311 C .696 .328 .713 .342 .720 .372 L .725 .379 L .727 .824 Q .727 .879 .681 .880 L .319 .880 Q .273 .879 .272 .827 L .277 .379 L .283 .373 C .289 .343 .307 .327 .355 .312 L .355 .268 Q .310 .260 .310 .238 L .310 .187 Q .296 .180 .296 .168 Z"/></clipPath></defs></svg>
    ${stage.map((p,i)=>`<img class="ph-vial ph-vial-${i}" width="360" height="484" decoding="async" ${i===2?'fetchpriority="high"':''} src="${productImage(p,p.variants[0])}" alt="">`).join('')}</div></div></section>`;
}
function renderHomeDocument(html, site) {
  if(html.includes('data-pure-home>'))return html;
  const selected=features.map(id=>catalog.find(p=>p.id===id));
  if(selected.some(p=>!p))throw Error('Missing featured compound.');
  const faq=homeFaq(site), sh=site.shipping;
  const schema={'@context':'https://schema.org','@type':'FAQPage',mainEntity:faq.map(f=>({'@type':'Question',name:f.question,acceptedAnswer:{'@type':'Answer',text:f.answer}}))};
  const main=`<main id="ap-main" data-pure-home>${hero(selected)}
    <ul class="ph-trust ph-wrap" aria-label="PURE ordering facts">
      <li><strong>${site.testing.reportCount}</strong>Original supplier reports</li><li><strong>${site.minimumAge}+</strong>Laboratory research only</li>
      <li><strong>US &amp; Canada</strong>Free shipping from <span data-usd-cents="${sh.freeThresholdCents}"><span class="pure-price-value">${number(sh.freeThresholdCents)}</span></span></li><li><strong>${esc(site.currency.base.toUpperCase())}</strong>Base catalog currency</li></ul>
    <section class="ph-section ph-wrap" aria-labelledby="ph-featured"><div class="ph-heading"><h2 id="ph-featured">Featured research compounds</h2><a href="/shop">Shop all compounds ↗</a></div><div class="ph-products" id="nl-featured">${selected.map(card).join('')}</div><p data-home-rating hidden></p></section>
    <section class="ph-lab"><div class="ph-section ph-wrap ph-lab-grid"><div><h2>How we test</h2><p class="ph-lede">${esc(site.testing.scope)}</p>
      <dl class="ph-methods">${site.testing.methods.map(m=>`<div><dt>${esc(m.name)}</dt><dd>${esc(m.scope)} <a href="${esc(m.sourceUrl)}">Source report</a></dd></div>`).join('')}</dl><a class="ph-text" href="/coas">Search all lab reports ↗</a></div>
      <article class="ph-report"><a href="${preview}.pdf" aria-label="Open the full Ipamorelin sample report PDF"><img src="${preview}.webp" loading="lazy" width="557" height="720" alt="Complete Ipamorelin sample report issued by Optiq Health Labs"></a><div><h3>Sample certificate of analysis</h3><p>${esc(report.product)} · ${esc(report.size)}<br>${esc(report.lab_name)}<br>Lot ${esc(report.lot)}<br>Reported ${esc(report.report_date)}</p><a class="ph-text" href="${preview}.pdf" download>Download original PDF ↓</a></div></article>
    </div></section>
    <section class="ph-section ph-wrap" aria-labelledby="ph-shipping"><h2 id="ph-shipping">Shipping &amp; fulfillment</h2><div class="ph-info-grid"><article><h3>Destinations &amp; services</h3><p>${esc(sh.regions.join(' · '))}</p><p>${esc(sh.deliveryNote)}</p></article><article><h3>Dispatch &amp; transit</h3><p>${esc(sh.processingEstimate+' '+sh.transitEstimate)}</p>${sh.cutoff&&sh.timeZone?'<p>Dispatch cutoff '+esc(sh.cutoff)+' ('+esc(sh.timeZone)+').</p>':''}${sh.carriers.length?'<p>'+esc(sh.carriers.join(' · '))+'</p>':''}</article><article><h3>Shipping protection</h3><p>${esc(sh.protectionSummary)}</p></article></div><a class="ph-text" href="/shipping-policy">Shipping details ↗</a><details class="ph-benefit-details"><summary>Free shipping and complimentary solution eligibility</summary><p>${esc(sh.freeSummary)}</p><p>${esc(sh.giftSummary)}</p></details></section>
    <section class="ph-wrap ph-pack"><div><h2>PURE packaging</h2><p>Review the labeled strength and original documentation when selecting a research vial.</p><a class="ap-button" href="/shop">Shop now ↗</a></div><img src="/assets/pure-packaging-studio.webp" width="1344" height="816" loading="lazy" alt="Black PURE carton and labeled Retatrutide research vial on white"></section>
    <section class="ph-section ph-wrap"><h2>Order for your lab</h2><div class="ph-programs"><article><h3>Subscribe &amp; Save</h3><p>Choose a recurring order and review your savings and delivery schedule.</p><a href="/subscribe-and-save">Explore subscriptions ↗</a></article><article><h3>Bulk Orders</h3><p>Combine sizes of one compound and see volume pricing before you order.</p><a href="/bulk-orders">Build a bulk order ↗</a></article><article><h3>Partner Program</h3><p>Review program terms and apply for a PURE partner account.</p><a href="/partner-program">Explore partnerships ↗</a></article></div></section>
    <div data-mx-membership-home><section class="ph-section ph-wrap"><h2>Memberships</h2><a class="ph-text" href="/memberships">Compare membership benefits ↗</a></section></div>
    <section class="ph-section ph-wrap ph-faq" id="faq"><h2>Frequently asked questions</h2><div>${faq.map(f=>`<details><summary>${esc(f.question)}</summary><p>${esc(f.answer)}</p></details>`).join('')}</div></section></main>`;
  return html.replace(/<main\b[^>]*>[\s\S]*?<\/main>/,()=>main).replace('</head>','<noscript><style>.ph-card-actions{display:none!important}</style></noscript><script type="application/ld+json">'+JSON.stringify(schema).replace(/</g,'\\u003c')+'</script></head>');
}
function buildHome(out,site) {
  const filename=path.join(out,'index.html');
  fs.writeFileSync(filename,renderHomeDocument(fs.readFileSync(filename,'utf8'),site));
}
function offer(site) {
  const visible=promoVisible(site.promo), p=site.promo;
  const until=visible ? new Intl.DateTimeFormat('en-US',{month:'short',day:'numeric',year:'numeric',hour:'numeric',minute:'2-digit',timeZone:'UTC',timeZoneName:'short'}).format(new Date(p.endsAt)) : '';
  return `<div class="ap-announcement pure-offer-active"${visible?'':' hidden'}><div class="pure-offer-trigger" data-default-offer${visible?' data-ends-at="'+esc(p.endsAt)+'"':''}>${visible?`<span class="pure-offer-buy">${esc(p.percent)}% off</span> <button type="button" class="pure-offer-free" data-copy-offer="${esc(p.code)}" aria-label="Copy code ${esc(p.code)}"><span>${esc(p.code)}</span></button> <a class="pure-offer-action" href="/shop">Shop now</a><time datetime="${esc(p.endsAt)}">Ends ${esc(until)}</time><span class="ap-sr" role="status" data-offer-status></span>`:''}</div></div>`;
}
function footerAdditions(site) {
  return `<div class="ap-container ph-foot-connect"><div><h2>PURE email updates</h2><form class="ap-newsletter-form" method="post" action="/api/customer-config?campaign=newsletter"><label for="pure-footer-email">Email address</label><div class="ph-email-line"><input id="pure-footer-email" name="email" type="email" autocomplete="email" required maxlength="254"><button class="ap-button">Subscribe</button></div><label class="ph-consent"><input type="checkbox" name="consent" required> I agree to receive PURE offers and research catalog updates by email.</label><p class="ap-form-status" role="status"></p></form></div>
    <div><h2>Contact PURE</h2><p><a href="mailto:${esc(site.support.email)}">${esc(site.support.email)}</a></p>${site.company.address?'<address>'+esc(site.company.address)+'</address>':''}
    <p class="ph-foot-currency">${esc(site.currency.disclosure)}</p>
    <div class="ph-payment-marks" role="group" aria-label="Checkout payment options"><span><img src="/assets/payment-brands/apple-mark-clean.svg" alt="Apple" width="16" height="20" loading="lazy"> Pay</span><span><img src="/assets/payment-brands/google-g-clean.svg" alt="Google" width="16" height="16" loading="lazy"> Pay</span></div></div></div>`;
}
function applyShell(out,site) {
  for(const name of ['home-shell.css','age-gate.js'])fs.copyFileSync(path.join(root,name),path.join(out,name));
  fs.mkdirSync(path.join(out,'assets/reports'),{recursive:true});
  for(const ext of ['webp','pdf']) {
    const resource=preview+'.'+ext;
    fs.copyFileSync(path.join(root,resource),path.join(out,resource));
  }
  const versions={};
  for(const name of ['home-shell.css','age-gate.js','storefront-navigation.js','storefront-v2.js','conversion-ui.js']){
    const file=path.join(out,name);
    if(fs.existsSync(file))versions[name]=createHash('sha256').update(fs.readFileSync(file)).digest('hex').slice(0,12);
  }
  function visit(dir) {
    for (const entry of fs.readdirSync(dir,{withFileTypes:true})){
      const f=path.join(dir,entry.name);
      if(entry.isDirectory()){visit(f);continue;}
      if(!entry.name.endsWith('.html')||entry.name.startsWith('admin-'))continue;
      let s=fs.readFileSync(f,'utf8');
      if(!s.includes('ap-header-compact'))continue;
      const route='/'+path.relative(out,f).split(path.sep).join('/').replace(/(?:^|\/)index\.html$/,'').replace(/\.html$/,'');
      s=s.replace(/<div class="ap-announcement\b[\s\S]*?(?=<header class="ap-header)/,()=>offer(site)+'\n');
      s=s.replace(/href="\/(?:my-)?account#rewards(?:-and-credit)?"/g,'href="/my-account/points"')
        .replace(/href="\/account(?=[/#"])/g,'href="/my-account')
        .replaceAll('href="/#faq"','href="/faq"')
        .replace(/href="(\/(?:shipping-policy|refund-policy|privacy-policy|terms-and-conditions|research-use-policy|shipping-protection|medical-disclaimer|corrections-policy|research-documentation|commercial-terms))\.html"/g,'href="$1"')
        .replace(/(<a\b[^>]*href="\/coas"[^>]*>)Testing(<\/a>)/g,'$1Lab Testing &amp; COAs$2')
        .replace(/(<a class="ap-icon" href="\/my-account"[^>]*>)([\s\S]*?<\/svg>)(<\/a>)/,(_,a,svg,end)=>a.replace('aria-label="My account"','aria-label="Account"')+svg+'<span class="pure-account-label">Account</span>'+end)
        .replace(/(<div class="ap-container ap-footer-bottom">)/,()=>footerAdditions(site)+'<div class="ap-container ap-footer-bottom">')
        .replace(/(<span id="year">\d{4}<\/span> PURE\.<\/span>)<span>[^<]*<\/span>/,'$1 <span>'+esc(site.ruo)+'</span>');
      const main=s.match(/<main[^>]*\bid="([^"]+)"/);
      if(main)s=s.replace(/(<a class="ap-skip" href=")#[^"]+/, '$1#'+main[1]);
      s=s.replace('</head>','<link rel="stylesheet" href="/home-shell.css?v='+versions['home-shell.css']+'"></head>');
      // The age terms themselves remain accessible from the age dialog.
      const showGate=!/^\/(?:account|my-account|checkout|bulk-orders\/checkout|research-use-policy|terms-and-conditions)(?:\/|$)/.test(route);
      s=s.replace(/<dialog id="ap-age-dialog"[\s\S]*?<\/dialog>/,'').replace(/<script src="\/age-gate\.js[^"]*"[^>]*><\/script>/g,'');
      if(showGate){
        const gate=gateDialog(site,route);
        s=s.replace(/<body\b[^>]*>/,start=>start+gate+'<script src="/age-gate.js?v='+versions['age-gate.js']+'"></script>');
        s=s.replace(/(<header class="ap-header)/,'<noscript><iframe class="ph-age-frame" title="Age verification" src="/api/customer-config?age_gate=prompt&amp;returnTo='+encodeURIComponent(route)+'"></iframe></noscript>$1');
      }
      s=s.replace(/src="\/(storefront-navigation\.js|storefront-v2\.js|conversion-ui\.js)(?:\?[^"]*)?"/g,(_,name)=>'src="/'+name+'?v='+versions[name]+'"');
      fs.writeFileSync(f,s);
    }
  }
  visit(out);
}
module.exports={homeFaq,buildHome,applyShell,renderHomeDocument,offer};
