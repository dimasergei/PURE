'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const {randomUUID} = require('node:crypto');
const {readFileSync} = require('node:fs');
const {join} = require('node:path');
const {PGlite} = require(process.env.PGLITE_MODULE || '@electric-sql/pglite');
const partner = require('../lib/partner-program');

const owner = randomUUID();
const env = {SITE_URL:'https://shop.example', CHECKOUT_RATE_LIMIT_SECRET:'fixture-signing-secret'};
async function visit({code='LAB42', headers={}, count=true, fail=false, environment=env} = {}) {
  const calls = [], responseHeaders = {};
  const records = {commerce_partner_codes:code==='LAB42' ? {partner_id:owner} : null,
    commerce_partners:{customer_id:owner,code,status:'active'}};
  const db = {
    from(name) {
      return {select(){return this;},eq(){return this;},async maybeSingle(){return {data:records[name]};}};
    },
    async rpc(name, args) {calls.push([name,args]);if(fail)throw Error('unavailable');return {data:null};}
  };
  const req = {method:'POST', headers:{origin:env.SITE_URL,'content-type':'application/json',...headers},
    body:{action:'visit',code,count_start:count}};
  const res = {setHeader(k,v){responseHeaders[k]=v;},status(n){this.code=n;return this;},json(b){this.body=b;}};
  await partner.handle(req,res,new URLSearchParams('partner=visit'),{db,env:environment});
  return {calls,responseHeaders,code:res.code,body:res.body};
}

test('fresh active referrals count once per issued cookie without sending visitor or product data',async()=>{
  const first = await visit();
  assert.deepEqual(first.calls,[['commerce_count_partner_start',{p_partner:owner}]]);
  const cookie = first.responseHeaders['Set-Cookie'].split(';')[0];
  assert.equal(partner.readCookie(cookie,env.CHECKOUT_RATE_LIMIT_SECRET),'LAB42');
  const repeat = await visit({headers:{cookie}});
  assert.deepEqual(repeat.calls,[]);assert.equal(repeat.responseHeaders['Set-Cookie'],undefined);
  const otherPartner = 'ap_ref='+partner.cookieToken('OTHER',env.CHECKOUT_RATE_LIMIT_SECRET);
  assert.deepEqual((await visit({headers:{cookie:otherPartner}})).calls,[]);
  const unknown = await visit({code:'UNKNOWN'});
  assert.deepEqual(unknown.calls,[]);assert.equal(unknown.responseHeaders['Set-Cookie'],undefined);
  const unavailableSecret=await visit({environment:{SITE_URL:env.SITE_URL}});
  assert.deepEqual(unavailableSecret.calls,[]);assert.equal(unavailableSecret.responseHeaders['Set-Cookie'],undefined);
});

test('opt-outs and recognized automation skip measurement, and unavailable measurement preserves attribution',async()=>{
  for(const options of [{count:false},{headers:{dnt:'1'}},{headers:{'sec-gpc':'1'}},
    {headers:{purpose:'prefetch'}},{headers:{'sec-purpose':'prefetch;prerender'}},{headers:{'user-agent':'Googlebot/2.1'}}]){
    const result=await visit(options);
    assert.deepEqual(result.calls,[]);assert.match(result.responseHeaders['Set-Cookie'],/^ap_ref=LAB42/);
  }
  const result=await visit({fail:true});
  assert.equal(result.code,200);assert.equal(result.body.recorded,true);assert.match(result.responseHeaders['Set-Cookie'],/^ap_ref=LAB42/);
});

