'use strict';
// Native USDC receipt verification. The server never signs or broadcasts a transfer.
const {randomBytes,randomUUID,createHash}=require('node:crypto');
const {Interface,TypedDataEncoder,verifyTypedData,Signature}=require('ethers');
const membershipPayment=require('./membership-payment');
const CHAIN_ID=137,TOKEN='0x3c499c542cef5e3811e1192ce70d8cc03d5c3359';
const ADDRESS=/^0x[a-f0-9]{40}$/i,HASH=/^0x[a-f0-9]{64}$/i,UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const ZERO='0x'+'0'.repeat(40);
const nativeNetwork=(provider,name,chainId,token)=>Object.freeze({
 provider,name,envPrefix:provider.toUpperCase(),chainId,token,
 domain:Object.freeze({name:'USD Coin',version:'2',chainId,verifyingContract:token})
});
const NETWORKS=Object.freeze({
 polygon_usdc:nativeNetwork('polygon_usdc','Polygon',CHAIN_ID,TOKEN),
 base_usdc:nativeNetwork('base_usdc','Base',8453,'0x833589fcd6edb6e08f4c7c32d4f71b54bda02913'),
 ethereum_usdc:nativeNetwork('ethereum_usdc','Ethereum',1,'0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48')
});
const DOMAIN=NETWORKS.polygon_usdc.domain;
const TYPES={TransferWithAuthorization:[{name:'from',type:'address'},{name:'to',type:'address'},{name:'value',type:'uint256'},{name:'validAfter',type:'uint256'},{name:'validBefore',type:'uint256'},{name:'nonce',type:'bytes32'}]};
const ABI=new Interface([
 'function name() view returns(string)','function version() view returns(string)','function decimals() view returns(uint8)','function DOMAIN_SEPARATOR() view returns(bytes32)',
 'function authorizationState(address,bytes32) view returns(bool)',
 'function transferWithAuthorization(address from,address to,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce,uint8 v,bytes32 r,bytes32 s)',
 'event AuthorizationUsed(address indexed authorizer,bytes32 indexed nonce)','event Transfer(address indexed from,address indexed to,uint256 value)'
]);
const error=(status,message)=>Object.assign(Error(message),{status});
const fail=(status,message)=>{throw error(status,message);};
const lower=value=>String(value||'').toLowerCase();
const goodAddress=value=>ADDRESS.test(value||'')&&lower(value)!==ZERO;
const checked=result=>{if(result.error)fail(409,'Crypto payment state could not be confirmed. Check the saved order before trying again.');return result.data;};
const isSupportedProvider=provider=>Object.hasOwn(NETWORKS,provider);
function networkForProvider(provider){
 if(!isSupportedProvider(provider))fail(400,'Unsupported native USDC payment route.');
 return NETWORKS[provider];
}
function networkForIntent(intent){
 const network=Object.values(NETWORKS).find(({chainId,token})=>Number(intent.chain_id)===chainId&&lower(intent.token)===token);
 if(!network)fail(409,'The saved USDC payment references an unsupported network or token.');
 return network;
}
function rpcURL(value){try{const u=new URL(value);return u.protocol==='https:'&&!u.username&&!u.password&&!u.hash?u.href:null;}catch{return null;}}
const rpcHost=url=>new URL(url).hostname.replace(/\.$/,'');
function configuration(env=process.env,provider='polygon_usdc'){
 const {chainId,token,envPrefix}=networkForProvider(provider);
 const recipientKey=`${envPrefix}_RECIPIENT`,rpcKey=`${envPrefix}_RPC_URL`,secondaryKey=`${envPrefix}_SECONDARY_RPC_URL`;
 const recipient=lower(env[recipientKey]),missing=[];
 if(!goodAddress(recipient))missing.push(recipientKey);
 const rpc=rpcURL(env[rpcKey]),secondary=rpcURL(env[secondaryKey]);
 if(!rpc)missing.push(rpcKey);
 if(!secondary||(rpc&&rpcHost(secondary)===rpcHost(rpc)))missing.push(secondaryKey);
 const enabled=env[`${envPrefix}_ENABLED`]==='true';
 return{provider,mode:'live',enabled,ready:enabled&&!missing.length,missing,currencies:['USD'],recipient,chain_id:chainId,token,rpc,secondary,
  account_tag:goodAddress(recipient)?createHash('sha256').update(`${provider}:live:${chainId}:${token}:${recipient}`).digest('hex'):null,three_ds:false,wallets:{apple:false,google:false}};
}
async function rpc(url,method,params,fetchImpl,network){
 let response,data;
 const unavailable=`${network.name} verification is temporarily unavailable. Your payment remains pending.`;
 try{
  response=await fetchImpl(url,{method:'POST',redirect:'error',headers:{'Content-Type':'application/json',Accept:'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params}),signal:AbortSignal.timeout(10000)});
  // Block responses include the full list of transaction hashes, even with full transactions disabled.
  const cap=method==='eth_getBlockByNumber'?1048576:131072,declared=response.headers?.get('content-length');
  if(declared&&(!/^\d+$/.test(declared)||Number(declared)>cap))throw Error('response limit');
  const reader=response.body?.getReader();if(!reader)throw Error('unbounded response');
  const chunks=[];let size=0;
  try{for(;;){const part=await reader.read();if(part.done)break;size+=part.value.byteLength;if(size>cap)throw Error('response limit');chunks.push(Buffer.from(part.value));}}
  finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
  data=JSON.parse(Buffer.concat(chunks,size).toString('utf8'));
 }catch{fail(503,unavailable);}
 if(!response.ok||data?.jsonrpc!=='2.0'||data.id!==1||data.error||!Object.hasOwn(data,'result'))fail(503,unavailable);
 return data.result;
}
const quantity=value=>{if(typeof value!=='string'||!/^0x[0-9a-f]+$/i.test(value))fail(503,'The network returned an invalid block reference.');return BigInt(value);};
const safeQuantity=(value,max=Number.MAX_SAFE_INTEGER)=>{const n=quantity(value);if(n>BigInt(max))fail(503,'The network returned an invalid block index.');return Number(n);};
async function finality(url,fetchImpl,network){
 if(quantity(await rpc(url,'eth_chainId',[],fetchImpl,network))!==BigInt(network.chainId))fail(503,`The configured network is not ${network.name}.`);
 const block=await rpc(url,'eth_getBlockByNumber',['finalized',false],fetchImpl,network);
 if(!block||!HASH.test(block.hash||''))fail(503,`${network.name} finality could not be verified.`);
 return{number:BigInt(safeQuantity(block.number)),hash:lower(block.hash),timestamp:safeQuantity(block.timestamp)};
}
async function tokenCall(url,name,args,block,fetchImpl,network){
 const raw=await rpc(url,'eth_call',[{to:network.token,data:ABI.encodeFunctionData(name,args)},block],fetchImpl,network);
 try{return ABI.decodeFunctionResult(name,raw)[0];}catch{fail(503,'The native USDC contract could not be verified.');}
}
const readinessCache=new Map();
async function readiness(env=process.env,fetchImpl=fetch,provider='polygon_usdc'){
 const network=networkForProvider(provider),c=configuration(env,provider);
 const base={provider:c.provider,enabled:c.enabled,configured:!c.missing.length,operational:false,ready:false,missing:c.missing,chain_id:network.chainId,token:network.token,recipient_tail:goodAddress(c.recipient)?c.recipient.slice(-6):null,checked_at:new Date().toISOString(),checks:{}};
 if(c.missing.length)return base;
 const key=createHash('sha256').update([c.account_tag,c.rpc,c.secondary].join('|')).digest('hex'),cache=readinessCache.get(key);
 if(fetchImpl===fetch&&cache&&cache.until>Date.now())return{...cache.result,enabled:c.enabled,ready:c.enabled&&cache.result.operational};
 try{
  const heights=await Promise.all([c.rpc,c.secondary].map(async url=>{
   const [block,name,version,decimals,domain]=await Promise.all([finality(url,fetchImpl,network),...['name','version','decimals','DOMAIN_SEPARATOR'].map(method=>tokenCall(url,method,[],'latest',fetchImpl,network))]);
   if(name!==network.domain.name||version!==network.domain.version||decimals!==6n||lower(domain)!==lower(TypedDataEncoder.hashDomain(network.domain)))fail(503,`Native USDC metadata does not match the pinned ${network.name} configuration.`);
   return block.number;
  }));
  base.finalized_block_number=(heights[0]<heights[1]?heights[0]:heights[1]).toString();
  base.checks={chain:true,token:true,decimals:true,domain:true,finality:true};base.operational=true;base.ready=c.enabled;
 }catch{base.error=`${network.name} verification unavailable.`;}
 if(fetchImpl===fetch)readinessCache.set(key,{until:Date.now()+30000,result:base});
 return base;
}
function message(intent){return{from:intent.payer,to:intent.recipient,value:String(intent.amount_units),validAfter:Number(intent.valid_after),validBefore:Number(intent.valid_before),nonce:intent.nonce};}
function publicIntent(intent,invoice={}){
 const cancellation=invoice.cancellation_status,held=!!invoice.cancellation_requested_at;
 if(!intent)return{state:held?'cancel_pending':'not_started'};
 const {chainId,token,domain}=networkForIntent(intent);
 return{state:cancellation==='review'||intent.status==='review'?'review':invoice.status==='void'?'canceled':held?'cancel_pending':intent.status==='paid'?'paid':intent.status==='expired'?'expired':intent.candidate_tx_hash?'pending':'awaiting_wallet',
  ...(held?{cancellation_status:cancellation,cancellation_requested_at:invoice.cancellation_requested_at}:{}),
  intent:{attempt_id:intent.attempt_id,invoice_id:intent.invoice_id,chain_id:chainId,token,recipient:intent.recipient,payer:intent.payer,amount_units:String(intent.amount_units),nonce:intent.nonce,valid_after:Number(intent.valid_after),valid_before:Number(intent.valid_before),tx_hash:intent.candidate_tx_hash||null},
  ...(!held&&invoice.status!=='void'?{authorization:{domain,types:TYPES,primaryType:'TransferWithAuthorization',message:message(intent)}}:{})};
}
async function loadIntent(db,invoiceId,attemptId,chainId){
 let query=db.from('commerce_polygon_usdc_intents').select('*').eq('invoice_id',invoiceId);
 if(chainId)query=query.eq('chain_id',chainId);
 if(attemptId)query=query.eq('attempt_id',attemptId);else query=query.order('created_at',{ascending:false}).limit(1);
 return checked(await query.maybeSingle());
}
function owner(i,u){if(!u?.id||u.id!==i.customer_id)fail(403,'This crypto payment belongs to another account.');}
function binding(intent,i,a,c){
 if(!intent||intent.invoice_id!==i.id||intent.account_tag!==a.account_tag||a.account_tag!==c.account_tag||a.provider!==c.provider||a.mode!=='live'||lower(intent.recipient)!==c.recipient||lower(intent.token)!==c.token||Number(intent.chain_id)!==c.chain_id||BigInt(intent.amount_units)!==BigInt(i.total_cents)*10000n)fail(409,'The crypto payment does not match this saved order and receiving route.');
}
async function customerState(db,i,u,env=process.env,provider){
 owner(i,u);return publicIntent(await loadIntent(db,i.id,undefined,provider&&networkForProvider(provider).chainId),i);
}
async function start(db,i,a,c,body,u,env=process.env,fetchImpl=fetch){
 owner(i,u);
 if(i.cancellation_requested_at)fail(409,'Cancellation has been requested for this order. Do not send payment.');
 const network=networkForProvider(c.provider);
 if(!c.ready||a.provider!==c.provider||a.mode!=='live'||a.account_tag!==c.account_tag||i.currency!=='USD'||!membershipPayment.allowsPayment(i,a)||i.status!=='accepted'||Date.parse(i.expires_at)<=Date.now()||body.confirm_amount_cents!==i.total_cents||body.confirm_currency!=='USD'||body.consent!==true)fail(409,'Review the current order and available crypto payment route.');
 const payer=lower(body.wallet_address);if(!goodAddress(payer))fail(400,`Connect a compatible ${network.name} wallet.`);
 const old=await loadIntent(db,i.id,undefined,network.chainId);if(old){binding(old,i,a,c);if(old.payer!==payer)fail(409,'Reconnect the wallet originally selected for this saved payment.');return publicIntent(old);}
 const ready=await readiness(env,fetchImpl,network.provider);if(!ready.ready)fail(503,`${network.name} verification is unavailable. No payment authorization was created.`);
 if(await rpc(c.rpc,'eth_getCode',[payer,'latest'],fetchImpl,network)!=='0x')fail(400,'This checkout currently supports standard externally owned wallets. Choose Card for a smart-contract wallet.');
 const block=await finality(c.rpc,fetchImpl,network),now=Math.floor(Date.now()/1000),validBefore=Math.min(now+1800,Math.floor(Date.parse(i.expires_at)/1000));
 if(validBefore<now+60)fail(409,'This order is expiring. Review a new order before authorizing a transfer.');
 const id=UUID.test(body.attempt_id||'')?body.attempt_id:randomUUID();
 const validAfter=(network.chainId===8453?now:Math.min(now,block.timestamp))-60;
 const intent={chain_id:network.chainId,token:network.token,recipient:c.recipient,payer,amount_units:(BigInt(i.total_cents)*10000n).toString(),nonce:'0x'+randomBytes(32).toString('hex'),valid_after:validAfter,valid_before:validBefore,start_block:block.number.toString()};
 const created=checked(await db.rpc(`commerce_create_${network.provider}_intent`,{p_id:id,p_invoice:i.id,p_customer:u.id,p_account_tag:c.account_tag,p_intent:intent}));
 binding(created,i,a,c);if(created.payer!==payer)fail(409,'Reconnect the wallet originally selected for this saved payment.');
 return publicIntent(created);
}
function decodeTransfer(tx,intent){
 const {token,domain}=networkForIntent(intent);
 if(!tx||lower(tx.to)!==token||quantity(tx.value||'0x0')!==0n)fail(409,'This transaction is not the authorized native USDC transfer.');
 let decoded;try{decoded=ABI.parseTransaction({data:tx.input||tx.data,value:0});}catch{fail(409,'The transaction does not contain this order authorization.');}
 if(decoded?.name!=='transferWithAuthorization'||decoded.args.length!==9)fail(409,'Use the exact order authorization, not a plain wallet transfer.');
 const [from,to,value,validAfter,validBefore,nonce,v,r,s]=decoded.args,expected=message(intent);
 if(lower(from)!==intent.payer||lower(to)!==intent.recipient||value!==BigInt(expected.value)||validAfter!==BigInt(expected.validAfter)||validBefore!==BigInt(expected.validBefore)||lower(nonce)!==intent.nonce)fail(409,'The transaction authorization belongs to a different order.');
 try{if(lower(verifyTypedData(domain,TYPES,expected,Signature.from({v:Number(v),r,s})))!==intent.payer)throw Error('signer');}catch{fail(409,'The wallet authorization signature is invalid.');}
}
async function proofAt(url,intent,hash,fetchImpl=fetch){
 const network=networkForIntent(intent),{chainId,token}=network;
 const [block,tx,receipt]=await Promise.all([finality(url,fetchImpl,network),rpc(url,'eth_getTransactionByHash',[hash],fetchImpl,network),rpc(url,'eth_getTransactionReceipt',[hash],fetchImpl,network)]);
 if(!tx)return{pending:true};
 if(lower(tx.hash)!==hash)fail(503,`${network.name} transaction reference mismatch.`);decodeTransfer(tx,intent);
 if(!receipt||!receipt.blockNumber)return{pending:true,submitted:true};
 if(lower(receipt.transactionHash)!==hash||quantity(receipt.status)!==1n)fail(409,'This transaction did not complete the USDC payment.');
 const number=BigInt(safeQuantity(receipt.blockNumber)),index=safeQuantity(receipt.transactionIndex,2147483647);
 if(number>block.number)return{pending:true,submitted:true};
 if(number<BigInt(intent.start_block)||safeQuantity(tx.blockNumber)!==Number(number)||safeQuantity(tx.transactionIndex,2147483647)!==index||!goodAddress(tx.from)||lower(receipt.from)!==lower(tx.from)||lower(receipt.to)!==token||receipt.contractAddress)fail(503,'The receipt does not match its transaction.');
 const canonical=await rpc(url,'eth_getBlockByNumber',[receipt.blockNumber,false],fetchImpl,network),receiptBlockHash=lower(receipt.blockHash);
 if(!canonical||!HASH.test(receiptBlockHash)||safeQuantity(canonical.number)!==Number(number)||lower(canonical.hash)!==receiptBlockHash||lower(tx.blockHash)!==receiptBlockHash||(number===block.number&&block.hash!==receiptBlockHash)||!Array.isArray(canonical.transactions)||lower(canonical.transactions[index])!==hash)fail(503,`The payment block is not final on the canonical ${network.name} chain.`);
 const timestamp=safeQuantity(canonical.timestamp);if(timestamp<=Number(intent.valid_after)||timestamp>=Number(intent.valid_before)||timestamp>block.timestamp)fail(409,'The authorization was not settled within its validity window.');
 const matching=[],authorizations=[];
 for(const log of receipt.logs||[]){
  if(lower(log.address)!==token||log.removed===true)continue;
  let parsed;try{parsed=ABI.parseLog(log);}catch{continue;}
  if(parsed?.name==='AuthorizationUsed'&&lower(parsed.args.authorizer)===intent.payer&&lower(parsed.args.nonce)===intent.nonce)authorizations.push(log);
  if(parsed?.name==='Transfer'&&lower(parsed.args.from)===intent.payer&&lower(parsed.args.to)===intent.recipient&&parsed.args.value===BigInt(intent.amount_units))matching.push(log);
 }
 if(authorizations.length!==1||matching.length!==1)fail(409,'The finalized receipt does not contain the exact authorized USDC payment.');
 for(const log of [...authorizations,...matching]){
  if(lower(log.transactionHash)!==hash||lower(log.blockHash)!==receiptBlockHash||safeQuantity(log.blockNumber)!==Number(number)||safeQuantity(log.transactionIndex,2147483647)!==index)fail(503,'The token receipt does not match its transaction block.');
  safeQuantity(log.logIndex,2147483647);
 }
 if(quantity(authorizations[0].logIndex)===quantity(matching[0].logIndex))fail(503,'The token receipt has duplicate log indices.');
 return{chain_id:chainId,token,recipient:intent.recipient,payer:intent.payer,nonce:intent.nonce,amount_units:String(intent.amount_units),tx_hash:hash,log_index:safeQuantity(matching[0].logIndex,2147483647),block_number:number.toString(),block_hash:receiptBlockHash,block_timestamp:timestamp,finalized_number:block.number.toString()};
}
async function locate(url,intent,fetchImpl){
 const network=networkForIntent(intent),block=await finality(url,fetchImpl,network),base=network.chainId===8453;
 let start=BigInt(intent.start_block),until=block.number;
 const timestampAt=async height=>{
  const historic=await rpc(url,'eth_getBlockByNumber',['0x'+height.toString(16),false],fetchImpl,network);
  if(!historic||BigInt(safeQuantity(historic.number))!==height)fail(503,`${network.name} history is unavailable.`);
  return safeQuantity(historic.timestamp);
 };
 // Sub-second Base blocks and L1 finality can leave thousands of pre-authorization
 // blocks between the pinned start and the actual authorization window.
 if(base){
  if(until<start||block.timestamp<=Number(intent.valid_after))return null;
  let low=start,high=until;
  while(low<high){
   const mid=(low+high)/2n;
   if(await timestampAt(mid)<=Number(intent.valid_after))low=mid+1n;else high=mid;
  }
  start=low;
 }
 // A 30-minute authorization remains recoverable long after the browser closes.
 // Bound history by its immutable validity window, rather than by today's height.
 if(block.timestamp>=Number(intent.valid_before)){
  let low=start,high=until;
  while(low<high){const mid=(low+high+1n)/2n;if(await timestampAt(mid)<Number(intent.valid_before))low=mid;else high=mid-1n;}
  until=low;
 }
 if(until-start>10000n)fail(409,'This older payment requires reconciliation by support.');
 const topics=ABI.encodeFilterTopics('AuthorizationUsed',[intent.payer,intent.nonce]);let found=null;
 const range=base?1000n:2000n;
 for(let from=start;from<=until;from+=range){
  const to=from+range-1n<until?from+range-1n:until;
  const logs=await rpc(url,'eth_getLogs',[{address:network.token,fromBlock:'0x'+from.toString(16),toBlock:'0x'+to.toString(16),topics}],fetchImpl,network);
  if(!Array.isArray(logs)||logs.length>1)fail(503,`${network.name} authorization history is ambiguous.`);
  for(const log of logs){
   if(log.removed===true)continue;
   let parsed;try{parsed=ABI.parseLog(log);}catch{fail(503,`${network.name} authorization history is invalid.`);}
   if(lower(log.address)!==network.token||parsed?.name!=='AuthorizationUsed'||lower(parsed.args.authorizer)!==intent.payer||lower(parsed.args.nonce)!==intent.nonce||!HASH.test(log.transactionHash||''))fail(503,`${network.name} authorization history is invalid.`);
   const height=BigInt(safeQuantity(log.blockNumber));if(height<from||height>to)fail(503,`${network.name} authorization history is outside the requested range.`);
   if(found&&found!==lower(log.transactionHash))fail(409,'This authorization needs review.');found=lower(log.transactionHash);
  }
 }
 return found;
}
async function confirm(db,i,a,c,body,u,env=process.env,fetchImpl=fetch,{dispatch=true}={}){
 owner(i,u);if(!UUID.test(body.attempt_id||''))fail(400,'Invalid crypto attempt.');
 if(i.kind!=='goods'&&!membershipPayment.isMembershipInvoice(i))fail(409,'This membership or subscription payment is unavailable.');
 const network=networkForProvider(c.provider),intent=await loadIntent(db,i.id,body.attempt_id,network.chainId);binding(intent,i,a,c);
 if(intent.status==='paid')return{state:'paid',invoice_id:i.id};
 if(intent.status==='review')return{state:'review',invoice_id:i.id};
 if(c.missing.length)fail(503,`${network.name} verification is temporarily unavailable. Your payment remains pending.`);
 let hash=body.tx_hash||intent.candidate_tx_hash;if(hash&&!HASH.test(hash))fail(400,`Invalid ${network.name} transaction reference.`);hash=hash?lower(hash):null;
 let proof=null,invalid=null;
 if(hash){try{proof=await proofAt(c.rpc,intent,hash,fetchImpl);}catch(e){if(e.status!==409)throw e;invalid=e;}}
 // A wallet may replace a transaction while keeping the same signed authorization.
 // Its nonce is the order identity; an old public transaction hash never blocks recovery.
 if(!proof||proof.pending){
  const located=await locate(c.rpc,intent,fetchImpl);
  if(located&&located!==hash){hash=located;proof=await proofAt(c.rpc,intent,hash,fetchImpl);invalid=null;}
 }
 if(!proof||proof.pending){
  if(invalid&&body.tx_hash)throw invalid;
  const submitted=proof?.submitted===true;
  checked(await db.rpc(`commerce_note_${network.provider}_submission`,{p_id:intent.attempt_id,p_hash:submitted?hash:null,p_account_tag:c.account_tag}));
  if(i.status==='void'&&intent.status==='expired')return{state:'canceled',invoice_id:i.id,cancellation_status:i.cancellation_status};
  if(i.cancellation_requested_at||Date.now()/1000>Number(intent.valid_before)){
   try{const released=await verifyUnpaid(db,i,env,fetchImpl);return{...publicIntent(intent,i),state:released.status==='void'?'canceled':'expired',...(released.cancellation_status?{cancellation_status:released.cancellation_status}:{})};}catch(e){if(e.status!==409)throw e;}
  }
  return{...publicIntent({...intent,candidate_tx_hash:submitted?hash:intent.candidate_tx_hash},i),state:i.cancellation_requested_at?'cancel_pending':submitted||intent.candidate_tx_hash?'pending':'awaiting_wallet'};
 }
 const second=await proofAt(c.secondary,intent,hash,fetchImpl);if(second.pending){checked(await db.rpc(`commerce_note_${network.provider}_submission`,{p_id:intent.attempt_id,p_hash:hash,p_account_tag:c.account_tag}));return{...publicIntent(intent,i),state:i.cancellation_requested_at?'cancel_pending':'pending'};}
 for(const key of ['chain_id','token','recipient','payer','tx_hash','log_index','block_number','block_hash','block_timestamp','nonce','amount_units'])if(second[key]!==proof[key])fail(503,`Independent ${network.name} verification has not agreed. Payment remains pending.`);
 const result=checked(await db.rpc(`commerce_finish_${network.provider}_payment`,{p_id:intent.attempt_id,p_account_tag:c.account_tag,p_proof:proof}));
 if(dispatch&&result.state==='paid'){try{await require('./invoice-notifications').dispatch(db,{invoiceId:i.id,env,limit:2});}catch{}}
 return result;
}
async function reconcilePending(db,{env=process.env,fetchImpl=fetch,limit=4,timeBudgetMs=35000}={}){
 const configs=Object.keys(NETWORKS).map(provider=>configuration(env,provider)).filter(c=>!c.missing.length);
 const result={checked:0,paid:0,pending:0,review:0,expired:0,canceled:0,errors:0};
 if(!configs.length)return{...result,skipped:true};
 const max=Math.min(10,Math.max(1,Number(limit)||4)),deadline=Date.now()+Math.min(40000,Math.max(1000,Number(timeBudgetMs)||35000));
 const boundedFetch=(url,options)=>fetchImpl(url,{...options,signal:AbortSignal.any([options.signal,AbortSignal.timeout(Math.max(1,deadline-Date.now()))])});
 const intents=checked(await db.from('commerce_polygon_usdc_intents').select('*').in('chain_id',configs.map(c=>c.chain_id)).in('status',['open','submitted']).order('updated_at',{ascending:true}).limit(max))||[];
 for(const intent of intents){
  if(Date.now()>=deadline)break;
  let network;
  try{
   network=networkForIntent(intent);
   const c=configs.find(config=>config.provider===network.provider);
   if(!c)continue;
   const invoice=checked(await db.from('commerce_invoices').select('*').eq('id',intent.invoice_id).single()),account=checked(await db.from('commerce_gateway_accounts').select('*').eq('method_id',invoice.method_id).single());
   const done=await confirm(db,invoice,account,c,{attempt_id:intent.attempt_id},{id:invoice.customer_id},env,boundedFetch,{dispatch:false});
   if(Object.hasOwn(result,done.state))result[done.state]++;else result.pending++;
  }catch{result.errors++;}
  finally{
   result.checked++;
   // Rotate failed/pending checks so an unavailable old receipt cannot starve newer orders.
   try{if(network)checked(await db.rpc(`commerce_note_${network.provider}_submission`,{p_id:intent.attempt_id,p_hash:null,p_account_tag:intent.account_tag}));}catch{}
  }
 }
 return result;
}
async function verifyUnpaid(db,invoice,env=process.env,fetchImpl=fetch){
 const intent=await loadIntent(db,invoice.id);
 if(!intent)fail(409,'This crypto payment requires reconciliation before cancellation.');
 const network=networkForIntent(intent),c=configuration(env,network.provider);
 if(intent.invoice_id!==invoice.id||intent.account_tag!==c.account_tag||lower(intent.recipient)!==c.recipient||c.missing.length)fail(409,'This crypto payment requires reconciliation before cancellation.');
 const blocks=await Promise.all([c.rpc,c.secondary].map(async url=>{
  const block=await finality(url,fetchImpl,network);
  if(block.timestamp<=Number(intent.valid_before))fail(409,'The wallet authorization is still valid. Check payment status or wait until it expires before canceling.');
  if(await tokenCall(url,'authorizationState',[intent.payer,intent.nonce],'0x'+block.number.toString(16),fetchImpl,network))fail(409,'This authorization was used or canceled on-chain. Reconcile its receipt before canceling the order.');
  return block;
 }));
 const finalized=blocks[0].number<blocks[1].number?blocks[0]:blocks[1];
 const released=checked(await db.rpc(`commerce_release_${network.provider}_intent`,{p_id:intent.attempt_id,p_account_tag:c.account_tag,p_finalized_block:finalized.number.toString(),p_finalized_timestamp:finalized.timestamp,p_nonce_unused:true}));
 return{...released,confirmed_unpaid:true,provider_link_may_remain_live:false};
}
module.exports={configuration,readiness,isSupportedProvider,start,confirm,customerState,verifyUnpaid,reconcilePending,CHAIN_ID,TOKEN,DOMAIN,TYPES,ABI,decodeTransfer,proofAt,publicIntent};
