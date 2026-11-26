'use strict';
const fs=require('node:fs');
const {site}=require('./config/site.ts');
const zones=site.shipping.rates;
const money=cents=>'US$'+(cents/100).toFixed(cents%100?2:0);
for(const [file,note] of [
 ['shipping-policy.html',`<strong>Free shipping from ${site.shipping.freeThresholdLabel}:</strong> ${site.shipping.freeServicesLabel}, are free for eligible merchandise after discounts, before points or store credit.`],
 ['refund-policy.html','<strong>Product orders:</strong> Refund requests and payment reconciliation follow the published checkout and product-return terms. Applicable statutory rights are not limited.']
]){
 let html=fs.readFileSync(file,'utf8');
 if(file==='shipping-policy.html')html=html.replace(/(<td data-shipping-rate="(US|CA)\.(economy|standard|express|next_day)">)[^<]*(<\/td>)/g,
  (_,open,country,service,close)=>open+money(zones[country][service])+close);
 html=html.replace(/<section id="manual-invoice-policy-note"[\s\S]*?<\/section>/,'');
 html=html.replace('</h1>','</h1><section id="manual-invoice-policy-note" style="margin:24px 0;padding:18px;border:1px solid #d6d6d6;border-radius:10px"><p>'+note+'</p><p><a href="/commercial-terms.html">Read the checkout terms →</a></p></section>');
 fs.writeFileSync(file,html);
}
