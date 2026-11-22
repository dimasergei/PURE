'use strict';
const fs=require('node:fs');
for(const [file,note] of [
 ['shipping-policy.html','<strong>US express and Canadian standard shipping:</strong> Free for eligible merchandise of US$250 or more after discounts, before points or store credit. Under the threshold, standard shipping is US$11.95 in the United States and US$24.95 in Canada. CAD Interac displays the corresponding converted amount. Express and other international rates are displayed at checkout. Fulfillment is arranged after confirmed payment.'],
 ['refund-policy.html','<strong>Product orders:</strong> Refund requests and payment reconciliation follow the published checkout and product-return terms. Applicable statutory rights are not limited.']
]){
 let html=fs.readFileSync(file,'utf8');
 html=html.replace(/<section id="manual-invoice-policy-note"[\s\S]*?<\/section>/,'');
 html=html.replace('</h1>','</h1><section id="manual-invoice-policy-note" style="margin:24px 0;padding:18px;border:1px solid #d6d6d6;border-radius:10px"><p>'+note+'</p><p><a href="/commercial-terms.html">Read the checkout terms →</a></p></section>');
 fs.writeFileSync(file,html);
}
