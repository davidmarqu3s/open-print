const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const GhostscriptModule=require('../vendor/ghostscript.js');const {PDFLib}=require('./figma-fixtures.cjs');const {PDFDocument,PDFName,PDFRawStream,PDFDict,decodePDFRawStream}=PDFLib;
const context={PDFLib,Uint8Array,DataView,Number,Error,TextEncoder,crypto,Date,Math};vm.createContext(context);vm.runInContext(fs.readFileSync('src/core.js','utf8'),context);const core=context.PrintCore;
async function ghostscript(pdf,icc,compatibility){let output;const self={postMessage:m=>output=m},worker={self,GhostscriptModule,WebAssembly};vm.createContext(worker);vm.runInContext(fs.readFileSync('src/worker.js','utf8'),worker);await self.onmessage({data:{wasm:new Uint8Array(fs.readFileSync('vendor/ghostscript.wasm')),pdf,icc,compatibility}});if(output.error)throw new Error(output.error);return output.bytes;}
const black=text=>{const result=core.pureBlackContent(Buffer.from(text));return result.used?Buffer.from(result.bytes).toString('latin1'):null;};
const FOGRA39=()=>fs.readFileSync('vendor/profiles/CoatedFOGRA39.icc');
test('pure black fills and strokes become overprinting 100% K, and other colours turn overprint off again',()=>{
 // Figma's layout: outlined glyphs painted with an sRGB colour space, then other colours.
 assert.equal(black('/C1 CS /C1 cs 0 0 0 scn 0 0 m 5 5 l h f 0.2 0.2 0.2 scn 0 0 5 5 re f'),'/C1 CS /C1 cs /OPK10 gs 0 0 0 1 k 0 0 m 5 5 l h f /OPK00 gs /C1 cs 0.2 0.2 0.2 scn 0 0 5 5 re f');
 assert.equal(black('0 0 0 RG 1 0 0 rg 0 0 5 5 re B'),'/OPK01 gs 0 0 0 1 K 1 0 0 rg 0 0 5 5 re B');
 assert.equal(black('0 0 0 rg 0 0 0 RG 0 0 5 5 re B'),'/OPK10 gs 0 0 0 1 k /OPK11 gs 0 0 0 1 K 0 0 5 5 re B');
});
test('near-black, grey, CMYK, gray and pattern colours stay as they are, as do strings and inline images',()=>{
 for(const source of ['/C1 cs 0.2 0.2 0.2 scn 0 0 5 5 re f','/C1 cs 0.004 0 0 scn 0 0 5 5 re f','0 0 0 1 k 0 0 5 5 re f','0 g 0 0 5 5 re f','/Pattern cs /P1 scn 0 0 5 5 re f','BT (0 0 0 rg) Tj ET','BI /W 1 /H 1 ID x EI 0 0 0 rg 0 0 5 5 re f'])assert.equal(black(source),null,source);
});
test('Q restores the colour and overprint it saved, and images, shadings and Forms never inherit overprint',()=>{
 assert.equal(black('q 0 0 0 rg 0 0 5 5 re f Q 0 0 5 5 re f'),'q /OPK10 gs 0 0 0 1 k 0 0 5 5 re f Q 0 0 5 5 re f');
 assert.equal(black('0 0 0 rg /Fm Do /Sh sh 0 0 5 5 re f'),'/OPK10 gs 0 0 0 1 k /OPK00 gs /Fm Do /OPK10 gs /OPK00 gs /Sh sh /OPK10 gs 0 0 5 5 re f');
});
test('through Ghostscript, pure black is K only and overprints, grey stays rich, and soft masks are untouched',async()=>{
 const doc=await PDFDocument.create(),page=doc.addPage([200,100]);
 const mask=doc.context.register(PDFRawStream.of(doc.context.obj({Type:'XObject',Subtype:'Form',BBox:[0,0,200,100],Group:{Type:'Group',S:'Transparency',CS:'DeviceRGB'}}),Buffer.from('0 0 0 rg 0 0 50 50 re f')));
 page.node.set(PDFName.of('Resources'),doc.context.obj({ExtGState:{M:doc.context.obj({Type:'ExtGState',SMask:{Type:'Mask',S:'Luminosity',G:mask}})}}));
 page.node.set(PDFName.of('Contents'),doc.context.register(PDFRawStream.of(doc.context.obj({}),Buffer.from('1 0.85 0 rg 0 0 200 100 re f 0 0 0 rg 10 70 m 30 70 l 30 90 l h f 0.2 0.2 0.2 rg 60 0 50 50 re f'))));
 core.pureBlack(doc);assert.equal(Buffer.from(decodePDFRawStream(doc.context.lookup(mask)).decode()).toString(),'0 0 0 rg 0 0 50 50 re f');
 const out=await PDFDocument.load(await ghostscript(await doc.save(),FOGRA39()));let text='';
 for(const [,o] of out.context.enumerateIndirectObjects())if(o instanceof PDFRawStream&&!o.dict.get(PDFName.of('Subtype'))&&!o.dict.get(PDFName.of('N')))text+=Buffer.from(decodePDFRawStream(o).decode()).toString('latin1');
 assert.match(text,/\/R\d+ gs\n0 0 0 1 k\n/);assert.match(text,/0\.675 0\.596 0\.565 0\.659 k/,'grey stays four-colour');assert.doesNotMatch(text,/0\.89 0\.784 0\.616 0\.969 k/,'no rich black is left');
 const states=[...out.context.enumerateIndirectObjects()].map(([,o])=>o).filter(o=>o instanceof PDFDict&&o.get(PDFName.of('Type'))===PDFName.of('ExtGState'));
 assert(states.some(s=>s.get(PDFName.of('op'))===PDFLib.PDFBool.True&&s.get(PDFName.of('OPM')).asNumber()===1));
});
test('Ghostscript writes in points, so soft masks are not drawn under a scale macOS applies twice',async()=>{
 const doc=await PDFDocument.create(),page=doc.addPage([200,100]);
 const mask=doc.context.register(PDFRawStream.of(doc.context.obj({Type:'XObject',Subtype:'Form',BBox:[0,0,200,100],Group:{Type:'Group',S:'Transparency'}}),Buffer.from('1 g 20 20 100 60 re f')));
 page.node.set(PDFName.of('Resources'),doc.context.obj({ExtGState:{M:doc.context.obj({Type:'ExtGState',SMask:{Type:'Mask',S:'Alpha',G:mask}})}}));
 page.node.set(PDFName.of('Contents'),doc.context.register(PDFRawStream.of(doc.context.obj({}),Buffer.from('/M gs 1 0 0 rg 0 0 200 100 re f'))));
 const out=await PDFDocument.load(await ghostscript(await doc.save(),FOGRA39())),contents=out.context.lookup(out.getPage(0).node.get(PDFName.of('Contents')));
 const text=(contents instanceof PDFLib.PDFArray?contents.asArray():[contents]).map(ref=>Buffer.from(decodePDFRawStream(out.context.lookup(ref)).decode()).toString('latin1')).join('\n');
 assert.match(text,/\/R\d+ gs/);assert.doesNotMatch(text,/0\.1 0 0 0\.1 0 0 cm/);
 const masks=[...out.context.enumerateIndirectObjects()].map(([,o])=>o).filter(o=>o instanceof PDFDict&&o.get(PDFName.of('S'))===PDFName.of('Alpha'));assert(masks.length);
 for(const m of masks){const box=out.context.lookup(m.get(PDFName.of('G'))).dict.lookup(PDFName.of('BBox')).asArray().map(n=>n.asNumber());assert(box[2]<=201&&box[3]<=101,'mask in points: '+box);}
});
test('PDF/X-4 files are PDF 1.6 with a document ID, Trapped key and XMP naming the standard',async()=>{
 const doc=await PDFDocument.create();doc.addPage([200,100]).drawRectangle({x:0,y:0,width:10,height:10,color:PDFLib.cmyk(0,0,0,1)});
 const bytes=await ghostscript(await doc.save(),FOGRA39(),'1.6'),output=await core.finish(bytes,FOGRA39(),70.56,35.28,'Coated FOGRA39',null,{bleeds:[3],pdfx:true,title:'Poster <A4> & “final”'});
 assert.equal(Buffer.from(output.subarray(0,8)).toString(),'%PDF-1.6');
 const result=await PDFDocument.load(output,{updateMetadata:false}),info=result.getInfoDict();
 assert.equal(info.get(PDFName.of('Trapped')),PDFName.of('False'));assert.equal(result.getTitle(),'Poster <A4> & “final”');assert.equal(result.getCreator(),'Figma');
 assert(result.context.trailerInfo.ID,'document ID');assert(!info.get(PDFName.of('GTS_PDFXVersion')),'X-4 keeps the version in XMP only');
 const xmp=Buffer.from(result.catalog.lookup(PDFName.of('Metadata'),PDFRawStream).contents).toString('utf8');
 for(const part of ['<pdfxid:GTS_PDFXVersion>PDF/X-4</pdfxid:GTS_PDFXVersion>','<pdf:Trapped>False</pdf:Trapped>','<xmpMM:VersionID>1</xmpMM:VersionID>','<xmpMM:RenditionClass>default</xmpMM:RenditionClass>','Poster &lt;A4&gt; &amp; “final”'])assert(xmp.includes(part),part);
 const date=result.getCreationDate().toISOString().replace('.000','');assert(xmp.includes('<xmp:CreateDate>'+date+'</xmp:CreateDate>'),'XMP and Info dates match');
 const page=result.getPage(0);assert(page.node.get(PDFName.of('TrimBox'))&&page.node.get(PDFName.of('BleedBox')));
 assert(result.catalog.lookup(PDFName.of('OutputIntents')));
});
test('PDF/X-4 needs a profile, and files without it keep their usual header',async()=>{
 const doc=await PDFDocument.create();doc.addPage([200,100]);const bytes=await doc.save();
 await assert.rejects(core.finish(bytes,null,70.56,35.28,'',null,{pdfx:true}),/needs a colour profile/);
 const plain=await core.finish(bytes,null,70.56,35.28,'',null,{});assert.equal(Buffer.from(plain.subarray(0,8)).toString(),'%PDF-1.7');
 assert(!(await PDFDocument.load(plain)).catalog.get(PDFName.of('Metadata')));
});
