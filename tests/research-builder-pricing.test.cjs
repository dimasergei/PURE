'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const builder=require('../lib/research-builder-pricing'),handler=require('../lib/research-builder-handler');

const source=[40.01,70.02,90.03,100.04,120].map((price,index)=>({id:'compound-'+index,name:'Compound '+index,category:'injectables',group:'Research',supplier_secret:'private',variants:[{size:'5mg',price,cost:1},{size:'10mg',price:Math.round((price+25)*100)/100}]})).concat([
 {id:'bac-water',name:'Reconstitution Solution',category:'supplies',variants:[{size:'3mL',price:14.95}]},
 {id:'oral-fixture',name:'Oral fixture',category:'oral',variants:[{size:'30 capsules',price:40}]}
]);
const items=source.slice(0,4).map(product=>({id:product.id,size:'5mg',qty:1}));
const origin='https://pure.example',token='fixture_verified_member_token_1234',customer='fixture-customer';
const authenticated={authorization:'Bearer '+token};
const membership={plan:'vip',invoice_id:'membership-source'};
function response(){return{headers:{},setHeader(name,value){this.headers[name]=value;},status(code){this.code=code;return this;},json(body){this.body=body;return this;}};}
async function request({method='POST',headers={},body={action:'quote',items},query,db}={}){
 const res=response();await handler({method,headers:{origin,'content-type':'application/json',...headers},body,query},res,{catalog:source,env:{SITE_URL:origin},db});return res;
}
function database({plan='vip',user={id:customer,email_confirmed_at:'2026-01-01'},authError=null,errorTable=null,invoiceOverrides={}}={}){
 const calls=[],now=Date.now();
 const rows={commerce_memberships:plan?[{invoice_id:'membership-source',customer_id:customer,plan,starts_at:new Date(now-86400000).toISOString(),expires_at:new Date(now+86400000).toISOString(),revoked_at:null}]:[],
  commerce_invoices:[{id:'membership-source',customer_id:customer,kind:'membership',plan,status:'paid',request_data:{billing_period:'monthly'},...invoiceOverrides}]};
 const db={auth:{getUser:async value=>{calls.push({auth:value});return{data:{user},error:authError};}},from(table){
  const call={table,filters:[]};calls.push(call);let data=rows[table]||[];
  const query={select(columns){call.select=columns;return this;},eq(key,value){call.filters.push(['eq',key,value]);data=data.filter(row=>row[key]===value);return this;},
   is(key,value){call.filters.push(['is',key,value]);data=data.filter(row=>row[key]===value);return this;},
   lte(key,value){call.filters.push(['lte',key,value]);data=data.filter(row=>row[key]<=value);return this;},
   gt(key,value){call.filters.push(['gt',key,value]);data=data.filter(row=>row[key]>value);return this;},
   in(key,values){call.filters.push(['in',key,values]);data=data.filter(row=>values.includes(row[key]));return this;},
   order(){return this;},limit(n){data=data.slice(0,n);return this;},then(resolve,reject){return Promise.resolve({data,error:errorTable===table?{message:'fixture database unavailable'}:null}).then(resolve,reject);}};
  return query;
 }};return{db,calls};
}

test('the verified member catalog contains only injectable selections and public variant fields',async()=>{
 const catalog=builder.catalog(source);
 assert.equal(catalog.length,5);
 assert.ok(catalog.every(item=>item.category==='injectables'));
 assert.deepEqual(Object.keys(catalog[0]).sort(),['category','group','id','name','variants']);
 assert.deepEqual(catalog[0].variants,[{size:'5mg',price:40.01},{size:'10mg',price:65.01}]);
 const unsigned=await request({method:'GET'});
 assert.equal(unsigned.code,401);
 assert.equal(unsigned.body.catalog,undefined);
 const fixture=database(),result=await request({method:'GET',headers:authenticated,db:fixture.db});
 assert.equal(result.code,200);
 assert.deepEqual(result.body.catalog,catalog);
 assert.equal(result.body.member_plan,'vip');
 assert.equal(result.body.member_stack_available,true);
 assert.equal(result.body.subscription_available,false);
 assert.equal(result.body.terms.version,'pure-member-stack-2026-11-v2');
 assert.equal(result.body.terms.membership_required,true);
 assert.equal(result.body.terms.automatic_renewal,false);
 assert.equal(result.headers['Cache-Control'],'no-store');
 assert.equal(result.headers.Vary,'Authorization');
});

