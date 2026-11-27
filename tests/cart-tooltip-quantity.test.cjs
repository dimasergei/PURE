'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const css=fs.readFileSync('cart-reference.css','utf8');
test('gift tooltip opens above the icon into the scroll area instead of under the fixed footer',()=>{
 assert.match(css,/\.nlc-reward-tip\s*\{[^}]*bottom: 22px;[^}]*right: -13px;/s);
 assert.match(css,/\.nlc-reward-tip::before\s*\{[^}]*top: 100%;[^}]*border-top-color:/s);
 assert.match(css,/\.nlc-reward-trigger\s*\{[^}]*width: 44px;[^}]*height: 44px;/s);
 assert.match(css,/\.nlc-scrollable-items\{overflow-x:hidden/);
});
test('each earned section and gift glows green while locked rewards stay black',()=>{
 assert.match(css,/--reward-earned:\s*#16803d/);
 assert.match(css,/--reward-pending:\s*#171717/);
 assert.match(css,/\.nlc-reward-meter\s*\{[^}]*background: var\(--reward-pending\)/s);
 assert.match(css,/\.nlc-reward-meter::before\s*\{[^}]*width: var\(--earned-width, 0%\);[^}]*background: var\(--reward-earned\)/s);
 assert.match(css,/\.nlc-reward-rail:has\(\.nlc-reward-trigger\[data-reached="true"\]\) \.nlc-reward-meter::before\s*\{[^}]*box-shadow:[^}]*var\(--reward-glow\)/s);
 assert.match(css,/\.nlc-reward-trigger > span\s*\{[^}]*background: var\(--reward-pending\)/s);
 assert.match(css,/\.nlc-reward-trigger\[data-reached="true"\] > span\s*\{[^}]*background: var\(--reward-earned\)[^}]*box-shadow:[^}]*var\(--reward-glow\)/s);
});
test('the reward bar shares the banner shimmer and honors reduced motion',()=>{
 const brand=fs.readFileSync('pure-brand.css','utf8');
 assert.match(brand,/\.ap-announcement::before,\s*\.nlc-reward-meter > span::before\s*\{[^}]*animation: pure-announcement-shimmer 5s/s);
 assert.match(brand,/@media \(prefers-reduced-motion: reduce\)\s*\{[^}]*\.nlc-reward-meter > span::before\s*\{[^}]*animation: none/s);
});
test('quantity control uses one capsule with connected pale buttons and white center',()=>{
 assert.match(css,/\.nlc-quantity-row \.ap-quantity\{display:grid!important/);
 assert.match(css,/grid-template-columns:49px 57px 49px!important/);
 assert.match(css,/border-radius:25px!important/);
 assert.match(css,/\.nlc-quantity-row \.ap-quantity input\{[^}]*background:#fff!important/s);
});
