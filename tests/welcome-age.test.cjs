'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const {test} = require('node:test');
const {JSDOM} = require('jsdom');
const {site} = require('../config/site.ts');
const {gateDialog, handle} = require('../lib/age-consent');
const enhance = fs.readFileSync('age-gate.js','utf8');
function fixture(t, cookie) {
  const dom = new JSDOM('<main>Research catalog</main>'+gateDialog(site,'/shop'), {url:site.origin+'/shop',runScripts:'outside-only'});
  t.after(()=>dom.window.close());
  const w=dom.window;
  w.HTMLDialogElement.prototype.showModal=function(){this.open=true;};
  w.HTMLDialogElement.prototype.close=function(){this.open=false;};
  if(cookie)w.document.cookie=cookie;
  w.eval(enhance);
  return {w,gate:w.document.querySelector('dialog')};
}
test('age confirmation works immediately without location lookup and survives navigation',t=>{
  const first=fixture(t);
  const enter=first.gate.querySelector('[data-action="age-confirm"]');
  assert.equal(first.gate.open,true);
  assert.equal(enter.disabled,false);
  assert.match(first.gate.textContent,/21\+ to enter/);
  assert.equal(first.gate.querySelector('[data-action="age-exit"]').href,site.origin+'/api/customer-config?age_gate=exit');
  enter.click();
  assert.equal(first.gate.open,false);
  const cookie=first.w.document.cookie;
  assert.match(cookie,/pure_age=21-v1/);
  assert.equal(fixture(t,cookie).gate.open,false);
  assert.equal(fixture(t,'pure_age=19-v1').gate.open,true);
});
function response(){
  return {headers:{},setHeader(name,value){this.headers[name]=value;},status(code){this.code=code;return this;},send(body){this.body=body;return this;},end(){return this;}};
}
test('the native no-JS form stores cookie consent and redirects only to this store',()=>{
  const req={method:'POST',headers:{origin:site.origin},body:'consent=yes&returnTo=%2Fshop%3Fq%3Dvial'};
  const params=new URLSearchParams('age_gate=confirm'),res=response();
  handle(req,res,params);
  assert.equal(res.code,303);assert.equal(res.headers.Location,'/shop?q=vial');assert.match(res.headers['Set-Cookie'],/pure_age=21-v1;.*Secure; SameSite=Lax/);
  for(const dest of ['https://elsewhere.example/','//elsewhere.example','/\\elsewhere.example','/api/checkout']){
    const redirected=response();handle({...req,body:{consent:'yes',returnTo:dest}},redirected,params);assert.equal(redirected.headers.Location,'/');
  }
  const denied=response();handle({...req,headers:{origin:'https://elsewhere.example'}},denied,params);assert.equal(denied.code,403);
  const fresh=response();handle({method:'GET',headers:{}},fresh,new URLSearchParams('age_gate=prompt'));assert.match(fresh.body,/method="post"/);
  const filtered=response();handle({method:'GET',headers:{referer:site.origin+'/shop?q=reference'}},filtered,new URLSearchParams('age_gate=prompt&returnTo=/shop'));assert.match(filtered.body,/value="\/shop\?q=reference"/);
  const seen=response();handle({method:'GET',headers:{cookie:'pure_age=21-v1'}},seen,new URLSearchParams('age_gate=prompt'));assert.match(seen.body,/Age confirmed/);assert.doesNotMatch(seen.body,/<form/);
});