test('Member Stack uses the canonical catalog and ignores customer-supplied amounts or discounts',()=>{
 const forged=items.map(item=>({...item,name:'Forged name',unit_price_usd_cents:1,discount_bps:10000}));
 const quote=builder.quote(forged,source,{membership});
 assert.equal(quote.mode,'member_stack');
 assert.equal(quote.currency,'USD');
 assert.equal(quote.subtotal_cents,30010);
 assert.equal(quote.total_cents,24010);
 assert.equal(quote.discount_cents,6000);
 assert.equal(quote.shipping_cents,0);
 assert.equal(quote.bundled_item.id,'gift-bac-3');
 assert.deepEqual(quote.lines.map(line=>line.name),source.slice(0,4).map(product=>product.name));
 assert.deepEqual(quote.lines.map(line=>line.unit_price_usd_cents),[4001,7002,9003,10004]);
});

test('verified tiers receive their own Member Stack savings and included shipping, independent of other offers',()=>{
 for(const [plan,total,shipping,rate] of [['vip',24010,'standard',2000],['elite',18008,'express',4000]]){
  const member=builder.quote(items,source,{membership:{...membership,plan},coupon:'BLACKFRIDAY10'});
  assert.equal(member.total_cents,total);
  assert.equal(member.discount_cents,30010-total);
  assert.equal(member.discount_bps,rate);
  assert.equal(member.shipping_speed,shipping);
  assert.equal(member.shipping_cents,0);
  assert.ok(member.lines.every(line=>line.discount_reason==='member_stack'&&line.discount_bps===rate));
  assert.equal(member.lines.reduce((sum,line)=>sum+line.discount_cents,0),30010-total);
  assert.equal(member.bundled_item.id,'gift-bac-3');
  assert.equal(member.terms.subscription_available,false);
 }
});

test('builder rejects incomplete, duplicate, non-injectable, invalid-quantity and nonexistent-size selections',()=>{
 const invalid=[undefined,[],items.slice(0,3),[...items,items[0]],[items[0],items[0],items[2],items[3]],
  items.map((item,index)=>index?item:{id:'bac-water',size:'3mL',qty:1}),items.map((item,index)=>index?item:{id:'oral-fixture',size:'30 capsules',qty:1}),
  ...[0,2,'1',null].map(qty=>items.map((item,index)=>index?item:{...item,qty})),items.map((item,index)=>index?item:{...item,size:'unknown'}),items.map((item,index)=>index?item:null)];
 for(const selection of invalid)assert.throws(()=>builder.quote(selection,source,{membership}),error=>error.status===400);
 assert.throws(()=>builder.quote(items,source,{membership:{plan:'vip'}}),/active PURE/);
 assert.throws(()=>builder.quote(items,source,{membership:{plan:'member',invoice_id:'forged'}}),/active PURE/);
});

test('member quotes reject client-supplied benefits and use only the verified account entitlement',async()=>{
 const unsigned=database({plan:'elite'});
 const forged={action:'quote',items,membership:{plan:'elite'},plan:'elite'};
 assert.equal((await request({db:unsigned.db,body:forged})).code,401);
 assert.equal(unsigned.calls.length,0);
 for(const [plan,total] of [['vip',24010],['elite',18008],[null,undefined]]){
  const fixture=database({plan}),result=await request({headers:authenticated,db:fixture.db,body:forged});
  assert.equal(result.code,plan?200:403);
  assert.equal(result.body.total_cents,total);
  assert.deepEqual(fixture.calls[0],{auth:token});
  assert.ok(fixture.calls.find(call=>call.table==='commerce_memberships').filters.some(filter=>filter[0]==='eq'&&filter[1]==='customer_id'&&filter[2]===customer));
 }
 for(const invoiceOverrides of [{customer_id:'another-customer'},{plan:'elite'},{kind:'goods'},{status:'refunded'}]){
  const fixture=database({invoiceOverrides}),result=await request({headers:authenticated,db:fixture.db});
  assert.equal(result.code,403);
  assert.equal(result.body.total_cents,undefined);
 }
});

