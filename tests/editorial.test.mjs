import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const source = readFileSync('src/index.html','utf8');
const data = vm.runInNewContext(source.slice(source.indexOf('const STATES ='),source.indexOf('// ----- Helpers -----'))+'; ({STATES,DOCS,PATHWAYS,FED})');
test('all jurisdictions and program workflows remain available',()=>{
  assert.equal(data.STATES.length,51);
  assert.equal(new Set(data.STATES.map(s=>s.c)).size,51);
  assert.equal(data.DOCS.length,22);
  assert.deepEqual(Object.keys(data.PATHWAYS),['vr','oib','idea','va','icc','nls','at']);
  for(const state of data.STATES)for(const program of Object.values(data.PATHWAYS)){
    assert.ok(program.steps(state).length>=2);
    assert.ok(state.agency && state.url && state.at);
  }
});
test('editorial copy retains deadline qualifications and legal references',()=>{
  for(const reference of ['34 CFR 361.41','361.45','34 CFR 361.53(b)','34 CFR 361.57','34 CFR 300.304 and 300.324','34 CFR 300.105'])assert.ok(source.includes(reference));
  assert.ok(source.includes('IPE due if eligibility is decided on day 60'));
  assert.ok(source.includes('This is my requested response time, not a statutory deadline.'));
  assert.ok(source.includes('IDEA applies through age 21, subject to state rules; it does not cover college.'));
  assert.doesNotMatch(source,/funding doors|Free, fastest|the exact papers/);
  assert.match(readFileSync('public/sw.js','utf8'),/const VERSION = 'v9'/);
});
