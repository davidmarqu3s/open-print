const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const GhostscriptModule=require('../vendor/ghostscript.js');const {PDFLib}=require('./figma-fixtures.cjs');const {PDFDocument,PDFName,PDFRawStream,PDFDict,decodePDFRawStream}=PDFLib;
const context={PDFLib,Uint8Array,DataView,Number,Error,TextEncoder,crypto,Date,Math};vm.createContext(context);vm.runInContext(fs.readFileSync('src/core.js','utf8'),context);const core=context.PrintCore;
async function ghostscript(pdf,icc,compatibility){let output;const self={postMessage:m=>output=m},worker={self,GhostscriptModule,WebAssembly};vm.createContext(worker);vm.runInContext(fs.readFileSync('src/worker.js','utf8'),worker);await self.onmessage({data:{wasm:new Uint8Array(fs.readFileSync('vendor/ghostscript.wasm')),pdf,icc,compatibility}});if(output.error)throw new Error(output.error);return output.bytes;}
const black=text=>{const result=core.blackTextContent(Buffer.from(text));return result.used?Buffer.from(result.bytes).toString('latin1'):null;};
const FOGRA39=()=>fs.readFileSync('vendor/profiles/CoatedFOGRA39.icc');
test('pure black text becomes overprinting 100% K, and the RGB black comes back after the text',()=>{
 assert.equal(black('/C1 cs 0 0 0 scn BT (Hi) Tj ET 0 0 5 5 re f'),'/C1 cs 0 0 0 scn BT /OPKOn gs 0 0 0 1 k (Hi) Tj ET\n/OPKOff gs /C1 cs 0 0 0 scn\n 0 0 5 5 re f');
 assert.equal(black('0 0 0 rg BT [(A) 10 (B)] TJ ET'),'0 0 0 rg BT /OPKOn gs 0 0 0 1 k [(A) 10 (B)] TJ ET\n/OPKOff gs 0 0 0 rg\n');
});
test('only pure black text changes: grey text, black shapes, other colours and strings that look like operators stay as they are',()=>{
 for(const source of ['/C1 cs 0.2 0.2 0.2 scn BT (Hi) Tj ET','/C1 cs 0 0 0 scn 0 0 5 5 re f','0 0 0 1 k BT (Hi) Tj ET','0 g BT (Hi) Tj ET','1 0 0 rg BT (0 0 0 rg BT \\(x\\) Tj) Tj ET','BI /W 1 /H 1 ID x EI 0 0 0 rg BT (a) Tj ET'])assert.equal(black(source),null,source);
});
test('a colour change inside the text turns overprint off and restores its colour space',()=>{
 assert.equal(black('/C1 cs 0 0 0 scn BT (A) Tj 1 0 0 scn (B) Tj ET'),'/C1 cs 0 0 0 scn BT /OPKOn gs 0 0 0 1 k (A) Tj /OPKOff gs /C1 cs 1 0 0 scn (B) Tj ET');
 assert.equal(black('q 0 0 0 rg Q BT (A) Tj ET'),null,'Q restores the earlier colour');
});
test('through Ghostscript, black text is K only and overprints while black shapes and soft masks keep rich black',async()=>{
 const doc=await PDFDocument.create(),page=doc.addPage([200,100]),font=await doc.embedFont(PDFLib.StandardFonts.Helvetica);
 const mask=doc.context.register(PDFRawStream.of(doc.context.obj({Type:'XObject',Subtype:'Form',BBox:[0,0,200,100],Group:{Type:'Group',S:'Transparency',CS:'DeviceRGB'},Resources:{Font:{F1:font.ref}}}),Buffer.from('0 0 0 rg BT /F1 12 Tf 10 10 Td (M) Tj ET')));
 page.node.set(PDFName.of('Resources'),doc.context.obj({Font:{F1:font.ref},ExtGState:{M:doc.context.obj({Type:'ExtGState',SMask:{Type:'Mask',S:'Luminosity',G:mask}})}}));
 page.node.set(PDFName.of('Contents'),doc.context.register(PDFRawStream.of(doc.context.obj({}),Buffer.from('0 0 0 rg BT /F1 12 Tf 10 70 Td (Black) Tj ET 0 0 50 50 re f'))));
 core.blackText(doc);assert.equal(Buffer.from(decodePDFRawStream(mask instanceof PDFRawStream?mask:doc.context.lookup(mask)).decode()).toString(),'0 0 0 rg BT /F1 12 Tf 10 10 Td (M) Tj ET');
 const out=await PDFDocument.load(await ghostscript(await doc.save(),FOGRA39()));let text='';
 for(const [,o] of out.context.enumerateIndirectObjects())if(o instanceof PDFRawStream&&!o.dict.get(PDFName.of('Subtype'))&&!o.dict.get(PDFName.of('N')))text+=Buffer.from(decodePDFRawStream(o).decode()).toString('latin1');
 assert.match(text,/\/R\d+ gs\n0 0 0 1 k\n/);assert.match(text,/0\.89 0\.784 0\.616 0\.969 k/,'the shape stays rich black');
 const states=[...out.context.enumerateIndirectObjects()].map(([,o])=>o).filter(o=>o instanceof PDFDict&&o.get(PDFName.of('Type'))===PDFName.of('ExtGState'));
 assert(states.some(s=>s.get(PDFName.of('op'))===PDFLib.PDFBool.True&&s.get(PDFName.of('OPM')).asNumber()===1));
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
