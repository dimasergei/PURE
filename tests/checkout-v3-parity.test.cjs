'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const js=fs.readFileSync('checkout-reference.js','utf8'),css=fs.readFileSync('checkout-reference.css','utf8');
test('shipping trust, email help, SMS opt-in and linked legal notices remain',()=>{for(const value of ['3RD PARTY TESTED','Order confirmation and tracking go here. Leave blank to use your account email.','Consent is not a condition of purchase.','Reply HELP for help or STOP to cancel.','/privacy-policy.html'])assert.ok(js.includes(value),value);});
test('summary supports changing paid quantities and applying or removing the current coupon',()=>{
 for(const value of ['data-nlx-remove','data-nlx-qty','data-nlx-coupon','data-nlx-remove-coupon'])assert.ok(js.includes(value),value);
 assert.match(js,/Use <strong>BLACKFRIDAY10<\/strong> for 10% off merchandise/);
 assert.doesNotMatch(js,/BLACKFRIDAY15|buy 1 get 1/i);
});
test('hosted payment requires an available method and both explicit customer consents',()=>{assert.doesNotMatch(js,/Card number \*<input|nlx-wallet-unavailable/);assert.match(js,/method&&currentPreview&&!loadingPreview&&!onePayment&&!lastPlaced&&form.elements.ruo\?\.checked&&form.elements.responsibility\?\.checked/);});
test('payment and delivery retain responsive cards without retired plan activation',()=>{assert.ok(js.includes('Choose how to pay'));assert.doesNotMatch(js,/PURE GOLD|data-nlx-plan|offerBox|checkout\?plan=|Same-Day Bank Payment/);assert.match(css,/\.nlx-payment-choice/);assert.match(css,/\.nlx-trust svg/);});
