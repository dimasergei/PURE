const test = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");

const read = (path) => readFileSync(resolve(__dirname, "..", path), "utf8");

test("storefront header puts menu and search before PURE and account and cart after it", () => {
  const html = read("site-build.cjs");
  const start = html.slice(html.indexOf('<div class="ap-header-start">'), html.indexOf('aria-label="PURE home"><span class="ap-mark"'));
  const actions = html.slice(html.indexOf('<div class="ap-header-actions">'), html.indexOf('const footer='));
  const menu = start.indexOf('aria-controls="ap-mobile-menu"');
  const search = start.indexOf('data-action="search"');
  const account = actions.indexOf('href="/my-account" aria-label="My account"');
  const cart = actions.indexOf('data-action="cart"');
  assert.ok(menu >= 0 && search > menu);
  assert.ok(account >= 0 && cart > account);
  assert.match(actions.slice(account, cart), /<svg[\s\S]*?<circle cx="12" cy="8"/);
});

test("order detail shipping address uses real line breaks, not literal backslash-n", () => {
  const account = read("account.js");
  assert.ok(account.includes(".filter(Boolean).join('\\n')"));
  assert.ok(!account.includes(".filter(Boolean).join('\\\\n')"));
});

test("account navigation exposes the requested sections in order", () => {
  const account = read("account.js");
  const start = account.indexOf("function accountNav(active)");
  const end = account.indexOf("async function overview()", start);
  assert.ok(start >= 0 && end > start);
  const nav = account.slice(start, end);
  const labels = ["Overview", "Orders", "Profile", "Partner", "Log out"];
  assert.doesNotMatch(nav,/\[\x27(?:Points|Store Credit)\x27,/);
  let previous = -1;
  for (const label of labels) {
    const next = nav.indexOf(label);
    assert.ok(next > previous, `Navigation item out of order: ${label}`);
    previous = next;
  }
});

test("profile editing updates only the authenticated user's display name", () => {
  const account = read("account.js");
  assert.match(account, /auth\.auth\.updateUser\(\{data:\{\.\.\.\(user\.user_metadata\|\|\{\}\),full_name:value\}\}\)/);
  assert.match(account, /readonly aria-readonly="true"/);
  assert.doesNotMatch(account, /updateUser\(\{email:/);
});

test("Google sign-in is present on account, login, and signup routes", () => {
  const account = read("account.js");
  assert.match(account, /function googleOption\(\)[\s\S]*?Continue with Google/);
  assert.match(account, /signInWithIdToken\(\{provider:'google',token:response\.credential,nonce\}\)/);
  assert.match(account, /function bindGoogle\(\)[\s\S]*?redirectTo:signInCallbackUrl\(\)/);
  assert.match(account, /function login\(error=''\)[\s\S]*?googleOption\(\)[\s\S]*?bindGoogle\(\)/);
  assert.match(account, /function signup\(error=''\)[\s\S]*?googleOption\(\)[\s\S]*?bindGoogle\(\)/);
  assert.match(account, /head\('Your account'[\s\S]*?googleOption\(\)[\s\S]*?bindGoogle\(\)/);
});

test('Google sign-in reuses the clean Google Pay G asset instead of a stroked inline symbol',()=>{
 const account=require('node:fs').readFileSync('account.js','utf8');
 assert.match(account,/class="pure-google-mark" src="\/assets\/payment-brands\/google-g-clean\.svg"/);
 assert.doesNotMatch(account,/<svg viewBox="0 0 48 48"/);
});
