import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const read = p => readFileSync(p, 'utf8');
test('generated entry point has app metadata and executable scripts',()=>{
 const html=read('dist/index.html');
 assert.match(html, /<html lang="en">/); assert.match(html,/rel="manifest"/);
 for(const match of html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)) new vm.Script(match[1]);
 new vm.Script(read('app-enhancements.js')); new vm.Script(read('public/sw.js'));
});
test('manifest has real PNG icons at required dimensions',()=>{
 const manifest=JSON.parse(read('public/manifest.webmanifest'));
 assert.equal(manifest.display,'standalone'); assert.equal(manifest.scope,'/');
 for(const icon of manifest.icons){const png=readFileSync('public'+icon.src); assert.equal(png.subarray(1,4).toString(),'PNG'); const [w,h]=icon.sizes.split('x').map(Number); assert.equal(png.readUInt32BE(16),w); assert.equal(png.readUInt32BE(20),h);}
});
test('notification runtime imports successfully',async()=>{await import('../netlify/functions/_push/runtime.mjs')});
