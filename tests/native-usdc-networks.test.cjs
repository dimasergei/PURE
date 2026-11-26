'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const {createHash,randomUUID}=require('node:crypto');
const {Wallet,Signature,TypedDataEncoder}=require('ethers');
const native=require('../lib/polygon-usdc');

const routes=[
 {provider:'base_usdc',chainId:8453,token:'0x833589fcd6edb6e08f4c7c32d4f71b54bda02913',recipient:'0x'+'1'.repeat(40)},
 {provider:'ethereum_usdc',chainId:1,token:'0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',recipient:'0x'+'2'.repeat(40)}
];
const payer=Wallet.createRandom();
const relayer='0x'+'3'.repeat(40);
const txHash='0x'+'4'.repeat(64);
const blockHash='0x'+'5'.repeat(64);
const previousHash='0x'+'6'.repeat(64);
const alternateHash='0x'+'7'.repeat(64);
const hex=n=>'0x'+n.toString(16);

function settings(route){
 const prefix=route.provider.toUpperCase();
 return {
  [`${prefix}_ENABLED`]:'true',
  [`${prefix}_RECIPIENT`]:route.recipient,
  [`${prefix}_RPC_URL`]:`https://${route.provider.replace('_','-')}.primary.example`,
  [`${prefix}_SECONDARY_RPC_URL`]:`https://${route.provider.replace('_','-')}.secondary.example`
 };
}

function database(route,config){
 const state={
  intent:null,calls:[],
  invoice:{id:randomUUID(),customer_id:randomUUID(),method_id:randomUUID(),kind:'goods',status:'accepted',total_cents:950,currency:'USD',expires_at:new Date(Date.now()+3600000).toISOString()},
  account:{provider:route.provider,mode:'live',account_tag:config.account_tag}
 };
 const db={
  from(table){
   const filters={};
   const query={
    select(){return query;},
    eq(key,value){filters[key]=[value];return query;},
    in(key,values){filters[key]=values;return query;},
    order(){return query;},limit(){return query;},
    single:async()=>({data:table==='commerce_invoices'?state.invoice:state.account}),
    maybeSingle:async()=>({data:matches()?state.intent:null}),
    then(resolve){return Promise.resolve({data:matches()?[state.intent]:[]}).then(resolve);}
   };
   function matches(){
    assert.equal(table,'commerce_polygon_usdc_intents');
    return state.intent&&Object.entries(filters).every(([key,values])=>values.includes(state.intent[key]));
   }
   return query;
  },
  async rpc(name,args){
   state.calls.push({name,args});
   assert.equal(args.p_account_tag,config.account_tag);
   switch(name){
    case `commerce_create_${route.provider}_intent`:
     state.intent={...args.p_intent,invoice_id:args.p_invoice,attempt_id:args.p_id,account_tag:args.p_account_tag,status:'open'};
     return {data:state.intent};
    case `commerce_note_${route.provider}_submission`:
     if(args.p_hash)Object.assign(state.intent,{status:'submitted',candidate_tx_hash:args.p_hash});
     return {data:state.intent};
    case `commerce_finish_${route.provider}_payment`:
     state.intent.status='paid';
     return {data:{state:'paid',invoice_id:state.invoice.id}};
    case `commerce_release_${route.provider}_intent`:
     state.intent.status='expired';
     return {data:{status:'void',cancellation_status:'canceled'}};
    default:throw Error(`Unexpected SQL RPC ${name}`);
   }
  }
 };
 return {db,state};
}

