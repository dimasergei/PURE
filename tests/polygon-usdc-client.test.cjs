'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),{randomUUID,randomBytes}=require('node:crypto'),{JSDOM}=require('jsdom'),{Wallet,Signature}=require('ethers');
const polygon=require('../lib/polygon-usdc'),source=fs.readFileSync(require.resolve('../polygon-usdc-pay.js'),'utf8');
const payer=Wallet.createRandom(),recipient='0x'+'a'.repeat(40),hash='0x'+'c'.repeat(64);
function intent(){const now=Math.floor(Date.now()/1000);return{attempt_id:randomUUID(),invoice_id:randomUUID(),payer:payer.address.toLowerCase(),recipient,chain_id:137,token:polygon.TOKEN,amount_units:'9500000',nonce:'0x'+randomBytes(32).toString('hex'),valid_after:now-60,valid_before:now+1800,status:'open'};}
async function setup({wallet=true,guest=false,state,ready=true,rejectSign=false,rejectSend=false,unknownSend=false,chain='0x89',rejectSwitch=false,cancelOnStatusRead=0}={}){
 const i=intent(),dom=new JSDOM('<div id="host"></div>',{url:'https://getpurelabs.com/pay.html?invoice='+i.invoice_id,runScripts:'outside-only'}),w=dom.window,calls=[],posts=[],requests=[];let active=payer.address,network=chain;
 let canceled=state==='cancel_pending'?'pending':null,reads=0;
 const invoice=()=>({status:canceled==='canceled'?'void':'accepted',...(canceled?{cancellation_status:canceled,cancellation_requested_at:'2026-11-17T22:00:00Z'}:{})});
 w.fetch=async(url,o={})=>{const body=o.body?JSON.parse(o.body):null;posts.push(body);requests.push({url,options:o});let result;if(body?.action==='pay')result=polygon.publicIntent(i,invoice());else if(body?.action==='confirm_crypto')result=canceled?polygon.publicIntent(i,invoice()):{state:body.tx_hash?'paid':'awaiting_wallet'};else if(body?.action==='guest_wallet_link')result={ticket:'aaaaaaaa-0000-4000-8000-000000000001.1970000000.'+'a'.repeat(43)};else{if(cancelOnStatusRead&&++reads>=cancelOnStatusRead)canceled='pending';result={invoice:invoice(),crypto:polygon.publicIntent(i,invoice())};}return{ok:true,json:async()=>result};};
 if(wallet)w.ethereum={request:async q=>{calls.push(q);switch(q.method){case'eth_requestAccounts':case'eth_accounts':return[active];case'eth_chainId':return network;case'wallet_switchEthereumChain':if(rejectSwitch)throw Object.assign(Error('Network switch canceled'),{code:4001});network=q.params[0].chainId;return null;case'eth_signTypedData_v4':if(rejectSign)throw Object.assign(Error('Sign canceled'),{code:4001});const data=JSON.parse(q.params[1]);delete data.types.EIP712Domain;return payer.signTypedData(data.domain,data.types,data.message);case'eth_sendTransaction':if(rejectSend)throw Object.assign(Error('Send canceled'),{code:4001});if(unknownSend)throw Error('Wallet disconnected after submission');return hash;default:throw Error(q.method);}}};
 w.eval(source);const mount=await w.PureUSDC.mount({host:w.document.getElementById('host'),auth:guest?undefined:{auth:{getSession:async()=>({data:{session:{access_token:'fixture-token'}}})}},guest,invoice:i.invoice_id,amount:950,currency:'USD',ready,state:state?{...polygon.publicIntent(i),state}:undefined});
 const buttons=[...w.document.querySelectorAll('button')],connect=buttons[0],pay=buttons[1],check=buttons[2],status=w.document.querySelector('[role=status]');
 return{w,i,calls,posts,requests,mount,connect,pay,check,status,setAccount:a=>{active=a},setCancellation:s=>{canceled=s},close:()=>{mount.destroy();w.close();}};
}
test('client static EIP-3009 encoding exactly matches ethers ABI',async()=>{const d=await setup();try{const authorization=polygon.publicIntent(d.i).authorization,sig=await payer.signTypedData(authorization.domain,authorization.types,authorization.message),parsed=Signature.from(sig);assert.equal(d.w.PureUSDC.encodeAuthorization(authorization,sig),polygon.ABI.encodeFunctionData('transferWithAuthorization',[d.i.payer,d.i.recipient,d.i.amount_units,d.i.valid_after,d.i.valid_before,d.i.nonce,parsed.v,parsed.r,parsed.s]));}finally{d.close();}});
test('wallet connection alone never signs or transfers, refresh leaves unpaid authorization usable',async()=>{const d=await setup();try{await d.connect.onclick();assert.equal(d.pay.hidden,false);assert.equal(d.calls.some(x=>x.method==='eth_sendTransaction'),false);await d.check.onclick();assert.equal(d.pay.hidden,false);assert.match(d.status.textContent,/Wallet connected/);}finally{d.close();}});
test('explicit pay signs and broadcasts only exact token authorization and ignores duplicate clicks',async()=>{const d=await setup();try{await d.connect.onclick();await Promise.all([d.pay.onclick(),d.pay.onclick()]);const sends=d.calls.filter(x=>x.method==='eth_sendTransaction');assert.equal(sends.length,1);assert.equal(sends[0].params[0].to,polygon.TOKEN);assert.equal(sends[0].params[0].from,payer.address.toLowerCase());assert.equal(sends[0].params[0].value,'0x0');assert.match(d.status.textContent,/Payment confirmed/);assert.equal(d.posts.filter(x=>x?.action==='pay').length,1);}finally{d.close();}});
test('wrong network is explicitly switched before any signature or broadcast',async()=>{const d=await setup({chain:'0x1'});try{await d.connect.onclick();assert.ok(d.calls.some(x=>x.method==='wallet_switchEthereumChain'&&x.params[0].chainId==='0x89'));assert.equal(d.calls.some(x=>x.method==='eth_signTypedData_v4'),false);}finally{d.close();}const denied=await setup({chain:'0x1',rejectSwitch:true});try{await denied.connect.onclick();assert.equal(denied.posts.length,0);assert.equal(denied.pay.hidden,true);}finally{denied.close();}});
test('signing rejection sends no transfer and leaves the same immutable intent retryable',async()=>{const d=await setup({rejectSign:true});try{await d.connect.onclick();await d.pay.onclick();assert.equal(d.calls.some(x=>x.method==='eth_sendTransaction'),false);assert.match(d.status.textContent,/Authorization was canceled/);assert.equal(d.pay.hidden,false);assert.equal(d.w.localStorage.length,0);}finally{d.close();}});
test('wallet transaction rejection allows retry, ambiguous transport result never auto-resends',async()=>{const rejected=await setup({rejectSend:true});try{await rejected.connect.onclick();await rejected.pay.onclick();assert.equal(rejected.pay.hidden,false);assert.equal(rejected.w.localStorage.length,0);}finally{rejected.close();}const unknown=await setup({unknownSend:true});try{await unknown.connect.onclick();await unknown.pay.onclick();assert.equal(unknown.pay.hidden,true);assert.equal(unknown.w.localStorage.length,1);await unknown.pay.onclick();assert.equal(unknown.calls.filter(x=>x.method==='eth_sendTransaction').length,1);assert.ok(unknown.posts.some(x=>x?.action==='confirm_crypto'));}finally{unknown.close();}});
test('changing selected account exposes reconnect and never signs for a stale account',async()=>{const d=await setup();try{await d.connect.onclick();d.setAccount(recipient);await d.pay.onclick();assert.equal(d.calls.some(x=>x.method==='eth_signTypedData_v4'),false);assert.equal(d.connect.hidden,false);assert.match(d.status.textContent,/selected wallet changed/);}finally{d.close();}});
test('mobile without injected wallet gets a saved-order handoff, never a fabricated payment',async()=>{const d=await setup({wallet:false});try{await d.connect.onclick();assert.equal(d.posts.length,0);assert.match(d.status.textContent,/wallet browser/);assert.equal([...d.w.document.querySelectorAll('button')].find(x=>x.textContent==='COPY SAVED ORDER LINK').hidden,false);}finally{d.close();}});
test('guest wallet requests use only the order cookie and support a mobile handoff',async()=>{
 const mobile=await setup({wallet:false,guest:true});
 try{
  const copy=[...mobile.w.document.querySelectorAll('button')].find(x=>x.textContent==='COPY WALLET PAYMENT LINK');
  assert.equal(copy.hidden,false);
  await copy.onclick();
  const link=new URL(mobile.w.document.querySelector('[aria-label="Private wallet payment link"]').value);
  assert.equal(link.origin,'https://getpurelabs.com');
  assert.equal(link.searchParams.get('invoice'),mobile.i.invoice_id);
  assert.equal(link.searchParams.get('guest'),'1');
  assert.match(link.hash,/^#wallet=/);
  assert.equal(mobile.posts[0].action,'guest_wallet_link');
  assert.equal(mobile.requests[0].options.credentials,'same-origin');
  assert.equal(mobile.requests[0].options.headers.Authorization,undefined);
  assert.equal(mobile.calls.length,0);
 }finally{mobile.close();}
 const injected=await setup({guest:true});
 try{
  await injected.connect.onclick();
  assert.equal(injected.pay.hidden,false);
  assert.equal(injected.requests[0].options.credentials,'same-origin');
  assert.equal(injected.requests[0].options.headers.Authorization,undefined);
  assert.equal(injected.calls.some(call=>call.method==='eth_sendTransaction'),false);
 }finally{injected.close();}
});
test('the first pay-page script clears the guest ticket before exchanging it',async()=>{
 const invoice=randomUUID(),ticket='fixture-ticket';
 const dom=new JSDOM(fs.readFileSync(require.resolve('../pay.html'),'utf8'),{url:'https://getpurelabs.com/pay.html?invoice='+invoice+'&guest=1#wallet='+ticket,runScripts:'outside-only'});
 const w=dom.window;
 try{
  let exchanged=false;
  w.fetch=async(url,options)=>{
   assert.equal(w.location.hash,'');
   assert.equal(url,'/api/checkout?native=customer');
   assert.equal(options.credentials,'same-origin');
   assert.deepEqual(JSON.parse(options.body),{action:'guest_wallet_exchange',invoice_id:invoice,ticket});
   exchanged=true;return {ok:true};
  };
  w.eval(w.document.querySelector('script').textContent);
  assert.equal(await w.PureWalletHandoff,true);
  assert.equal(exchanged,true);
 }finally{w.close();}
});
test('paused new collection still offers status reconciliation for existing pending transfers',async()=>{const d=await setup({state:'pending',ready:false});try{assert.equal(d.connect.hidden,true);assert.equal(d.pay.hidden,true);assert.equal(d.check.hidden,false);await d.check.onclick();assert.equal(d.posts[0].action,'confirm_crypto');}finally{d.close();}});
test('pending cancellation cannot authorize or send and status checking can complete cancellation',async()=>{const d=await setup({state:'cancel_pending'});try{
 assert.equal(d.connect.hidden,true);assert.equal(d.pay.hidden,true);assert.equal(d.check.hidden,false);assert.match(d.status.textContent,/Cancellation requested/);
 await d.connect.onclick();await d.pay.onclick();assert.equal(d.calls.length,0);
 d.setCancellation('canceled');await d.check.onclick();assert.match(d.status.textContent,/unpaid order is canceled/);assert.equal(d.check.hidden,true);
}finally{d.close();}});
test('a cancellation in another tab is checked before signing and again before broadcasting',async()=>{
 for(const stage of [1,2]){const d=await setup({cancelOnStatusRead:stage});try{
  await d.connect.onclick();await d.pay.onclick();assert.equal(d.calls.filter(x=>x.method==='eth_sendTransaction').length,0);
  assert.equal(d.calls.filter(x=>x.method==='eth_signTypedData_v4').length,stage===1?0:1);
  assert.equal(d.pay.hidden,true);assert.match(d.status.textContent,/no longer available for payment/);
 }finally{d.close();}}
});
