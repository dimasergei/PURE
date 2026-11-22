'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const css=fs.readFileSync('cart-reference.css','utf8');
test('gift tooltip opens below the icon instead of clipping above cart header',()=>{
 assert.match(css,/\.nlc-reward-tip\s*\{[^}]*top: 18px;[^}]*right: -13px;/s);
 assert.match(css,/\.nlc-reward-trigger\s*\{[^}]*width: 44px;[^}]*height: 44px;/s);
 assert.match(css,/\.nlc-scrollable-items\{overflow-x:hidden/);
});
test('quantity control uses one capsule with connected pale buttons and white center',()=>{
 assert.match(css,/\.nlc-quantity-row \.ap-quantity\{display:grid!important/);
 assert.match(css,/grid-template-columns:49px 57px 49px!important/);
 assert.match(css,/border-radius:25px!important/);
 assert.match(css,/\.nlc-quantity-row \.ap-quantity input\{[^}]*background:#fff!important/s);
});