test('30 UTC dates, separated partner totals, reversals, USD commission basis and service-only permissions',async()=>{
  const db = new PGlite();
  const other = randomUUID(), suspended = randomUUID(), buyer = randomUUID();
  const [first,repeat,reversed,refunded,older,otherOrder] = Array.from({length:6},()=>randomUUID());
  try {
    await db.exec(`create role service_role; create role anon; create role authenticated; create schema commerce_internal;
      create table commerce_partners(customer_id uuid primary key, status text);
      create table commerce_invoices(id uuid primary key, customer_id uuid, status text);
      create table commerce_referrals(customer_id uuid primary key, partner_id uuid, first_invoice_id uuid);
      create table commerce_partner_commissions(invoice_id uuid unique,partner_id uuid,basis_cents int,amount_cents int,status text,created_at timestamptz);`);
    await db.exec(readFileSync(join(__dirname,'../supabase/migrations/20261122001800_partner_performance.sql'),'utf8'));
    await db.query("insert into commerce_partners values($1,'active'),($2,'active'),($3,'suspended')",[owner,other,suspended]);
    for(const id of [owner,owner,other,suspended])await db.query('select commerce_count_partner_start($1)',[id]);
    await db.query("insert into commerce_internal.partner_link_days values($1,(now() at time zone 'UTC')::date-30,500),($1,(now() at time zone 'UTC')::date-29,5)",[owner]);
    for(const [id,invoiceStatus,partnerId,amount,commissionStatus,age] of [
      [first,'delivered',owner,4000,'paid',29],[repeat,'paid',owner,1000,'pending',0],
      [reversed,'delivered',owner,4000,'reversed',2],[refunded,'refunded',owner,4000,'reversed',2],
      [older,'delivered',owner,1000,'paid',30],[otherOrder,'shipped',other,1000,'eligible',0]]){
      await db.query('insert into commerce_invoices values($1,$2,$3)',[id,buyer,invoiceStatus]);
      await db.query("insert into commerce_partner_commissions values($1,$2,10000,$3,$4,(((now() at time zone 'UTC')::date-$5::int)::timestamp at time zone 'UTC'))",[id,partnerId,amount,commissionStatus,age]);
    }
    await db.query('insert into commerce_referrals values($1,$2,$3)',[buyer,owner,first]);
    const report = async(ids)=>(await db.query('select commerce_partner_performance($1::uuid[]) as data',[ids])).rows[0].data;
    await db.exec('set role service_role');
    const all=await report([owner,other,suspended,owner]),p=all[owner];
    assert.equal(Object.keys(all).length,3);
    assert.deepEqual([p.starts,p.paid_orders,p.first_orders,p.repeat_orders,p.delivered_orders,p.reversed_orders,p.merchandise_cents,p.commission_cents],[7,2,1,1,1,2,20000,5000]);
    assert.match(p.tracking_since,/^\d{4}-\d{2}-\d{2}$/);
    assert.equal(all[other].starts,1);assert.equal(all[other].paid_orders,1);
    assert.equal(all[suspended].starts,0);assert.equal(all[suspended].paid_orders,0);
    assert.deepEqual(Object.keys(await report([owner])),[owner]);
    for(const role of ['anon','authenticated']){
      await db.exec('reset role; set role '+role);
      await assert.rejects(report([owner]),/permission denied/);
      await assert.rejects(db.query('select commerce_count_partner_start($1)',[owner]),/permission denied/);
      await assert.rejects(db.query('select * from commerce_internal.partner_link_days'),/permission denied/);
    }
  } finally { await db.close(); }
});

test('partner report scopes to authenticated owner and stays available during a missing-migration rollout', async()=>{
  const outsider = randomUUID(), requested = [];
  let missing = false;
  const db = {
    auth:{async getUser(){return {data:{user:{id:owner,email_confirmed_at:new Date().toISOString()}}};}},
    from(name){
      return {select(){return this;},eq(){return this;},order(){return this;},limit(){return {data:[]};},
        async maybeSingle(){return {data:name==='commerce_partners'?{code:'PURE42',status:'active'}:null};}};
    },
    async rpc(name,args){
      if(name==='commerce_partner_performance'){
        requested.push(args.p_partners);
        return missing ? {error:{code:'PGRST202'}} : {data:{[owner]:{starts:3},[outsider]:{starts:90}}};
      }
      return {data:name==='commerce_partner_summary'?{paid_cents:30}:null};
    }
  };
  const run = async(authorization)=>{
    const res={setHeader(){},status(n){this.code=n;return this;},json(body){this.body=body;}};
    await partner.handle({method:'GET',headers:{authorization}},res,new URLSearchParams({partner:'dashboard',partner_id:outsider}),{db,env});
    return res;
  };
  assert.equal((await run('')).code,401);
  const auth='Bearer '+('a'.repeat(24));
  assert.deepEqual((await run(auth)).body.performance,{starts:3});
  missing=true;
  const degraded=await run(auth);
  assert.equal(degraded.code,200);assert.equal(degraded.body.performance,null);assert.equal(degraded.body.summary.paid_cents,30);
  assert.deepEqual(requested,[[owner],[owner]]);
});

