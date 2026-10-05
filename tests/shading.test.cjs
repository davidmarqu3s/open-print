const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const GhostscriptModule=require('../vendor/ghostscript.js');const {figmaPDF,STOPS_FN,PDFLib}=require('./figma-fixtures.cjs');
const {PDFDocument,PDFName,PDFDict,PDFArray,PDFRawStream,decodePDFRawStream}=PDFLib;
// Loaded in this realm (not a vm context) so arrays pass pdf-lib's type checks, as they do in the plugin.
const {PrintCore,PrintShading}=new Function('PDFLib',fs.readFileSync('src/core.js','utf8')+'\n'+fs.readFileSync('src/shading.js','utf8')+'\nreturn {PrintCore,PrintShading};')(PDFLib),wasm=fs.readFileSync('vendor/ghostscript.wasm'),FOGRA39=new Uint8Array(fs.readFileSync('vendor/profiles/CoatedFOGRA39.icc'));
async function ghostscript(pdf,icc){let output;const self={postMessage:m=>output=m},worker={self,GhostscriptModule,WebAssembly};vm.createContext(worker);vm.runInContext(fs.readFileSync('src/worker.js','utf8'),worker);await self.onmessage({data:{wasm:new Uint8Array(wasm),pdf,icc}});if(output.error)throw new Error(output.error);return output.bytes;}
// The plugin's export path: gradients to CMYK, Ghostscript, then finishing.
async function exportPDF(bytes,icc){const doc=await PDFDocument.load(bytes);await PrintShading.toCMYK(doc,probe=>ghostscript(probe,icc));return PrintCore.finish(await ghostscript(await doc.save(),icc),icc,null,null,'Coated FOGRA39',[{width:200*25.4/72,height:100*25.4/72}]);}
function inventory(doc){const result={images:0,shadings:[]};for(const [,o] of doc.context.enumerateIndirectObjects()){const d=o instanceof PDFRawStream?o.dict:o instanceof PDFDict?o:null;if(!d)continue;if(d.get(PDFName.of('Subtype'))===PDFName.of('Image')&&!d.get(PDFName.of('ColorSpace'))?.toString().includes('Gray'))result.images++;
 const walk=v=>{const x=doc.context.lookup(v),xd=x instanceof PDFRawStream?x.dict:x instanceof PDFDict?x:null;if(xd&&xd.get(PDFName.of('ShadingType'))){const cs=doc.context.lookup(xd.get(PDFName.of('ColorSpace')));result.shadings.push(xd.get(PDFName.of('ShadingType')).asNumber()+' '+(cs instanceof PDFArray?cs.get(0):cs));}};
 walk(o);if(d.get(PDFName.of('Shading')))walk(d.get(PDFName.of('Shading')));}result.shadings=[...new Set(result.shadings)].sort();return result;}
// A flat fill painted in the fixture's own sRGB colour space, converted by Ghostscript.
const solid=async(rgb,icc)=>{const doc=await PDFDocument.load(await figmaPDF('linear'));doc.getPage(0).node.set(PDFName.of('Contents'),doc.context.register(doc.context.flateStream(Buffer.from('/C1 cs '+rgb.join(' ')+' scn 0 0 10 10 re f'))));const out=await PDFDocument.load(await ghostscript(await doc.save(),icc));return Buffer.from(decodePDFRawStream(out.getPages()[0].node.Contents()).decode()).toString().match(/([\d.]+) ([\d.]+) ([\d.]+) ([\d.]+) k/).slice(1).map(Number);};

test('PostScript calculator evaluates Figma gradient functions',async()=>{
 const code=PrintShading.parseCalculator(STOPS_FN),at=t=>Array.from(PrintShading.runCalculator(code,[t]),v=>Math.round(v*1000)/1000);
 assert.deepEqual(at(0),[1,0,0]);assert.deepEqual(at(0.25),[0.5,0.3,0.5]);assert.deepEqual(at(0.5),[0,0.6,1]);assert.deepEqual(at(1),[1,0.85,0]);
 assert.deepEqual(Array.from(PrintShading.runCalculator(PrintShading.parseCalculator('{ 2 copy gt { exch } if pop 3 1 roll 0.5 ge { 1 } { 0 } ifelse }'),[0.2,0.7,0.6,0.1])),[0.1,0.2,1]);
 assert.throws(()=>PrintShading.runCalculator(PrintShading.parseCalculator('{ dup frobnicate }'),[1]),/Unsupported/);
});

