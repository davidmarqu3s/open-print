const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),os=require('node:os'),path=require('node:path'),{execFileSync}=require('node:child_process');
const GhostscriptModule=require('../vendor/ghostscript.js');const PDFLib=require('../vendor/pdf-lib.min.js');const {PDFDocument,PDFName,PDFRawStream}=PDFLib;
const context={PDFLib,Uint8Array,DataView,Number,Error,TextEncoder,crypto,Date,Math};vm.createContext(context);vm.runInContext(fs.readFileSync('src/core.js','utf8'),context);const core=context.PrintCore;
async function ghostscript(pdf,icc,compatibility){let output;const self={postMessage:m=>output=m},worker={self,GhostscriptModule,WebAssembly};vm.createContext(worker);vm.runInContext(fs.readFileSync('src/worker.js','utf8'),worker);await self.onmessage({data:{wasm:new Uint8Array(fs.readFileSync('vendor/ghostscript.wasm')),pdf,icc,compatibility}});if(output.error)throw new Error(output.error);return output.bytes;}
const FOGRA39=()=>fs.readFileSync('vendor/profiles/CoatedFOGRA39.icc'),pt=mm=>mm*72/25.4;
// A page like Figma's A4 export with 3 mm bleed: a purple background, and a card painted through a soft mask, as Figma does for rounded clipping.
async function figmaA4(){
 const doc=await PDFDocument.create(),w=pt(216),h=pt(303),page=doc.addPage([w,h]);
 const mask=doc.context.register(PDFRawStream.of(doc.context.obj({Type:'XObject',Subtype:'Form',BBox:[0,0,w,h],Group:{Type:'Group',S:'Transparency'}}),Buffer.from(`1 g 40 40 ${w-80} ${h-80} re f`)));
 page.node.set(PDFName.of('Resources'),doc.context.obj({ExtGState:{M:doc.context.obj({Type:'ExtGState',SMask:{Type:'Mask',S:'Alpha',G:mask}})}}));
 page.node.set(PDFName.of('Contents'),doc.context.register(PDFRawStream.of(doc.context.obj({}),Buffer.from(`0.4 0.2 0.6 rg 0 0 ${w} ${h} re f q /M gs 0.9 0.8 0.95 rg 0 0 ${w} ${h} re f Q`))));
 return doc.save();
}
// Renders page 1 with poppler, as a viewer would, and returns the share of near-white pixels inside the trim.
function blankShare(pdf,trim){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'render-')),file=path.join(dir,'out.pdf');fs.writeFileSync(file,pdf);
 const ppm=execFileSync('pdftoppm',['-r','12','-f','1','-l','1',file],{maxBuffer:1<<26});fs.rmSync(dir,{recursive:true,force:true});
 const header=ppm.toString('latin1',0,40).match(/^P6\s+(\d+)\s+(\d+)\s+255\s/),[width,height]=[Number(header[1]),Number(header[2])],data=ppm.subarray(header[0].length);
 const s=12/72,[x0,y0,x1,y1]=[Math.ceil(trim.x*s),Math.ceil(trim.y*s),Math.floor((trim.x+trim.width)*s),Math.floor((trim.y+trim.height)*s)];let white=0,total=0;
 for(let y=height-y1;y<height-y0;y++)for(let x=x0;x<x1;x++){const i=(y*width+x)*3;total++;if(data[i]>235&&data[i+1]>235&&data[i+2]>235)white++;}
 return white/total;
}
async function exportA4(options,pageSizes=null){
 // Like the UI, a page for another size is scaled before finishing.
 let bytes=await ghostscript(await figmaA4(),FOGRA39(),'1.6');const scale=options.fits?options.fits[0].scale:1;
 if(scale!==1){const source=await PDFDocument.load(bytes);source.getPage(0).scale(scale,scale);bytes=await source.save();}
 const finished=await core.finish(bytes,FOGRA39(),pageSizes?null:210,pageSizes?null:297,'Coated FOGRA39',pageSizes,{bleeds:[3],marks:{offset:3,length:5,weight:0.25},...options});
 const doc=await PDFDocument.load(finished),box=doc.getPage(0).getTrimBox();return {finished,trim:box};
}
test('a finished export renders in a real viewer with the artwork filling its trim',async()=>{
 const {finished,trim}=await exportA4({});assert(Math.abs(trim.width-pt(210))<0.01);
 assert.equal(blankShare(finished,trim),0,'no white inside the trim');
});
test('a finished export scaled to another page size still renders its artwork across the trim',async()=>{
 const fit=core.fit({width:210,height:297},{width:148,height:210});
 const {finished,trim}=await exportA4({fits:[fit]},[{width:148,height:210}]);
 // The A4 artwork fits A5 almost exactly, so at most a thin sliver at the top and bottom is empty.
 assert(blankShare(finished,trim)<0.03,'artwork fills the A5 trim');
});
