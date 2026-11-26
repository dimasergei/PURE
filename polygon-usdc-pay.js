(function(){
 'use strict';
 const ADDRESS=/^0x[0-9a-f]{40}$/i,HASH=/^0x[0-9a-f]{64}$/i;
 const NETWORKS=Object.freeze({
  polygon_usdc:Object.freeze({label:'Polygon',gas:'POL',chainId:137,token:'0x3c499c542cef5e3811e1192ce70d8cc03d5c3359'}),
  base_usdc:Object.freeze({label:'Base',gas:'ETH',chainId:8453,token:'0x833589fcd6edb6e08f4c7c32d4f71b54bda02913'}),
  ethereum_usdc:Object.freeze({label:'Ethereum',gas:'ETH',chainId:1,token:'0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48'})
 });
 const networkFor=provider=>Object.hasOwn(NETWORKS,provider)?NETWORKS[provider]:null;
 const lower=value=>String(value||'').toLowerCase();
 const TRANSFER='TransferWithAuthorization';
 const DOMAIN_TYPES=[{name:'name',type:'string'},{name:'version',type:'string'},{name:'chainId',type:'uint256'},{name:'verifyingContract',type:'address'}];
 const TRANSFER_TYPES=[{name:'from',type:'address'},{name:'to',type:'address'},{name:'value',type:'uint256'},{name:'validAfter',type:'uint256'},{name:'validBefore',type:'uint256'},{name:'nonce',type:'bytes32'}];
 const domainFor=network=>({name:'USD Coin',version:'2',chainId:network.chainId,verifyingContract:network.token});
 function matchesDomain(domain,network){return !!network&&domain?.name==='USD Coin'&&domain.version==='2'&&domain.chainId===network.chainId&&lower(domain.verifyingContract)===network.token;}
 function word(value){const hex=BigInt(value).toString(16);if(hex.length>64||hex.startsWith('-'))throw Error('Invalid payment authorization.');return hex.padStart(64,'0');}
 function address(value){if(!ADDRESS.test(value))throw Error('Invalid payment address.');return value.slice(2).toLowerCase().padStart(64,'0');}
 function encode(authorization,signature,paymentProvider='polygon_usdc'){
  const m=authorization.message;if(!/^0x[0-9a-f]{130}$/i.test(signature)||!HASH.test(m.nonce)||!matchesDomain(authorization.domain,networkFor(paymentProvider)))throw Error('Your wallet returned an unsupported authorization.');
  let v=parseInt(signature.slice(130,132),16);if(v<27)v+=27;if(v!==27&&v!==28)throw Error('Your wallet returned an unsupported signature.');
  return '0xe3ee160e'+address(m.from)+address(m.to)+word(m.value)+word(m.validAfter)+word(m.validBefore)+m.nonce.slice(2)+word(v)+signature.slice(2,66)+signature.slice(66,130);
 }
 async function mount({host,auth,guest=false,invoice,amount,currency,ready,state,paymentProvider='polygon_usdc'}){
  const network=networkFor(paymentProvider);
  if(!network||currency!=='USD'||!Number.isSafeInteger(amount)||amount<=0)throw Error('This wallet payment route could not be verified.');
  const chain='0x'+network.chainId.toString(16),amountUnits=String(BigInt(amount)*10000n);
  const intentMatches=intent=>intent?.invoice_id===invoice&&intent.chain_id===network.chainId&&lower(intent.token)===network.token&&ADDRESS.test(intent.recipient)&&ADDRESS.test(intent.payer)&&String(intent.amount_units)===amountUnits;
  let current=state||{state:'not_started'},wallet=null,provider=null,busy=false,disposed=false,poll=null,pollCount=0;
  const root=document.createElement('section');root.className='ap-form pure-usdc-payment';
  const heading=document.createElement('h2');heading.textContent='Pay with native USDC on '+network.label;
  const details=document.createElement('p');details.textContent='Pay '+(amount/100).toFixed(2)+' USDC directly from your wallet. Use native USDC on '+network.label+', plus a little '+network.gas+' for your wallet’s network fee. Any applicable order discount is already included.';
  const summary=document.createElement('p');summary.className='ap-fine';summary.style.overflowWrap='anywhere';
  const status=document.createElement('p');status.className='native-status';status.setAttribute('role','status');status.setAttribute('aria-live','polite');
  const connect=document.createElement('button');connect.type='button';connect.className='ap-button';connect.textContent='CONNECT WALLET';
  const pay=document.createElement('button');pay.type='button';pay.className='ap-button';pay.textContent='AUTHORIZE & PAY '+(amount/100).toFixed(2)+' USDC';pay.hidden=true;
  const check=document.createElement('button');check.type='button';check.className='ap-button ap-button-secondary';check.textContent='CHECK PAYMENT STATUS';
  const handoff=document.createElement('p');handoff.className='ap-fine';handoff.textContent=guest?'On mobile, copy a private payment link and open it in the browser inside your compatible wallet. It is valid for five minutes.':'On mobile, open this saved order in the browser inside your compatible wallet, then sign in. On desktop, use a compatible wallet extension. This flow supports standard externally owned wallets.';
  const copy=document.createElement('button');copy.type='button';copy.className='ap-button ap-button-secondary';copy.textContent=guest?'COPY WALLET PAYMENT LINK':'COPY SAVED ORDER LINK';
  const walletLink=document.createElement('input');walletLink.type='text';walletLink.readOnly=true;walletLink.hidden=true;walletLink.setAttribute('aria-label','Private wallet payment link');
  root.append(heading,details,summary,status,connect,pay,check,handoff,copy,walletLink);host.replaceChildren(root);
  const key=()=>current.intent?'pure-usdc:'+invoice+':'+current.intent.attempt_id:null;
  function marker(value){try{const k=key();if(!k)return null;if(value===null)localStorage.removeItem(k);else if(value!==undefined)localStorage.setItem(k,value);return localStorage.getItem(k);}catch{return null;}}
  const uncertain=()=>current.state==='pending'||!!marker();
  const stopped=()=>['paid','review','expired','canceled','cancel_pending'].includes(current.state);
  function draw(text){
   if(disposed)return;const intent=current.intent,ended=stopped(),expired=intent&&Date.now()/1000>=Number(intent.valid_before),mismatch=intent&&!intentMatches(intent);
   connect.hidden=ended||expired||mismatch||!ready||uncertain()||!!wallet||!window.ethereum?.request;connect.disabled=busy;
   pay.hidden=ended||!ready||mismatch||uncertain()||!wallet||!intent||expired;pay.disabled=busy;
   check.hidden=!intent||['paid','canceled'].includes(current.state);check.disabled=busy;
   summary.textContent=intent&&!mismatch?'Network: '+network.label+' · Native USDC · Receiving wallet: '+intent.recipient:'';
   handoff.hidden=!!window.ethereum;copy.hidden=!!window.ethereum;
   status.textContent=text||(current.state==='canceled'?'Your unpaid order is canceled. No payment was received and no refund was issued.':current.state==='cancel_pending'?'Cancellation requested. Do not send payment. We are checking the wallet authorization and will finish canceling automatically once it has expired unused.':current.state==='paid'?'Payment confirmed. Your order is paid.':current.state==='review'?'Your transfer was received and needs order review. Please contact support with this saved order; do not send another payment.':current.state==='expired'||expired?'This authorization has expired. Check payment status before creating a new order.':mismatch?'The saved payment does not match this order’s network or amount. Check payment status.':uncertain()?'Checking your transfer on '+network.label+'. Keep this order link; confirmation continues even if you close this page. Do not send a second payment.':!ready?'New wallet payments are currently unavailable for this order. You can still check a previously sent payment.':wallet?'Wallet connected. Review the amount, then authorize this order and confirm the transaction in your wallet.':'Connect your wallet to review the exact order authorization.');
  }
  async function api(body){
   const session=guest?null:await auth.auth.getSession(),token=session?.data?.session?.access_token;
   if(!guest&&!token)throw Error('Sign in again to check or pay this saved order.');
   const r=await fetch('/api/checkout?native=customer&invoice='+encodeURIComponent(invoice),{method:body?'POST':'GET',cache:'no-store',credentials:'same-origin',headers:{...(token?{Authorization:'Bearer '+token}:{}),...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});
   const data=await r.json();if(!r.ok)throw Error(data.error||'Payment confirmation is temporarily unavailable. Keep this saved order link.');return data;
  }
  function schedule(){clearTimeout(poll);if(disposed||!current.intent||['paid','review','expired','canceled'].includes(current.state)||pollCount>=18)return;poll=setTimeout(async()=>{pollCount++;await refresh();schedule();},10000);}
  async function refresh(){
   if(busy||disposed||!current.intent)return;busy=true;draw();
   try{const saved=marker(),hash=HASH.test(saved||'')?saved:current.intent.tx_hash;const result=await api({action:'confirm_crypto',invoice_id:invoice,attempt_id:current.intent.attempt_id,...(hash?{tx_hash:hash}:{})});current={...current,...result};if(['paid','review','expired','canceled'].includes(current.state))marker(null);draw();}
   catch(e){draw(e.message);}finally{busy=false;draw(status.textContent);}
  }
  async function selected(){
   const accounts=await provider.request({method:'eth_accounts'});if(String(accounts?.[0]||'').toLowerCase()!==wallet){wallet=null;throw Error('The selected wallet changed. Reconnect the wallet selected for this order.');}
   if(lower(await provider.request({method:'eth_chainId'}))!==chain)throw Error('Switch your wallet to '+network.label+' before authorizing this order.');
  }
  async function stillPayable(attempt){
   const latest=await api();if(latest.crypto)current=latest.crypto;
   if(!latest.crypto||stopped()||current.state==='pending'||current.intent?.tx_hash||current.intent?.attempt_id!==attempt||latest.gateway?.ready===false||latest.gateway?.provider&&latest.gateway.provider!==paymentProvider||latest.invoice?.cancellation_requested_at||latest.invoice?.status&&latest.invoice.status!=='accepted'||!current.authorization)throw Error('This order is no longer available for payment. Check its current status; do not send payment.');
  }
  function typedAuthorization(){
   const {authorization,intent}=current,message=authorization?.message;
   if(!intentMatches(intent)||authorization?.primaryType!==TRANSFER||!matchesDomain(authorization.domain,network)||!message||
    lower(message.from)!==wallet||lower(intent.payer)!==wallet||lower(message.to)!==lower(intent.recipient)||String(message.value)!==amountUnits||
    !HASH.test(message.nonce)||lower(message.nonce)!==lower(intent.nonce)||!Number.isSafeInteger(message.validAfter)||!Number.isSafeInteger(message.validBefore)||
    message.validAfter!==intent.valid_after||message.validBefore!==intent.valid_before||message.validAfter<0||message.validBefore<=message.validAfter)
    throw Error('The wallet authorization does not match this order. Refresh payment status.');
   return {domain:domainFor(network),types:{EIP712Domain:DOMAIN_TYPES,[TRANSFER]:TRANSFER_TYPES},primaryType:TRANSFER,
    message:{from:wallet,to:lower(intent.recipient),value:amountUnits,validAfter:intent.valid_after,validBefore:intent.valid_before,nonce:lower(intent.nonce)}};
  }
  connect.onclick=async()=>{
   if(busy||stopped()||!ready||current.intent&&!intentMatches(current.intent))return;busy=true;draw();
   try{
    provider=window.ethereum;if(!provider?.request)throw Error('Open this saved order in your wallet browser or use a desktop wallet extension.');
    const accounts=await provider.request({method:'eth_requestAccounts'});wallet=lower(accounts?.[0]);if(!ADDRESS.test(wallet))throw Error('Choose a wallet compatible with '+network.label+'.');
    if(lower(await provider.request({method:'eth_chainId'}))!==chain)await provider.request({method:'wallet_switchEthereumChain',params:[{chainId:chain}]});
    await selected();
    current=await api({action:'pay',invoice_id:invoice,attempt_id:current.intent?.attempt_id||crypto.randomUUID(),wallet_address:wallet,confirm_amount_cents:amount,confirm_currency:currency,consent:true});
    if(current.intent&&!intentMatches(current.intent))throw Error('The saved payment does not match this order’s network or amount. Check payment status.');
    if(current.intent&&lower(current.intent.payer)!==wallet)throw Error('Reconnect the original wallet for this saved payment.');
    draw();schedule();
   }catch(e){wallet=null;draw(e.code===4001?'Wallet connection was canceled. No payment was sent.':e.message);}finally{busy=false;draw(status.textContent);}
  };
  pay.onclick=async()=>{
   if(busy||stopped()||!ready||uncertain()||!wallet||!intentMatches(current.intent)||Date.now()/1000>=current.intent.valid_before)return;busy=true;draw('Review the order authorization in your wallet.');let sending=false;
   try{
    const attempt=current.intent.attempt_id;
    await stillPayable(attempt);await selected();
    const typed=typedAuthorization(),serialized=JSON.stringify(typed);
    const signature=await provider.request({method:'eth_signTypedData_v4',params:[wallet,serialized]});
    const data=encode(typed,signature,paymentProvider);await stillPayable(attempt);await selected();
    if(JSON.stringify(typedAuthorization())!==serialized)throw Error('The wallet authorization changed. Check payment status.');
    if(Date.now()/1000>=current.intent.valid_before)throw Error('This authorization expired before submission. Check payment status.');
    // Persist uncertainty before the wallet request: a lost response is not proof of failure.
    marker('broadcasting');sending=true;draw('Confirm the native USDC transfer and '+network.gas+' network fee in your wallet.');
    const hash=await provider.request({method:'eth_sendTransaction',params:[{from:wallet,to:network.token,value:'0x0',data}]});
    if(!HASH.test(hash||''))throw Error('Your wallet did not return a transaction reference. Check this saved order before doing anything else.');
    marker(hash.toLowerCase());current.state='pending';current.intent.tx_hash=hash.toLowerCase();draw();
   }catch(e){
    if(e.code===4001){if(sending)marker(null);draw(sending?'The transaction request was canceled. No new transfer was submitted by this page.':'Authorization was canceled. No payment was sent.');}
    else{if(sending)current.state='pending';draw(e.message);}
   }finally{busy=false;draw(status.textContent);if(uncertain()){await refresh();schedule();}}
  };
  check.onclick=async()=>{pollCount=0;await refresh();schedule();};
  copy.onclick=async()=>{
   const url=new URL('/pay.html',location.origin);
   url.searchParams.set('invoice',invoice);
   if(!guest){
    try{await navigator.clipboard.writeText(url.href);draw('Saved order link copied. Open it in your wallet browser and sign in.');}
    catch{draw('Open '+url.href+' in your wallet browser and sign in.');}
    return;
   }
   copy.disabled=true;walletLink.hidden=true;walletLink.value='';
   try{
    const {ticket}=await api({action:'guest_wallet_link',invoice_id:invoice});
    if(disposed)return;
    if(!/^[a-f0-9.-]+\.[A-Za-z0-9_-]{43}$/i.test(ticket||''))throw Error('Could not create a private wallet link.');
    url.searchParams.set('guest','1');
    url.hash='wallet='+ticket;
    try{await navigator.clipboard.writeText(url.href);draw('Private wallet payment link copied. Paste it in your wallet browser within five minutes.');}
    catch{
     walletLink.value=url.href;walletLink.hidden=false;walletLink.focus();walletLink.select();
     draw('Copy this private payment link and open it in your wallet browser within five minutes.');
    }
   }catch(e){draw(e.message);}
   finally{copy.disabled=false;}
  };
  draw();if(current.intent)schedule();
  return{destroy(){disposed=true;clearTimeout(poll);root.remove();}};
 }
 window.PureUSDC={mount,encodeAuthorization:encode};
})();
