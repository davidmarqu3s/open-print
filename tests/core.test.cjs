const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const vm=require('node:vm');
const ctx={Uint8Array,DataView,Number,Error};vm.createContext(ctx);if(fs.existsSync('src/core.js'))vm.runInContext(fs.readFileSync('src/core.js','utf8'),ctx);
test('millimetres become exact PDF points',()=>assert.equal(ctx.PrintCore?.points(320),320*72/25.4));
test('invalid page sizes fail before conversion',()=>{assert.throws(()=>ctx.PrintCore?.points(0));assert.throws(()=>ctx.PrintCore?.points(NaN));});
test('ICC validator accepts a CMYK header and rejects RGB',()=>{const bytes=Buffer.alloc(132);bytes.writeUInt32BE(132,0);bytes.write('CMYK',16);bytes.write('acsp',36);assert.equal(ctx.PrintCore?.validateICC(bytes),true);const rgb=Buffer.from(bytes);rgb.write('RGB ',16);assert.throws(()=>ctx.PrintCore?.validateICC(rgb),/CMYK/);});
test('truncated ICC is rejected',()=>assert.throws(()=>ctx.PrintCore?.validateICC(new Uint8Array(128)),/profile/i));
test('frame dimensions infer millimetres at native Figma PDF scale',()=>{const size=ctx.PrintCore?.frameSize(907,1276);assert.equal(size?.width,319.97);assert.equal(size?.height,450.14);const exact=ctx.PrintCore?.frameSize(320*72/25.4,450*72/25.4);assert.equal(exact?.width,320);assert.equal(exact?.height,450);});
