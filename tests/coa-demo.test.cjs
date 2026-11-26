'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
test('demo samples contain no report, lab, URL or analytical claim',()=>{
 const samples=JSON.parse(fs.readFileSync(path.join(root,'data/coa-demo-samples.json'),'utf8'));
 assert.ok(samples.length>0);
 for(const sample of samples){
  assert.equal(sample.status,'sample_only');
  assert.equal(sample.lot,'DEMO-NOT-A-REAL-LOT');
  assert.equal(sample.report_id,null);
  assert.equal(sample.lab_name,null);
  assert.equal(sample.document_url,null);
  assert.equal(sample.purity,undefined);
  assert.equal(sample.test_results,undefined);
 }
});
test('demonstration records stay off the Testing page and the legacy sample renderer never links to a PDF',()=>{
 const publicShell=fs.readFileSync(path.join(root,'site-build.cjs'),'utf8');
 const page=fs.readFileSync(path.join(root,'workspace-v2.js'),'utf8');
 const js=fs.readFileSync(path.join(root,'coa-demo.js'),'utf8');
 assert.doesNotMatch(publicShell,/coa-demo\.js|coa-demo-samples/);
 assert.doesNotMatch(page,/coa-demo-results|coa-demo-samples/);
 assert.match(page,/id="ap-supplier-references"/);
 assert.match(js,/sample\.status!=='sample_only'/);
 assert.match(js,/DEMO ONLY — NOT A COA/);
 assert.doesNotMatch(js,/createElement\('a'\)|innerHTML\s*=/);
});
test('verified registry stays empty and independent of sample records',()=>{
 const registry=JSON.parse(fs.readFileSync(path.join(root,'data/verified-coas.json'),'utf8'));
 assert.deepEqual(registry,[]);
});
