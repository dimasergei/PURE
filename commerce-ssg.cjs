'use strict';
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {JSDOM} = require('jsdom');
const views = require('./reference-ui-functions.cjs').workspace;
const conversion = require('./config/conversion.json');
const {TIERS} = require('./quantity-pricing');
const {escapeHtml: esc} = require('./lib/order-email-layout');

const dollars = value => 'US$'+(value / 100).toLocaleString('en-US', {minimumFractionDigits:2,maximumFractionDigits:2});
const link = (href, label) => '<a href="'+esc(href)+'">'+esc(label)+'</a>';
const section = (title, body, id='') => '<section class="ap-container commerce-section"'+(id?' id="'+id+'"':'')+'><h2>'+esc(title)+'</h2>'+body+'</section>';
const table = (caption, headings, rows) => '<div class="commerce-table"><table><caption>'+esc(caption)+'</caption><thead><tr>'+headings.map(v=>'<th scope="col">'+esc(v)+'</th>').join('')+'</tr></thead><tbody>'+rows.map(row=>'<tr>'+row.map((v,i)=>i?'<td>'+esc(v)+'</td>':'<th scope="row">'+esc(v)+'</th>').join('')+'</tr>').join('')+'</tbody></table></div>';
const faq = (title, rows) => section(title,rows.map(([q,a])=>'<details><summary>'+esc(q)+'</summary><p>'+esc(a)+'</p></details>').join(''));
const productList = (list, plan=false) => list.map(p=>{
  const cents=Math.round(Math.min(...p.variants.map(v=>v.price))*100);
  return '<article class="commerce-product"><h3>'+link('/product/'+encodeURIComponent(p.id),p.name)+'</h3><p>'+esc(p.variants.map(v=>v.size).join(' · '))+'</p><p>Retail from '+dollars(cents)+'</p>'+(plan?'<p>Plan from <strong>'+dollars(Math.round(cents*.6))+'</strong></p>':'')+'</article>';
}).join('');
function cleanLinks(d){
  for(const a of d.querySelectorAll('main a[href]')){
    const href=a.getAttribute('href');
    if (/^\/account#rewards(?:-and-credit)?$/.test(href)) a.setAttribute('href','/my-account/points');
    else if (/^\/account(?:\/|$|[?#])/.test(href)) a.setAttribute('href',href.replace('/account','/my-account'));
  }
}
function buildCommerce(out, site) {
  const app = fs.readFileSync(path.join(out, 'workspace-v2.js'),'utf8');
  const catalog = JSON.parse(fs.readFileSync(path.join(out,'../lib/catalog.json'),'utf8')).filter(p=>p.variants.length);
  // Static and interactive routes share repository-owned markup functions.
  function fromWorkspace(name, next) {
    const start=app.indexOf('function '+name+'('),end=app.indexOf(next,start);
    if(start<0||end<0)throw Error('Missing workspace view '+name);
    return vm.runInNewContext('('+app.slice(start,end).trim()+')',{esc});
  }
  const inquiryForm = fromWorkspace('inquiryForm','function bulkPage');
  const trackOrder = fromWorkspace('trackOrder','async function requestTracking');
  const render = (fn, locals={})=>vm.runInNewContext('('+fn.toString()+')()', {esc,...locals});
  function page(src,dest,update){
    const dom=new JSDOM(fs.readFileSync(path.join(out,src+'.html'),'utf8'));
    const d=dom.window.document;
    update(d);
    cleanLinks(d);
    const css=d.createElement('link');css.rel='stylesheet';css.href='/commerce-pages.css';d.head.append(css);
    fs.writeFileSync(path.join(out,dest+'.html'),dom.serialize());
    dom.window.close();
  }
  const accountLinks='<nav aria-label="Your account" class="commerce-links">'+[['/my-account/login','Sign in'],['/my-account/signup','Create account'],['/my-account/purchases','Orders and tracking'],['/my-account/profile','Addresses'],['/my-account/points','Rewards and credit'],['/monthly-orders','Subscriptions']].map(([url,label])=>link(url,label)).join('')+'</nav>';
  const policies='<p>'+esc(site.shipping.protectionSummary)+'</p><p>'+esc(site.returns.summary)+'</p><p>'+link('/shipping-policy','Shipping policy')+' · '+link('/refund-policy','Returns')+' · '+link('/coas','Lab Testing & COAs')+'</p>';
  for(const [file,title,copy,body] of [
    ['checkout','Checkout','Choose a delivery address and review your order total before placing your order.', '<p>Guest checkout is available. Sign in to use saved addresses and eligible account benefits.</p>'+policies],
    ['bulk-checkout','Bulk checkout','Review your bulk quantities, savings and delivery options before confirming your order.',link('/bulk-orders','Return to bulk selections')+policies],
    ['account','Your PURE account','Sign in with your checkout email to view your orders, manage addresses and use program benefits.',accountLinks]
  ]) page('account',file,d=>{
    d.querySelector('#account-root').innerHTML='<h1>'+title+'</h1><p>'+esc(copy)+'</p>'+body+'<noscript><p>Enable JavaScript to securely access your account or complete checkout. '+link('/contact','Contact support')+'.</p></noscript>';
    d.title=title+' | PURE';
    if(file!=='account'){
      d.querySelector('main').dataset.checkoutTitle=title;
      const script=d.createElement('script');script.src='/commerce-checkout-heading.js';script.defer=true;d.body.append(script);
    }
  });
  const monthlyRoot=(d,title,copy)=>{
    d.querySelector('#monthly-main h1').textContent=title;
    const content=d.querySelector('#monthly-content');content.removeAttribute('aria-busy');
    content.innerHTML='<p>'+esc(copy)+'</p><p>'+link('/subscribe-and-save','Explore Subscribe & Save')+' · '+link('/commercial-terms#subscribe-and-save-plan','Read plan terms')+'</p><noscript><p>Enable JavaScript to manage your plan or complete enrollment.</p></noscript>';
    d.title=title+' | PURE';
  };
  page('monthly-orders','monthly-checkout',d=>monthlyRoot(d,'Subscribe & Save checkout','Review your selections, the first monthly invoice and the three-delivery agreement.'));
  page('monthly-orders','monthly-orders',d=>monthlyRoot(d,'Monthly orders','Sign in to review invoices and deliveries or manage future selections under your plan terms.'));
  page('shop','cart',d=>{
    const main=d.querySelector('main');const old=main.id;main.id='commerce-cart';
    const skip=d.querySelector('a[href="#'+old+'"]');if(skip)skip.href='#commerce-cart';
    main.innerHTML='<section class="ap-container commerce-section"><h1>Your cart</h1><p>Review your saved quantities, offers and shipping estimate.</p><button type="button" class="ap-button" data-action="cart">View saved cart</button> '+link('/shop','Continue shopping')+'<noscript><p>Enable JavaScript to use the cart saved on this device.</p></noscript></section>'+section('Shipping rewards','<p>'+esc(site.shipping.freeSummary)+'</p><p>'+esc(site.shipping.giftSummary)+'</p>'+policies);
    const script=d.createElement('script');script.src='/commerce-cart.js';script.defer=true;d.body.append(script);d.title='Your cart | PURE';
  });
  page('contact','contact',d=>{
    const main=d.querySelector('main');main.dataset.commerceRoute='/contact';
    main.innerHTML=render(views.contactPage,{inquiryForm});
    main.querySelector('h1').textContent='Contact PURE';
    main.querySelector('.pure-contact-watermark')?.remove();
    const support=main.querySelector('.pure-contact-email');support.href='mailto:'+site.support.email;support.textContent=site.support.email;
    const note=d.createElement('p');note.className='commerce-support';note.textContent='Support hours '+(site.support.hours||site.placeholders.supportHours)+'. Response time '+(site.support.responseTime||site.placeholders.supportResponse)+'.';support.after(note);
    main.querySelector('.pure-contact-links').insertAdjacentHTML('beforeend','<a href="/faq"><span>Frequently asked questions</span><span aria-hidden="true">↗</span></a>');
  });
  page('track-order','track-order',d=>{
    const main=d.querySelector('main');main.dataset.commerceRoute='/track-order';main.innerHTML=trackOrder();
    main.querySelector('form').action='/api/customer-config?commerce_form=tracking';
    main.querySelector('.pure-track-help').insertAdjacentHTML('beforebegin','<section class="commerce-timeline" aria-labelledby="tracking-stages"><h2 id="tracking-stages">Shipment stages</h2><ol><li>Order received</li><li>Preparing for shipment</li><li>Shipped</li><li>Delivered</li></ol><p>Your private update identifies your current status and includes carrier tracking when available.</p></section>');
  });
  page('404','404',d=>{
    const main=d.querySelector('main');main.innerHTML='<h1>Page not found</h1><p>Search the research catalog or choose a destination below.</p><form action="/shop" method="get" class="commerce-search" role="search"><label for="missing-search">Search products</label><input id="missing-search" name="q" type="search" maxlength="120"><button class="ap-button">Search</button></form><nav class="commerce-links" aria-label="Popular destinations">'+[['/shop','All products'],['/coas','Lab Testing & COAs'],['/track-order','Track an order'],['/faq','Frequently asked questions'],['/contact','Contact PURE']].map(([href,label])=>link(href,label)).join('')+'</nav>';
  });
  page('bulk-orders','bulk-orders',d=>{
    const bulk=catalog.filter(p=>!/\bneedles?\b/i.test(p.name));
    const main=d.querySelector('main');main.dataset.commerceRoute='/bulk-orders';
    main.innerHTML=render(views.bulkPage,{bulkQuery:'',bulkGroup:'All',A:{shopCategories:['All','Peptides','Mist Applicators','Supplies']}});
    main.querySelector('#ap-bulk-rows').innerHTML=productList(bulk);
    main.querySelector('#ap-bulk-summary').innerHTML='<h2>Bulk pricing</h2><p>Choose quantities in the builder or '+link('#request-quote','request a quote')+'.</p>';
    const tiers=TIERS.filter(v=>v.bps>0).toSorted((a,b)=>a.min-b.min);
    const options=bulk.map(p=>'<optgroup label="'+esc(p.name)+'">'+p.variants.map(v=>'<option value="'+esc(p.id+'|'+v.size)+'">'+esc(p.name+' · '+v.size)+'</option>').join('')+'</optgroup>').join('');
    const form='<form action="/api/customer-config?commerce_form=bulk" method="post" class="commerce-quote"><label>Compound and size<select required name="variant"><option value="">Choose a compound and size</option>'+options+'</select></label><label>Quantity<input type="number" name="quantity" min="1" max="100" step="1" required inputmode="numeric"></label><label>Organization<input name="organization" autocomplete="organization" maxlength="180" required></label><label>Your name<input name="name" autocomplete="name" maxlength="120" required></label><label>Work email<input name="email" type="email" autocomplete="email" maxlength="254" required></label><label class="commerce-quote-wide">Research use case and requirements<textarea name="message" required minlength="10" maxlength="4000" rows="3"></textarea></label><input type="hidden" name="topic" value="Bulk quote request"><label class="ap-honeypot" aria-hidden="true">Website<input name="website" tabindex="-1" autocomplete="off"></label><label class="commerce-check"><input type="checkbox" name="consent" required> PURE may contact me about this quote.</label><button class="ap-button" type="submit">Request quote</button></form>';
    main.insertAdjacentHTML('beforeend',section('Request a bulk quote',table('Quantity tiers per compound',['Units','Merchandise savings'],tiers.map(t=>[t.min+'+',t.bps/100+'%']))+'<p>Combine strengths of the same compound to reach a tier. Request a quote for your laboratory below.</p>'+form+'<p>Quote response time '+esc(site.support.bulkResponseTime||site.placeholders.bulkResponse)+'.</p>','request-quote'));
    main.querySelector('.nl-bulk-hero .ap-container').insertAdjacentHTML('beforeend','<a href="#request-quote" class="commerce-quote-link">Request a laboratory quote</a>');
  });
  page('subscribe-and-save','subscribe-and-save',d=>{
    const main=d.querySelector('main'), products=catalog.filter(p=>p.category==='injectables');
    main.querySelector('[data-pss-products]').innerHTML=productList(products,true);
    main.querySelector('[data-pss-subtotal]').textContent=dollars(0);
    main.querySelector('[data-pss-count]').textContent='0 of 4';
    main.insertAdjacentHTML('beforeend',faq('Subscribe & Save questions',[
      ['How are savings calculated?','The monthly merchandise price is 60% of each selected retail unit price, rounded to cents. For example, US$100 of qualifying merchandise becomes US$60 before delivery, taxes or applicable fees.'],
      ['How often are deliveries invoiced?','The four-product plan runs for three monthly deliveries. Each delivery is invoiced separately.'],
      ['How can I change my plan?','Open Monthly orders in your account. Three-delivery plans allow future selection changes after the first shipment and before the final invoice. Earlier flexible invoice plans also support skipping, pausing and cancellation under their accepted terms.']
    ])+section('Manage a plan','<p>'+link('/monthly-orders','Open monthly orders')+' · '+link('/commercial-terms#subscribe-and-save-plan','Read the plan terms')+'</p>'));
  });
  page('memberships','memberships',d=>{
    const main=d.querySelector('main'), dom=new JSDOM('<div id="member-page"></div>',{runScripts:'outside-only'});
    try{
      dom.window.eval(fs.readFileSync(path.join(out,'membership-experience.js'),'utf8'));
      const view=dom.window.document.querySelector('div');
      dom.window.PureMemberships.page(view,conversion,false);
      main.innerHTML=view.innerHTML;main.dataset.commerceRoute='/memberships';
    }finally{dom.window.close();}
    const plans=Object.values(conversion.plans);
    main.querySelector('.mx-faq').insertAdjacentHTML('beforebegin',section('Membership comparison',table('Prepaid access in USD',['Tier','Monthly','Annual','Merchandise discount','Points per eligible US$1'],plans.map(p=>[p.name,dollars(p.monthly_cents),dollars(p.annual_cents),p.discount_bps/100+'%',p.points_per_dollar]))));
  });
  page('partner-program','partner-program',d=>{
    const main=d.querySelector('main');main.dataset.commerceRoute='/partner-program';
    const p=conversion.partner;
    main.insertAdjacentHTML('beforeend',faq('Partner questions',[
      ['What is the commission rate?',p.first_order_bps/100+'% on the first qualifying paid merchandise order and '+p.repeat_order_bps/100+'% on later qualifying orders.'],
      ['When does a referral qualify?', 'The first valid partner link is remembered for '+p.cookie_days+' days. The new customer must place a qualifying paid order.'],
      ['Where can I see my payout?', 'Sign in to your partner dashboard to see pending and eligible commissions. The monthly payout minimum is '+dollars(p.minimum_payout_cents)+'.']
    ])+'<div class="ap-container commerce-section">'+table('Partner benefits',['Benefit','Terms'],[['First qualifying order',p.first_order_bps/100+'% commission'],['Repeat qualifying order',p.repeat_order_bps/100+'% commission'],['Referral window',p.cookie_days+' days'],['Minimum eligible payout',dollars(p.minimum_payout_cents)]])+'</div>');
  });
  page('gift-cards','gift-cards',d=>{
    d.querySelector('.pgc-faq').insertAdjacentHTML('beforebegin',section('Gift card terms',table('Digital gifts in USD',['Feature','Terms'],[['Amount','US$25–US$1,000'],['Scheduling','Today or up to 28 days ahead, in UTC'],['Redemption','Verified account with the recipient email'],['Balance','Unspent redeemed credit remains available for eligible purchases']])+'<p>'+link('/commercial-terms','Commercial terms')+' · '+link('/my-account/signup','Create a PURE account')+'</p>'));
  });
  for(const asset of ['commerce-pages.css','commerce-cart.js','commerce-checkout-heading.js'])fs.copyFileSync(path.join(__dirname,asset),path.join(out,asset));
}
module.exports = {buildCommerce};
