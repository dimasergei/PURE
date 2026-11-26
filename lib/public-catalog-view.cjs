'use strict';

const fs = require('node:fs');
const path = require('node:path');
const {safeUrl, validReport, selectReports} = require('../supplier-coas.js');
const records = require('../data/supplier-coas.json').reports.filter(validReport);
const results = require('../data/coa-results.json');
const {publicReports} = require('./coa-library.js');
const {skuKey} = require('./commerce-eligibility.js');
const releaseReports = publicReports(require('../data/verified-coas.json'));
const images = require('../assets/products-pure/manifest.json');
const imageByVariant = new Map(images.map(row => [row.product_id + ':' + row.size, '/assets/catalog-webp/' + path.basename(row.file, '.svg') + '.webp']));
const categories = new Map([['injectables', 'Research compounds'], ['supplies', 'Laboratory supplies']]);
const esc = text => String(text ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'}[ch]));
const money = (v, site) => new Intl.NumberFormat('en-US', {style:'currency',currency:site.currency.base.toUpperCase()}).format(v);
const catalog = () => require('./catalog.json');
const img = (p, v) => imageByVariant.get(p.id + ':' + v.size) || '/assets/research-vials-pure.webp';
const slug = p => '/product/' + encodeURIComponent(p.id);
const bySize = (p, v) => slug(p) + '?size=' + encodeURIComponent(v.size);
const distinct = list => [...new Set(list.filter(Boolean))].sort((a,b) => a.localeCompare(b, 'en', {numeric:true}));
const read = (params, name) => (params.get(name) || '').trim().slice(0,120);
const stock = v => v.stock_status === 'in_stock';
const image = (p, v, priority = false) => '<img src="'+esc(img(p,v))+'" width="640" height="862" alt="'+esc(p.name+' '+v.size+' product label')+'" '+(priority?'loading="eager" fetchpriority="high"':'loading="lazy"')+' decoding="async">';
const formatDate = iso => /^\d{4}-\d{2}-\d{2}$/.test(iso || '') ? '<time datetime="'+esc(iso)+'">'+esc(iso)+'</time>' : 'Not reported';
function link(base, values) {
  const q = new URLSearchParams();
  for (const [k,v] of Object.entries(values)) if (v) q.set(k, v);
  return esc(base + (q.size ? '?'+q.toString() : ''));
}
function select(name, label, entries, params, all='All') {
  const current = read(params,name);
  return '<label>'+esc(label)+'<select name="'+name+'"><option value="">'+esc(all)+'</option>'+entries.map(([value,label])=>'<option value="'+esc(value)+'"'+(value===current?' selected':'')+'>'+esc(label)+'</option>').join('')+'</select></label>';
}
const options = a => distinct(a).map(x=>[x,x]);
function paginate(items, size, params, base, keys) {
  const total = Math.max(1,Math.ceil(items.length/size));
  const raw = Number(read(params,'page'));
  const page = Number.isInteger(raw) ? Math.max(1,Math.min(total,raw)) : 1;
  const keep = Object.fromEntries(keys.map(k => [k,read(params,k)]));
  const anchors = Array.from({length:total},(_,i)=>'<a href="'+link(base,{...keep,page:String(i+1)})+'" aria-label="Page '+(i+1)+'"'+(page===i+1?' aria-current="page"':'')+'>'+(i+1)+'</a>').join('');
  return { items:items.slice((page-1)*size,page*size), nav:total>1 ? '<nav class="pc-pager" aria-label="Result pages">'+anchors+'</nav>':'' };
}
function shopForm(params,site) {
  const sizes=options(catalog().flatMap(p=>p.variants.map(v=>v.size)));
  return '<form action="/shop/browse" method="get" class="pc-filters" role="search" aria-label="Filter research products"><label>Product search<input type="search" name="q" maxlength="120" value="'+esc(read(params,'q'))+'"></label>'
    +select('category','Category',[...categories],params,'All categories')+select('group','Research area',options(Object.values(site.catalogGroups||{})),params,'All research areas')+select('size','Size',sizes,params,'All sizes')
    +'<label>Maximum price (USD)<input name="max" type="number" min="0" step="0.01" value="'+esc(read(params,'max'))+'"></label>'
    +select('stock','Availability',[['in-stock','Confirmed in stock']],params,'All listings')
    +select('sort','Sort order',[['low','Price, low to high'],['high','Price, high to low'],['name','Name, A–Z']],params,'Catalog order')
    +'<div class="pc-form-actions"><button class="ap-button" type="submit">Show products</button><a href="/shop">Reset</a></div></form>';
}
function compareBox(p) {
  return '<label class="pc-compare" data-pc-enhance><input type="checkbox" data-compare="'+esc(p.id)+'"> Compare<span class="ap-sr"> '+esc(p.name)+'</span></label>';
}
function card(p, vs, site, priority=false) {
  const first = [...vs].sort((a,b)=>a.price-b.price)[0];
  const range = vs.length>1 ? vs[0].size+' – '+vs[vs.length-1].size : first.size;
  return '<article class="pc-card"><a class="pc-card-image" href="'+esc(bySize(p,first))+'" tabindex="-1" aria-hidden="true">'+image(p,first,priority)+'</a><div><h3><a href="'+esc(slug(p))+'">'+esc(p.name)+'</a></h3><p>'+esc(range)+'</p><strong>'+(vs.some(v=>v.price!==first.price)?'From ':'')+money(first.price,site)+'</strong><div class="pc-card-actions"><a class="ap-button" href="'+esc(bySize(p,first))+'">View options</a><button type="button" class="ap-button" data-pc-enhance data-action="add" data-id="'+esc(p.id)+'" data-size="'+esc(first.size)+'" aria-label="'+esc('Add '+p.name+' '+first.size+' to cart')+'">Add '+esc(first.size)+'</button>'+compareBox(p)+'</div></div></article>';
}
const shopKeys = ['q','category','group','size','max','stock','sort'];
function shop(params,site) {
  const query=read(params,'q').toLowerCase(),category=read(params,'category'),size=read(params,'size'),max=read(params,'max'),onlyStock=read(params,'stock')==='in-stock',sort=read(params,'sort');
  const group=read(params,'group');
  const rows=catalog().filter(p=>(!category||p.category===category)&&(!group||site.catalogGroups?.[p.group]===group||p.group===group)).map(p=>({p,variants:p.variants.filter(v=>(!size||v.size===size)&&(!max||v.price<=Number(max))&&(!onlyStock||stock(v))&&(p.name+' '+p.id+' '+v.size).toLowerCase().includes(query))})).filter(r=>r.variants.length);
  const min = row=>Math.min(...row.variants.map(v=>v.price));
  if (sort==='low'||sort==='high') rows.sort((a,b)=>(sort==='low'?1:-1)*(min(a)-min(b)));
  if (sort==='name') rows.sort((a,b)=>a.p.name.localeCompare(b.p.name));
  const {items,nav}=paginate(rows,20,params,'/shop/browse',shopKeys);
  return '<div class="pc-page ap-container" data-public-catalog><header><h1>Research catalog</h1><p>Browse laboratory compounds and supplies by size and price. '+esc(site.ruo)+'</p></header>'+shopForm(params,site)+'<h2 class="pc-result-count">'+rows.length+' product'+(rows.length===1?'':'s')+' · Prices in '+esc(site.currency.base.toUpperCase())+'</h2><div class="pc-grid">'+items.map((r,i)=>card(r.p,r.variants,site,i===0)).join('')+'</div>'+(!items.length?'<p>No products match these filters. '+(onlyStock?'Unconfirmed stock is excluded. ':'')+'<a href="/shop">See the full catalog</a>.</p>':'')+nav+'<details class="pc-details"><summary>Where can I find a product report?</summary><p>Open <a href="/coas">Lab Testing &amp; COAs</a> and filter by compound or report lot.</p></details></div>';
}

function originals(r) {
  const urls=r.document_type==='images'?r.document_pages:[r.document_url];
  return '<button type="button" class="pc-preview" data-pc-enhance data-preview-report="'+esc(r.id)+'" data-document-url="'+esc(safeUrl(r.document_url))+'" aria-haspopup="dialog">Preview</button> '+urls.map((u,i)=>'<a href="'+esc(safeUrl(u))+'" target="_blank" rel="noopener noreferrer">'+(r.document_type==='images'?'Report sheet '+(i+1):'Original PDF')+'<span class="ap-sr">, '+esc(r.report_id)+', opens in a new tab</span></a>').join(' ');
}
function reportRows(list) {
  if (!list.length) return '<p>No supplier reports match this selection.</p>';
  return '<div class="pc-table-scroll" role="region" aria-label="Supplier report results" tabindex="0"><table class="pc-reports"><caption class="ap-sr">Supplier-submitted samples and original reports</caption><thead><tr><th scope="col">Product / size</th><th scope="col">Reported lot</th><th scope="col">Dates</th><th scope="col">Sample purity</th><th scope="col">Laboratory</th><th scope="col">Report</th></tr></thead><tbody>'+list.map(r=>{
    const a=results[r.id]||{};
    return '<tr><th scope="row"><a href="'+esc(slug({id:r.product_id}))+'">'+esc(r.product)+'</a><small>'+esc(r.size)+'</small></th><td data-label="Lot">'+esc(r.lot)+'</td><td data-label="Dates">Reported '+formatDate(r.report_date)+'<small>'+esc(a.test_label||'Tested')+' '+(a.test_date?formatDate(a.test_date):'— see original')+'</small></td><td data-label="Sample purity">'+esc(a.purity||'See original report')+'</td><td data-label="Laboratory">'+esc(r.lab_name)+'<small>'+esc((a.methods||[]).join(' · '))+'</small></td><td data-label="Report">'+originals(r)+'<small>'+esc(r.report_id)+'</small><small>'+esc(r.supplier)+'</small>'+(r.id.startsWith('ypb-')?'<small>Publisher-issued certificate</small>':'')+'</td></tr>';
  }).join('')+'</tbody></table></div>';
}
function inventoryReports(params) {
  if (!releaseReports.length) return '';
  const product=read(params,'product'),size=read(params,'size'),lot=read(params,'lot').toLowerCase(),lab=read(params,'lab'),date=read(params,'date');
  const terms=read(params,'q').toLowerCase().split(/\s+/).filter(Boolean);
  const entries=[];
  for (const report of releaseReports) {
    const p=catalog().find(p=>p.id===report.product_id);
    const variant=p?.variants.find(v=>skuKey(p.id,v.size)===report.sku_key);
    if (!p||!variant||(product&&p.id!==product)||(size&&variant.size!==size)||(lab&&lab!==report.lab_name)||(date&&date!==report.report_date)||(lot&&!report.lot.toLowerCase().includes(lot))) continue;
    const searchable=[p.name,variant.size,report.report_id,report.lab_name,report.lot].join(' ').toLowerCase();
    if (!terms.every(t=>searchable.includes(t))) continue;
    entries.push('<li><a href="'+esc(report.document_url)+'">'+esc(p.name+' '+variant.size+' · '+report.lot)+'</a> · '+esc(report.lab_name)+' · '+formatDate(report.report_date)+'</li>');
  }
  return entries.length?'<section><h2>Published PURE inventory lot reports</h2><ul>'+entries.join('')+'</ul></section>':'';
}
const coaKeys = ['q','lot','product','size','date','lab','supplier'];
function archive(params,site,mainPage=false) {
  params = new URLSearchParams(params);
  if (!params.has('q') && params.has('query')) params.set('q',read(params,'query'));
  if (!params.has('lab') && params.has('laboratory')) params.set('lab',read(params,'laboratory'));
  const traceExample=records.find(r=>r.id==='pd-nad-500mg-research-peptide');
  const p=read(params,'product'),size=read(params,'size'),lab=read(params,'lab'),supplier=read(params,'supplier'),lot=read(params,'lot').toLowerCase(),date=read(params,'date');
  const filtered=selectReports(records,{product:p,size,laboratory:lab,supplier,query:read(params,'q')})
    .filter(r=>(!lot||r.lot.toLowerCase().includes(lot))&&(!date||r.report_date===date||results[r.id]?.test_date===date))
    .sort((a,b)=>(b.report_date||'').localeCompare(a.report_date||'')||a.product.localeCompare(b.product));
  // The permanent archive exposes every original link in its HTML. GET result views paginate.
  const {items,nav}=paginate(filtered,mainPage?Math.max(1,records.length):20,params,'/coas/search',coaKeys);
  const form='<form class="pc-filters" action="/coas/search" method="get" role="search" aria-label="Filter lab reports"><label>Search reports<input name="q" type="search" maxlength="120" value="'+esc(read(params,'q'))+'"></label>'
    +select('product','Compound',catalog().map(p=>[p.id,p.name+(p.category==='supplies'?' '+p.variants[0].size:'')]),params,'All compounds')+select('size','Size',options(records.map(r=>r.size)),params,'All sizes')
    +'<label>Reported lot<input name="lot" maxlength="120" value="'+esc(read(params,'lot'))+'"></label><label>Report or test date<input name="date" type="date" value="'+esc(date)+'"></label>'
    +select('lab','Laboratory',options(records.map(r=>r.lab_name)),params,'All laboratories')+select('supplier','Supplier',[...new Map(records.map(r=>[r.supplier_id,r.supplier]))],params,'All suppliers')
    +'<div class="pc-form-actions"><button class="ap-button" type="submit">Find reports</button><a href="/coas">Reset</a></div></form>';
  return '<div class="pc-page ap-container" data-coa-archive><header><h1>Lab Testing &amp; COAs</h1><p>'+esc(site.testing.scope)+'</p></header>'+form+inventoryReports(params)+'<section><h2>Supplier reports <span>('+filtered.length+')</span></h2>'+reportRows(items)+nav+'</section><section class="pc-guide"><h2>How to read a COA</h2><p>Match the compound, size and printed lot to the label. A report ID identifies the laboratory record. The test date and the issue date can differ.</p><p>Read the method, units and result together. Chromatographic area purity describes the tested sample under the stated conditions. Mass spectrometry can support an identity assignment. Check the original for chromatograms, spectra and any exclusions.</p>'+(traceExample?'<p><a href="'+esc(safeUrl(traceExample.document_url))+'">See the HPLC chromatogram and mass spectrum in the Bioviridian NAD+ sample report</a>.</p>':'')+'<details class="pc-details"><summary>How do I request the report for an order?</summary><p>Send <a href="/contact">PURE support</a> the order number and the lot printed on the vial so the team can check for a matching release document.</p></details><p>'+esc(site.ruo)+'</p></section></div>';
}
module.exports={catalog,records,results,esc,money,image,img,slug,bySize,stock,link,inventoryReports,shopForm,shop,archive,originals,reportRows,compareBox,card};

function handle(req,res,params) {
  if (req.method!=='GET'&&req.method!=='HEAD') {
    res.setHeader('Allow','GET, HEAD');
    return res.status(405).end();
  }
  const {site}=require('./public-site.cjs');
  const isArchive=params.get('catalog_view')==='coas';
  const route=isArchive?'/coas':'/shop';
  const title=isArchive?'Lab Report Search | PURE':'Browse Research Products | PURE';
  const description=isArchive?'Search supplier laboratory reports by compound, size, lot, date and laboratory.':'Filter research compounds and laboratory supplies by size, category, price and confirmed availability.';
  let html=fs.readFileSync(path.join(__dirname,'public-catalog-shell.html'),'utf8')
    .replace(/<title\b[^>]*>[^<]*<\/title>/i,'<title data-pure-page-title>'+title+'</title>')
    .replace(/<link\b(?=[^>]*\brel=["']canonical["'])[^>]*>/gi,'')
    .replace(/<meta\b(?=[^>]*\b(?:name|property)=["'](?:description|robots|og:(?:url|title|description)|twitter:(?:title|description))["'])[^>]*>/gi,'')
    .replace('</head>','<meta name="robots" content="noindex,follow"><meta name="description" content="'+description+'"><link rel="canonical" href="'+esc(site.origin+route)+'"><meta property="og:title" content="'+title+'"><meta property="og:description" content="'+description+'"><meta property="og:url" content="'+esc(site.origin+route)+'"><meta name="twitter:title" content="'+title+'"><meta name="twitter:description" content="'+description+'"></head>');
  const publicPath=isArchive?'/coas/search':'/shop/browse';
  const saved=new URLSearchParams();
  for(const key of (isArchive?[...coaKeys,'query','laboratory','page']:[...shopKeys,'page'])){
    const value=read(params,key);
    if(value)saved.set(key,value);
  }
  const returnTo=publicPath+(saved.size?'?'+saved:'');
  html=html.replace(/(name="returnTo" value=")[^"]*/g,(_,start)=>start+esc(returnTo))
    .replace(/(age_gate=prompt(?:&amp;|&)returnTo=)[^"&]*/g,(_,start)=>start+encodeURIComponent(returnTo));
  const content=isArchive?archive(params,site):shop(params,site);
  html=html.replace('<!-- public-catalog-results -->',()=>content);
  res.setHeader('Content-Type','text/html; charset=utf-8');
  return res.status(200).end(req.method==='HEAD'?undefined:html);
}
module.exports.handle=handle;
