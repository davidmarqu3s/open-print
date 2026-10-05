const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const {webcrypto}=require('node:crypto');
const PDFLib=require('../vendor/pdf-lib.min.js');
const ENGINE_URL='https://raw.githubusercontent.com/J0shua-code/pdf-tools/51131feb82b37ad51687718889b788bf425ce594/web/ghostscript.wasm';
const ENGINE_SIZE=17614404;
const ENGINE_SHA256='5a2b1b4daecc0003a70020106dc78c566a59d89524c502ad2a3eecbce0c7bf36';
function assets(fetch){
  const context={Uint8Array,ArrayBuffer,DataView,Error,Number,Promise,PDFLib,crypto:webcrypto,fetch,atob,AbortController};
  vm.createContext(context);
  vm.runInContext(fs.readFileSync('src/assets.js','utf8'),context);
  return vm.runInContext('OpenPrintAssets',context);
}
function response(bytes){return {ok:true,status:200,arrayBuffer:async()=>Uint8Array.from(bytes).buffer};}

test('every bundled profile decodes to the exact original ICC bytes',()=>{
  const html=fs.readFileSync('dist/ui.html','utf8');
  const assignment=html.match(/const BUNDLED_PROFILES=(\{[^\n]*\});/);
  assert.ok(assignment,'Built UI must contain the bundled profile library');
  const bundled=JSON.parse(assignment[1]);
  const paths=JSON.parse(fs.readFileSync('vendor/profiles/paths.json','utf8'));
  assert.equal(Object.keys(paths).length,15);
  const module=assets(()=>assert.fail('Profile decoding must not make a network request'));
  for(const [id,path] of Object.entries(paths)){
    assert.equal(typeof bundled[id],'object',id+' must use packed bytes');
    assert.deepEqual(Buffer.from(module.decodeProfile(bundled[id])),fs.readFileSync(path),id+' must remain byte-identical');
  }
});

test('uploaded profiles retain raw base64 compatibility',()=>{
  const original=fs.readFileSync('vendor/profiles/CoatedFOGRA39.icc');
  assert.deepEqual(Buffer.from(assets().decodeProfile(original.toString('base64'))),original);
});

test('publication code stays within Figma’s 15 MB budget and excludes embedded WASM',()=>{
  const total=fs.statSync('dist/code.js').size+fs.statSync('dist/ui.html').size;
  assert.ok(total<=15000000,'Publishing code is '+total+' bytes');
  assert.ok(!fs.readFileSync('dist/ui.html','utf8').includes('const WASM_BASE64='));
});

test('engine download uses a fixed version and reuses successfully verified bytes',async()=>{
  const original=fs.readFileSync('vendor/ghostscript.wasm');
  let calls=0;
  const signal=new AbortController().signal;
  const module=assets(async(url,options)=>{
    calls++;
    assert.equal(url,ENGINE_URL);
    assert.equal(options.signal,signal);
    return response(original);
  });
  assert.equal(module.ENGINE_URL,ENGINE_URL);
  assert.equal(module.ENGINE_SIZE,ENGINE_SIZE);
  assert.equal(module.ENGINE_SHA256,ENGINE_SHA256);
  assert.deepEqual(Buffer.from(await module.loadEngine(signal)),original);
  assert.deepEqual(Buffer.from(await module.loadEngine(signal)),original);
  assert.equal(calls,1);
});

test('failed HTTP download is not cached and can be retried',async()=>{
  const original=fs.readFileSync('vendor/ghostscript.wasm');
  let calls=0;
  const module=assets(async()=>++calls===1?{ok:false,status:503}:response(original));
  await assert.rejects(module.loadEngine(),/503|download|load/i);
  assert.deepEqual(Buffer.from(await module.loadEngine()),original);
  assert.equal(calls,2);
});

test('engine integrity mismatch is rejected before execution and remains retryable',async()=>{
  const original=fs.readFileSync('vendor/ghostscript.wasm');
  const changed=Buffer.from(original);changed[changed.length-1]^=1;
  let calls=0;
  const module=assets(async()=>response(++calls===1?changed:original));
  await assert.rejects(module.loadEngine(),/integrity|verif|checksum|match/i);
  assert.deepEqual(Buffer.from(await module.loadEngine()),original);
  assert.equal(calls,2);
});

test('truncated engine is rejected',async()=>{
  const module=assets(async()=>response(new Uint8Array(32)));
  await assert.rejects(module.loadEngine(),/size|length|incomplete|verif/i);
});
