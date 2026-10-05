const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const GhostscriptModule=require('../vendor/ghostscript.js');const {PDFLib}=require('./figma-fixtures.cjs');const {PDFDocument,PDFName,PDFRawStream,PDFDict,PDFArray}=PDFLib;
const context={PDFLib,Uint8Array,DataView,Number,Error};vm.createContext(context);vm.runInContext(fs.readFileSync('src/core.js','utf8'),context);const core=context.PrintCore;
const SRGB=Buffer.from(fs.readFileSync('tests/figma-fixtures.cjs','utf8').match(/SRGB_FLATE=Buffer.from\('([^']+)'/)[1],'base64');
const raw=(doc,dict,bytes)=>doc.context.register(PDFRawStream.of(doc.context.obj(dict),Buffer.from(bytes,'latin1')));
async function ghostscript(pdf,icc){let output;const self={postMessage:m=>output=m},worker={self,GhostscriptModule,WebAssembly};vm.createContext(worker);vm.runInContext(fs.readFileSync('src/worker.js','utf8'),worker);await self.onmessage({data:{wasm:new Uint8Array(fs.readFileSync('vendor/ghostscript.wasm')),pdf,icc}});if(output.error)throw new Error(output.error);return output.bytes;}
// A Figma-style page: an sRGB photo with a soft mask, multiplied over an sRGB fill in an sRGB transparency group.
async function photoPage(){
 const doc=await PDFDocument.create(),page=doc.addPage([200,100]),W=64,H=32,pixels=Buffer.alloc(W*H*3),alpha=Buffer.alloc(W*H,255);
 for(let i=0;i<W*H;i++){pixels[i*3]=i%W*4;pixels[i*3+1]=Math.floor(i/W)*8;pixels[i*3+2]=200;if(i%W<16)alpha[i]=128;}
 const cs=doc.context.register(doc.context.obj([PDFName.of('ICCBased'),raw(doc,{N:3,Alternate:'DeviceRGB',Filter:'FlateDecode'},SRGB.toString('latin1'))]));
 const mask=doc.context.register(doc.context.flateStream(alpha,{Type:'XObject',Subtype:'Image',Width:W,Height:H,ColorSpace:'DeviceGray',BitsPerComponent:8}));
 const image=doc.context.register(doc.context.flateStream(pixels,{Type:'XObject',Subtype:'Image',Width:W,Height:H,ColorSpace:cs,BitsPerComponent:8,SMask:mask}));
 page.node.set(PDFName.of('Resources'),doc.context.obj({ColorSpace:{C1:cs},XObject:{X1:image},ExtGState:{M:{Type:'ExtGState',BM:'Multiply'}}}));page.node.set(PDFName.of('Group'),doc.context.obj({Type:'Group',S:'Transparency',CS:cs}));
 page.node.set(PDFName.of('Contents'),raw(doc,{},'/C1 cs\n1 0.85 0 scn\n0 0 200 100 re f\nq\n/M gs\n128 0 0 64 36 18 cm\n/X1 Do\nQ\n'));
 return doc.save({useObjectStreams:false});
}
const streams=doc=>doc.context.enumerateIndirectObjects().map(([,o])=>o).filter(o=>o instanceof PDFRawStream);
test('photos come out DeviceCMYK at full size, and no RGB colour space survives finishing',async()=>{
 const icc=fs.readFileSync('vendor/profiles/CoatedFOGRA39.icc'),converted=await ghostscript(await photoPage(),icc);
 const before=await PDFDocument.load(converted);assert(before.getPage(0).node.Resources().get(PDFName.of('ColorSpace')),'Ghostscript leaves the source colour space behind');
 const result=await PDFDocument.load(await core.finish(converted,icc,70.56,35.28,'Coated FOGRA39'));
 const images=streams(result).filter(s=>s.dict.get(PDFName.of('Subtype'))===PDFName.of('Image'));
 const colour=images.filter(s=>s.dict.has(PDFName.of('SMask')));assert.equal(colour.length,1);
 assert.equal(colour[0].dict.get(PDFName.of('ColorSpace')),PDFName.of('DeviceCMYK'));assert.equal(colour[0].dict.get(PDFName.of('Width')).asNumber(),64);
 assert.equal(result.getPage(0).node.Resources().get(PDFName.of('ColorSpace')),undefined);
 for(const s of streams(result))assert.notEqual(s.dict.get(PDFName.of('N'))?.asNumber?.(),3,'no RGB ICC profile left in the file');
 assert(!result.context.enumerateIndirectObjects().some(([,o])=>o instanceof PDFArray&&o.get(0)===PDFName.of('ICCBased')));
});
test('colour spaces the content still names are kept, in pages, Forms and shared dictionaries',async()=>{
 const doc=await PDFDocument.create(),page=doc.addPage([100,100]),cmyk=PDFName.of('DeviceCMYK');
 const form=raw(doc,{Type:'XObject',Subtype:'Form',BBox:[0,0,10,10],Resources:{ColorSpace:{F1:cmyk,F2:cmyk}}},'/F1 cs 1 0 0 0 sc 0 0 5 5 re f');
 const shared=doc.context.register(doc.context.obj({CS0:cmyk,CS01:cmyk,Unused:cmyk}));
 const sharing=raw(doc,{Type:'XObject',Subtype:'Form',BBox:[0,0,10,10],Resources:{ColorSpace:shared}},'/CS01 cs 1 0 0 0 sc 0 0 5 5 re f');
 page.node.set(PDFName.of('Resources'),doc.context.obj({ColorSpace:shared,XObject:{Fm:form,Sh:sharing}}));
 page.node.set(PDFName.of('Contents'),raw(doc,{},'/CS0 cs 0 0 0 1 sc 0 0 10 10 re f /Fm Do /Sh Do'));
 const result=await PDFDocument.load(await core.finish(await doc.save(),null,50,50,''));
 assert.deepEqual(result.getPage(0).node.Resources().lookup(PDFName.of('ColorSpace'),PDFDict).keys().map(k=>k.asString()),['/CS0','/CS01'],'kept for the Form sharing the dictionary');
 const fixed=streams(result).find(s=>s.dict.get(PDFName.of('Subtype'))===PDFName.of('Form')&&s.dict.lookup(PDFName.of('Resources'),PDFDict).get(PDFName.of('ColorSpace'))instanceof PDFDict);
 assert.deepEqual(fixed.dict.lookup(PDFName.of('Resources'),PDFDict).lookup(PDFName.of('ColorSpace'),PDFDict).keys().map(k=>k.asString()),['/F1']);
});
async function placed(pages){
 const doc=await PDFDocument.create();
 for(const {content,form}of pages){const page=doc.addPage([600,600]),image=doc.context.register(doc.context.flateStream(Buffer.alloc(600*400*4),{Type:'XObject',Subtype:'Image',Width:600,Height:400,ColorSpace:'DeviceCMYK',BitsPerComponent:8}));
  const resources={XObject:{Im:image}};if(form)resources.XObject.Fm=raw(doc,{Type:'XObject',Subtype:'Form',BBox:[0,0,600,600],Matrix:form,Resources:{XObject:{Im:image}}},'q 144 0 0 96 0 0 cm /Im Do Q');
  page.node.set(PDFName.of('Resources'),doc.context.obj(resources));page.node.set(PDFName.of('Contents'),raw(doc,{},content));}
 return doc.save();
}
test('image resolution follows the transforms to the printed size',async()=>{
 assert.deepEqual({...await core.imageResolution(await placed([{content:'q 144 0 0 96 0 0 cm /Im Do Q'}]))},{ppi:300,page:1,pages:1});
 assert.equal((await core.imageResolution(await placed([{content:'q 2 0 0 2 0 0 cm q 144 0 0 96 0 0 cm /Im Do Q Q'}]))).ppi,150,'nested cm');
 assert.equal((await core.imageResolution(await placed([{content:'q 0 288 -192 0 0 0 cm /Im Do Q'}]))).ppi,150,'rotated');
 assert.equal((await core.imageResolution(await placed([{content:'q 0.5 0 0 0.5 0 0 cm Q q 144 0 0 96 0 0 cm /Im Do Q'}]))).ppi,300,'Q restores the matrix');
 assert.deepEqual({...await core.imageResolution(await placed([{content:'q 72 0 0 48 0 0 cm /Im Do Q'},{content:'/Fm Do',form:[4,0,0,4,0,0]}]))},{ppi:75,page:2,pages:2},'Form matrix, lowest page');
 const doc=await PDFDocument.create();doc.addPage([10,10]).drawRectangle({x:0,y:0,width:5,height:5});assert.equal(await core.imageResolution(await doc.save()),null);
});
