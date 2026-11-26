(() => {
 'use strict';const $=id=>document.getElementById(id);let auth,model,widget,three,guest=false,processing=false,poll=null;
 const query=new URLSearchParams(location.search),invoice=query.get('invoice');
 const refresh=$('native-refresh');refresh.hidden=true;refresh.disabled=true;
 const money=(n,c)=>new Intl.NumberFormat('en-US',{style:'currency',currency:c}).format(n/100);
 // What the customer is told about a payment that is not final. A Stripe test payment never marks an order paid: say so plainly.
 const attemptNote=(a,g)=>a.error_code==='pure_gateway_test_payment'?'This was a test payment (card payments are in test mode), so no money was taken and this order was not marked as paid.':g.provider==='pure_gateway'&&a.state==='review'?'We received your card payment and it is being checked. Do not pay again; we will confirm your order shortly.':'Existing payment attempt: '+a.state+'. Do not start another charge.';
 async function request(body,token){
  const r=await fetch('/api/checkout?native=customer&invoice='+encodeURIComponent(invoice),{method:body?'POST':'GET',cache:'no-store',credentials:'same-origin',headers:{...(token?{Authorization:'Bearer '+token}:{}),...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});
  const result=await r.json().catch(()=>null);
  if(!r.ok||!result)throw Object.assign(Error(result?.error||'Payment result is unavailable. Check your order before retrying.'),{status:r.status});
  return result;
 }
 async function api(body){
  if(guest)return request(body);
  const session=await auth.auth.getSession(),token=session.data?.session?.access_token;
  if(!token)throw Error('Sign in to view your order.');
  return request(body,token);
 }
 const unavailable=error=>[401,403,404].includes(error.status);
 const usdcNetwork=provider=>window.DirectCheckout?.usdcNetwork?.(provider);
 async function guestInvoice(){
  try{
   const result=await request();
   const provider=result.gateway?.provider;
   if(result.invoice?.guest!==true||result.invoice.id!==invoice||provider!=='pure_gateway'&&!usdcNetwork(provider))throw Error('Guest order access could not be verified.');
   guest=true;return result;
  }catch(error){if(!unavailable(error))throw error;return null;}
 }
 async function loadInvoice(){
  const guestLink=query.get('guest')==='1',paymentReturn=query.has('payment_intent');
  if(window.PureWalletHandoff&&!await window.PureWalletHandoff)throw Error('This wallet link is invalid or expired. Copy a new link from your checkout browser.');
  if(guestLink||paymentReturn){const result=await guestInvoice();if(result)return result;}
  if(guestLink)throw Error('This guest order is unavailable in this browser. Open the link in the browser used at checkout or contact support.');
  const r=await fetch('/api/customer-config',{cache:'no-store'}),c=await r.json();
  if(!r.ok)throw Error('Account configuration unavailable.');
  auth=window.supabase.createClient(c.supabaseUrl,c.anonKey,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true,flowType:'pkce'}});
  const session=await auth.auth.getSession(),token=session.data?.session?.access_token;
  if(token){
   try{return await request(null,token);}
   catch(error){if(paymentReturn||!unavailable(error))throw error;const result=await guestInvoice();if(result)return result;throw error;}
  }
  const result=paymentReturn?null:await guestInvoice();if(result)return result;
  const signIn='/account/login?returnTo='+encodeURIComponent('/pay.html?invoice='+invoice);
  const link=$('native-back');if(link){link.href=signIn;link.textContent='Sign in to view your order';}
  throw Error('Sign in to view your order, or open your guest order in the browser used at checkout.');
 }
 function paymentDestination(value,gateway){return gateway.provider==='pure_gateway'?window.DirectCheckout.gatewayPaymentUrl(value,gateway.origin):value;}
 async function sdk(){if(window.mountNmiPayments)return;await new Promise((resolve,reject)=>{const s=document.createElement('script');s.src='https://cdn.jsdelivr.net/npm/@nmipayments/nmi-pay@1.1.1/dist/nmi-payments-cdn.iife.js';s.integrity='sha384-qp9Er1mVythwqCixKu2kKWEUOFRdWQjXovOGr0O+TuhQOFmd8zihM9I0yC9VavFe';s.crossOrigin='anonymous';s.onload=resolve;s.onerror=()=>reject(Error('Secure payment component could not load. No charge was requested.'));document.head.append(s);});}
 function billing(){const form=$('native-billing');if(!form.reportValidity())throw Error('Complete your billing details and confirm the displayed amount.');return Object.fromEntries(new FormData(form));}
 async function authenticate(token,bill){if(!model.gateway.three_ds)return null;return new Promise((resolve,reject)=>{let done=false;const timer=setTimeout(()=>{if(!done){done=true;three?.destroy();reject(Error('Cardholder authentication timed out. No charge was requested.'));}},120000);three=window.mountNmiThreeDSecure('#native-3ds',{tokenizationKey:model.gateway.tokenization_key,modal:true,onComplete:e=>{if(done)return;done=true;clearTimeout(timer);resolve({status:e.cardHolderAuth,cavv:e.cavv,directory_server_id:e.directoryServerId,three_ds_version:e.threeDsVersion,xid:e.xid});},onFailure:()=>{if(done)return;done=true;clearTimeout(timer);reject(Error('Cardholder authentication did not complete. No charge was requested.'));}});three.startThreeDSecure({paymentToken:token,currency:model.invoice.currency,amount:(model.invoice.amount_cents/100).toFixed(2),firstName:bill.first_name,lastName:bill.last_name,email:model.customer.email,address1:bill.address1,city:bill.city,state:bill.state,postalCode:bill.zip,country:bill.country});});}
 async function pay(token){if(processing)return 'A payment is already being checked.';processing=true;$('native-status').textContent='Checking the one-time payment. Do not close the page or submit another charge.';try{const rampex=['rampex','pure_gateway'].includes(model.gateway.provider),bill=rampex?undefined:billing(),authData=token?await authenticate(token,bill):undefined;const result=await api({action:'pay',invoice_id:invoice,attempt_id:crypto.randomUUID(),payment_token:token,billing:bill,cardholder_auth:authData,confirm_amount_cents:model.invoice.amount_cents,confirm_currency:model.invoice.currency,consent:rampex||$('native-consent').checked,crypto_conversion_consent:rampex||$('native-conversion-consent').checked,redirect_notice_ack:model.gateway.provider==='pure_gateway'?true:undefined});if(result.redirect_url&&result.state==='redirected'){location.assign(paymentDestination(result.redirect_url,model.gateway));return true;}if(result.state==='paid'){$('native-status').textContent='Payment confirmed. Your invoice has been updated.';$('native-form').hidden=true;return true;}if(result.state==='declined'){$('native-status').textContent='The card was declined. No paid order was created.';return 'Card declined. Review your details or choose another card.';}$('native-form').hidden=true;$('native-status').textContent='Payment is awaiting confirmation or review. Do not pay again. Refresh this invoice to see the result.';schedulePoll();return 'Confirmation pending—do not submit another payment.';}catch(e){$('native-status').textContent=e.message;return e.message;}finally{processing=false;three?.destroy();three=null;}}
 function schedulePoll(){clearInterval(poll);let count=0;poll=setInterval(async()=>{try{const fresh=await api();if(['paid','processing','shipped','delivered','refunded','void'].includes(fresh.invoice.status)){clearInterval(poll);await render(fresh);}}catch{}if(++count>=20)clearInterval(poll);},5000);}
 const orderStatuses={paid:'Paid',processing:'Processing',shipped:'Shipped',delivered:'Delivered',refunded:'Refunded',void:'Canceled'};
 async function render(data){
  model=data;widget?.destroy();widget=null;$('native-form').hidden=true;
  const i=data.invoice,g=data.gateway,link=$('native-back');
  if(guest&&link){link.href='/shop';link.textContent='← Continue shopping';}
  $('native-title').textContent=i.status==='paid'?'Payment confirmed':guest?'Order payment':'Invoice payment';
  $('native-reference').textContent=(guest&&i.order_number?i.order_number:'INV-'+i.id.toUpperCase())+' · '+(guest?(orderStatuses[i.status]||'Awaiting payment'):i.status);
  $('native-total').textContent=money(i.amount_cents,i.currency);refresh.hidden=false;refresh.disabled=false;
  if(orderStatuses[i.status]){
   $('native-status').textContent=guest?'Order status: '+orderStatuses[i.status]+'.':'Current invoice status: '+i.status+'. View your invoice history for details.';return;
  }
  if(i.status!=='accepted'){$('native-status').textContent=guest?'This order is unavailable for payment. Contact support with your order reference.':'Accept the final amount in My invoices before paying.';return;}

 const network=usdcNetwork(g.provider);
 if(network){
  $('native-billing').hidden=true;$('native-crypto').hidden=true;$('native-widget').hidden=false;$('native-widget').replaceChildren();
  $('native-form').hidden=false;
  if(!window.PureUSDC?.mount){$('native-status').textContent='The wallet payment screen could not load. Refresh your saved order before retrying.';return;}
  $('native-status').textContent='Pay USDC on '+network.label+' directly from your wallet. You need '+network.gas+' for gas; the exact recipient and amount are shown before signing.';
  widget=await window.PureUSDC.mount({host:$('native-widget'),auth,guest,invoice:i.id,amount:i.amount_cents,currency:i.currency,ready:g.ready&&Date.parse(i.expires_at)>Date.now(),state:data.crypto,paymentProvider:g.provider});
  return;
 }
 const active=data.attempts.find(a=>a.operation==='sale'&&a.state!=='declined');if(active){$('native-status').textContent=attemptNote(active,g);if(active.state==='redirected'&&active.redirect_url){try{const a=document.createElement('a');a.href=paymentDestination(active.redirect_url,g);a.className='ap-button';a.textContent='Resume the existing payment session ↗';$('native-status').append(document.createElement('br'),a);}catch(error){$('native-status').textContent=error.message+' Contact support before trying again.';}}schedulePoll();return;}
 if(!g.ready||Date.parse(i.expires_at)<=Date.now()){$('native-status').textContent='This gateway is not activated or the invoice has expired. No payment can be collected here yet.';return;}
 $('native-status').textContent=(g.mode==='sandbox'?'SANDBOX ONLY—no real order entitlement will be granted. ':'')+(g.provider==='nmi'?'Pay with the secure NMI component below.':g.provider==='pure_gateway'?'Pay securely by card on our encrypted payment page. You will be taken to the Get Pure Skin payment page, which collects card payments for PURE orders. It shows PURE as the seller, this order and the exact total before you enter any card details. Your order is confirmed automatically once the payment clears.':g.provider==='rampex'?'Continue to secure card-to-crypto checkout through Rampex. The provider displays its fees, conversion rate and final charge before payment. Cards and digital wallets depend on country, device and eligibility.':g.provider==='peptidepay'?'PeptidePay uses a third-party crypto purchase to pay this invoice. Read the disclosure below before continuing.':'Continue to the configured PayerURL crypto checkout.');
 $('native-form').hidden=false;const f=$('native-billing'),names=data.customer.name.split(/\s+/),address=data.customer.address;f.elements.first_name.value=names.shift()||'';f.elements.last_name.value=names.join(' ');for(const [k,v]of Object.entries({address1:address.line1,city:address.city,state:address.region,zip:address.postal_code}))if(v)f.elements[k].value=v;f.elements.country.replaceChildren();for(const code of g.countries){const o=document.createElement('option');o.value=code;o.textContent=code;f.elements.country.append(o);}if(address.country&&g.countries.includes(address.country))f.elements.country.value=address.country;
 $('native-crypto').hidden=g.provider==='nmi';$('native-crypto').textContent=g.provider==='pure_gateway'?'Continue to secure card payment ↗':g.provider==='rampex'?'Continue to secure card checkout ↗':g.provider==='peptidepay'?'Continue to PeptidePay ↗':'Continue to crypto payment ↗';$('native-conversion').hidden=g.provider!=='peptidepay';$('native-conversion-consent').required=g.provider==='peptidepay';const hosted=['rampex','pure_gateway'].includes(g.provider);$('native-billing').hidden=hosted;const label=$('native-consent').closest?.('label');if(label)label.hidden=hosted;$('native-consent').required=!hosted;$('native-widget').hidden=g.provider!=='nmi';
 if(g.provider==='nmi'){await sdk();const methods=['card'];if(g.wallets.google)methods.push('google-pay');if(g.wallets.apple)methods.push('apple-pay');widget=window.mountNmiPayments('#native-widget',{tokenizationKey:g.tokenization_key,paymentMethods:methods,payButtonText:'Pay '+money(i.amount_cents,i.currency),expressCheckoutConfig:{amount:(i.amount_cents/100).toFixed(2),currency:i.currency,countryCode:f.elements.country.value,emailRequired:true,billingRequired:true,applePay:{totalLabel:'PURE'},googlePay:{totalPriceStatus:'FINAL',buttonType:'pay'}},onPay:e=>pay(e.token),onExpressCheckout:e=>pay(e.token)});}
 }
 $('native-crypto').onclick=()=>pay();$('native-billing').onsubmit=e=>e.preventDefault();refresh.onclick=async()=>{if(refresh.disabled||!model)return;try{await render(await api());}catch(e){$('native-status').textContent=e.message;}};
 (async()=>{if(!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(invoice||''))throw Error('Open the secure payment link from your accepted invoice.');
  let first=await loadInvoice();
  // Returning from the card payment page: the address only says a payment was attempted. The server re-checks it with the provider.
  if(first.gateway?.provider==='pure_gateway'&&query.has('payment_intent')&&first.attempts?.some(x=>x.state!=='declined')){
   $('native-status').textContent='Confirming your card payment…';
   try{await api({action:'confirm_card',invoice_id:invoice});first=await api();}catch{/* the invoice status below remains authoritative */}
  }
  await render(first);})().catch(e=>{$('native-title').textContent='Payment unavailable';$('native-status').textContent=e.message;});
})();
