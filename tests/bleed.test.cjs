const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');const PDFLib=require('../vendor/pdf-lib.min.js');
// A minimal Figma node: children, plugin data and the properties showBleed and the bleed export touch.
function node(props={}){
 const data={},n={removed:false,children:[],fills:[],strokes:[],x:0,y:0,width:0,height:0,clipsContent:true,locked:false,...props,
  getPluginData:key=>data[key]||'',setPluginData:(key,value)=>{data[key]=value;},
  insertChild(i,child){child.parent=n;n.children.splice(i,0,child);},
  appendChild(child){if(child.parent)child.parent.children=child.parent.children.filter(c=>c!==child);child.parent=n;n.children.push(child);},
  resize(w,h){n.width=w;n.height=h;},
  remove(){n.removed=true;if(n.parent)n.parent.children=n.parent.children.filter(c=>c!==n);}};
 return n;
}
function controller(frames){
 const messages=[],page=node(),log={exported:[]};
 for(const f of frames)page.appendChild(f);
 const figma={showUI(){},on(){},currentPage:Object.assign(page,{selection:frames}),getNodeByIdAsync:async id=>frames.find(f=>f.id===id),ui:{postMessage:m=>messages.push(m)},
  createRectangle:()=>node({type:'RECTANGLE'}),createFrame:()=>node({type:'FRAME',fills:[{type:'SOLID'}],exportAsync:async function(){log.exported.push(this);return new Uint8Array([3]);}})};
 const context={figma,__html__:'',Set,setTimeout};vm.createContext(context);vm.runInContext(fs.readFileSync('src/controller.js','utf8'),context);return {figma,messages,log,page};
}
const plain=v=>JSON.parse(JSON.stringify(v));
const RED={type:'SOLID',color:{r:1,g:0,b:0}};
function poster(){
 const photo=node({type:'RECTANGLE',name:'Photo'}),frame=node({id:'1',type:'FRAME',name:'Poster',width:595,height:842,fills:[RED],children:[]});
 frame.appendChild(photo);
 frame.exportAsync=async()=>new Uint8Array([1]);
 frame.clone=()=>{const copy=node({type:'FRAME',width:frame.width,height:frame.height,fills:frame.fills,clipsContent:frame.clipsContent});for(const child of frame.children){const c=node({...child,children:[],strokes:[...child.strokes]});for(const key of ['open-print-bleed'])if(child.getPluginData(key))c.setPluginData(key,child.getPluginData(key));copy.appendChild(c);}return copy;};
 return {frame,photo};
}
test('show bleed moves the background onto a locked layer around the frame and turns clipping off',async()=>{
 const {frame,photo}=poster(),{figma,messages}=controller([frame]);
 await figma.ui.onmessage({type:'show-bleed',ids:['1'],bleed:8.5});
 const layer=frame.children[0];
 assert.equal(layer.name,'Bleed');assert.equal(frame.children[1],photo);
 assert.deepEqual([layer.x,layer.y,layer.width,layer.height],[-8.5,-8.5,612,859]);
 assert.deepEqual(plain(layer.fills),[RED]);assert.deepEqual(plain(frame.fills),[]);assert.equal(frame.clipsContent,false);assert.equal(layer.locked,true);
 assert.deepEqual(plain(layer.dashPattern),[4,4]);assert.equal(layer.strokes.length,1);
 assert.deepEqual(plain(layer.constraints),{horizontal:'STRETCH',vertical:'STRETCH'});
 assert.equal(messages.at(-1).type,'selection');assert.equal(messages.at(-1).frames[0].bleed,8.5);
 // A second Show bleed resizes the same layer.
 await figma.ui.onmessage({type:'show-bleed',ids:['1'],bleed:14.17});
 assert.equal(frame.children.filter(c=>c.name==='Bleed').length,1);assert.equal(frame.children[0].x,-14.17);assert.deepEqual(plain(frame.children[0].fills),[RED]);
});
test('hide bleed puts the background back, removes the layer and restores clipping',async()=>{
 const {frame}=poster(),{figma,messages}=controller([frame]);
 await figma.ui.onmessage({type:'show-bleed',ids:['1'],bleed:8.5});
 const BLUE={type:'SOLID',color:{r:0,g:0,b:1}};frame.children[0].fills=[BLUE];
 await figma.ui.onmessage({type:'hide-bleed',ids:['1']});
 assert.deepEqual(plain(frame.fills),[BLUE]);assert.equal(frame.children.length,1);assert.equal(frame.clipsContent,true);assert.equal(messages.at(-1).frames[0].bleed,0);
});
test('a frame that did not clip keeps not clipping after hide bleed',async()=>{
 const {frame}=poster();frame.clipsContent=false;const {figma}=controller([frame]);
 await figma.ui.onmessage({type:'show-bleed',ids:['1'],bleed:8.5});await figma.ui.onmessage({type:'hide-bleed',ids:['1']});
 assert.equal(frame.clipsContent,false);
});
test('in auto layout the bleed layer is absolutely positioned',async()=>{
 const {frame}=poster();frame.layoutMode='VERTICAL';const {figma}=controller([frame]);
 await figma.ui.onmessage({type:'show-bleed',ids:['1'],bleed:8.5});assert.equal(frame.children[0].layoutPositioning,'ABSOLUTE');
});
test('a frame with bleed exports from a clipping wrapper of trim plus bleed, without the guide outline, and reports its bleed',async()=>{
 const {frame}=poster(),{figma,messages,log,page}=controller([frame]);
 await figma.ui.onmessage({type:'show-bleed',ids:['1'],bleed:8.5});
 await figma.ui.onmessage({type:'export',ids:['1']});
 const msg=messages.at(-1);assert.equal(msg.type,'pdfs',msg.text);assert.deepEqual([...msg.bleeds],[8.5]);
 const wrapper=log.exported[0];assert.deepEqual([wrapper.width,wrapper.height],[612,859]);assert.equal(wrapper.clipsContent,true);assert.deepEqual(plain(wrapper.fills),[]);
 const copy=wrapper.children[0];assert.deepEqual([copy.x,copy.y],[8.5,8.5]);assert.deepEqual(plain(copy.children[0].strokes),[]);
 assert.equal(wrapper.removed,true);assert.equal(page.children.length,1);
 // The original keeps its guide.
 assert.equal(frame.children[0].strokes.length,1);
});
test('a frame without bleed exports directly with zero bleed',async()=>{
 const {frame}=poster(),{figma,messages,log}=controller([frame]);
 await figma.ui.onmessage({type:'export',ids:['1']});assert.deepEqual([...messages.at(-1).bleeds],[0]);assert.equal(log.exported.length,0);
});
function core(){const ctx={PDFLib,Uint8Array,DataView,Number,Error,Math,Object,String};vm.createContext(ctx);vm.runInContext(fs.readFileSync('src/core.js','utf8'),ctx);return ctx.PrintCore;}
const pt=mm=>mm*72/25.4,close=(a,b)=>Math.abs(a-b)<1e-6;
async function exported(bleedMm){const doc=await PDFLib.PDFDocument.create();doc.addPage([pt(210+2*bleedMm),pt(297+2*bleedMm)]).drawRectangle({x:0,y:0,width:10,height:10,color:PDFLib.cmyk(0,0,0,1)});return doc.save();}
const box=b=>[b.x,b.y,b.width,b.height];
test('bleed and crop marks set the PDF boxes around the trim',async()=>{
 const result=await PDFLib.PDFDocument.load(await core().finish(await exported(3),null,null,null,'',[{width:210,height:297}],{bleeds:[3],marks:{offset:3,length:5,weight:0.25}}));
 const page=result.getPage(0),m=pt(8),b=pt(3);
 for(const [actual,expected] of [[box(page.getMediaBox()),[0,0,pt(210)+2*m,pt(297)+2*m]],[box(page.getTrimBox()),[m,m,pt(210),pt(297)]],[box(page.getBleedBox()),[m-b,m-b,pt(210)+2*b,pt(297)+2*b]]])
  assert(actual.every((v,i)=>close(v,expected[i])),actual+' vs '+expected);
});
test('bleed without marks grows the page by the bleed only',async()=>{
 const page=(await PDFLib.PDFDocument.load(await core().finish(await exported(3),null,null,null,'',[{width:210,height:297}],{bleeds:[3]}))).getPage(0);
 assert(close(page.getWidth(),pt(216)));assert(close(page.getTrimBox().x,pt(3)));
});
test('crop marks are eight Registration lines outside the bleed, in their own stream',async()=>{
 const result=await PDFLib.PDFDocument.load(await core().finish(await exported(3),null,null,null,'',[{width:210,height:297}],{bleeds:[3],marks:{offset:3,length:5,weight:0.25}}));
 const page=result.getPage(0),streams=page.node.Contents().asArray().map(ref=>Buffer.from(PDFLib.decodePDFRawStream(result.context.lookup(ref)).decode()).toString());
 const marks=streams.at(-1);assert.match(marks,/^q\n\/OPRegistration CS\n1 SCN\n0.25 w/);assert.equal((marks.match(/ l\n/g)||[]).length,8);
 const space=page.node.Resources().lookup(PDFLib.PDFName.of('ColorSpace')).lookup(PDFLib.PDFName.of('OPRegistration'));
 assert.equal(space.lookup(0).toString(),'/Separation');assert.equal(space.lookup(1).toString(),'/All');
 // Marks run from the page edge to the bleed edge, along the trim lines.
 const m=pt(8);assert(marks.includes('0 '+m+' l'));
});
test('marks may not sit inside the bleed',()=>{
 const c=core();assert.match(c.marksProblem({offset:2,length:5,weight:0.25},3),/at least the bleed \(3 mm\)/);assert.equal(c.marksProblem({offset:3,length:5,weight:0.25},3),'');assert.match(c.marksProblem({offset:3,length:1,weight:0.25},0),/Length/);
});
test('a custom page size fits the artwork, centred, and clips it to its trim plus the scaled bleed',async()=>{
 const P=core(),fit=P.fit({width:210,height:297},{width:105,height:200});assert.equal(fit.scale,0.5);assert(close(fit.dx,0));assert(close(fit.dy,25.75));
 // The UI scales the merged page before finishing, as it does here.
 const source=await PDFLib.PDFDocument.load(await exported(3));source.getPage(0).scale(0.5,0.5);
 const result=await PDFLib.PDFDocument.load(await P.finish(await source.save(),null,null,null,'',[{width:105,height:200}],{bleeds:[3],fits:[fit]}));
 const page=result.getPage(0),b=pt(1.5);
 for(const [actual,expected] of [[box(page.getMediaBox()),[0,0,pt(105)+2*b,pt(200)+2*b]],[box(page.getTrimBox()),[b,b,pt(105),pt(200)]],[box(page.getBleedBox()),[0,0,pt(105)+2*b,pt(200)+2*b]]])
  assert(actual.every((v,i)=>close(v,expected[i])),actual+' vs '+expected);
 const first=Buffer.from(PDFLib.decodePDFRawStream(result.context.lookup(page.node.Contents().asArray()[0])).decode()).toString();
 const [x,y,w,h]=first.match(/([\d.-]+) ([\d.-]+) ([\d.-]+) ([\d.-]+) re/).slice(1).map(Number);
 assert(close(x,0));assert(Math.abs(y-pt(25.75))<1e-3);assert(Math.abs(w-pt(108))<1e-3);assert(Math.abs(h-pt(151.5))<1e-3);assert.match(first,/W\nn/);
});
test('scaling down blocks bleed that would end up under 3 mm',()=>{
 const P=core();assert.equal(P.scaledBleedProblem(3,0.707),'Scaling to 71% leaves 2.1 mm of bleed.');assert.equal(P.scaledBleedProblem(4.3,0.707),'');assert.equal(P.scaledBleedProblem(3,1.41),'');assert.equal(P.scaledBleedProblem(0,0.5),'');assert.equal(P.scaledBleedProblem(2,0.7),'Scaling to 70% leaves 1.4 mm of bleed.');assert.equal(P.scaledBleedProblem(Math.ceil(3/0.7*10)/10,0.7),'');assert.equal(P.scaledBleed(3,1.41),3);
});
