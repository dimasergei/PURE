'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {JSDOM}=require('jsdom');
const read=p=>fs.readFileSync(path.join(__dirname,'..',p),'utf8');
const dom=new JSDOM(read('public-build/index.html'),{url:'https://altapurelabs.test/',runScripts:'outside-only'}),w=dom.window,d=w.document;
w.matchMedia=()=>({matches:true});w.eval(read('storefront-navigation.js'));
const primaryLabels=['Products','Bulk Orders','Contact Us','Partner'];
const accountLabels=['Overview','Orders','Track','Profile'];
const labels=(root,selector='a')=>[...root.querySelectorAll(selector)].map(node=>node.textContent);
const nav=d.querySelector('#ap-nav'),panel=d.querySelector('#ap-account-menu');
const trigger=d.querySelector('[aria-controls="ap-account-menu"]'),group=trigger.parentElement;
assert.deepEqual(labels(nav),primaryLabels);
assert.deepEqual(labels(panel),accountLabels);
assert.equal(d.querySelector('#ap-more-menu'),null);
assert.equal(panel.hidden,true);
const enter=new w.Event('pointerenter');Object.defineProperty(enter,'pointerType',{value:'mouse'});
group.dispatchEvent(enter);assert.equal(panel.hidden,false);assert.equal(trigger.getAttribute('aria-expanded'),'true');
d.body.dispatchEvent(new w.Event('pointerdown',{bubbles:true}));assert.equal(panel.hidden,true);
w.matchMedia=()=>({matches:false});group.dispatchEvent(enter);assert.equal(panel.hidden,true);
w.matchMedia=()=>({matches:true});
trigger.focus();trigger.dispatchEvent(new w.KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true}));
assert.equal(d.activeElement,panel.querySelector('a'));assert.equal(d.activeElement.textContent,'Overview');
d.activeElement.dispatchEvent(new w.KeyboardEvent('keydown',{key:'End',bubbles:true}));assert.equal(d.activeElement.textContent,'Profile');
d.activeElement.dispatchEvent(new w.KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));
assert.equal(panel.hidden,true);assert.equal(d.activeElement,trigger);
for(const file of ['account.html','shop.html','coas.html','contact.html','partner-program.html','track-order.html','memberships.html','research-builder.html','membership-terms.html']){
 const page=new JSDOM(read('public-build/'+file)),document=page.window.document;
 const header=document.querySelector('header');
 assert.ok(header?.querySelector('#ap-account-menu'),file);
 assert.equal(header.querySelector('#ap-more-menu'),null,file);
 assert.equal(header.querySelectorAll('#ap-nav').length,1,file);
 assert.deepEqual(labels(header.querySelector('#ap-nav')),primaryLabels,file);
 const scripts=[...document.scripts].map(script=>script.getAttribute('src'));
 const navScript=scripts.findIndex(src=>src?.startsWith('/storefront-navigation.js'));
 assert.ok(navScript>=0&&navScript<scripts.findIndex(src=>src?.startsWith('/storefront-v2.js')),file+' handles submenu Escape before mobile navigation');
 page.window.close();
}
assert.match(read('public-build/storefront-v2.js'),/coas:'Testing'/);
assert.doesNotMatch(read('public-build/storefront-v2.js'),/FIND YOUR FOCUS/);
dom.window.close();

// Native modal behavior provides focus containment on every shared header.
for(const file of ['index.html','account.html','shop.html','subscribe-and-save.html','research-use-policy.html']){
 const page=new JSDOM(read('public-build/'+file),{url:'https://getpurelabs.com/',runScripts:'outside-only'});
 const w=page.window,d=w.document;
 w.matchMedia=()=>({matches:false});
 w.HTMLDialogElement.prototype.showModal=function(){this.open=true;this.querySelector('[autofocus]').focus();};
 w.HTMLDialogElement.prototype.close=function(){this.open=false;this.dispatchEvent(new w.Event('close'));};
 w.eval(read('storefront-navigation.js'));
 const menu=d.getElementById('ap-mobile-menu'),toggle=d.querySelector('[aria-controls="ap-mobile-menu"]');
 assert.equal(menu.open,false,file);
 assert.equal(toggle.getAttribute('aria-expanded'),'false',file);
 assert.deepEqual(labels(menu.querySelector('nav')),primaryLabels,file);
 assert.deepEqual(labels(menu.querySelector('.ap-mobile-menu-account')),accountLabels,file);
 assert.ok(menu.querySelector('.ap-mobile-menu-account a[href="/track-order"]'),file);
 assert.ok(menu.querySelector('.ap-mobile-menu-currency select[data-currency-select]'),file);
 toggle.click();
 assert.equal(menu.open,true,file);
 assert.equal(toggle.getAttribute('aria-expanded'),'true',file);
 const close=menu.querySelector('[data-mobile-menu-close]');
 assert.equal(d.activeElement,close,file);
 close.click();
 assert.equal(menu.open,false,file);
 assert.equal(toggle.getAttribute('aria-expanded'),'false',file);
 page.window.close();
}
console.log('PASS: desktop disclosures and the shared mobile modal menu.');
