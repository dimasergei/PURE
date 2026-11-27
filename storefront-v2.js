/* Unified PURE storefront. */
(() => {
 'use strict';
 const catalog=typeof CATALOG==='undefined'?[]:CATALOG;
 const groups=typeof GROUPS==='undefined'?['All']:GROUPS;
 const $=(s,r=document)=>r.querySelector(s), $$=(s,r=document)=>Array.from(r.querySelectorAll(s));
 const age=$('#ap-age-dialog');
 const minimumAge=window.PureSite?.minimumAge??21;
 const welcomeCookie='pure_age='+minimumAge+'-v1';
 let welcomeReady=false;
 function saveWelcome(){
  document.cookie=welcomeCookie+'; Max-Age=2592000; Path=/; SameSite=Lax'+(location.protocol==='https:'?'; Secure':'');
  try{localStorage.removeItem('ap-age-verified');}catch{}
 }
 const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const dictionary={
  en:{shop:'Products',categories:'Categories',bulk:'Bulk Orders',coas:'Testing',about:'About',contact:'Contact Us',moreNav:'More',partnerNav:'Partner Program',trackNav:'Track Order',rewardsNav:'Rewards & Credit',searchHint:'Search compounds, sizes, and more',heroA:'CUTTING EDGE',heroB:'PURITY',heroText:'Research compounds, product documentation, and straightforward ordering for laboratories and research teams.',explore:'Explore the catalog',collection:'Featured Compounds',catalogTitle:'Find your next compound.',catalogText:'Compare exact sizes and per-unit prices, then add your selections to your cart.',viewAll:'View all compounds',perUnit:'per unit',add:'Add to cart',saved:'Saved',save:'Save product',compare:'Compare',search:'Search compounds',sortName:'Name: A–Z',sortLow:'Price: low to high',sortHigh:'Price: high to low',loadMore:'Show more compounds',noResults:'No matching compounds.',clear:'Clear filters',cart:'Your cart',cartEmpty:'Your cart is waiting for its first compound.',subtotal:'Subtotal',checkoutPaused:'Instant card checkout is not connected. Reviewed invoices are available.',checkoutNote:'Request an invoice for manual fulfillment. Pay only after the final amount and business receiving method are confirmed.',continueShop:'Continue exploring',export:'Export list',remove:'Remove',documentation:'Documentation',delivery:'Shipping & delivery',overview:'Overview',selectedSize:'Selected size',categoryTitle:'Explore by research area.',workspaceTitle:'Built around the way you research.',qualityTitle:'The details matter. Start with the documentation.',faqTitle:'A little clarity goes a long way.',updatesTitle:'Stay in the research loop.',updatesText:'Request product, catalog, and program updates from the PURE team.',updatesButton:'Request updates',requestSent:'Your request was received by our email service.',unavailable:'That information is not available yet.',added:'Added to your cart',compareLimit:'Choose up to four compounds to compare.',bulkCard:'More units. Less busywork.',bulkLead:'Build a quantity matrix across exact product variants and check out in one order.',quote:'Build Order'},
  fr:{shop:'Produits',moreNav:'Plus',partnerNav:'Partenaires',trackNav:'Suivre une commande',rewardsNav:'Points et crédit',categories:'Catégories',bulk:'Commandes en volume',coas:'Testing',about:'À propos',contact:'Contact',searchHint:'Rechercher un composé, un format…',heroA:'Votre recherche.',heroB:'Tout est connecté.',heroText:'Explorez les composés de recherche, préparez votre prochain projet et rassemblez les détails dans votre espace PURE.',explore:'Explorer le catalogue',collection:'Explorer la collection.',catalogTitle:'Trouvez votre prochain composé.',catalogText:'Comparez les formats et les prix unitaires. Enregistrez ou ajoutez vos sélections à une liste de recherche.',viewAll:'Voir tous les composés',perUnit:'par unité',add:'Ajouter au panier',saved:'Enregistré',save:'Enregistrer',compare:'Comparer',search:'Rechercher des composés',sortName:'Nom : A–Z',sortLow:'Prix croissant',sortHigh:'Prix décroissant',loadMore:'Afficher plus de composés',noResults:'Aucun composé correspondant.',clear:'Effacer les filtres',cart:'Votre panier',cartEmpty:'Votre panier attend son premier composé.',subtotal:'Sous-total',checkoutPaused:'Le paiement instantané par carte est indisponible. Demandez une facture.',checkoutNote:'Préparez et enregistrez votre panier. Aucun paiement ne sera effectué.',continueShop:'Continuer à explorer',export:'Exporter la liste',remove:'Retirer',documentation:'Documentation',delivery:'Expédition et livraison',overview:'Présentation',selectedSize:'Format sélectionné',categoryTitle:'Explorer par domaine de recherche.',workspaceTitle:'Conçu pour votre recherche.',qualityTitle:'Les détails comptent. Commencez par la documentation.',faqTitle:'Des réponses à vos questions.',updatesTitle:'Restez informé.',updatesText:'Demandez les nouvelles du catalogue et des programmes PURE.',updatesButton:'Demander les nouvelles',requestSent:'Votre demande a été reçue par notre service de messagerie.',unavailable:'Ces informations ne sont pas encore disponibles.',added:'Ajouté au panier',compareLimit:'Choisissez jusqu’à quatre composés.',bulkCard:'Plus d’unités. Moins de saisie.',bulkLead:'Préparez les quantités par format et envoyez une demande de devis.',quote:'Créer une demande'},
  es:{shop:'Productos',moreNav:'Más',partnerNav:'Programa de socios',trackNav:'Seguir pedido',rewardsNav:'Puntos y crédito',categories:'Categorías',bulk:'Pedidos al por mayor',coas:'Testing',about:'Acerca de',contact:'Contacto',searchHint:'Buscar compuestos, tamaños y más',heroA:'Su investigación.',heroB:'Todo conectado.',heroText:'Explore compuestos, prepare su próximo proyecto y mantenga los detalles juntos en su espacio PURE.',explore:'Explorar el catálogo',collection:'Explore la colección.',catalogTitle:'Encuentre su próximo compuesto.',catalogText:'Compare tamaños y precios por unidad. Guarde, compare o añada selecciones a su lista de investigación.',viewAll:'Ver todos los compuestos',perUnit:'por unidad',add:'Añadir al carrito',saved:'Guardado',save:'Guardar',compare:'Comparar',search:'Buscar compuestos',sortName:'Nombre: A–Z',sortLow:'Precio: menor a mayor',sortHigh:'Precio: mayor a menor',loadMore:'Mostrar más compuestos',noResults:'No se encontraron compuestos.',clear:'Borrar filtros',cart:'Su carrito',cartEmpty:'Su carrito espera su primer compuesto.',subtotal:'Subtotal',checkoutPaused:'El pago instantáneo con tarjeta no está conectado. Solicite una factura.',checkoutNote:'Puede preparar y guardar su carrito. No se realizará ningún pago.',continueShop:'Seguir explorando',export:'Exportar lista',remove:'Quitar',documentation:'Documentación',delivery:'Envío y entrega',overview:'Descripción',selectedSize:'Tamaño seleccionado',categoryTitle:'Explorar por área de investigación.',workspaceTitle:'Diseñado para su investigación.',qualityTitle:'Los detalles importan. Empiece por la documentación.',faqTitle:'Respuestas para seguir adelante.',updatesTitle:'Manténgase al día.',updatesText:'Solicite novedades de productos, catálogo y programas PURE.',updatesButton:'Solicitar novedades',requestSent:'Nuestro servicio de correo ha recibido su solicitud.',unavailable:'Esta información aún no está disponible.',added:'Añadido al carrito',compareLimit:'Seleccione hasta cuatro compuestos.',bulkCard:'Más unidades. Menos trabajo.',bulkLead:'Prepare cantidades por variante y envíe una solicitud de presupuesto.',quote:'Crear solicitud'}
 };
 const t=(key,fallback)=>dictionary[window.AltaLocale?.language||'en']?.[key]??window.AltaLocale?.t(key,fallback??dictionary.en[key]??key)??fallback??dictionary.en[key]??key;
 const money=value=>window.AltaLocale?.formatMoney(Number(value)||0)??new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(Number(value)||0);
 const priceMarkup=(value,options={})=>{const amount=Number(value)||0,cents=Math.round(amount*100);return window.AltaLocale?.price?window.AltaLocale.price(cents,options):esc(new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',minimumFractionDigits:options.trimWhole&&cents%100===0?0:2,maximumFractionDigits:2}).format(amount));};
 const memory=new Map();
 const read=(key,fallback)=>{try{return JSON.parse(localStorage.getItem(key)||'null')??fallback;}catch{return memory.get(key)??fallback;}};
 const write=(key,value)=>{memory.set(key,value);try{localStorage.setItem(key,JSON.stringify(value));return true;}catch{return false;}};
 const product=id=>catalog.find(p=>p.id===id);
 const searchText=p=>[p.name,p.group,...p.variants.map(v=>v.size)].filter(Boolean).join(' ').toLowerCase();
 const image=(p,size)=>{const v=p?.variants.find(v=>v.size===size)||p?.variants[0];const raw=typeof PRODUCT_IMAGES!=='undefined'?PRODUCT_IMAGES[p?.id]?.[v?.size]:null;const fallback=typeof PRODUCT_IMAGE_FALLBACKS!=='undefined'?PRODUCT_IMAGE_FALLBACKS[p?.id]:null;const src=raw||fallback||'/assets/research-vials-pure.webp';return src.startsWith('https://')||src.startsWith('/')?src:'/'+src;};
 function normalizeLines(input){const lines=new Map();if(!Array.isArray(input))return[];for(const x of input.slice(0,100)){const p=product(x?.id),v=p?.variants.find(v=>v.size===x.size);if(!v||!Number.isSafeInteger(x.qty)||x.qty<1||x.qty>100)continue;const key=p.id+':'+v.size;const previous=lines.get(key);lines.set(key,{key,id:p.id,name:p.name,size:v.size,price:v.price,qty:Math.min(100,(previous?.qty||0)+x.qty)});}return [...lines.values()];}
 let cart=normalizeLines(read('pp-cart',[]));
 let saved=Array.isArray(read('ap-wishlist',[]))?read('ap-wishlist',[]).filter(id=>product(id)):[];
 let compared=[];
 const selections={};
 const route=()=>location.pathname.replace(/\.html$/,'').replace(/\/$/,'')||'/';
 const initialParams=new URLSearchParams(location.search);
 const initialCategory=initialParams.get('offer')==='second-unit'?'Offers':initialParams.get('category')||'All';
 const shopCategories=['All','Peptides','Mist Applicators','Supplies'];
 const categoryOf=p=>p.category==='supplies'?'Supplies':'Peptides';
 const state={query:'',group:initialCategory==='Reconstitution Solution & Supplies'?'Supplies':groups.includes(initialCategory)&&initialCategory!=='All'?'Peptides':initialCategory,sort:'popular',limit:12,maxPrice:Math.ceil(Math.max(0,...catalog.flatMap(p=>p.variants.map(v=>v.price)))),savedOnly:false};
 let reports=[];
 let reviewSummary=null;
 let toastTimer;
 function toast(text){const node=$('#ap-toast');if(!node)return;clearTimeout(toastTimer);node.textContent=text;node.hidden=false;toastTimer=setTimeout(()=>{node.hidden=true;},3400);}
 function syncCart(modified=false){if(modified)write('ap-research-cart-origin-v1',null);write('pp-cart',cart);$$('.ap-cart-count').forEach(n=>{const count=cart.reduce((sum,x)=>sum+x.qty,0);n.textContent=String(count);n.hidden=count===0;});if($('#ap-cart-dialog')?.open)renderCart();window.dispatchEvent(new CustomEvent('alta:cart',{detail:{count:cart.length}}));}
 function addItems(input){
  const valid=normalizeLines(input);
  if(!Array.isArray(input)||valid.length!==input.length)throw Error('Invalid product selection.');
  const merged=new Map(cart.map(line=>[line.key,line]));
  for(const line of valid){
   const qty=(merged.get(line.key)?.qty||0)+line.qty;
   if(qty>100)throw Error('A cart line can contain up to 100 units.');
   merged.set(line.key,{...line,qty});
  }
  if(merged.size>60&&merged.size>cart.length)throw Error('A cart can contain up to 60 different items.');
  cart=[...merged.values()];syncCart(true);toast(t('added'));
 }
 function adjustQuantity(key,delta){if(typeof key!=='string'||!Number.isSafeInteger(delta)||Math.abs(delta)!==1)return false;const found=cart.some(x=>x.key===key);if(!found)return false;cart=normalizeLines(cart.map(x=>x.key===key?{...x,qty:Math.max(0,Math.min(100,x.qty+delta))}:x).filter(x=>x.qty>0));syncCart(true);return true;}
 function showDialog(id){const d=$(id);if(d&&!d.open)d.showModal();}
 function openCart(){renderCart();showDialog('#ap-cart-dialog');}
 function closeDialog(button){button.closest('dialog')?.close();}
 function exportLines(lines,name='PURE-research-list.csv'){const list=normalizeLines(lines);const cell=x=>'"'+String(x).replace(/"/g,'""')+'"';const csv=['Product,Size,Quantity,Unit price USD,Line total USD',...list.map(x=>[x.name,x.size,x.qty,x.price.toFixed(2),(x.qty*x.price).toFixed(2)].map(cell).join(',')),'','"Planning document only. Shipping, tax, discounts, and payment are not included."'].join('\r\n');const url=URL.createObjectURL(new Blob(['\ufeff'+csv],{type:'text/csv;charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
 function eligibleSizes(p){return p.variants.filter(v=>window.PureCampaign?.eligible?.(p.id,v.size));}
 function cardVariant(p){
  const eligible=eligibleSizes(p);
  const selected=p.variants.find(v=>v.size===selections[p.id]);
  if(state.group==='Offers')return eligible.find(v=>v===selected)||eligible[0]||p.variants[0];
  return selected||eligible[0]||p.variants[0];
 }
 function cardBadge(p,v){
  if(!window.PureCampaign?.eligible?.(p.id,v.size))return '';
  return '<span class="pure-card-sale">Second unit '+esc(window.PureCampaign.discountPercent)+'% off</span>';
 }
 function purchaseLabel(id){
  return cart.some(line=>line.id===id)?t('addMore','Add more'):t('add');
 }
 function catalogCardAction(p,v){
  const choose=p.variants.length>1;
  const label=purchaseLabel(p.id);
  const url='/product/'+encodeURIComponent(p.id)+'?size='+encodeURIComponent(v.size);
  return `<div class="ap-catalog-actions">
   <a class="ap-button ap-button-secondary ap-catalog-view" href="${url}" aria-label="${esc('View more · '+p.name)}">View More</a>
   <button type="button" class="ap-button ap-catalog-action" data-action="${choose?'catalog-options':'add'}" data-id="${esc(p.id)}" ${choose?'aria-haspopup="dialog"':`data-size="${esc(v.size)}" data-open-cart`} aria-label="${esc(label+' · '+p.name)}">${esc(label)}</button>
  </div>`;
 }
 window.addEventListener('alta:cart',()=>{
  for(const button of $$('.ap-catalog-action')){
   const p=product(button.dataset.id);
   if(!p)continue;
   const label=purchaseLabel(p.id);
   button.textContent=label;
   button.setAttribute('aria-label',label+' · '+p.name);
  }
 });
 function openCatalogOptions(p){
  if(!p)return;
  const variants=state.group==='Offers'?eligibleSizes(p):p.variants;
  if(!variants.length)return;
  const dialog=document.createElement('dialog');
  dialog.className='ap-dialog ap-catalog-options';
  dialog.setAttribute('aria-labelledby','ap-catalog-options-title');
  dialog.innerHTML=`<div class="ap-dialog-head"><div><h2 id="ap-catalog-options-title">${esc(p.name)}</h2><p>Choose a size</p></div><button type="button" data-action="close-dialog" aria-label="Close options">×</button></div>
   <div class="ap-quick-sizes">${variants.map(v=>`<button type="button" data-quick-size="${esc(v.size)}" aria-label="${esc('Add '+p.name+' '+v.size+' to cart')}"><span>${esc(v.size)}</span><strong>${priceMarkup(v.price,{trimWhole:true})}</strong><i aria-hidden="true">+</i></button>`).join('')}</div><p role="status" hidden></p>`;
  dialog.addEventListener('click',event=>{
   const choice=event.target.closest('[data-quick-size]');
   if(!choice){
    if(event.target===dialog){
     const bounds=dialog.getBoundingClientRect();
     if(event.clientX<bounds.left||event.clientX>bounds.right||event.clientY<bounds.top||event.clientY>bounds.bottom)dialog.close();
    }
    return;
   }
   try{addItems([{id:p.id,size:choice.dataset.quickSize,qty:1}]);}
   catch(error){const status=$('[role=status]',dialog);status.textContent=error.message;status.hidden=false;return;}
   dialog.close();
   openCart();
  });
  dialog.addEventListener('close',()=>dialog.remove(),{once:true});
  document.body.append(dialog);
  dialog.showModal();
 }
 function card(p,options={}) {
 const v=cardVariant(p);
 const url='/product/'+encodeURIComponent(p.id)+'?size='+encodeURIComponent(v.size);
 if(options.featured){
  const price=new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(v.price);
  return `<article class="ap-product-card nl-product nl-featured-product" data-product="${esc(p.id)}"><a class="ap-product-image" href="${url}">${cardBadge(p,v)}<img src="${esc(image(p,v.size))}" alt="${esc(p.name+' '+v.size+' product label')}" loading="lazy"></a><div class="nl-featured-meta"><h3><a href="${url}">${esc(p.name)}</a></h3><strong class="nl-featured-price" aria-label="${esc(price+' USD')}">${esc(price)}</strong>${options.quickAdd?catalogCardAction(p,v):''}</div></article>`;
 }
 return `<article class="ap-product-card nl-product" data-product="${esc(p.id)}"><a class="ap-product-image" href="${url}">${cardBadge(p,v)}<img src="${esc(image(p,v.size))}" alt="${esc(p.name+' '+v.size+' product label')}" loading="lazy"></a><div class="ap-card-body"><h3><a href="${url}">${esc(p.name)} <span>(${esc(v.size)})</span></a></h3><label class="nl-size-label"><span class="ap-sr">Size for ${esc(p.name)}</span><select class="ap-card-size" data-card-size="${esc(p.id)}">${p.variants.map(x=>`<option value="${esc(x.size)}" ${x.size===v.size?'selected':''}>${esc(x.size)}</option>`).join('')}</select></label><div class="nl-prices"><strong class="ap-card-price">${priceMarkup(v.price)}</strong><small>per unit</small></div><div class="nl-card-actions"><a class="ap-button ap-button-secondary" href="${url}">View More</a><button class="ap-add" data-action="add" data-id="${esc(p.id)}" data-size="${esc(v.size)}" data-quantity="1">Add to Cart</button></div></div></article>`;
}
 const heading=(eyebrow,title,description='')=>`<div class="ap-container ap-page-intro"><div class="ap-breadcrumbs"><a href="/">PURE</a><span>/</span><span>${esc(eyebrow)}</span></div><span class="ap-eyebrow">${esc(eyebrow)}</span><h1>${title}</h1>${description?'<p>'+description+'</p>':''}</div>`;
 const featureLinks=()=>'';
 function homeOffer(){
  const strip=$('.ap-announcement [data-default-offer]');
  const code=strip?.querySelector('button[data-copy-offer]')?.dataset.copyOffer;
  const saving=strip?.querySelector('.pure-offer-buy')?.textContent.trim();
  return code&&saving?{code,saving}:null;
 }
 function homeHeroActions(){
  return '<div class="ap-actions"><a class="ap-button nl-primary" href="/shop">SHOP NOW</a></div>';
 }
 function homeFeaturedOffer(){
  const offer=homeOffer();
  return offer?`<p class="pure-home-featured-offer">${esc(offer.saving)} eligible merchandise with <strong>${esc(offer.code)}</strong> at checkout.</p>`:'';
 }
 const homeBulkDraft=[];
 const homeBulkSizes=new Map();
 function homeBulkPromo(featured){
  const pricing=window.PureQuantityPricing;
  const tiers=(pricing?.TIERS||[]).filter(tier=>tier.bps>0).slice().reverse();
  const products=featured.filter(p=>p.category!=='supplies').slice(0,3);
  return `<section class="ap-container pure-home-volume" aria-labelledby="pure-home-volume-title">
    <header class="pure-home-volume-head">
      <h2 id="pure-home-volume-title">Bulk Orders</h2>
      <a class="pure-home-volume-link" href="/bulk-orders">Build a Bulk Order</a>
    </header>
    <p class="pure-home-volume-tiers">${tiers.map(tier=>`<span><strong>${tier.bps/100}% off</strong> at ${tier.min}+ units</span>`).join('')}<small>Per compound · mix strengths</small></p>
    ${tiers.length&&products.length?`<div class="pure-home-express" data-home-bulk>
      <div class="pure-home-express-products">${products.map(homeBulkProduct).join('')}</div>
      <p class="pure-home-volume-note"><span>Bulk prices per unit starting at ${tiers[0].min}+</span><span>Free U.S. 2-day express after dispatch</span></p>
      <aside class="pure-home-express-summary" aria-label="Bulk order summary" ${homeBulkDraft.length?'':'hidden'}>${homeBulkSummary()}</aside>
    </div>`:''}
  </section>`;
 }
 function homeBulkPrices(retail,net){
  return net<retail
   ? `<del><span class="ap-sr">Retail </span>${priceMarkup(retail/100)}</del><strong><span class="ap-sr">Bulk </span>${priceMarkup(net/100)}</strong>`
   : `<strong>${priceMarkup(retail/100)}</strong>`;
 }
 function homeBulkUnitPrice(id,price,quantity){
  const pricing=window.PureQuantityPricing;
  const minimum=pricing.TIERS.filter(tier=>tier.bps>0).at(-1).min;
  const count=homeBulkDraft.reduce((units,line)=>units+(line.id===id?line.qty:0),0);
  const qualified=pricing.bulkRate(count)>0;
  const units=qualified?(quantity||1):minimum;
  const retail=Math.round(price*100);
  const gross=retail*units;
  const net=Math.round((gross-pricing.bulkDiscountCents(gross,Math.max(minimum,count)))/units);
  return homeBulkPrices(retail,net);
 }
 function homeBulkProduct(p){
  const variants=p.variants.slice().sort((a,b)=>(parseFloat(a.size)-parseFloat(b.size))||a.size.localeCompare(b.size));
  const variant=variants.find(v=>v.size===homeBulkSizes.get(p.id))||variants[0];
  const {size,price}=variant;
  const quantity=homeBulkDraft.find(line=>line.id===p.id&&line.size===size)?.qty||0;
  return `<article data-home-bulk-product="${esc(p.id)}">
    <div class="pure-home-express-image"><img src="${esc(image(p,size))}" alt="" loading="lazy" width="48" height="56"></div>
    <h4>${esc(p.name)}</h4>
    <label class="pure-home-express-strength"><span class="ap-sr">Strength for ${esc(p.name)}</span><select data-home-bulk-size>${variants.map(v=>`<option value="${esc(v.size)}"${v.size===size?' selected':''}>${esc(v.size)}</option>`).join('')}</select></label>
    <div class="pure-home-express-quantity">
      <input type="number" inputmode="numeric" min="0" max="100" step="1" value="${quantity}" data-home-bulk-quantity aria-label="Quantity for ${esc(p.name+' '+size)}">
      <button type="button" data-home-bulk-step="10" aria-label="Add 10 units of ${esc(p.name+' '+size)}" ${quantity===100?'disabled':''}>+10</button>
    </div>
    <div class="pure-home-express-price">${homeBulkUnitPrice(p.id,price,quantity)}</div>
  </article>`;
 }
 function homeBulkSummary(){
  const pricing=window.PureQuantityPricing;
  const counts=new Map();
  for(const line of homeBulkDraft)counts.set(line.id,(counts.get(line.id)||0)+line.qty);
  const ready=counts.size>0&&[...counts.values()].every(units=>pricing.bulkRate(units)>0);
  let retail=0,savings=0;
  const lines=homeBulkDraft.map(line=>{
   const p=product(line.id),variant=p.variants.find(v=>v.size===line.size);
   const gross=Math.round(variant.price*100)*line.qty;
   const discount=pricing.bulkDiscountCents(gross,counts.get(line.id));
   retail+=gross;savings+=discount;
   return `<li><span><strong>${esc(p.name)}</strong><small>${esc(line.size)} · ${line.qty} units</small></span><span class="pure-home-express-line-price">${homeBulkPrices(gross,gross-discount)}</span><button type="button" data-home-bulk-remove="${esc(line.id)}" data-size="${esc(line.size)}" aria-label="Remove ${esc(p.name+' '+line.size)}">×</button></li>`;
  }).join('');
  return `<h3>Your bulk order</h3>
   <ul>${lines}</ul>
   <div class="pure-home-express-purchase">
    <div class="pure-home-express-total">
     <div class="pure-home-express-estimate"><span>Estimated total</span><span class="pure-home-express-line-price">${homeBulkPrices(retail,retail-savings)}</span></div>
     ${savings?`<div class="pure-order-savings"><span>Bulk savings</span><strong>−${priceMarkup(savings/100)}</strong></div>`:''}
    </div>
    <button class="ap-button" type="button" data-home-bulk-checkout ${ready?'':'disabled'}>Checkout</button>
    <p data-home-bulk-notice>${ready?'':'Add at least 10 units per compound.'}</p>
   </div>`;
 }
 function refreshHomeBulkProduct(card){
  const p=product(card.dataset.homeBulkProduct);
  card.outerHTML=homeBulkProduct(p);
  $(`[data-home-bulk-product="${p.id}"] [data-home-bulk-size]`)?.focus({preventScroll:true});
 }
 function setHomeBulkQuantity(id,size,qty){
  const index=homeBulkDraft.findIndex(line=>line.id===id&&line.size===size);
  if(!Number.isSafeInteger(qty)||qty<0||qty>100)return false;
  if(index>=0){
   if(qty)homeBulkDraft[index].qty=qty;
   else homeBulkDraft.splice(index,1);
  }else if(qty)homeBulkDraft.push({id,size,qty});
  return true;
 }
 function updateHomeBulkQuantity(card,qty){
  const id=card.dataset.homeBulkProduct;
  const size=card.querySelector('[data-home-bulk-size]').value;
  if(!setHomeBulkQuantity(id,size,qty))return;
  const variant=product(id).variants.find(item=>item.size===size);
  card.querySelector('.pure-home-express-price').innerHTML=homeBulkUnitPrice(id,variant.price,qty);
  card.querySelector('[data-home-bulk-step]').disabled=qty===100;
 }
 function mountHomeBulk(root){
  const builder=root.querySelector('[data-home-bulk]');
  if(!builder)return;
  const summary=builder.querySelector('.pure-home-express-summary');
  const updateSummary=()=>{
   summary.hidden=!homeBulkDraft.length;
   summary.innerHTML=homeBulkSummary();
  };
  builder.addEventListener('change',event=>{
   const input=event.target,card=input.closest('[data-home-bulk-product]');
   if(!card)return;
   const id=card.dataset.homeBulkProduct;
   if(input.matches('[data-home-bulk-size]')){
    homeBulkSizes.set(id,input.value);
    refreshHomeBulkProduct(card);
   }
  });
  builder.addEventListener('input',event=>{
   const input=event.target;
   if(!input.matches('[data-home-bulk-quantity]')||!input.validity.valid)return;
   updateHomeBulkQuantity(input.closest('[data-home-bulk-product]'),Number(input.value));
   updateSummary();
  });
  builder.addEventListener('click',async event=>{
   const button=event.target.closest('button');
   if(!button)return;
   if(button.hasAttribute('data-home-bulk-step')){
    const card=button.closest('[data-home-bulk-product]');
    const id=card.dataset.homeBulkProduct,size=card.querySelector('[data-home-bulk-size]').value;
    const qty=homeBulkDraft.find(line=>line.id===id&&line.size===size)?.qty||0;
    const next=Math.min(100,qty+Number(button.dataset.homeBulkStep));
    card.querySelector('[data-home-bulk-quantity]').value=String(next);
    updateHomeBulkQuantity(card,next);
    updateSummary();
   }
   if(button.hasAttribute('data-home-bulk-remove')){
    setHomeBulkQuantity(button.dataset.homeBulkRemove,button.dataset.size,0);
    refreshHomeBulkProduct(builder.querySelector(`[data-home-bulk-product="${button.dataset.homeBulkRemove}"]`));
    updateSummary();
   }
   if(button.hasAttribute('data-home-bulk-checkout')&&!button.disabled){
    if(builder.querySelector('input:invalid')){builder.querySelector('input:invalid').reportValidity();return;}
    const chosen=homeBulkDraft.map(line=>({...line}));
    if(!write('ap-bulk-draft-v2',chosen)){
     builder.querySelector('[data-home-bulk-notice]').textContent='Allow browser storage to carry this order to checkout.';
     return;
    }
    button.disabled=true;
    if(window.PurePartnerVisit){
     let timer;
     await Promise.race([window.PurePartnerVisit,new Promise(resolve=>{timer=setTimeout(resolve,1500);})]).catch(()=>{});
     clearTimeout(timer);
    }
    location.assign('/bulk-orders/checkout');
   }
  });
 }
 function homeFAQ(){
  const questions=[
   ['Who are PURE products intended for?', 'PURE products are for controlled laboratory research only, with no human or veterinary use. Purchasers must be 21 or older.'],
   ['Where can I find the testing methods?', 'Open the relevant laboratory report on <a href="/coas">Testing</a> to see the methods and results for that sample. The tests reported can vary by product and laboratory.'],
   ['When will my order ship?', 'Processing begins after payment is confirmed. The shipping service depends on your destination. See the <a href="/shipping-policy">shipping policy</a> for processing and transit estimates.'],
   ['How can I pay for my order?', 'Checkout shows eligible payment methods for the order and shipping address. See <a href="/payment-options">Payment Options</a> for details.'],
   ['Is international shipping available?', 'Service and rates depend on the destination. Enter the shipping address at checkout to see available options. Local duties and customs charges may apply.'],
   ['What does shipping protection cover?', 'Optional protection covers qualifying loss or damage in transit. See the <a href="/shipping-protection">shipping protection terms</a> for eligibility and claim instructions.'],
   ['Where can I track my order?', 'Look for the tracking link in your shipment email after dispatch, or use <a href="/track-order">Track Order</a> with your order number and email.']
  ];
  return `<section aria-labelledby="pure-home-faq-title" class="ap-container ap-section ap-faq-layout pure-faq-section pure-home-faq" id="faq">
    <div class="pure-faq-intro">
      <div class="pure-faq-intro-copy"><h2 id="pure-home-faq-title">Frequently asked questions</h2></div>
      <nav class="pure-home-faq-links" aria-label="Order support">
        <a href="/track-order">Track Order</a>
        <a href="/shipping-policy">Shipping</a>
        <a href="/contact">Contact Us</a>
      </nav>
    </div>
    <div class="ap-faq pure-faq-list">${questions.map(([question,answer])=>`<details><summary>${question}</summary><p>${answer}</p></details>`).join('')}</div>
  </section>`;
 }
 function homePackaging(){
  return `<section class="ap-container pure-home-packaging" aria-labelledby="pure-packaging-title">
    <img src="/assets/pure-packaging-studio.webp" alt="Black PURE carton and matching vial with white lettering on a white background" width="1344" height="816" loading="lazy">
    <div><h2 id="pure-packaging-title">Packaging &amp; delivery</h2><p>Choose your shipping option at checkout. Look for tracking details in your shipment email after dispatch.</p><a class="ap-button" href="/shop">Shop now</a></div>
  </section>`;
 }
 function homeEmailUpdates(){
  return `<section class="ap-container pure-home-email" aria-labelledby="pure-home-email-title">
    <div class="pure-home-email-copy"><h2 id="pure-home-email-title">PURE updates</h2><p>Get product announcements and current offers by email.</p></div>
    <form class="ap-newsletter-form">
      <label class="pure-home-email-label" for="pure-home-email-address">Email address</label>
      <div class="pure-home-email-fields"><input id="pure-home-email-address" type="email" name="email" autocomplete="email" maxlength="254" placeholder="you@example.com" required><button class="ap-button ap-button-light" type="submit">Sign up</button></div>
      <label class="pure-home-email-consent"><input type="checkbox" name="consent" required> I agree to receive email updates from PURE.</label>
      <p class="ap-form-status" role="status" aria-live="polite"></p>
    </form>
  </section>`;
 }
 function homeHighlights(){
  const check='<svg class="nl-trust-check" viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12 4 4L19 6"/></svg>';
  const highlights=[
   '<strong title="Applies to qualifying shipments to the U.S. and Canada after discounts">Free shipping over '+priceMarkup(250,{trimWhole:true})+'</strong>',
   '<a href="/coas?product=5-amino-1mq&amp;size=50mg" aria-label="99%+ Purity on the linked supplier sample" title="See the purity result for the tested 5-Amino-1MQ sample">99%+ Purity</a>',
   '<a href="/coas">Verified Lab Testing</a>'
  ];
  const rating=reviewSummary?'<p class="nl-trust-rating">'+reviewSummary.rating.toFixed(1)+'/5 · '+reviewSummary.count+' '+(reviewSummary.count===1?'review':'reviews')+'<small>Review credit offered</small></p>':'';
  return '<div class="nl-trust" aria-label="PURE product and delivery highlights">'+highlights.map(label=>'<div>'+check+'<span>'+label+'</span></div>').join('')+rating+'</div>';
 }
 function home() {
 const featured=['retatrutide','bpc-157','ghk-cu','nad'].map(product).filter(Boolean);
 featured.push(...catalog.filter(x=>!featured.includes(x)).slice(0,10-featured.length));
 const hero=['nad','retatrutide','bpc-157','ghk-cu','tirzepatide'].map(product).filter(Boolean);
 return `<section class="nl-hero"><div class="ap-container nl-hero-inner"><div class="nl-hero-copy"><h1>CUTTING EDGE<br><em>PURITY</em></h1><p class="nl-hero-description">Research compounds, product documentation, and straightforward ordering for laboratories and research teams.</p>${homeHeroActions()}</div><div class="nl-vial-stage" aria-label="Featured PURE products"><svg class="ap-vial-clip" width="0" height="0" aria-hidden="true"><defs><clipPath id="ap-vial-outline" clipPathUnits="objectBoundingBox"><path d="M .296 .127 C .296 .094 .409 .079 .499 .079 C .592 .079 .705 .095 .705 .128 L .705 .168 Q .705 .179 .691 .186 L .691 .239 Q .691 .259 .648 .267 L .648 .311 C .696 .328 .713 .342 .720 .372 L .725 .379 L .727 .824 Q .727 .879 .681 .880 L .319 .880 Q .273 .879 .272 .827 L .277 .379 L .283 .373 C .289 .343 .307 .327 .355 .312 L .355 .268 Q .310 .260 .310 .238 L .310 .187 Q .296 .180 .296 .168 Z"/></clipPath></defs></svg>${hero.map((p,i)=>`<a class="nl-vial nl-vial-${i}" href="/product/${p.id}"><img src="${esc(image(p,p.variants[0].size))}" alt="${esc(p.name+' '+p.variants[0].size)}" ${i===2?'fetchpriority="high"':''}></a>`).join('')}<span class="nl-stage-word" aria-hidden="true">PURE</span></div>${homeHighlights()}</div></section><section class="ap-container nl-featured"><div class="ap-section-head"><div><span class="ap-eyebrow">THE COLLECTION</span><h2>Featured Compounds</h2>${homeFeaturedOffer()}</div><div class="nl-carousel-controls"><button data-carousel="-1" aria-label="Previous products">‹</button><button data-carousel="1" aria-label="Next products">›</button></div></div><div class="nl-carousel" id="nl-featured">${featured.map(p=>card(p,{featured:true,quickAdd:true})).join('')}</div><div class="nl-center"><a class="ap-button" href="/shop">View All Products</a></div></section>${homeBulkPromo(featured)}${homePackaging()}<section class="ap-container nl-editorial"><div><span class="nl-capsule">PURE DOCUMENTATION</span><h2>KNOW WHAT’S<br>IN YOUR ORDER.</h2><p>Explore certificates of analysis by product, strength, laboratory or report ID.</p><p class="ap-fine">Request the certificate for your fulfilled lot when you order.</p><a class="ap-button" href="/coas">Explore Testing</a></div><div class="nl-doc-art"><span>PURE</span><strong>Certificate<br>of Analysis</strong><div class="nl-doc-purity"><span class="nl-doc-purity-check" aria-hidden="true">✓</span><span><b>Testing reports</b><small>See available product documentation</small></span></div><div><b>Retatrutide</b> / 60mg</div><hr><div><b>Janoshik</b> / Report ID</div><hr><div><b>PURE</b> / Lot</div><a class="ap-button" href="/coas">View COAS</a></div></section>${homeFAQ()}${homeEmailUpdates()}<a class="pure-floating-shop" href="/shop">Shop Now</a>`;
}
 function catalogResults(){
  const lowest=p=>Math.min(...(state.group==='Offers'?eligibleSizes(p):p.variants).map(v=>v.price));
  const list=catalog.filter(p=>(state.group==='All'||(state.group==='Offers'?eligibleSizes(p).length>0:categoryOf(p)===state.group))
   &&(!state.savedOnly||saved.includes(p.id))&&lowest(p)<=state.maxPrice&&searchText(p).includes(state.query.toLowerCase()));
  if(state.sort!=='popular')list.sort((a,b)=>state.sort==='low'?lowest(a)-lowest(b):state.sort==='high'?lowest(b)-lowest(a):a.name.localeCompare(b.name));
  return list;
 }
 function renderCatalogResults(){
  const grid=$('#ap-catalog-grid');
  if(!grid)return;
  const active=window.PureCampaign?.status==='active',filters=$('.nl-filter-pills');
  const offerView=active&&state.group==='Offers';
  for(const [selector,offerCopy] of [['[data-pure-collection-title]','SECOND-UNIT OFFERS'],['[data-pure-collection-intro]','Buy two of the same eligible variant and save on the second unit. One merchandise offer applies per order.']]){
   const node=$(selector);
   if(node){node.dataset.defaultText??=node.textContent;node.textContent=offerView?offerCopy:node.dataset.defaultText;}
  }
  let offerButton=filters?.querySelector('[data-filter-group="Offers"]');
  if(active&&filters&&!offerButton){
   offerButton=document.createElement('button');
   offerButton.type='button';offerButton.dataset.filterGroup='Offers';offerButton.textContent='Second-unit offers';
   filters.firstElementChild?.after(offerButton);
  }else if(!active)offerButton?.remove();
  const list=catalogResults(),more=$('#ap-load-more');
  if(state.group==='Offers'&&!active){
   const status=window.PureCampaign?.status;
   const title=status==='loading'?'Loading offers…':status==='inactive'?'No active second-unit offers':'Offers are temporarily unavailable';
   grid.innerHTML='<div class="ap-empty" role="status"><h3>'+title+'</h3><a class="ap-button ap-button-secondary" href="/shop">View all products</a></div>';
  }else{
   const links=state.query.trim()?pageSearchLinks(state.query):'';
   const cards=list.slice(0,state.limit).map(p=>card(p,{featured:true,quickAdd:true})).join('');
   grid.innerHTML=(links?`<section class="ap-catalog-help" aria-label="Pages and help"><h3>Pages &amp; help</h3>${links}</section>`:'')+cards||`<div class="ap-empty"><h3>${t('noResults')}</h3><button class="ap-button ap-button-secondary" data-action="clear-filters">${t('clear')}</button></div>`;
  }
  more.hidden=list.length<=state.limit;
  $$('[data-filter-group]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.filterGroup===state.group)));
 }
 window.addEventListener('pure:campaign',()=>{
  if(route()==='/shop'){renderCatalogResults();return;}
  for(const item of $$('#nl-featured .ap-product-card,.ap-related .ap-product-card')){
   const p=product(item.dataset.product);
   if(p)item.outerHTML=card(p,{featured:true,quickAdd:!!item.querySelector('.ap-catalog-actions')});
  }
 });
 function shop(){const shopGroups=shopCategories;return `<section class="ap-container nl-shop"><header class="nl-shop-header"><h1 data-pure-collection-title>All Products</h1><p data-pure-collection-intro>Browse research compounds and available testing reports.</p></header><div class="ap-toolbar nl-shop-controls"><label class="nl-shop-search"><span class="ap-sr">Search products and help</span><svg aria-hidden="true" viewBox="0 0 24 24"><circle cx="10.8" cy="10.8" r="6.7"></circle><path d="m16 16 5 5"></path></svg><input id="ap-catalog-query" type="search" placeholder="Search products and help…" value="${esc(state.query)}" maxlength="120"></label><div class="nl-shop-sort"><label class="nl-shop-sort-label" for="ap-catalog-sort">Sort by:</label><select id="ap-catalog-sort"><option value="popular" ${state.sort==='popular'?'selected':''}>Most Popular</option><option value="low" ${state.sort==='low'?'selected':''}>Price: Low to High</option><option value="high" ${state.sort==='high'?'selected':''}>Price: High to Low</option><option value="name" ${state.sort==='name'?'selected':''}>Name: A–Z</option></select></div></div><div class="nl-filter-pills" role="group" aria-label="Product categories">${shopGroups.map(g=>`<button type="button" data-filter-group="${esc(g)}" aria-pressed="${state.group===g}">${esc(g==='All'?'All Products':g)}</button>`).join('')}</div><div class="ap-grid" id="ap-catalog-grid"></div><button class="ap-button ap-button-secondary ap-load-more" id="ap-load-more" data-action="more">Load More Products</button></section>`;}
 function detail(id) {
 const p=product(id);if(!p)return heading('Product','Product not found','Browse the current catalog.')+'<a href="/shop">View products</a>';
 const v=p.variants.find(x=>x.size===(selections[p.id]||new URLSearchParams(location.search).get('size')))||p.variants[0];
 selections[p.id]=v.size;document.title=p.name+' '+v.size+' | PURE';
 return `<div class="ap-container nl-product-breadcrumb"><a href="/">Home</a> / <a href="/shop">Products</a> / ${esc(p.name)}</div><section class="ap-container ap-product-layout nl-detail"><div class="ap-detail-image"><img src="${esc(image(p,v.size))}" alt="${esc(p.name+' '+v.size+' label')}" fetchpriority="high"></div><div class="ap-detail-copy"><span class="ap-eyebrow">${esc(p.group)}</span><h1>${esc(p.name)} <span>(${esc(v.size)})</span></h1><p>${esc(p.blurb)}</p><p data-pure-dispatch-cutoff hidden></p><p data-pure-campaign-countdown data-campaign-product="${esc(p.id+':'+v.size)}" hidden></p><div class="ap-detail-price">${priceMarkup(v.price)} <span class="ap-fine">per unit</span></div><p class="nl-label">Strength: <strong>${esc(v.size)}</strong></p><div class="ap-size-options">${p.variants.map(x=>`<button data-action="detail-size" data-id="${p.id}" data-size="${esc(x.size)}" aria-pressed="${x.size===v.size}">${esc(x.size)}</button>`).join('')}</div><div class="ap-actions nl-purchase" data-unit-price="${v.price}" data-unit-label="${p.id==='needles'?'pack':'vial'}"><label class="ap-quantity"><span class="ap-sr">Quantity</span><button data-action="detail-quantity" data-step="-1" type="button" aria-label="Decrease quantity">−</button><input id="ap-detail-quantity" type="number" min="1" max="100" value="1" aria-label="Quantity"><button data-action="detail-quantity" data-step="1" type="button" aria-label="Increase quantity">+</button></label><button class="ap-button" data-action="detail-add" data-id="${p.id}" data-size="${esc(v.size)}">Add to Cart</button></div><p class="ap-bundle-estimate" data-bundle-estimate aria-live="polite"></p><div class="ap-mobile-purchase"><span>${esc(p.name)} · ${esc(v.size)}<strong data-mobile-total></strong></span><button class="ap-button" data-action="detail-add" data-id="${p.id}" data-size="${esc(v.size)}">Add to Cart</button></div><div class="nl-mini-benefits"><span>✓ Clear unit pricing</span><span>✓ Tracked delivery</span></div><a class="nl-document-link" href="/coas?product=${encodeURIComponent(p.id)}&amp;size=${encodeURIComponent(v.size)}">▤ View testing reports for ${esc(v.size)}</a><div class="ap-detail-tabs"><details open><summary>Description</summary><p>${esc(p.blurb)} ${esc(v.size)}. Laboratory research only. Not for human or animal use.</p></details><details><summary>Shipping & delivery</summary><p>Free priority shipping on merchandise totals of $250 or more after any coupon and before points or store credit. Available delivery options and fees are confirmed at checkout. <a href="/shipping-policy.html">Shipping policy</a></p></details><details><summary>COAS & supplier documentation</summary><p>Original supplier reports are available where matched to this product and strength. They are not proof of the lot you will receive. Request the fulfilled-lot COA with your order.</p></details></div></div></section><section class="ap-container ap-section"><div class="ap-section-head"><h2>Related Products</h2></div><div class="ap-grid">${catalog.filter(x=>x.id!==p.id&&(x.group===p.group||p.premixed_blend&&x.premixed_blend)).sort((a,b)=>p.premixed_blend?Number(!!b.premixed_blend)-Number(!!a.premixed_blend):0).slice(0,5).map(x=>card(x)).join('')}</div></section>`;
}
 function renderCart() {
 const root=$('#ap-cart-content');if(!root)return;$('#ap-cart-title').textContent='Your Cart';
 if(!cart.length){root.innerHTML='<div class="ap-empty"><h3>Your cart is empty.</h3><a class="ap-button" href="/shop">Shop Products</a></div>';return;}
 const subtotal=cart.reduce((n,x)=>n+x.qty*x.price,0);
 root.innerHTML=cart.map(x=>`<div class="ap-cart-line"><img src="${esc(image(product(x.id),x.size))}" alt="${esc(x.name+' '+x.size)}"><div><a href="/product/${x.id}?size=${encodeURIComponent(x.size)}"><strong>${esc(x.name)}</strong></a><small>${esc(x.size)} · ${priceMarkup(x.price)} each</small><div class="ap-quantity"><button data-action="cart-quantity" data-key="${esc(x.key)}" data-step="-1" aria-label="Decrease ${esc(x.name)} quantity">−</button><input value="${x.qty}" readonly aria-label="Quantity"><button data-action="cart-quantity" data-key="${esc(x.key)}" data-step="1" aria-label="Increase ${esc(x.name)} quantity">+</button></div></div><div><strong>${priceMarkup(x.qty*x.price)}</strong><button class="ap-remove" data-action="cart-remove" data-key="${esc(x.key)}">Remove</button></div></div>`).join('')+`<div class="ap-cart-totals"><strong>Merchandise subtotal</strong><strong>${priceMarkup(subtotal)}</strong></div><p class="ap-fine">Coupons, delivery, tax, points and store credit are confirmed at checkout. Final totals and payment currency are confirmed at checkout.</p><a class="ap-button" href="/checkout">Proceed to Checkout</a><a class="ap-button ap-button-secondary" href="/shop">Continue Shopping</a>`;
 window.AltaCartNmi?.offer(root);
}
 function pageSearchLinks(value){
  const terms=value.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const pages=[
   ['Shipping policy','/shipping-policy.html','shipping delivery rates costs transit international Canada'],
   ['Frequently asked questions','/#faq','help faq ordering payments questions'],
   ['Contact Us','/contact','help support customer service'],
   ['Track an order','/track-order','shipping delivery tracking status'],
   ['Refund policy','/refund-policy.html','refund return cancellation help'],
   ['Testing','/coas','certificate analysis COA lab reports documentation'],
   ['Bulk orders','/bulk-orders',''],['Partner Program','/partner-program',''],['Rewards & Credit','/rewards','']
  ];
  return pages.filter(([name,,keywords])=>terms.every(term=>(name+' '+keywords).toLowerCase().includes(term)))
   .map(([name,url])=>`<a class="ap-search-result ap-page-search-result" href="${url}"><strong>${esc(name)}</strong><span aria-hidden="true">↗</span></a>`).join('');
 }
 function searchResults(value=''){
  const needle=value.trim().toLowerCase(),links=pageSearchLinks(value);
  const matches=catalog.filter(p=>searchText(p).includes(needle)).slice(0,7);
  const products=matches.map(p=>`<a class="ap-search-result" href="/product/${p.id}"><img src="${esc(image(p,p.variants[0].size))}" alt=""><span><strong>${esc(p.name)}</strong><small>${esc(p.variants.map(v=>v.size).join(' · '))}</small></span><span>${priceMarkup(Math.min(...p.variants.map(v=>v.price)))} ↗</span></a>`).join('');
  $('#ap-search-results').innerHTML=(products?`<p class="ap-fine" style="margin-top:18px">${needle?'MATCHING PRODUCTS':'EXPLORE COMPOUNDS'}</p>${products}`:'')
   +(links?`<p class="ap-fine" style="margin-top:22px">PAGES &amp; HELP</p>${links}`:'')||'<p class="ap-empty">No matches. Try a product, shipping, or help topic.</p>';
 }
 function updateCompare(){const bar=$('#ap-compare-bar');if(!bar)return;bar.hidden=compared.length===0;bar.innerHTML=`${compared.length} selected <button class="ap-button ap-button-small" data-action="compare-open">Compare compounds ↗</button> <button class="ap-text-button" data-action="compare-clear">Clear</button>`;$$('[data-compare]').forEach(x=>x.checked=compared.includes(x.dataset.compare));}
 function renderCompare(){const rows=compared.map(product).filter(Boolean);$('#ap-compare-content').innerHTML=`<div class="ap-compare-grid" style="--cols:${rows.length||1}">${rows.map(p=>`<div><img src="${esc(image(p,selections[p.id]))}" alt="${esc(p.name)}"><h3>${esc(p.name)}</h3><p>${esc(p.group)}</p><p>${esc(p.blurb)}</p><p>${p.variants.map(v=>esc(v.size)+' · '+priceMarkup(v.price)).join('<br>')}</p><a class="ap-button ap-button-small" href="/product/${p.id}">View product ↗</a></div>`).join('')}</div>`;}
 function validReport(r){if(!r||r.status!=='verified'||r.publication_approved!==true||!product(r.product_id)||!r.lot||!r.report_id||!r.lab_name||!r.reviewer||!r.evidence_reference)return false;try{const u=new URL(r.document_url);return u.origin==='https://getpurelabs.com'&&!u.username&&!u.password;}catch{return false;}}
 function render(){const root=$('#ap-main');if(!root)return;const r=route();if(r==='/'||r==='/index'){root.innerHTML=home();mountHomeBulk(root);}else if(r==='/shop'){root.innerHTML=shop();renderCatalogResults();}else if(r.startsWith('/product/')){let id;try{id=decodeURIComponent(r.slice(9));}catch{id='';}root.innerHTML=detail(id);window.PureCampaign?.mountDispatch(root.querySelector('[data-pure-dispatch-cutoff]'));window.PureCampaign?.mountCountdown(root.querySelector('[data-pure-campaign-countdown]'));}else if(window.AltaWorkspace)window.AltaWorkspace.render(r,root);else root.innerHTML=heading('Research workspace','Loading your workspace…');translateShell();updateCompare();}
 function translateShell(){$$('[data-ap-i18n]').forEach(el=>el.textContent=t(el.dataset.apI18n));}
 async function inquiry(payload){const response=await fetch('/api/customer-config',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...payload,request_id:payload.request_id||crypto.randomUUID()})});let result;try{result=await response.json();}catch{throw Error('The inquiry service could not respond. Please try again or email support@getpurelabs.com.');}if(!response.ok||result.received!==true)throw Error(result.error||'Request not sent. Please try again.');return result;}
 window.AltaStore={catalog,groups,shopCategories,categoryOf,$,$$,esc,t,money,priceMarkup,image,product,card,heading,featureLinks,normalizeLines,addItems,adjustQuantity,exportLines,toast,read,write,inquiry,render,get cart(){return [...cart];},get saved(){return [...saved];},get selections(){return selections;},get reports(){return [...reports];},route};
 document.addEventListener('click',event=>{const button=event.target.closest('[data-action]');if(!button)return;const action=button.dataset.action,id=button.dataset.id;
  if(action==='close-dialog'){closeDialog(button);return;}
  if(action==='search'){showDialog('#ap-search-dialog');searchResults();$('#ap-global-search').focus();return;}
  if(action==='cart'){openCart();return;}
  if(action==='age-confirm'){if(welcomeReady){saveWelcome();age.close();}return;}
  if(action==='age-exit'){if(welcomeReady)updateAgeText('#ap-age-message','welcomeBlocked','You must be {age}+ and meet any higher local age requirement to enter.');return;}
  if(action==='catalog-options'){openCatalogOptions(product(id));return;}
  if(action==='add'||action==='detail-add'){
   const detail=action==='detail-add';
   const qty=detail?Number($('#ap-detail-quantity')?.value):1;
   if(!Number.isInteger(qty)||qty<1||qty>100){toast('Choose a quantity between 1 and 100.');return;}
   try{addItems([{id,size:button.dataset.size,qty}]);}
   catch(error){toast(error.message);return;}
   if(detail||button.hasAttribute('data-open-cart'))openCart();
   return;
  }
  if(action==='save'){if(!product(id))return;saved=saved.includes(id)?saved.filter(x=>x!==id):[...saved,id];write('ap-wishlist',saved);$$(`[data-action="save"][data-id="${id}"]`).forEach(b=>{b.setAttribute('aria-pressed',String(saved.includes(id)));b.textContent=b.classList.contains('ap-save')?(saved.includes(id)?'♥':'♡'):(saved.includes(id)?'♥ '+t('saved'):'♡ '+t('save'));});toast(saved.includes(id)?'Saved on this device.':'Removed from saved products.');return;}
  if(action==='detail-size'){
   const qty=$('#ap-detail-quantity')?.value||'1';
   const fromSticky=!!button.closest('.ap-mobile-purchase');
   selections[id]=button.dataset.size;
   const u=new URL(location.href);u.searchParams.set('size',button.dataset.size);history.replaceState(null,'',u);
   render();
   const input=$('#ap-detail-quantity');
   if(input){input.value=qty;input.dispatchEvent(new Event('input',{bubbles:true}));}
   const current=$(fromSticky?'.ap-mobile-purchase [aria-pressed="true"]':'.ap-size-options [aria-pressed="true"]');
   current?.focus({preventScroll:true});
   if(fromSticky&&current)current.parentElement.scrollLeft=Math.max(0,current.offsetLeft-current.parentElement.offsetLeft-16);
   return;
  }
  if(action==='detail-quantity'){const input=$('#ap-detail-quantity');input.value=String(Math.max(1,Math.min(100,(Number(input.value)||1)+Number(button.dataset.step))));return;}
  if(action==='cart-remove'){cart=cart.filter(x=>x.key!==button.dataset.key);syncCart(true);return;}
  if(action==='cart-quantity'){cart=cart.map(x=>x.key===button.dataset.key?{...x,qty:Math.max(0,Math.min(100,x.qty+Number(button.dataset.step)))}:x).filter(x=>x.qty>0);syncCart(true);return;}
  if(action==='cart-export'){exportLines(cart,'PURE-cart.csv');return;}
  if(action==='clear-filters'){state.query='';state.group=new URLSearchParams(location.search).get('offer')==='second-unit'?'Offers':'All';state.maxPrice=Math.ceil(Math.max(...catalog.flatMap(p=>p.variants.map(v=>v.price))));state.savedOnly=false;state.limit=12;render();return;}
  if(action==='more'){state.limit+=12;renderCatalogResults();return;}
  if(action==='compare-clear'){compared=[];updateCompare();return;}
  if(action==='compare-open'){renderCompare();showDialog('#ap-compare-dialog');return;}
 });
 document.addEventListener('click',event=>{const group=event.target.closest('[data-filter-group]');if(group){state.group=group.dataset.filterGroup;state.limit=12;const url=new URL(location.href);if(state.group==='Offers'){url.searchParams.set('offer','second-unit');url.searchParams.delete('category');}else url.searchParams.delete('offer');history.replaceState(null,'',url);renderCatalogResults();}const mega=$('.ap-mega');if(mega&&!event.target.closest('.ap-mega'))mega.open=false;});
 document.addEventListener('change',event=>{const el=event.target;if(el.matches('[data-card-size]')){const p=product(el.dataset.cardSize);selections[p.id]=el.value;const cardNode=el.closest('.ap-product-card');cardNode.outerHTML=card(p);}
  if(el.matches('[data-compare]')){if(el.checked&&!compared.includes(el.dataset.compare)){if(compared.length>=4){el.checked=false;toast(t('compareLimit'));return;}compared.push(el.dataset.compare);}else compared=compared.filter(id=>id!==el.dataset.compare);updateCompare();}
  if(el.id==='ap-catalog-sort'){state.sort=el.value;renderCatalogResults();}
  if(el.id==='ap-saved-filter'){state.savedOnly=el.checked;state.limit=12;renderCatalogResults();}
 });
 document.addEventListener('input',event=>{const el=event.target;if(el.id==='ap-global-search')searchResults(el.value);if(el.id==='ap-catalog-query'){state.query=el.value;state.limit=12;renderCatalogResults();}if(el.id==='ap-price-filter'){state.maxPrice=Number(el.value);$('#ap-price-label').innerHTML=priceMarkup(state.maxPrice);renderCatalogResults();}});
 document.addEventListener('keydown',event=>{if(event.key==='/'&&!event.ctrlKey&&!event.metaKey&&!event.altKey&&!event.target.matches('input,textarea,select,[contenteditable=true]')){event.preventDefault();showDialog('#ap-search-dialog');searchResults();$('#ap-global-search').focus();}});
 document.addEventListener('submit',async event=>{
  const form=event.target;
  if(!form.matches('.ap-newsletter-form'))return;
  event.preventDefault();
  if(!form.reportValidity())return;
  const data=new FormData(form),button=$('button',form),status=$('.ap-form-status',form);
  button.disabled=true;
  status.textContent='Signing up…';
  try{
   const response=await fetch('/api/customer-config?campaign=signup',{
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body:JSON.stringify({email:data.get('email'),consent:data.get('consent')==='on'})
   });
   const result=await response.json();
   if(!response.ok||!result.code)throw Error(result.error||'Signup is temporarily unavailable.');
   status.textContent='You’re subscribed. Use '+result.code+' at checkout.';
   form.reset();
  }catch(error){
   status.textContent=error.message;
  }finally{
   button.disabled=false;
  }
 });
 $$('#ap-search-dialog,#ap-cart-dialog,#ap-compare-dialog').forEach(d=>d.addEventListener('click',e=>{if(e.target===d){const r=d.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)d.close();}}));
 if($('#year'))$('#year').textContent=String(new Date().getFullYear());
 const mega=$('#ap-mega-content');if(mega)mega.innerHTML=groups.slice(1).map(g=>`<a href="/shop?category=${encodeURIComponent(g)}">${esc(t(g,g))}<small>${catalog.filter(p=>p.group===g).length} products <span aria-hidden="true">↗</span></small></a>`).join('');
 if(state.group!=='Offers'&&!shopCategories.includes(state.group))state.group='All';
 window.addEventListener('storage',e=>{if(e.key==='pp-cart'){cart=normalizeLines(read('pp-cart',[]));syncCart();}});
 window.AltaLocale?.onChange(event=>{if(!event||event.reason==='language'){render();renderCart();translateShell();if(welcomeReady)renderWelcome();}else window.AltaLocale?.refreshPrices?.(document);});
 render();syncCart();translateShell();
 fetch('/data/verified-coas.json',{cache:'no-store'}).then(r=>r.ok?r.json():[]).catch(()=>[]).then(r=>{reports=Array.isArray(r)?r.filter(validReport):[];render();});
 if(route()==='/'||route()==='/index')fetch('/api/customer-config?reviews=summary').then(r=>r.ok?r.json():null).then(summary=>{
  if(Number.isSafeInteger(summary?.count)&&summary.count>0&&Number.isFinite(summary.rating)&&summary.rating>=1&&summary.rating<=5){
   reviewSummary=summary;
   render();
  }
 }).catch(()=>{});
 function updateAgeText(selector,key,fallback){
  const target=$(selector,age);
  if(target)target.textContent=t(key,fallback).replaceAll('{age}',String(minimumAge));
 }
 function renderWelcome(){
  updateAgeText('#ap-age-title','welcomeTitle','{age}+ only');
  updateAgeText('[data-age-rules]','welcomeRules','Confirm you are {age} or older and meet any higher local age requirement.');
  updateAgeText('[data-age-research]','welcomeResearch','For controlled laboratory research only. Human and veterinary use are prohibited. Purchasers must be 21 or older.');
  updateAgeText('[data-action="age-confirm"]','welcomeConfirm','Confirm and enter');
  updateAgeText('[data-action="age-exit"]','welcomeExit','I don’t meet the age requirement');
  updateAgeText('[data-age-research-link]','welcomeResearchLink','Research-use policy');
  updateAgeText('[data-age-terms-link]','welcomeTermsLink','Terms and conditions');
 }
 if(age&&!/^\/(?:my-account|account)(?:\/|$)/.test(location.pathname)){
  const prior=read('ap-age-verified',null);
  // Earlier storefronts recorded the age actually confirmed, including regional
  // thresholds below 21. Migrate only a confirmation meeting the current floor.
  const legacy=typeof prior==='string' && /^welcome-[12]:(?:[A-Z]{2}|unknown):(\d{2})$/.exec(prior);
  const accepted=document.cookie.split(';').some(entry=>entry.trim()===welcomeCookie);
  if(legacy && Number(legacy[1])>=minimumAge){
   if(!accepted)saveWelcome();
   else try{localStorage.removeItem('ap-age-verified');}catch{}
  }else if(!accepted){
   welcomeReady=true;
   age.addEventListener('cancel',event=>event.preventDefault());
   renderWelcome();
   const loading=$('[data-age-loading]',age),options=$('[data-age-options]',age);
   if(loading)loading.hidden=true;
   if(options)options.hidden=false;
   $$('button',age).forEach(button=>{button.disabled=false;});
   if(!age.open)age.showModal();
   $('[data-action="age-confirm"]',age)?.focus();
  }
 }
})();