function rpcFixture(route,replace){
 const now=Math.floor(Date.now()/1000);
 const domain={name:'USD Coin',version:'2',chainId:route.chainId,verifyingContract:route.token};
 const final={number:'0x64',hash:previousHash,timestamp:hex(now-2),transactions:[]};
 const canonical={number:'0x65',hash:blockHash,timestamp:hex(now),transactions:[txHash]};
 const values={name:domain.name,version:domain.version,decimals:6n,DOMAIN_SEPARATOR:TypedDataEncoder.hashDomain(domain),authorizationState:false};
 const received=[];
 const chain={final,canonical,values,received,domain,tx:null,receipt:null};
 const fetchImpl=async(url,options)=>{
  const {method,params,id}=JSON.parse(options.body);
  received.push({url,method,params});
  let result;
  switch(method){
   case 'eth_chainId':result=hex(route.chainId);break;
   case 'eth_getCode':result='0x';break;
   case 'eth_getBlockByNumber':result=params[0]==='finalized'?chain.final:chain.canonical;break;
   case 'eth_getTransactionByHash':result=params[0]===txHash?chain.tx:null;break;
   case 'eth_getTransactionReceipt':result=params[0]===txHash?chain.receipt:null;break;
   case 'eth_getLogs':result=chain.receipt?.logs.filter(log=>native.ABI.parseLog(log).name==='AuthorizationUsed')||[];break;
   case 'eth_call':{
    assert.equal(params[0].to,route.token);
    const {name}=native.ABI.parseTransaction({data:params[0].data});
    result=native.ABI.encodeFunctionResult(name,[chain.values[name]]);
    break;
   }
   default:throw Error(`Unexpected chain RPC ${method}`);
  }
  if(replace)result=replace(result,{url,method,params});
  return new Response(JSON.stringify({jsonrpc:'2.0',id,result}));
 };
 return {chain,fetchImpl};
}

async function transfer(chain,authorization){
 const {domain,types,message}=authorization;
 const {from,to,value,validAfter,validBefore,nonce}=message;
 const sig=Signature.from(await payer.signTypedData(domain,types,message));
 const token=chain.domain.verifyingContract;
 const input=native.ABI.encodeFunctionData('transferWithAuthorization',[from,to,value,validAfter,validBefore,nonce,sig.v,sig.r,sig.s]);
 const position={transactionHash:txHash,blockNumber:chain.canonical.number,blockHash,transactionIndex:'0x0'};
 const events=[['AuthorizationUsed',[from,nonce]],['Transfer',[from,to,value]]];
 const logs=events.map(([name,args],index)=>({...position,address:token,logIndex:hex(index),...native.ABI.encodeEventLog(name,args)}));
 chain.tx={hash:txHash,input,to:token,from:relayer,value:'0x0',blockNumber:position.blockNumber,blockHash,transactionIndex:'0x0'};
 chain.receipt={...position,from:relayer,to:token,status:'0x1',logs};
}

test('new routes are disabled by default and keep the deployed Polygon route identity',()=>{
 const polygon={provider:'polygon_usdc',recipient:'0x'+'9'.repeat(40)};
 const active=settings(polygon),config=native.configuration(active);
 assert.equal(config.account_tag,createHash('sha256').update(`polygon_usdc:live:137:${native.TOKEN}:${polygon.recipient}`).digest('hex'));
 for(const route of routes){
  const prefix=route.provider.toUpperCase();
  const absent=native.configuration(active,route.provider);
  assert.equal(absent.ready,false);
  assert.equal(absent.recipient,'');
  assert.deepEqual(absent.missing,[`${prefix}_RECIPIENT`,`${prefix}_RPC_URL`,`${prefix}_SECONDARY_RPC_URL`]);
  const own=settings(route);
  const chosen=native.configuration({...active,...own},route.provider);
  assert.equal(chosen.ready,true);
  assert.equal(chosen.account_tag,createHash('sha256').update(`${route.provider}:live:${route.chainId}:${route.token}:${route.recipient}`).digest('hex'));
  assert.equal(native.configuration({...own,[`${prefix}_ENABLED`]:undefined},route.provider).ready,false);
  assert.equal(native.configuration({...own,[`${prefix}_SECONDARY_RPC_URL`]:`${chosen.rpc.replace(/\/$/,'')}./alias`},route.provider).ready,false);
 }
});

