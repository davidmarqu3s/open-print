// Synthetic large-image workload; measures pdf-lib preparation, not Figma rendering or native saves.
// Run: node scripts/benchmark-pdf-preparation.cjs
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),vm=require('node:vm'),crypto=require('node:crypto'),assert=require('node:assert/strict'),{execFileSync}=require('node:child_process');
const root=path.resolve(__dirname,'..'),PDFLib=require(path.join(root,'vendor/pdf-lib.min.js'));
const context={PDFLib,Uint8Array,TextEncoder,TextDecoder};vm.createContext(context);vm.runInContext(fs.readFileSync(path.join(root,'src/core.js'),'utf8'),context);
const core=context.PrintCore,pt=mm=>mm*72/25.4,MiB=bytes=>Math.round(bytes/2**20);
async function fixture(){
 const doc=await PDFLib.PDFDocument.create();
 for(let i=0;i<3;i++){
  const page=doc.addPage([pt(594),pt(841)]),data=crypto.randomBytes(24*1024*1024);
  const image=doc.context.register(PDFLib.PDFRawStream.of(doc.context.obj({Type:'XObject',Subtype:'Image',Width:6144,Height:4096,ColorSpace:'DeviceGray',BitsPerComponent:8,Length:data.length}),data));
  page.node.set(PDFLib.PDFName.of('Resources'),doc.context.obj({XObject:{Im1:image}}));
  page.pushOperators(PDFLib.pushGraphicsState(),PDFLib.concatTransformationMatrix(page.getWidth(),0,0,page.getHeight(),0,0),PDFLib.drawObject('Im1'),PDFLib.popGraphicsState());
 }
 return doc.save();
}
async function measure(mode,file){
 const bytes=fs.readFileSync(file);global.gc();const started=performance.now(),outputs=[];
 let sampledRss=process.memoryUsage().rss,sampledBuffers=process.memoryUsage().arrayBuffers;
 const converted=await PDFLib.PDFDocument.load(bytes);
 for(let i=0;i<converted.getPageCount();i++){
  const single=await PDFLib.PDFDocument.create(),[page]=await single.copyPages(converted,[i]);single.addPage(page);
  const args=[null,null,null,'',[{width:594,height:841}],{rgb:true}];
  outputs.push(mode==='before'?await core.finish(await single.save(),...args):await core.finishDocument(single,...args));
  const memory=process.memoryUsage();sampledRss=Math.max(sampledRss,memory.rss);sampledBuffers=Math.max(sampledBuffers,memory.arrayBuffers);
 }
 const ms=Math.round(performance.now()-started),signatures=[],outputBytes=outputs.reduce((n,b)=>n+b.length,0);
 for(const output of outputs){
  const doc=await PDFLib.PDFDocument.load(output),page=doc.getPage(0),image=page.node.Resources().lookup(PDFLib.PDFName.of('XObject')).lookup(PDFLib.PDFName.of('Im1'));
  signatures.push({pages:doc.getPageCount(),media:page.getMediaBox(),trim:page.getTrimBox(),bleed:page.getBleedBox(),image:crypto.createHash('sha256').update(image.contents).digest('hex'),width:image.dict.lookup(PDFLib.PDFName.of('Width')).asNumber(),height:image.dict.lookup(PDFLib.PDFName.of('Height')).asNumber(),content:crypto.createHash('sha256').update(Buffer.concat(page.node.Contents().asArray().map(ref=>Buffer.from(PDFLib.decodePDFRawStream(doc.context.lookup(ref)).decode())))).digest('hex')});
 }
 return {mode,ms,outputBytes,sampledRssMiB:MiB(sampledRss),sampledArrayBuffersMiB:MiB(sampledBuffers),outputs:signatures};
}
(async()=>{
 if(process.argv[2]==='before'||process.argv[2]==='after'){console.log(JSON.stringify(await measure(process.argv[2],process.argv[3])));return;}
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'open-print-benchmark-')),file=path.join(dir,'three-posters.pdf');
 try{
  fs.writeFileSync(file,await fixture());const runs=[];
  // Fresh processes and the same fixture; serial execution avoids CPU/memory contention.
  for(let i=0;i<3;i++)for(const mode of ['before','after'])runs.push(JSON.parse(execFileSync(process.execPath,['--expose-gc',__filename,mode,file],{encoding:'utf8'})));
  for(const run of runs)assert.deepEqual(run.outputs,runs[0].outputs,'image/content hashes, dimensions and page boxes must match');
  const median=values=>values.sort((a,b)=>a-b)[Math.floor(values.length/2)];
  const summary={};for(const mode of ['before','after']){const group=runs.filter(r=>r.mode===mode);summary[mode]={medianMs:median(group.map(r=>r.ms)),medianSampledRssMiB:median(group.map(r=>r.sampledRssMiB)),medianSampledArrayBuffersMiB:median(group.map(r=>r.sampledArrayBuffersMiB))};}
  console.log(JSON.stringify({inputMiB:fs.statSync(file).size/2**20,verifiedIdenticalImagesContentAndPageBoxes:true,summary,runs:runs.map(({outputs,...metrics})=>metrics)},null,2));
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
})().catch(error=>{console.error(error);process.exitCode=1;});