test('partner dashboard labels recorded metrics, missing figures, and opt-out-aware referral visit requests', async()=>{
  const {JSDOM}=require('jsdom'), script=readFileSync(join(__dirname,'../conversion-ui.js'),'utf8');
  const stats={starts:4,paid_orders:2,first_orders:1,repeat_orders:1,delivered_orders:1,merchandise_cents:3000,tracking_since:'2026-11-22'};
  for(const [performance,optOut] of [[stats,false],[null,true]]){
    const dom=new JSDOM('<main></main>',{url:'https://shop.example/?ref=LAB42',runScripts:'outside-only'});
    try{
      const w=dom.window,visits=[];
      Object.defineProperty(w.navigator,'globalPrivacyControl',{value:optOut});
      w.fetch=async(url,options)=>{
        if(url.includes('partner=visit'))visits.push(JSON.parse(options.body));
        return {ok:true,json:async()=>({partner:{code:'LAB42',status:'active'},codes:[{code:'LAB42'}],events:[],performance})};
      };
      w.eval(script);await w.PurePartnerVisit;
      const root=w.document.querySelector('main');
      await w.ConversionUI.partner(root,{auth:{getSession:async()=>({data:{session:{access_token:'fixture-access-token'}}})}});
      const panel=[...root.querySelectorAll('section.ae-panel')].find(s=>s.querySelector('h3')?.textContent==='Last 30 days');
      assert.ok(panel);assert.deepEqual(visits,[{action:'visit',code:'LAB42',count_start:!optOut}]);
      if(performance){
        assert.deepEqual([...panel.querySelectorAll('article strong')].map(x=>x.textContent),['4','2','$30.00']);
        assert.match(panel.textContent,/2026-11-22/);assert.match(panel.textContent,/Reversals are excluded/);
      }else{
        assert.match(panel.textContent,/temporarily unavailable/);assert.equal(panel.querySelector('article'),null);
      }
    }finally{dom.window.close();}
  }
});

test('owner sees every listed partner’s performance through one batched report with no partner impersonation',async()=>{
  const {JSDOM}=require('jsdom'),peer=randomUUID(),password='fixture-password-only-'.repeat(3);
  const partners=[{customer_id:owner,code:'LAB42',status:'active'},{customer_id:peer,code:'LAB43',status:'active'}];
  const report={starts:5,paid_orders:2,first_orders:1,repeat_orders:1,delivered_orders:1,reversed_orders:1,merchandise_cents:18000,commission_cents:6000,tracking_since:'2026-11-22'};
  const measured=[];
  const db={
    from(name){
      return {select(){return this;},eq(){return this;},order(){return this;},async limit(){return {data:name==='commerce_partners'?partners:[]};},async maybeSingle(){return {data:null};}};
    },
    async rpc(name,args){
      if(name==='commerce_partner_performance'){measured.push(args.p_partners);return {data:{[owner]:report,[peer]:{...report,starts:0}}};}
      return {data:name==='commerce_partner_summary'?{earned_cents:6000,pending_cents:6000,eligible_cents:0,paid_cents:0}:null};
    }
  };
  const res={setHeader(){},status(n){this.code=n;return this;},json(body){this.body=body;}};
  await partner.handle({method:'GET',headers:{'x-admin-password':password}},res,new URLSearchParams('partner=admin'),{db,env:{...env,ADMIN_ORDERS_PASSWORD:password}});
  assert.equal(res.code,200);assert.deepEqual(measured,[[owner,peer]]);
  const dom=new JSDOM('<form id="partner-login"><input name="password"></form><main id="partner-records"></main>',{url:'https://shop.example/admin-partners.html',runScripts:'outside-only'});
  try{
    const w=dom.window;
    w.fetch=async()=>({ok:true,json:async()=>res.body});
    w.eval(readFileSync(join(__dirname,'../admin-partners.js'),'utf8'));
    const form=w.document.querySelector('form');form.elements.password.value=password;
    await form.onsubmit({preventDefault(){}});
    const cards=[...w.document.querySelectorAll('article')];
    assert.equal(cards.length,2);
    assert.match(cards[0].textContent,/5 new link starts · 2 paid orders · 1 delivered/);assert.match(cards[0].textContent,/\$180.00 commissionable sales · \$60.00 commission accrued/);
    assert.match(cards[1].textContent,/0 new link starts/);
  }finally{dom.window.close();}
});
