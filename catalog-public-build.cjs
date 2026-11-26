'use strict';

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const views = require('./reference-ui-functions.cjs').store;
const {
  catalog, records, esc, money, img, image, slug, bySize, stock, link,
  shopForm, shop, archive, reportRows, compareBox, card
} = require('./lib/public-catalog-view.cjs');
const main = /(<main\b[^>]*\bid=["']ap-main["'][^>]*>)[\s\S]*?<\/main>/i;
const inject = (html, content) => {
  if (!main.test(html)) throw new Error('Catalog page is missing its main element.');
  return html.replace(main, (_,start) => start + content + '</main>');
};
function css(html) {
  return html.replace('</head>','<link rel="stylesheet" href="/catalog-public.css"><noscript><style>[data-pc-enhance]{display:none!important}</style></noscript></head>');
}
function productDocs(p,site) {
  const reports=records.filter(r=>r.product_id===p.id);
  const stockNote=p.variants.some(stock)?p.variants.filter(stock).map(v=>esc(v.size)).join(', ')+' confirmed in stock.':'[PLACEHOLDER: confirmed inventory availability by size]';
  return '<section class="ap-container pc-product-library" aria-label="Product specifications and reports"><h2>Product documentation</h2><p>'+esc(site.testing.scope)+'</p>'
    +'<div class="pc-product-facts"><div><h3>Stock status</h3><p>'+stockNote+'</p></div><div><h3>Storage and handling</h3><p>[PLACEHOLDER: approved storage and handling information for this product]</p></div><div><h3>Fulfillment lot and release COA</h3><p>[PLACEHOLDER: inventory-linked lot, test methods, purity and original release COA]</p></div></div>'
    +(reports.length?'<details class="pc-details"><summary>Supplier sample reports ('+reports.length+')</summary>'+reportRows(reports)+'</details>':'<p>No supplier reference is on file for this catalog product. <a href="/contact">Request documentation</a>.</p>')
    +'<details class="pc-details"><summary>How can I match a report to my product?</summary><p>Match the product, size and lot printed on the vial. <a href="'+link('/coas/search',{product:p.id})+'">Find reports for '+esc(p.name)+'</a> or <a href="/contact">ask for the assigned lot record</a>.</p></details></section>';
}
function product(p,site,docs) {
  const first=p.variants[0],related=catalog().filter(other=>other.id!==p.id&&other.group===p.group).slice(0,3);
  const sizes=p.variants.map(v=>'<li><a href="'+esc(bySize(p,v))+'">'+esc(v.size)+'</a> <strong>'+money(v.price,site)+'</strong></li>').join('');
  const gallery=p.variants.length>1?'<details class="pc-details"><summary>See all size labels</summary><div class="pc-gallery">'+p.variants.map(v=>'<figure>'+image(p,v)+'<figcaption>'+esc(v.size)+'</figcaption></figure>').join('')+'</div></details>':'';
  return '<div class="ap-container nl-product-breadcrumb"><a href="/shop">Products</a> / '+esc(p.name)+'</div><section class="ap-container ap-product-layout nl-detail"><div class="ap-detail-image">'+image(p,first,true)+'</div><div class="ap-detail-copy"><h1>'+esc(p.name)+'</h1><p>'+esc(p.blurb)+'</p><p>'+esc(site.ruo)+'</p><h2>Sizes and prices</h2><ul class="pc-sizes">'+sizes+'</ul><small>Catalog prices in '+esc(site.currency.base.toUpperCase())+'.</small>'+compareBox(p)+'<noscript><p>Enable JavaScript to select a size and add this product to your cart.</p></noscript>'+gallery+'<details class="pc-details"><summary>Shipping and returns</summary><p>'+esc(site.shipping.freeSummary)+'</p><p>'+esc(site.returns.summary)+'</p><a href="/shipping-policy">Shipping policy</a></details></div></section>'+docs
    +(related.length?'<section class="ap-container pc-product-library"><h2>Related products</h2><div class="pc-grid">'+related.map(other=>card(other,other.variants,site)).join('')+'</div></section>':'');
}
function productSchema(p,site) {
  const base=site.origin,usd=site.currency.base.toUpperCase();
  const offers=p.variants.map(v=>({
    '@type':'Offer',name:p.name+' '+v.size,price:v.price.toFixed(2),priceCurrency:usd,url:base+bySize(p,v),
    ...(stock(v)?{availability:'https://schema.org/InStock'}:{})
  }));
  return {'@context':'https://schema.org','@type':'Product','@id':base+slug(p)+'#product',name:p.name,description:p.blurb,sku:p.sku_code||p.id,brand:{'@type':'Brand',name:site.name},url:base+slug(p),image:p.variants.map(v=>base+img(p,v)),offers};
}
// Render the same catalog layout used by the client so its hero, cards and first
// image are already in place while the currency, cart and offer data initialize.
function initialShop(site,filters) {
  const products=catalog(),pageSize=20;
  const state={query:'',group:'All',sort:'popular'};
  const render=vm.runInNewContext('('+views.shop.toString()+')',{
    shopCategories:['All','Peptides','Mist Applicators','Supplies'],state,esc,
    document:{getElementById:()=>({innerHTML:filters})}
  });
  const renderCard=vm.runInNewContext('('+views.card.toString()+')',{
    esc,route:()=>'/shop',cardVariant:p=>p.variants[0],cardBadge:()=>'',
    webpProductImage:(p,size)=>img(p,p.variants.find(v=>v.size===size)),
    image:(p,size)=>img(p,p.variants.find(v=>v.size===size)),
    priceMarkup:v=>money(v,site),
    catalogCardAction:(p,v)=>'<div class="ap-catalog-actions"><a class="ap-button ap-button-secondary ap-catalog-view" href="'+esc(bySize(p,v))+'">View More</a><button type="button" class="ap-button ap-catalog-action" data-pc-enhance data-id="'+esc(p.id)+'" data-size="'+esc(v.size)+'" data-action="'+(p.variants.length>1?'catalog-options':'add')+'" '+(p.variants.length>1?'aria-haspopup="dialog"':'data-open-cart')+'>Add to Cart</button></div>'
  });
  const cards=products.slice(0,pageSize).map((p,i)=>{
    const html=renderCard(p,{featured:true,quickAdd:true}).replace('class="pc-compare"','class="pc-compare" data-pc-enhance');
    return i===0?html.replace('loading="lazy"','loading="eager" fetchpriority="high"'):html;
  }).join('');
  const links=Array.from({length:Math.ceil(products.length/16)},(_,i)=>'<a href="/shop/browse?page='+(i+1)+'">'+(i+1)+'</a>').join('');
  return render().replace('class="pure-shop-page"','class="pure-shop-page" data-server-shop')
    .replace('id="ap-catalog-grid"></div>',()=> 'id="ap-catalog-grid">'+cards+'</div>')
    .replace('class="ap-toolbar nl-shop-controls"','class="ap-toolbar nl-shop-controls" data-pc-enhance')
    .replace('class="nl-filter-pills"','class="nl-filter-pills" data-pc-enhance')
    .replace('id="ap-load-more"','id="ap-load-more" data-pc-enhance')
    .replace('</section></div>',()=>'<noscript><nav class="pc-pager" aria-label="Catalog pages">'+links+'</nav></noscript><details class="pc-details"><summary>Where can I find a product report?</summary><p>Search <a href="/coas">Lab Testing &amp; COAs</a> by product, strength or lot.</p></details><p>'+esc(site.ruo)+'</p></section></div>');
}
function buildCatalogPages(out,site) {
  const shopFile=path.join(out,'shop.html'),archiveFile=path.join(out,'coas.html');
  const searchShell=css(fs.readFileSync(shopFile,'utf8'));
  fs.copyFileSync(path.join(__dirname,'catalog-public.css'),path.join(out,'catalog-public.css'));
  const imageDir=path.join(out,'assets','catalog-webp');
  fs.mkdirSync(imageDir,{recursive:true});
  fs.cpSync(path.join(__dirname,'assets','catalog-webp'),imageDir,{recursive:true});
  fs.writeFileSync(path.join(__dirname,'lib/public-catalog-shell.html'),inject(searchShell,'<!-- public-catalog-results -->'));
  const blank=new URLSearchParams();
  const filters='<details class="pc-more-filters"><summary>Filters by size, price and availability</summary>'+shopForm(blank,site)+'</details>';
  fs.writeFileSync(shopFile,inject(searchShell,initialShop(site,filters)).replace('</main>',()=>'</main><template id="pure-shop-filters">'+filters+'</template>'));
  fs.writeFileSync(archiveFile,inject(css(fs.readFileSync(archiveFile,'utf8')),archive(blank,site,true)));
  for(const p of catalog()) {
    const file=path.join(out,'product',p.id+'.html'),docs=productDocs(p,site);
    let html=css(fs.readFileSync(file,'utf8')).replace(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi,(tag,body)=>{
      try { return JSON.parse(body)['@type']==='Product'?'':tag; } catch {return tag;}
    });
    const details=docs+(p.variants.length>1?'<section class="ap-container pc-product-library"><details class="pc-details"><summary>Gallery by size</summary><div class="pc-gallery">'+p.variants.map(v=>'<figure><a href="'+esc(bySize(p,v))+'">'+image(p,v)+'</a><figcaption>'+esc(v.size)+'</figcaption></figure>').join('')+'</div></details></section>':'');
    html=inject(html,product(p,site,docs)).replace('</main>',()=>'</main><template id="pure-product-library">'+details+'</template>');
    const schema=JSON.stringify(productSchema(p,site)).replace(/</g,'\\u003c');
    fs.writeFileSync(file,html.replace('</head>',()=>'<script type="application/ld+json">'+schema+'</script></head>'));
  }
}
module.exports={buildCatalogPages};
