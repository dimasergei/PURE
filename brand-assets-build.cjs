'use strict';
const fs=require('node:fs');
const path=require('node:path');
const out=path.join(process.cwd(),'public-build');
const theme='brand-theme.css';
if(!fs.existsSync(out))throw new Error('public-build output is missing.');
fs.copyFileSync(theme,path.join(out,theme));
fs.copyFileSync('pure-brand.css',path.join(out,'pure-brand.css'));
fs.copyFileSync('mobile-parity.css',path.join(out,'mobile-parity.css'));
fs.copyFileSync('unified-palette.css',path.join(out,'unified-palette.css'));
for(const file of ['pure-layout.css','pure-bulk-layout.css','pure-coa.css','pure-currency.css'])fs.copyFileSync(file,path.join(out,file));
const iconFiles={
  'pure-mark.svg':['favicon.svg','favicon-pure-mark.svg'],
  'pure-mark.ico':['favicon.ico','favicon-pure-mark.ico'],
  'pure-mark-32.png':['favicon-pure-mark-32.png'],
  'pure-mark-48.png':['favicon-48.png','favicon-pure-mark-48.png'],
  'pure-mark-96.png':['favicon-pure-mark-96.png'],
  'pure-icon-180.png':['apple-touch-icon.png','apple-touch-icon-pure.png'],
  'pure-icon.svg':['favicon-pure.svg'],
  'pure-icon-16.png':['favicon-pure-16.png'],
  'pure-icon-32.png':['favicon-pure-32.png'],
  'pure-icon-96.png':['favicon-pure-96.png','brand-logo.png'],
  'pure-icon.ico':['favicon-pure-20261117.ico','favicon-pure-20261117b.ico'],
};
for(const [source,targets] of Object.entries(iconFiles)){
  for(const target of targets)fs.copyFileSync(path.join('assets',source),path.join(out,target));
}
// Self-host authentic payment marks from the reviewed assets directory.
fs.mkdirSync(path.join(out,'assets','payment-brands'),{recursive:true});
fs.cpSync(path.join(process.cwd(),'assets','payment-brands'),path.join(out,'assets','payment-brands'),{recursive:true});
const iconLinks=(version,shortcut)=>`<link rel="icon" type="image/svg+xml" sizes="any" href="/favicon-pure.svg?v=${version}"><link rel="icon" type="image/png" sizes="16x16" href="/favicon-pure-16.png?v=${version}"><link rel="icon" type="image/png" sizes="32x32" href="/favicon-pure-32.png?v=${version}"><link rel="icon" type="image/png" sizes="96x96" href="/favicon-pure-96.png?v=${version}"><link rel="shortcut icon" type="image/x-icon" href="${shortcut}"><link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png?v=${version}"><meta name="theme-color" content="#ffffff">`;
const storefrontIconLinks=[
  '<link rel="shortcut icon" type="image/x-icon" href="/favicon-pure-mark.ico">',
  '<link rel="icon" type="image/png" sizes="32x32" href="/favicon-pure-mark-32.png">',
  '<link rel="icon" type="image/png" sizes="48x48" href="/favicon-pure-mark-48.png">',
  '<link rel="icon" type="image/png" sizes="96x96" href="/favicon-pure-mark-96.png">',
  '<link rel="icon" type="image/svg+xml" sizes="any" href="/favicon-pure-mark.svg">',
  '<link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon-pure.png">',
  '<meta name="theme-color" content="#ffffff">',
].join('');
const adminIconLinks=iconLinks('20261117b','/favicon-pure-20261117b.ico');
const organization='<script type="application/ld+json">{"@context":"https://schema.org","@type":"Organization","name":"PURE","url":"https://getpurelabs.com/","logo":"https://getpurelabs.com/brand-logo.png"}</script>';
let count=0;
for(const file of fs.readdirSync(out,{recursive:true}).filter(f=>f.endsWith('.html'))){
  const target=path.join(out,file);
  let html=fs.readFileSync(target,'utf8');
  // Admin and public shells share the exact same reference-derived wordmark.
  html=html.replace(/<link\b[^>]*href=["']\/pure-brand\.css[^"']*["'][^>]*>/gi,'');
  html=html.replace(/<link\b[^>]*href=["']https:\/\/fonts\.(?:googleapis|gstatic)\.com[^"']*["'][^>]*>/gi,'');
  const fontPreload=html.includes('href="/assets/fonts/archivo-latin-variable.woff"')?'':'<link rel="preload" href="/assets/fonts/archivo-latin-variable.woff" as="font" type="font/woff" crossorigin>';
  html=html.replace('</head>',fontPreload+'<link rel="stylesheet" href="/pure-brand.css?v=20261126-account-contrast"></head>');
  html=html.replace(/<link\b[^>]*\brel=["'](?:(?:shortcut )?icon|apple-touch-icon)["'][^>]*>/gi,'');
  html=html.replace(/<meta\b[^>]*\bname=["'](?:theme-color|altapure-promo-end)["'][^>]*>/gi,'');
  if(path.basename(file).startsWith('admin-')){
    html=html.replace(/src="\/admin-fulfillment\.js(?:\?[^"]*)?"/g,'src="/admin-fulfillment.js?v=20261126-bulk"');
    html=html.replace(/href="\/admin-fulfillment\.css(?:\?[^"]*)?"/g,'href="/admin-fulfillment.css?v=20261125-order-rows"');
    html=html.replace(/<link\b[^>]*href=["']\/admin-violet\.css[^"']*["'][^>]*>/gi,'');
    html=html.replace(/href="\/(admin-dashboard|operations)\.css(?:\?[^"]*)?"/g,'href="/$1.css?v=20261117b"');
    html=html.replace('</head>','<link rel="stylesheet" href="/admin-violet.css?v=20261117b">'+adminIconLinks+'</head>');
    fs.writeFileSync(target,html);continue;
  }
  const themeLink=html.includes('href="/brand-theme.css"')?'':'<link rel="stylesheet" href="/brand-theme.css?v=20261123-hero-labels">';
  const mobileLink=html.includes('href="/mobile-parity.css')?'':'<link rel="stylesheet" media="(max-width: 767px)" href="/mobile-parity.css?v=20261126-shop-mobile">';
  html=html.replace('</head>',`${themeLink}${mobileLink}${storefrontIconLinks}</head>`);
  const body=html.match(/<body\b([^>]*)>/i);
  if(body){
    let attrs=body[1];
    const classMatch=attrs.match(/\bclass="([^"]*)"/i);
    if(classMatch){if(!classMatch[1].split(/\s+/).includes('ap-site'))attrs=attrs.replace(classMatch[0],`class="${classMatch[1]} ap-site"`);}
    else attrs+=' class="ap-site"';
    html=html.replace(body[0],`<body${attrs}>`);
  }
  if(file==='index.html'&&!html.includes('"@type":"Organization"'))html=html.replace('</head>',`${organization}</head>`);
  html=html.replace('</head>','<link rel="stylesheet" href="/unified-palette.css?v=20261126-account-contrast"></head>');
  html=html.replace('</head>','<link rel="stylesheet" href="/pure-layout.css?v=20261118"><link rel="stylesheet" href="/pure-bulk-layout.css?v=20261118"><link rel="stylesheet" href="/pure-coa.css?v=20261118"></head>');
  html=html.replace(/src="\/(workspace-v2|supplier-coas)\.js(?:\?[^"]*)?"/g,'src="/$1.js?v=20261118-coa"');
  html=html.replace(/src="\/(checkout-reference|direct-checkout-client|payment-options-public|readiness-ui|locale)\.js(?:\?[^"]*)?"/g,'src="/$1.js?v=20261118-cad-checkout"');
  html=html.replace(/src="\/(account|workspace-v2|readiness-ui)\.js(?:\?[^"]*)?"/g,'src="/$1.js?v=20261118-autostack"');
  html=html.replace(/src="\/(account(?:-experience)?)\.js(?:\?[^"]*)?"/g,'src="/$1.js?v=20261124-auth"');
  html=html.replace(/href="\/account-experience\.css(?:\?[^"]*)?"/g,'href="/account-experience.css?v=20261118-interac"');
  // Keep the display layer and its opt-in price markup on the same release.
  html=html.replace(/src="\/(locale|storefront-v2|workspace-v2|reference-ui|cart-reference|membership-experience|research-builder-client|research-checkout-client)\.js(?:\?[^"]*)?"/g,'src="/$1.js?v=20261118-local-currency"');
  html=html.replace(/href="\/(pure-currency|pure-bulk-layout|reference-ui|cart-reference|membership-experience|research-builder-parity|research-checkout)\.css(?:\?[^"]*)?"/g,'href="/$1.css?v=20261118-local-currency"');
  // Price quotes and reward markers share one contract across the drawer and checkout.
  html=html.replace(/\b(src|href)="\/(cart-reference\.(?:js|css)|checkout-reference\.js|storefront-v2\.js)(?:\?[^"]*)?"/g,'$1="/$2?v=20261123-catalog-pricing"');
  html=html.replace(/src="\/(products|conversion-ui)\.js(?:\?[^"]*)?"/g,'src="/$1.js?v=20261123-catalog-pricing"');
  html=html.replace(/\b(src|href)="\/(conversion-ui\.(?:js|css)|storefront-v2\.js)(?:\?[^"]*)?"/g,'$1="/$2?v=20261123-hero-labels"');
  html=html.replace(/src="\/workspace-v2\.js(?:\?[^"]*)?"/g,'src="/workspace-v2.js?v=20261123-bulk-links"');
  html=html.replace(/\b(src|href)="\/(checkout-reference\.(?:js|css))(?:\?[^"]*)?"/g,'$1="/$2?v=20261122-summary-gifts"');
  html=html.replace(/src="\/(readiness-ui|direct-checkout-client)\.js(?:\?[^"]*)?"/g,'src="/$1.js?v=20261122-bulk-savings"');
  html=html.replace(/src="\/(account|checkout-reference|direct-checkout-client|native-pay)\.js(?:\?[^"]*)?"/g,'src="/$1.js?v=20261126-guest-checkout"');
  html=html.replace(/\b(src|href)="\/(cart-reference\.(?:js|css)|checkout-reference\.(?:js|css)|account\.js|account-experience\.css)(?:\?[^"]*)?"/g,'$1="/$2?v=20261125-mobile-checkout"');
  html=html.replace(/\b(src|href)="\/(storefront-v2\.js|reference-ui\.css)(?:\?[^"]*)?"/g,'$1="/$2?v=20261126-catalog-tools"');
  html=html.replace(/\b(src|href)="\/(locale\.js|cart-reference\.(?:js|css)|checkout-reference\.js)(?:\?[^"]*)?"/g,'$1="/$2?v=20261125-auto-location"');
  html=html.replace(/href="\/checkout-reference\.css(?:\?[^"]*)?"/g,'href="/checkout-reference.css?v=20261126-usdc-networks"');
  html=html.replace(/src="\/(checkout-reference|direct-checkout-client|native-pay|polygon-usdc-pay|guest-interac-pay)\.js(?:\?[^"]*)?"/g,'src="/$1.js?v=20261126-usdc-networks"');
  html=html.replace(/src="\/(locale|storefront-v2)\.js(?:\?[^"]*)?"/g,'src="/$1.js?v=20261125-welcome-age"');
  html=html.replace(/src="\/workspace-v2\.js(?:\?[^"]*)?"/g,'src="/workspace-v2.js?v=20261126-guest-order-help"');
  html=html.replace(/\b(src|href)="\/(storefront-navigation\.(?:js|css)|membership-experience\.(?:js|css)|conversion-ui\.js|workspace-v2\.js)(?:\?[^"]*)?"/g,'$1="/$2?v=20261126-mobile-storefront"');
  html=html.replace(/\b(src|href)="\/((?:storefront-v2|reference-ui|cart-reference)\.(?:js|css)|(?:storefront-navigation|pure-bulk-layout)\.css)(?:\?[^"]*)?"/g,'$1="/$2?v=20261126-shop-mobile"');
  html=html.replace(/src="\/storefront-v2\.js(?:\?[^"]*)?"/g,'src="/storefront-v2.js?v=20261126-packaging-studio"');
  html=html.replace(/href="\/account-experience\.css(?:\?[^"]*)?"/g,'href="/account-experience.css?v=20261126-bulk-summary"');
  html=html.replace(/href="\/((?:storefront-navigation|pure-currency)\.css)(?:\?[^"]*)?"/g,'href="/$1?v=20261126-compact-menu"');
  html=html.replace(/\b(src|href)="\/(storefront-v2\.(?:js|css))(?:\?[^"]*)?"/g,'$1="/$2?v=20261126-home-polish"');
  html=html.replace(/href="\/((?:pure-bulk-layout|pure-coa|reference-ui|supplier-coas|monthly-orders|subscribe-and-save)\.css)(?:\?[^"]*)?"/g,'href="/$1?v=20261126-builder-polish"');
  html=html.replace(/src="\/((?:workspace-v2|supplier-coas|monthly-orders)\.js)(?:\?[^"]*)?"/g,'src="/$1?v=20261126-builder-polish"');
  html=html.replace(/\b(src|href)="\/((?:storefront-v2|workspace-v2|reference-ui|conversion-ui|subscribe-and-save)\.(?:js|css)|(?:pure-bulk-layout|cart-reference)\.css)(?:\?[^"]*)?"/g,'$1="/$2?v=20261126-holiday-layout"');
  html=html.replace(/\b(src|href)="\/(storefront-v2\.(?:js|css))(?:\?[^"]*)?"/g,'$1="/$2?v=20261126-home-testing-card"');
  html=html.replace(/href="\/storefront-v2\.css(?:\?[^"]*)?"/g,'href="/storefront-v2.css?v=20261126-bulk-controls"');
  html=html.replace(/\b(src|href)="\/(conversion-ui\.(?:js|css))(?:\?[^"\n]*)?"/g,'$1="/$2?v=20261126-christmas-bogo"');
  html=html.replace(/\b(src|href)="\/((?:storefront-v2|reference-ui)\.js|(?:reference-ui|brand-theme)\.css)(?:\?[^"]*)?"/g,'$1="/$2?v=20261126-product-price-line"');
  html=html.replace(/src="\/((?:locale|checkout-reference|direct-checkout-client|readiness-ui|membership-checkout)\.js)(?:\?[^"]*)?"/g,'src="/$1?v=20261126-cad-price-symbol"');
  html=html.replace(/\b(src|href)="\/((?:account|readiness-ui|monthly-orders)\.js|readiness-ui\.css)(?:\?[^"]*)?"/g,'$1="/$2?v=20261126-account-subscription"');
  html=html.replace(/\b(src|href)="\/((?:account-experience|readiness-ui)\.(?:js|css))(?:\?[^"]*)?"/g,'$1="/$2?v=20261126-account-contrast"');
  html=html.replace(/href="\/cart-reference\.css(?:\?[^"]*)?"/g,'href="/cart-reference.css?v=20261126-reward-glow"');
  html=html.replace(/\b(src|href)="\/((?:storefront-v2|conversion-ui|checkout-reference|readiness-ui)\.(?:js|css)|direct-checkout-client\.js)(?:\?[^"\n]*)?"/g,'$1="/$2?v=20261126-checkout-carousel"');
  html=html.replace(/\b(src|href)="\/(storefront-v2\.(?:js|css))(?:\?[^"\n]*)?"/g,'$1="/$2?v=20261126-research-card"');
  html=html.replace(/\b(src|href)="\/(conversion-ui\.(?:js|css))(?:\?[^"\n]*)?"/g,'$1="/$2?v=20261126-shipping-promo"');
  if(file==='bulk-orders.html')html=html.replace(/\b(src|href)="\/(workspace-v2\.js|pure-bulk-layout\.css)(?:\?[^"\n]*)?"/g,'$1="/$2?v=20261126-bulk-coa-card"');
  if(file==='contact.html')html=html.replace(/href="\/reference-ui\.css(?:\?[^"]*)?"/g,'href="/reference-ui.css?v=20261126-contact-wordmark"');
  fs.writeFileSync(target,html);
  count++;
}

console.log(`Applied PURE favicon metadata and shared theme to ${count} public HTML pages.`);
require('./pure-policy-build.cjs')(out);