for(const route of routes){
 test(`${route.provider} pins its chain and token and requires two finalized proofs`,async()=>{
  const env=settings(route),config=native.configuration(env,route.provider);
  const {db,state}=database(route,config),user={id:state.invoice.customer_id};
  let lagging=true,wrongChain=false,alternateBlock=false;
  const {chain,fetchImpl}=rpcFixture(route,(result,{url,method,params})=>{
   if(!url.includes('secondary'))return result;
   if(wrongChain&&method==='eth_chainId')return '0x89';
   if(lagging&&method==='eth_getBlockByNumber'&&params[0]==='finalized')return {number:'0x64',hash:previousHash,timestamp:hex(Math.floor(Date.now()/1000)-2),transactions:[]};
   if(alternateBlock&&method==='eth_getBlockByNumber'&&params[0]===chain.canonical.number)return {...result,hash:alternateHash};
   return result;
  });
  wrongChain=true;
  assert.equal((await native.readiness(env,fetchImpl,route.provider)).ready,false);
  wrongChain=false;
  const ready=await native.readiness(env,fetchImpl,route.provider);
  assert.equal(ready.ready,true);
  assert.equal(ready.chain_id,route.chainId);
  assert.equal(ready.token,route.token);
  assert.equal(JSON.stringify(ready).includes(route.recipient),false);
  assert.equal(JSON.stringify(ready).includes('example'),false);
  const body={attempt_id:randomUUID(),wallet_address:payer.address,confirm_amount_cents:950,confirm_currency:'USD',consent:true};
  const created=await native.start(db,state.invoice,state.account,config,body,user,env,fetchImpl);
  assert.deepEqual(created.authorization.domain,chain.domain);
  assert.equal(created.intent.recipient,route.recipient);
  assert.equal(created.intent.amount_units,'9500000');
  assert.equal((await native.customerState(db,state.invoice,user,env,route.provider)).intent.nonce,created.intent.nonce);
  assert.equal((await native.customerState(db,state.invoice,user,env,'polygon_usdc')).state,'not_started');
  const {authorization}=created;
  await transfer(chain,{...authorization,domain:native.DOMAIN});
  assert.throws(()=>native.decodeTransfer(chain.tx,state.intent),/signature is invalid/);
  await transfer(chain,authorization);
  assert.throws(()=>native.decodeTransfer({...chain.tx,to:native.TOKEN},state.intent),/native USDC transfer/);
  assert.throws(()=>native.decodeTransfer(chain.tx,{...state.intent,amount_units:'9400000'}),/different order/);
  chain.final=chain.canonical;
  const confirm={attempt_id:created.intent.attempt_id,tx_hash:txHash};
  assert.equal((await native.confirm(db,state.invoice,state.account,config,confirm,user,env,fetchImpl,{dispatch:false})).state,'pending');
  assert.equal(state.calls.at(-1).name,`commerce_note_${route.provider}_submission`);
  lagging=false;
  alternateBlock=true;
  await assert.rejects(native.confirm(db,state.invoice,state.account,config,confirm,user,env,fetchImpl,{dispatch:false}),/canonical/);
  alternateBlock=false;
  const reconciliation=await native.reconcilePending(db,{env,fetchImpl});
  assert.equal(reconciliation.paid,1);
  const settlement=state.calls.find(call=>call.name===`commerce_finish_${route.provider}_payment`);
  assert.equal(settlement.args.p_proof.chain_id,route.chainId);
  assert.equal(settlement.args.p_proof.token,route.token);
  assert.equal(settlement.args.p_proof.tx_hash,txHash);
 });

 test(`${route.provider} releases an order only after both endpoints confirm its unused nonce`,async()=>{
  const env=settings(route),config=native.configuration(env,route.provider);
  const {db,state}=database(route,config),user={id:state.invoice.customer_id};
  let secondaryUsed=false;
  const {chain,fetchImpl}=rpcFixture(route,(result,{url,method,params})=>{
   if(secondaryUsed&&url.includes('secondary')&&method==='eth_call'&&native.ABI.parseTransaction({data:params[0].data}).name==='authorizationState'){
    return native.ABI.encodeFunctionResult('authorizationState',[true]);
   }
   return result;
  });
  await native.start(db,state.invoice,state.account,config,{attempt_id:randomUUID(),wallet_address:payer.address,confirm_amount_cents:950,confirm_currency:'USD',consent:true},user,env,fetchImpl);
  await assert.rejects(native.verifyUnpaid(db,state.invoice,env,fetchImpl),/still valid/);
  chain.final={...chain.final,number:'0x66',timestamp:hex(state.intent.valid_before+1)};
  secondaryUsed=true;
  await assert.rejects(native.verifyUnpaid(db,state.invoice,env,fetchImpl),/used or canceled/);
  secondaryUsed=false;
  assert.equal((await native.verifyUnpaid(db,state.invoice,env,fetchImpl)).confirmed_unpaid,true);
  assert.equal(state.calls.at(-1).name,`commerce_release_${route.provider}_intent`);
 });
}
