const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const PDFLib=require('../vendor/pdf-lib.min.js'),GhostscriptModule=require('../vendor/ghostscript.js');
const context={PDFLib,Uint8Array,DataView,Number,Error};vm.createContext(context);vm.runInContext(fs.readFileSync('src/core.js','utf8'),context);
const clean=text=>Buffer.from(context.PrintCore.cleanContent(Buffer.from(text))).toString();
test('remove only orphan closepath operators while preserving valid compound paths',()=>{
 const source='h 0 0 m 10 0 l h f\n0 1 0 0 k h\n20 20 m 10 0 l h S\nh';
 assert.equal(clean(source),' 0 0 m 10 0 l h f\n0 1 0 0 k \n20 20 m 10 0 l h S\n');
 assert.equal(clean('0 0 m q Q h f'),'0 0 m q Q h f');
});
test('content cleaning never changes names, strings, comments or inline-image bytes',()=>{
 for(const source of ['/h Do (h 0 0 m) Tj % h\n<68206d> Tj','BI /W 1 /H 1 /BPC 8 /CS /G ID h 0 0 m EI'])assert.equal(clean(source),source);
});
test('finishing repairs page and Form streams without changing valid paths or form resources',async()=>{
 const {PDFDocument,PDFName,PDFRawStream,decodePDFRawStream}=PDFLib,doc=await PDFDocument.create(),page=doc.addPage([100,100]);
 const form=doc.context.register(doc.context.flateStream(Buffer.from('h 0 0 m 10 10 l h f'),{Type:'XObject',Subtype:'Form',BBox:[0,0,100,100],Resources:{}}));
 page.node.set(PDFName.of('Resources'),doc.context.obj({XObject:{Fm:form}}));page.node.set(PDFName.of('Contents'),doc.context.register(doc.context.flateStream(Buffer.from('/Fm Do h 1 1 m 2 2 l h S'))));
 const result=await PDFDocument.load(await context.PrintCore.finish(await doc.save(),null,100,100,''));
 let checked=0;for(const [ref,object] of result.context.enumerateIndirectObjects())if(object instanceof PDFRawStream){const text=Buffer.from(decodePDFRawStream(object).decode()).toString();assert(!/(?:^|Do )h /.test(text));if(object.dict.get(PDFName.of('Subtype'))===PDFName.of('Form')){assert.equal(text,' 0 0 m 10 10 l h f');assert(object.dict.has(PDFName.of('Resources')));checked++;}}
 assert.equal(checked,1);
});
test('real conversion removes Figma’s inert Type3 font layer while retaining vector art',async()=>{
 const {PDFDocument,PDFName}=PDFLib,doc=await PDFDocument.create(),page=doc.addPage([100,100]);
 const char=doc.context.register(doc.context.flateStream(Buffer.from('10 0 0 0 10 10 d1')));
 const font=doc.context.register(doc.context.obj({Type:'Font',Subtype:'Type3',FontBBox:[0,0,0,0],FontMatrix:[1,0,0,1,0,0],FirstChar:65,LastChar:65,Widths:[10],Encoding:{Type:'Encoding',Differences:[65,PDFName.of('A')]},CharProcs:{A:char},Resources:{}}));
 page.node.set(PDFName.of('Resources'),doc.context.obj({Font:{F1:font}}));page.node.set(PDFName.of('Contents'),doc.context.register(doc.context.flateStream(Buffer.from('0 0 m 10 0 l 10 10 l h f BT /F1 1 Tf (A) Tj ET'))));
 let output;const self={postMessage:message=>output=message},worker={self,GhostscriptModule,WebAssembly};vm.createContext(worker);vm.runInContext(fs.readFileSync('src/worker.js','utf8'),worker);
 await self.onmessage({data:{wasm:new Uint8Array(fs.readFileSync('vendor/ghostscript.wasm')),pdf:await doc.save(),icc:null}});assert(!output.error,output.error);
 const result=await PDFDocument.load(output.bytes);assert(!result.context.enumerateIndirectObjects().some(([ref,o])=>o.dict?.get(PDFName.of('Subtype'))===PDFName.of('Type3')));
 const content=Buffer.from(PDFLib.decodePDFRawStream(result.pages?result.pages[0]:result.getPages()[0].node.Contents()).decode()).toString();assert.match(content,/\bl\b/);assert.match(content,/\bf\b/);
});

test('page streams retain paths spanning Contents arrays and never corrupt shared streams',async()=>{
 const {PDFDocument,PDFName,PDFArray,decodePDFRawStream}=PDFLib,doc=await PDFDocument.create(),a=doc.addPage([100,100]),b=doc.addPage([100,100]);
 const shared=doc.context.register(doc.context.flateStream(Buffer.from('h f h'))),prefix=doc.context.register(doc.context.flateStream(Buffer.from('0 0 m 10 0 l ')));
 a.node.set(PDFName.of('Contents'),doc.context.obj([prefix,shared]));b.node.set(PDFName.of('Contents'),shared);
 const result=await PDFDocument.load(await context.PrintCore.finish(await doc.save(),null,100,100,''));
 const text=page=>{const contents=page.node.Contents();return (contents instanceof PDFArray?contents.asArray():[contents]).map(ref=>Buffer.from(decodePDFRawStream(result.context.lookup(ref)).decode()).toString()).join('');};
 assert.match(text(result.getPages()[0]),/10 0 l h f /);assert(!text(result.getPages()[1]).includes('h'));
});
test('inline-image streams cause following streams to remain untouched',()=>{
 const state={active:false};context.PrintCore.cleanContent(Buffer.from('BI /W 1 /H 1 /BPC 8 /CS /G ID x EI'),state);
 assert.equal(Buffer.from(context.PrintCore.cleanContent(Buffer.from('h f'),state)).toString(),'h f');
});

test('rewritten streams use their new compression filter, never the original encoding',async()=>{
 const {PDFDocument,PDFName,decodePDFRawStream}=PDFLib,doc=await PDFDocument.create(),page=doc.addPage([100,100]);
 const stream=doc.context.stream(Buffer.from(Buffer.from('h 0 0 m 10 10 l h f').toString('hex')+'>'),{Filter:PDFName.of('ASCIIHexDecode')});
 page.node.set(PDFName.of('Contents'),doc.context.register(stream));
 const result=await PDFDocument.load(await context.PrintCore.finish(await doc.save(),null,100,100,''));
 const contents=result.getPages()[0].node.Contents();const refs=contents instanceof PDFLib.PDFArray?contents.asArray():[contents];
 const text=refs.map(ref=>Buffer.from(decodePDFRawStream(result.context.lookup(ref)).decode()).toString()).join('');assert.match(text,/ 0 0 m 10 10 l h f/);
});
