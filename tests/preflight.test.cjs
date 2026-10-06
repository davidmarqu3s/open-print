const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
function controller(nodes,images={}){const messages=[];const figma={showUI(){},on(){},currentPage:{selection:nodes},getNodeByIdAsync:async id=>nodes.find(n=>n.id===id),getImageByHash:hash=>images[hash]?{getSizeAsync:async()=>images[hash]}:null,ui:{postMessage:m=>messages.push(m)}};const context={figma,__html__:'',Set,Map,setTimeout,clearTimeout};vm.createContext(context);vm.runInContext(fs.readFileSync('src/controller.js','utf8'),context);return {figma,messages};}
const box=(x,y,width,height)=>({x,y,width,height});
// An A4-sized frame at the origin, with layers placed in frame units.
function sheet(children,props={}){for(const c of children){c.absoluteBoundingBox=c.absoluteBoundingBox||box(c.x,c.y,c.width,c.height);}return {id:'1',type:'FRAME',name:'Sheet',width:595,height:842,absoluteBoundingBox:box(0,0,595,842),fills:[{type:'SOLID',color:{r:1,g:1,b:1}}],children,...props};}
const findings=async(frame,images)=>{const {figma,messages}=controller([frame],images);await figma.ui.onmessage({type:'ready'});const msg=messages.findLast(m=>m.type==='preflight');assert(msg,'preflight posted');return JSON.parse(JSON.stringify(msg.frames[0].findings));};
test('preflight measures image resolution at frame size for fill, fit, crop and tile',async()=>{
 const image=(id,fill,w=100,h=100)=>({id,type:'RECTANGLE',name:'Photo '+id,x:100,y:100,width:w,height:h,fills:[{type:'IMAGE',imageHash:'h',...fill}]});
 const list=await findings(sheet([image('a',{scaleMode:'FILL'}),image('b',{scaleMode:'FIT'},100,50),image('c',{scaleMode:'CROP',imageTransform:[[0.5,0,0],[0,0.5,0]]}),image('d',{scaleMode:'TILE',scalingFactor:0.5})]),{h:{width:200,height:400}});
 const ppi=Object.fromEntries(list.filter(f=>f.kind==='image').map(f=>[f.name,f.ppi]));
 // 200 × 400 px filling 100 × 100 pt: width decides, 2 px per pt. Cropping to half the image doubles its size, so 1 px per pt.
 assert.equal(ppi['Photo a'],144);assert.equal(ppi['Photo b'],576);assert.equal(ppi['Photo c'],72);assert.equal(ppi['Photo d'],144);
});
test('preflight reports text size, black, and distance to the edge',async()=>{
 const text={id:'5',type:'TEXT',name:'Caption',x:4,y:300,width:100,height:10,getStyledTextSegments:()=>[{fontSize:5,fills:[{type:'SOLID',color:{r:0.05,g:0.05,b:0.05}}]},{fontSize:9,fills:[{type:'SOLID',color:{r:0,g:0,b:0}}]}]};
 const [f]=(await findings(sheet([text]))).filter(f=>f.kind==='text');
 assert.equal(f.size,5);assert.equal(f.rich,5);assert.equal(f.pure,9);assert.equal(f.gap,4);assert.equal('missingFont' in f,false);
});
test('artwork touching the edge of a frame without bleed needs bleed, and the bleed and trim layers are skipped',async()=>{
 const photo={id:'7',type:'RECTANGLE',name:'Background photo',x:0,y:0,width:595,height:400,fills:[]};
 assert.deepEqual((await findings(sheet([photo]))).filter(f=>f.kind==='bleed').map(f=>f.name),['Background photo']);
 const inset={id:'8',type:'RECTANGLE',name:'Box',x:50,y:50,width:100,height:100,fills:[]};
 assert.equal((await findings(sheet([inset]))).filter(f=>f.kind==='bleed').length,0);
 assert.deepEqual((await findings(sheet([inset],{fills:[{type:'SOLID',color:{r:1,g:0.8,b:0}}]}))).filter(f=>f.kind==='bleed').map(f=>f.name),['Sheet']);
 const bleed={id:'2',type:'RECTANGLE',name:'Bleed',x:-9,y:-9,width:613,height:860,strokes:[{type:'SOLID',color:{r:1,g:0,b:0}}],strokeWeight:1,getPluginData:k=>k==='open-print-bleed'?'8.5':''};
 const trim={id:'3',type:'RECTANGLE',name:'Trim',x:0,y:0,width:595,height:842,strokes:[{type:'SOLID',color:{r:1,g:0,b:0}}],strokeWeight:1,getPluginData:k=>k==='open-print-trim'?'true':''};
 const list=await findings(sheet([bleed,photo,trim],{fills:[]}));
 assert.equal(list.filter(f=>f.kind==='bleed').length,0,'a frame with bleed is fine');assert.equal(list.filter(f=>f.kind==='stroke').length,0,'guide outlines are not hairlines');
});
test('preflight lists thin strokes and unsupported effects, and skips hidden layers',async()=>{
 const line={id:'9',type:'LINE',name:'Rule',x:50,y:50,width:100,height:0,strokes:[{type:'SOLID',color:{r:0,g:0,b:0}}],strokeWeight:0.1};
 const glass={id:'10',type:'RECTANGLE',name:'Glass',x:50,y:60,width:10,height:10,effects:[{type:'GLASS'}]};
 const hidden={id:'11',type:'TEXT',name:'Hidden',visible:false,x:50,y:80,width:10,height:10,fontSize:2};
 const list=await findings(sheet([line,glass,hidden]));
 assert.deepEqual(list.map(f=>f.kind+':'+f.name),['stroke:Rule','effect:Glass']);assert.equal(list[0].weight,0.1);
});
test('preflight runs again once edits settle',async()=>{
 let change;const timers=[],messages=[],nodes=[sheet([])];
 const figma={showUI(){},on(){},currentPage:{selection:nodes,on:(type,fn)=>{change=fn;}},ui:{postMessage:m=>messages.push(m)}};
 const context={figma,__html__:'',Set,Map,setTimeout:fn=>timers.push(fn),clearTimeout(){}};vm.createContext(context);vm.runInContext(fs.readFileSync('src/controller.js','utf8'),context);
 change({nodeChanges:[]});assert.equal(timers.length,1);await timers[0]();await new Promise(resolve=>setImmediate(resolve));
 assert.equal(messages.filter(m=>m.type==='preflight').length,1);
});
