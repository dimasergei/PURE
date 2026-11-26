'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const account=fs.readFileSync(path.join(root,'account.js'),'utf8');
const storefront=fs.readFileSync(path.join(root,'site-build.cjs'),'utf8');
const workspace=fs.readFileSync(path.join(root,'workspace-v2.js'),'utf8');

test('tracking route requires authentication and preserves return URL',()=>{
 assert.match(account,/if\(p==='\/account\/tracking'\)\{if\(!user\)return go\('\/account\/login\?returnTo=%2Faccount%2Ftracking'\);return tracking\(\);\}/);
 assert.match(account,/\['Tracking','\/account\/tracking'\]/);
});
test('tracking searches only existing authenticated customer API data',()=>{
 assert.match(account,/async function tracking\(\)/);
 assert.match(account,/const data=await api\(\)/);
 assert.match(account,/const matches=ordersList\.filter/);
 assert.match(account,/matches\.map\(card\)/);
 assert.doesNotMatch(account,/\/api\/tracking\?order|fetch\(.*tracking_number/);
});
test('public storefront links to private tracking by email without putting customer details in the URL',()=>{
 assert.match(storefront,/href="\/track-order">Track Order/);
 assert.doesNotMatch(storefront,/href="\/track-order\?[^"]*(?:email|order_number)=/);
 assert.match(workspace,/<form method="post"[^>]*id="ap-track-order-form"/);
 assert.match(workspace,/name="order_number"[^>]*required/);
 assert.match(workspace,/name="email" type="email" required/);
 assert.match(workspace,/href="\/account\/purchases">view orders in your account/);
});
