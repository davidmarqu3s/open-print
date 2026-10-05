const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const {webcrypto,createHash}=require('node:crypto');
const PDFLib=require('../vendor/pdf-lib.min.js');
const ENGINE_URL='https://raw.githubusercontent.com/davidmarqu3s/open-print/436f731594ae50c359e70c03c0135e63cbd47cf8/vendor/ghostscript.wasm';
const ENGINE_SIZE=17614404;
const ENGINE_SHA256='5a2b1b4daecc0003a70020106dc78c566a59d89524c502ad2a3eecbce0c7bf36';
function assets(fetch,cryptoValue){
  if(arguments.length<2) cryptoValue=webcrypto;
  const context={Uint8Array,ArrayBuffer,DataView,Error,Number,Promise,PDFLib,crypto:cryptoValue,fetch,atob,AbortController};
  context.self=context;
  vm.createContext(context);
  if(fs.existsSync('vendor/sha256.js')) vm.runInContext(fs.readFileSync('vendor/sha256.js','utf8'),context);
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

test('manifest allows network access to the engine URL only',()=>{
  const manifest=JSON.parse(fs.readFileSync('manifest.json','utf8'));
  assert.deepEqual(manifest.networkAccess.allowedDomains,[ENGINE_URL]);
});

test('engine URL points at the repository’s own copy of vendor/ghostscript.wasm',()=>{
  assert.match(ENGINE_URL,/^https:\/\/raw\.githubusercontent\.com\/davidmarqu3s\/open-print\/[0-9a-f]{40}\/vendor\/ghostscript\.wasm$/);
  assert.equal(createHash('sha256').update(fs.readFileSync('vendor/ghostscript.wasm')).digest('hex'),ENGINE_SHA256);
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

for(const [label,cryptoValue] of [['without crypto.subtle',{}],['without crypto',undefined]]){
  test('engine verifies and reuses valid bytes '+label,async()=>{
    const original=fs.readFileSync('vendor/ghostscript.wasm');
    let calls=0;
    const module=assets(async()=>{calls++;return response(original);},cryptoValue);
    assert.deepEqual(Buffer.from(await module.loadEngine()),original);
    assert.deepEqual(Buffer.from(await module.loadEngine()),original);
    assert.equal(calls,1);
  });
  test('engine rejects corrupted bytes and permits retry '+label,async()=>{
    const original=fs.readFileSync('vendor/ghostscript.wasm');
    const changed=Buffer.from(original);changed[changed.length-1]^=1;
    let calls=0;
    const module=assets(async()=>response(++calls===1?changed:original),cryptoValue);
    await assert.rejects(module.loadEngine(),/integrity|verif|checksum|match/i);
    assert.deepEqual(Buffer.from(await module.loadEngine()),original);
    assert.equal(calls,2);
  });
}

test('vendored SHA256 matches known vectors and the complete engine',()=>{
  assert.ok(fs.existsSync('vendor/sha256.js'),'A SHA256 fallback must be bundled');
  const context={Uint8Array,ArrayBuffer};
  context.self=context;
  vm.createContext(context);
  vm.runInContext(fs.readFileSync('vendor/sha256.js','utf8'),context);
  const sha256=vm.runInContext('sha256',context);
  const vectors=[
    ['', 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'],
    ['abc', 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'],
    ['abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq', '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1'],
    ['a'.repeat(1000000), 'cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0']
  ];
  for(const [input,expected] of vectors) assert.equal(sha256(Uint8Array.from(Buffer.from(input))),expected);
  const engine=fs.readFileSync('vendor/ghostscript.wasm');
  assert.equal(sha256(Uint8Array.from(engine)),createHash('sha256').update(engine).digest('hex'));
});