test('invalid or unverified sessions fail closed and an unavailable benefits source does not promise member prices',async()=>{
 const malformed=database();
 assert.equal((await request({headers:{authorization:'Bearer short'},db:malformed.db})).code,401);
 assert.equal(malformed.calls.length,0);
 for(const options of [{authError:{message:'expired'}},{user:null},{user:{id:customer,email_confirmed_at:null}}]){
  const fixture=database(options),result=await request({headers:authenticated,db:fixture.db});
  assert.equal(result.code,401);
  assert.equal(fixture.calls.length,1);
 }
 for(const errorTable of ['commerce_memberships','commerce_invoices']){
  const fixture=database({errorTable}),result=await request({headers:authenticated,db:fixture.db});
  assert.equal(result.code,503);
  assert.match(result.body.error,/temporarily unavailable/);
 }
});

test('off-session enrollment and legacy recurring modes are rejected even for paid members',async()=>{
 const fixture=database();
 for(const action of ['create','checkout','activate','renew','pause','resume','cancel']){
  const result=await request({headers:authenticated,db:fixture.db,body:{action,items,mode:'subscription'}});
  assert.equal(result.code,400);
  assert.match(result.body.error,/current Member Stack checkout/);
 }
 const recurringQuote=await request({headers:authenticated,db:fixture.db,body:{action:'quote',items,mode:'subscription'}});
 assert.equal(recurringQuote.code,400);
 assert.match(recurringQuote.body.error,/membership benefit/);
 assert.ok(fixture.calls.every(call=>call.auth||['commerce_memberships','commerce_invoices'].includes(call.table)));
});

test('verified quotes ignore forged recurring terms and installment conditions',async()=>{
 const fixture=database({plan:'elite'});
 const result=await request({headers:authenticated,db:fixture.db,body:{action:'quote',items,mode:'member_stack',minimum_paid_cycles:3,
  automatic_renewal:true,subscription_available:true,terms:{version:'research-builder-2026-11-v2',minimum_paid_cycles:3}}});
 assert.equal(result.code,200);
 assert.equal(result.body.terms.version,'pure-member-stack-2026-11-v2');
 assert.equal(result.body.terms.minimum_paid_cycles,undefined);
 assert.equal(result.body.terms.automatic_renewal,false);
 assert.equal(result.body.terms.subscription_available,false);
 assert.equal(result.body.total_cents,18008);
 assert.equal(result.body.discount_bps,4000);
});

test('member quote endpoint enforces origin, JSON, body size, method and catalog validation',async()=>{
 for(const [options,status] of [[{headers:{origin:'https://untrusted.example'}},403],[{headers:{'content-type':'text/plain'}},415],
  [{body:'{invalid-json'},400],[{body:[]},400],[{body:{action:'quote',items:items.slice(0,3)}},400],[{body:{action:'quote',items,padding:'x'.repeat(33000)}},413]]){
  const result=await request({...options,headers:{...authenticated,...options.headers},db:database().db});
  assert.equal(result.code,status);
 }
 const unsupported=await request({method:'DELETE'});
 assert.equal(unsupported.code,405);
 assert.equal(unsupported.headers.Allow,'GET, POST');
});

test('a paid matching membership addon can verify benefits without borrowing another customer or tier',async()=>{
 for(const [record,status] of [
  [{kind:'goods',plan:null,request_data:{membership_addon:{plan:'vip',period:'monthly'}},pricing:{membership_addon:{plan:'vip'}}},200],
  [{kind:'goods',plan:null,request_data:{membership_addon:{plan:'elite',period:'monthly'}},pricing:{membership_addon:{plan:'vip'}}},403],
  [{kind:'goods',plan:null,customer_id:'other-owner',request_data:{membership_addon:{plan:'vip'}},pricing:{membership_addon:{plan:'vip'}}},403]
 ]){
  const fixture=database({invoiceOverrides:record});
  const result=await request({method:'GET',headers:authenticated,db:fixture.db});
  assert.equal(result.code,status);
  assert.equal(result.body.member_plan,status===200?'vip':undefined);
  assert.ok(fixture.calls.find(call=>call.table==='commerce_invoices').filters.some(filter=>filter[1]==='customer_id'&&filter[2]===customer));
 }
});