test('every Figma RGB gradient is found, greyscale masks are left alone',async()=>{
 for(const [name,type] of [['linear',2],['radial',3],['diamond',4],['linear-alpha',2]]){const jobs=PrintShading.plan(await PDFDocument.load(await figmaPDF(name)));assert.deepEqual(jobs.map(j=>j.type),[type],name);}
 assert.deepEqual(PrintShading.plan(await PDFDocument.load(await figmaPDF('drop-shadow'))),[]);
});

for(const [label,icc] of [['Coated FOGRA39',FOGRA39],['no profile',null]])
 test('gradients stay vector CMYK through conversion ('+label+')',async()=>{
  for(const [name,expected] of [['linear',['2 /DeviceCMYK']],['radial',['3 /DeviceCMYK']],['diamond',['4 /DeviceCMYK']],['linear-alpha',['2 /DeviceCMYK','2 /DeviceGray']]]){
   const found=inventory(await PDFDocument.load(await exportPDF(await figmaPDF(name),icc)));
   assert.equal(found.images,0,name+' must not be rasterised');assert.deepEqual(found.shadings,expected,name);
  }
 });

test('gradient end colours match Ghostscript’s conversion of the same flat colours',async()=>{
 const doc=await PDFDocument.load(await figmaPDF('linear'));const job=PrintShading.plan(doc)[0];
 await PrintShading.toCMYK(doc,probe=>ghostscript(probe,FOGRA39));
 const fn=PrintShading.evaluator(doc,job.item.shading.get(PDFName.of('Function')));
 for(const [t,rgb] of [[0,[1,0,0]],[0.5,[0,0.6,1]],[1,[1,0.85,0]]]){const flat=await solid(rgb,FOGRA39),got=fn([t]);got.forEach((v,i)=>assert(Math.abs(v-flat[i])<0.002,'colour at '+t+': '+got+' vs '+flat));}
});

test('Figma diamond gradient is no longer dropped by Ghostscript',async()=>{
 const before=inventory(await PDFDocument.load(await ghostscript(await figmaPDF('diamond'),FOGRA39)));
 assert.deepEqual(before.shadings,[],'Ghostscript alone loses the mesh, which is why the pre-conversion exists');
 const after=inventory(await PDFDocument.load(await exportPDF(await figmaPDF('diamond'),FOGRA39)));assert.deepEqual(after.shadings,['4 /DeviceCMYK']);
});

test('unsupported RGB shading types fail instead of silently disappearing',async()=>{
 const doc=await PDFDocument.create(),page=doc.addPage([10,10]);
 page.node.set(PDFName.of('Resources'),doc.context.obj({Shading:{S:doc.context.register(PDFRawStream.of(doc.context.obj({ShadingType:6,ColorSpace:'DeviceRGB',BitsPerFlag:8,BitsPerCoordinate:16,BitsPerComponent:8,Decode:[0,1,0,1,0,1,0,1,0,1]}),new Uint8Array(0)))}}));
 assert.throws(()=>PrintShading.plan(doc),/gradient type/);
});

test('effect frames exported at a larger scale return to their frame size',async()=>{
 const scale=300/144+0.02,merged=await PDFDocument.create(),source=await PDFDocument.load(await figmaPDF('drop-shadow',scale));
 const [page]=await merged.copyPages(source,[0]);page.scale(1/scale,1/scale);merged.addPage(page);
 assert(Math.abs(page.getWidth()-200)<0.001&&Math.abs(page.getHeight()-100)<0.001);
 const streams=page.node.Contents().asArray().map(r=>merged.context.lookup(r)),text=st=>Buffer.from(st.getUnencodedContents?st.getUnencodedContents():decodePDFRawStream(st).decode()).toString();
 assert.match(streams.map(text).join(''),new RegExp((1/scale).toFixed(3)+'\\d* 0 0 '+(1/scale).toFixed(3)+'\\d* 0 0 cm\\n'),'artwork is wrapped in the 1/scale transform');
 const out=await PDFDocument.load(await exportPDF(await merged.save(),FOGRA39)),result=out.getPage(0);
 assert(Math.abs(result.getWidth()-200)<0.01&&Math.abs(result.getHeight()-100)<0.01);assert.equal(inventory(out).images,1);
});
