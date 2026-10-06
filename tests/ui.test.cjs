const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');const PDFLib=require('../vendor/pdf-lib.min.js');
function ui(bundled={}){
 const elements={},clicks=[],blobs=new Map(),listeners=new Map(),timers=new Map(),revocations=[];let nextURL=0,nextTimer=0,now=0,focused=true;
 const emit=type=>{focused=type==='focus';for(const fn of [...(listeners.get(type)||[])])fn({type});};
 const runTimers=delay=>{const end=now+delay;for(;;){const next=[...timers].filter(([,t])=>t.at<=end).sort((a,b)=>a[1].at-b[1].at)[0];if(!next)break;timers.delete(next[0]);now=next[1].at;next[1].fn();}now=end;};
 const make=tag=>({tag,children:[],value:'',groups:[],options:[],checked:false,
  get textContent(){return this.children.length?this.children.map(child=>child.textContent||'').join(''):this.text||'';},
  set textContent(value){this.text=value;for(const child of this.children)child.parentNode=null;this.children=[];},
  get isConnected(){return !!this.root||!!(this.parentNode&&this.parentNode.isConnected);},
  remove(){if(this.parentNode)this.parentNode.children=this.parentNode.children.filter(child=>child!==this);this.parentNode=null;},
  replaceChildren(...items){for(const child of this.children)child.parentNode=null;this.children=[];this.append(...items);},
  append(...items){for(const item of items){item.parentNode=this;this.children.push(item);if(item.label)this.groups.push(item);else this.options.push(item);}},
  click(){if(this.onclick)this.onclick({isTrusted:false,preventDefault(){}});clicks.push({element:this,attached:this.isConnected,filename:this.download,href:this.href});}
 });
 const el=id=>elements[id]||(elements[id]=Object.assign(make('div'),{root:true,hidden:id==='size-reset'}));
 const window={addEventListener(type,fn){if(!listeners.has(type))listeners.set(type,new Set());listeners.get(type).add(fn);},removeEventListener(type,fn){listeners.get(type)?.delete(fn);}},messages=[];
 const context={window,setTimeout:(fn,delay)=>{const id=++nextTimer;timers.set(id,{fn,at:now+delay});return id;},clearTimeout:id=>timers.delete(id),document:{hasFocus:()=>focused,getElementById:el,createElement:make,createTextNode:text=>({textContent:text})},parent:{postMessage:x=>messages.push(x.pluginMessage)},PROFILE_CATALOG:JSON.parse(fs.readFileSync('src/profiles.json')),BUNDLED_PROFILES:bundled,OpenPrintAssets:{decodeProfile:encoded=>Uint8Array.from(atob(encoded),c=>c.charCodeAt(0))},atob,btoa,Uint8Array,DataView,Number,Error,TextEncoder,TextDecoder,Blob,URL:{createObjectURL:blob=>{const url='blob:test-'+(++nextURL);blobs.set(url,blob);return url;},revokeObjectURL:url=>{revocations.push({url,listeners:[...listeners.values()].reduce((n,set)=>n+set.size,0),timers:timers.size});blobs.delete(url);}}};
 vm.createContext(context);
 vm.runInContext(fs.readFileSync('vendor/pdf-lib.min.js','utf8'),context);vm.runInContext(fs.readFileSync('src/core.js','utf8'),context);vm.runInContext(fs.readFileSync('src/ui.js','utf8'),context);
 return {window,el,messages,context,clicks,blobs,emit,runTimers,timers,listeners,revocations};
}
const frame=(id,width,height)=>({id,name:'Sheet '+id,type:'FRAME',width,height});
test('manual dimensions stay selected when frames change',async()=>{const {window,el}=ui();await window.onmessage({data:{pluginMessage:{type:'selection',frames:[frame('1',907,1276)]}}});el('width').value='320';el('width').oninput();el('height').value='450';el('height').oninput();await window.onmessage({data:{pluginMessage:{type:'selection',frames:[frame('2',595,842)]}}});assert.equal(el('size-reset').hidden,false);assert.equal(el('width').value,'320');assert.equal(el('height').value,'450');});
test('automatic dimensions update when selection changes',async()=>{const {window,el}=ui();await window.onmessage({data:{pluginMessage:{type:'selection',frames:[frame('1',907,1276)]}}});assert.equal(el('width').value,319.97);await window.onmessage({data:{pluginMessage:{type:'selection',frames:[frame('2',595,842)]}}});assert.equal(el('width').value,209.9);assert.equal(el('height').value,297.04);});
test('all 15 official profiles are available even without bundled ICC files',()=>{const {el}=ui();assert.equal(el('profile-mode').groups.length,3);assert.equal(el('profile-mode').groups.flatMap(g=>g.options).length,15);});
test('missing preset asks for import and blocks export',async()=>{const {window,el}=ui();await window.onmessage({data:{pluginMessage:{type:'selection',frames:[frame('1',595,842)]}}});el('profile-mode').value='PSOcoated_v3';el('profile-mode').onchange();assert.equal(el('custom-profile').hidden,false);assert.equal(el('export').disabled,true);assert.match(el('export-hint').textContent,/Import PSO Coated v3/);});
function icc(name){const bytes=Buffer.alloc(156+name.length+1);bytes.writeUInt32BE(bytes.length);bytes.write('CMYK',16);bytes.write('acsp',36);bytes.writeUInt32BE(1,128);bytes.write('desc',132);bytes.writeUInt32BE(144,136);bytes.writeUInt32BE(12+name.length+1,140);bytes.write('desc',144);bytes.writeUInt32BE(name.length+1,152);bytes.write(name,156);return bytes;}
test('named ICC imports are saved and restored with the official name',async()=>{const {window,el,messages}=ui();await window.onmessage({data:{pluginMessage:{type:'selection',frames:[frame('1',595,842)]}}});el('profile-mode').value='PSOcoated_v3';el('profile-mode').onchange();const bytes=icc('PSO Coated v3');await el('profile').onchange({target:{files:[{name:'profile.icc',size:bytes.length,arrayBuffer:async()=>bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength)}]}});assert.equal(el('custom-profile').hidden,true);assert.equal(el('export').disabled,false);const saved=messages.find(m=>m.type==='save-profile');assert.equal(saved.id,'PSOcoated_v3');const next=ui();next.el('profile-mode').value=saved.id;next.el('profile-mode').onchange();await next.window.onmessage({data:{pluginMessage:{type:'profiles',profiles:{[saved.id]:saved.encoded}}}});assert.equal(next.el('custom-profile').hidden,true);});
test('wrong ICC cannot be imported under a named preset',async()=>{const {el,messages}=ui();el('profile-mode').value='PSOcoated_v3';el('profile-mode').onchange();const bytes=icc('Different CMYK');await el('profile').onchange({target:{files:[{name:'wrong.icc',size:bytes.length,arrayBuffer:async()=>bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength)}]}});assert.match(el('status').textContent,/This file contains Different CMYK/);assert.equal(el('export').disabled,true);assert(!messages.some(m=>m.type==='save-profile'));});
test('storage response arriving during an import does not discard the import',async()=>{const {window,el,messages}=ui();el('profile-mode').value='PSOcoated_v3';el('profile-mode').onchange();const bytes=icc('PSO Coated v3');let release;const pending=el('profile').onchange({target:{files:[{name:'profile.icc',size:bytes.length,arrayBuffer:()=>new Promise(resolve=>release=resolve)}]}});await window.onmessage({data:{pluginMessage:{type:'profiles',profiles:{}}}});release(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength));await pending;assert(messages.some(m=>m.type==='save-profile'));});
test('reset to frame size restores the inferred size after manual edits',async()=>{const {window,el}=ui();await window.onmessage({data:{pluginMessage:{type:'selection',frames:[frame('1',907,1276)]}}});assert.equal(el('size-reset').hidden,true);el('width').value='320';el('width').oninput();assert.equal(el('size-reset').hidden,false);el('size-reset').onclick();assert.equal(el('size-reset').hidden,true);assert.equal(el('width').value,319.97);assert.equal(el('height').value,450.14);});
test('unit switching converts manual dimensions without accumulating rounding',async()=>{const {window,el}=ui();await window.onmessage({data:{pluginMessage:{type:'selection',frames:[frame('1',907,1276)]}}});el('width').value='320';el('width').oninput();el('height').value='450';el('height').oninput();for(let i=0;i<5;i++){el('units').value='in';el('units').onchange();assert(Math.abs(Number(el('width').value)-320/25.4)<0.000001);el('units').value='mm';el('units').onchange();assert.equal(Number(el('width').value),320);assert.equal(Number(el('height').value),450);}assert.equal(el('size-reset').hidden,false);});
test('inch input exports exact physical dimensions in mm',async()=>{const {window,el,context}=ui();await window.onmessage({data:{pluginMessage:{type:'selection',frames:[frame('1',595,842)]}}});el('units').value='in';el('units').onchange();el('width').value='8.5';el('width').oninput();el('height').value='11';el('height').oninput();el('export').onclick();const job=vm.runInContext('job',context);assert(Math.abs(job.width-215.9)<1e-10);assert(Math.abs(job.height-279.4)<1e-10);assert.equal(el('units').disabled,true);});
test('automatic and mixed frame sizes keep their physical sizes in inches',async()=>{const {window,el}=ui();await window.onmessage({data:{pluginMessage:{type:'selection',frames:[frame('1',907,1276)]}}});el('units').value='in';el('units').onchange();assert.equal(el('size-reset').hidden,true);assert(Math.abs(Number(el('width').value)-319.97/25.4)<0.000001);await window.onmessage({data:{pluginMessage:{type:'selection',frames:[frame('1',907,1276),frame('2',595,842)]}}});assert.equal(el('width').value,'');assert.equal(el('width').placeholder,'Varies');});
test('non-frame selection explains why export is blocked',async()=>{const {window,el}=ui();await window.onmessage({data:{pluginMessage:{type:'selection',frames:[frame('1',595,842),{id:'2',name:'Rectangle',type:'RECTANGLE',width:10,height:10}]}}});assert.equal(el('export').disabled,true);assert.match(el('export-hint').textContent,/Deselect “Rectangle”/);assert.equal(el('frame-count').textContent,'2 selected');});
test('incomplete manual size blocks export until both dimensions are valid',async()=>{const {window,el}=ui();await window.onmessage({data:{pluginMessage:{type:'selection',frames:[frame('1',907,1276),frame('2',595,842)]}}});assert.equal(el('export').disabled,false);el('width').value='320';el('width').oninput();assert.equal(el('export').disabled,true);assert.match(el('size-error').textContent,/width and height/);assert.equal(el('size-error').className,'hint');el('height').value='5';el('height').oninput();assert.equal(el('export').disabled,true);assert.match(el('size-error').textContent,/between 10 and 2000/);assert.equal(el('height-field').className,'field invalid');assert.equal(el('width-field').className,'field');el('height').value='450';el('height').oninput();assert.equal(el('export').disabled,false);assert.equal(el('size-error').textContent,'');assert.equal(el('height-field').className,'field');});

test('export format is shown only for multiple frames and defaults to a multipage PDF',async()=>{const {window,el}=ui();assert.equal(el('export-mode').value,'combined');assert.equal(el('export-options').hidden,true);await window.onmessage({data:{pluginMessage:{type:'selection',frames:[frame('1',595,842),frame('2',907,1276)]}}});assert.equal(el('export-options').hidden,false);await window.onmessage({data:{pluginMessage:{type:'selection',frames:[frame('1',595,842)]}}});assert.equal(el('export-options').hidden,true);});
test('individual export snapshots filenames and locks the format while exporting',async()=>{const {window,el,context}=ui();await window.onmessage({data:{pluginMessage:{type:'selection',frames:[frame('2',907,1276),frame('1',595,842)]}}});el('export-mode').value='separate';el('export-mode').onchange();el('export').onclick();const current=vm.runInContext('job',context);assert.equal(current.individual,true);assert.deepEqual(Array.from(current.filenames),['Sheet 1.pdf','Sheet 2.pdf']);assert.equal(el('export-mode').disabled,true);await window.onmessage({data:{pluginMessage:{type:'selection',frames:[frame('3',300,400)]}}});assert.deepEqual(Array.from(current.filenames),['Sheet 1.pdf','Sheet 2.pdf']);});
test('single frames always export one PDF even if individual mode was selected previously',async()=>{const {window,el,context}=ui();await window.onmessage({data:{pluginMessage:{type:'selection',frames:[frame('1',595,842)]}}});el('export-mode').value='separate';el('export').onclick();assert.equal(vm.runInContext('job.individual',context),false);});
async function convertedPages(){const doc=await PDFLib.PDFDocument.create();for(const size of [[595,842],[907,1276]])doc.addPage(size).drawRectangle({x:12,y:34,width:100,height:50,color:PDFLib.cmyk(.1,.2,.3,.4)});return doc.save();}
async function inspectOutput(bytes,expectedSizes,expectedICC){const result=await PDFLib.PDFDocument.load(bytes);assert.equal(result.getPageCount(),expectedSizes.length);for(let i=0;i<expectedSizes.length;i++){const page=result.getPage(i);assert.equal(page.getWidth(),expectedSizes[i].width*72/25.4);assert.equal(page.getHeight(),expectedSizes[i].height*72/25.4);const text=page.node.Contents().asArray().map(ref=>Buffer.from(PDFLib.decodePDFRawStream(result.context.lookup(ref)).decode()).toString()).join('\n');assert.match(text,/0\.1 0\.2 0\.3 0\.4 k/);assert.match(text,/100/);assert.match(text,/50/);assert(!text.includes(' rg'));}if(expectedICC){const intent=result.catalog.lookup(PDFLib.PDFName.of('OutputIntents'),PDFLib.PDFArray).lookup(0,PDFLib.PDFDict);const embedded=intent.lookup(PDFLib.PDFName.of('DestOutputProfile'),PDFLib.PDFRawStream);assert.equal(embedded.dict.lookup(PDFLib.PDFName.of('N'),PDFLib.PDFNumber).asNumber(),4);assert.deepEqual(Buffer.from(PDFLib.decodePDFRawStream(embedded).decode()),expectedICC);}else assert.equal(result.catalog.get(PDFLib.PDFName.of('OutputIntents')),undefined);}
function exportFixture(){return {individual:true,filename:'Sheet 1.pdf',filenames:['Sheet 1.pdf','Sheet 2.pdf'],width:null,height:null,auto:true,sizes:[{width:209.9,height:297.04},{width:319.97,height:450.14}],icc:fs.readFileSync('vendor/profiles/CoatedFOGRA39.icc'),name:'Coated FOGRA39 (ISO 12647-2:2004)'};}
test('individual PDFs retain vectors, exact embedded ICC and each frame’s automatic size',async()=>{const {context}=ui(),current=exportFixture();const downloads=await context.prepareDownloads(await convertedPages(),current);assert.deepEqual(Array.from(downloads,d=>d.filename),current.filenames);for(let i=0;i<downloads.length;i++)await inspectOutput(downloads[i].bytes,[current.sizes[i]],current.icc);});
test('individual PDFs apply a manual print size to every file without a profile',async()=>{const {context}=ui(),current={...exportFixture(),auto:false,sizes:null,width:320,height:450,icc:null,name:''};const downloads=await context.prepareDownloads(await convertedPages(),current);assert.equal(downloads.length,2);for(const output of downloads)await inspectOutput(output.bytes,[{width:320,height:450}],null);});
test('combined format keeps both pages in one PDF with the first frame filename',async()=>{const {context}=ui(),current={...exportFixture(),individual:false};const downloads=await context.prepareDownloads(await convertedPages(),current);assert.equal(downloads.length,1);assert.equal(downloads[0].filename,'Sheet 1.pdf');await inspectOutput(downloads[0].bytes,current.sizes,current.icc);});
test('individual exports reject a converted PDF with a different frame count',async()=>{const {context}=ui(),current=exportFixture();current.filenames.push('Sheet 3.pdf');const bytes=await convertedPages();await assert.rejects(()=>context.prepareDownloads(bytes,current),/count|match/i);});

const sampleDownloads=()=>[{filename:'Álvaro name tag.pdf',bytes:new Uint8Array([37,80,68,70,1])},{filename:'Sheet 2.pdf',bytes:new Uint8Array([37,80,68,70,2])}];
const anchors=node=>[...(node.tag==='a'?[node]:[]),...(node.children||[]).flatMap(anchors)];
test('individual PDFs keep every duplicate and colliding filename as a separate PDF',async()=>{
 const {context,el,blobs}=ui();const names=['Sheet.pdf','Sheet.pdf','Sheet (2).pdf','sheet.pdf','../Label/Tag.pdf'];
 const outputs=names.map((filename,i)=>({filename,bytes:new Uint8Array([i])}));context.showDownloads(outputs);
 const links=anchors(el('status'));assert.equal(links.length,names.length);assert(links.every(link=>!/[\\/]/.test(link.download)));
 assert.deepEqual(links.map(link=>link.download),['Sheet.pdf','Sheet (2).pdf','Sheet (2) (2).pdf','sheet (3).pdf','.._Label_Tag.pdf']);
 for(let i=0;i<links.length;i++){const blob=blobs.get(links[i].href);assert.equal(blob.type,'application/pdf');assert.equal(new Uint8Array(await blob.arrayBuffer())[0],i);}
 assert.equal(new Set(links.map(link=>link.download.toLowerCase())).size,names.length);
 context.stopDownloadQueue();
});
test('single PDF delivery mounts its original filename link before its only automatic click',async()=>{
 const {context,clicks,blobs}=ui(),output=sampleDownloads()[0];context.showDownloads([output]);
 assert.equal(clicks.length,1);assert.equal(clicks[0].attached,true);assert.equal(clicks[0].filename,output.filename);
 const blob=blobs.get(clicks[0].href);assert.equal(blob.type,'application/pdf');assert.deepEqual(Buffer.from(await blob.arrayBuffer()),Buffer.from(output.bytes));
});

const threeDownloads=()=>[...sampleDownloads(),{filename:'Sheet 3.pdf',bytes:new Uint8Array([37,80,68,70,3])}];
const pdfClicks=h=>h.clicks.filter(click=>/\.pdf$/i.test(click.filename));
const listenerCount=h=>[...h.listeners.values()].reduce((sum,set)=>sum+set.size,0);
test('consecutive delivery clicks attached original files only after a paired blur and focus',()=>{
 const h=ui(),outputs=threeDownloads();h.context.showDownloads(outputs);
 assert.equal(pdfClicks(h).length,1);assert.equal(pdfClicks(h)[0].attached,true);assert.equal(pdfClicks(h)[0].filename,outputs[0].filename);
 assert.match(h.el('status').textContent,/Cancel.*skip/i);
 h.emit('focus');h.runTimers(1000);assert.equal(pdfClicks(h).length,1);
 h.emit('blur');h.emit('focus');h.emit('focus');h.runTimers(999);assert.equal(pdfClicks(h).length,1);
 h.runTimers(1);assert.equal(pdfClicks(h).length,2);assert.equal(pdfClicks(h)[1].filename,outputs[1].filename);
 h.emit('blur');h.emit('focus');h.runTimers(1000);assert.equal(pdfClicks(h).length,3);
 h.emit('blur');h.emit('focus');h.runTimers(1000);assert.equal(pdfClicks(h).length,3);
 assert.equal(listenerCount(h),0);assert.equal(h.timers.size,0);assert.equal(h.messages.at(-1).type,'ready');assert.doesNotMatch(h.el('status').textContent,/PDFs? saved|saved successfully/i);
});
test('stopping consecutive downloads removes timers and listeners without showing download links',()=>{
 const h=ui();h.context.showDownloads(threeDownloads());h.emit('blur');h.emit('focus');
 assert(h.timers.size>0);h.context.stopDownloadQueue();assert.equal(h.timers.size,0);assert.equal(listenerCount(h),0);
 h.emit('blur');h.emit('focus');h.runTimers(5000);assert.equal(pdfClicks(h).length,1);
 assert.equal(anchors(h.el('status')).filter(link=>/\.pdf$/i.test(link.download)).length,3);assert.equal(h.blobs.size,3);assert.equal(h.el('status').children[1].hidden,true);
});
test('consecutive downloads hide the conversion cancel button',()=>{
 const h=ui();h.context.showDownloads(threeDownloads());assert.equal(h.el('cancel').hidden,true);
 h.emit('blur');h.emit('focus');h.runTimers(1000);assert.equal(pdfClicks(h).length,2);
 assert.doesNotMatch(h.el('status').textContent,/Stop remaining downloads/i);
});
test('no native save dialog pauses the queue instead of dropping later downloads',()=>{
 const h=ui();h.context.showDownloads(threeDownloads());h.runTimers(3000);
 assert.equal(pdfClicks(h).length,1);assert.match(h.el('status').textContent,/paused|could not detect|didn.t detect/i);
 h.emit('blur');h.emit('focus');h.runTimers(5000);assert.equal(pdfClicks(h).length,1);
 assert.equal(listenerCount(h),0);assert.equal(h.timers.size,0);
});
test('a new export stops delivery before revoking previous download URLs',async()=>{
 const h=ui();await h.window.onmessage({data:{pluginMessage:{type:'selection',frames:[frame('1',595,842),frame('2',907,1276)]}}});
 h.context.showDownloads(threeDownloads());h.emit('blur');h.emit('focus');h.el('export').onclick();
 assert(h.revocations.length>0);for(const revoked of h.revocations){assert.equal(revoked.listeners,0);assert.equal(revoked.timers,0);}
 h.runTimers(5000);assert.equal(pdfClicks(h).length,1);assert.equal(listenerCount(h),0);
});
test('focus lost during the gap waits for another focus before requesting the next PDF',()=>{
 const h=ui();h.context.showDownloads(threeDownloads());h.emit('blur');h.emit('focus');h.emit('blur');h.runTimers(1000);
 assert.equal(pdfClicks(h).length,1);h.emit('focus');h.runTimers(999);assert.equal(pdfClicks(h).length,1);
 h.runTimers(1);assert.equal(pdfClicks(h).length,2);
});

const select=(h,frames)=>h.window.onmessage({data:{pluginMessage:{type:'selection',frames}}});
const send=(h,message)=>h.window.onmessage({data:{pluginMessage:message}});
test('an old error is cleared when the selection changes so the current blocker shows',async()=>{
 const h=ui();await select(h,[frame('1',595,842)]);await send(h,{type:'error',text:'Gradient in Background'});
 await select(h,[frame('1',595,842)]);assert.match(h.el('status').textContent,/Gradient/);
 await select(h,[frame('1',595,842),{id:'2',name:'Group 3',type:'GROUP',width:10,height:10}]);
 assert.equal(h.el('status').textContent,'');assert.match(h.el('export-hint').textContent,/Deselect “Group 3”/);
});
test('preflight issues are listed under their frame with a way to show each layer',async()=>{
 const h=ui();await select(h,[frame('1',595,842),frame('2',595,842)]);
 await send(h,{type:'error',text:'Unsupported effect in Fill',issues:[{kind:'effect',text:'Unsupported effect in Fill',frameId:'2',nodeId:'9',name:'Fill'}]});
 const rows=h.el('frames').children;assert.equal(rows.length,3);assert.equal(rows[2].className,'issue');assert.match(rows[2].textContent,/Unsupported effect · Fill/);
 rows[2].children[1].onclick();assert.equal(h.messages.at(-1).type,'show-layer');assert.equal(h.messages.at(-1).id,'9');
 assert.match(h.el('status').textContent,/1 layer uses an unsupported effect/);
 await select(h,[frame('1',595,842)]);assert.equal(h.el('frames').children.length,1);
});
test('frame names truncate in the middle and keep their full name as a tooltip',async()=>{
 const h=ui(),name='Campaign / Social / Instagram story variant 12';await select(h,[{...frame('1',595,842),name}]);
 const node=h.el('frames').children[0].children[0];assert.equal(node.title,name);assert.equal(node.children[1].textContent,' variant 12');assert.equal(node.textContent,name);
});
test('export button says how many PDFs or pages it will produce',async()=>{
 const h=ui();await select(h,[frame('1',595,842)]);assert.equal(h.el('export').textContent,'Export CMYK PDF');
 await select(h,[frame('1',595,842),frame('2',595,842),frame('3',595,842)]);assert.equal(h.el('export').textContent,'Export 3-page CMYK PDF');
 h.el('export-mode').value='separate';h.el('export-mode').onchange();assert.equal(h.el('export').textContent,'Export 3 CMYK PDFs');
});
test('a frame a fraction off a paper size offers to snap to it',async()=>{
 const h=ui();await select(h,[frame('1',842,1191)]);assert.equal(h.el('size-match').hidden,false);assert.equal(h.el('size-snap').textContent,'Use A3');
 h.el('size-snap').onclick();assert.equal(h.el('size-reset').hidden,false);assert.equal(h.el('width').value,297);assert.equal(h.el('height').value,420);assert.equal(h.el('size-match').hidden,true);
 const dl=ui();await select(dl,[frame('1',281,595)]);assert.equal(dl.el('size-snap').textContent,'Use DL');
 const exact=ui();await select(exact,[frame('1',297*72/25.4,420*72/25.4)]);assert.equal(exact.el('size-match').hidden,true);
});
test('progress messages show their step and cancel stays available for the whole export',async()=>{
 const h=ui();await select(h,[frame('1',595,842)]);h.el('export').onclick();
 assert.equal(h.el('cancel').hidden,false);assert.match(h.el('status').textContent,/Step 1 of 5/);
 await send(h,{type:'status',text:'Exporting frame 1 of 1…'});assert.equal(h.el('cancel').hidden,false);
 h.el('cancel').onclick();assert(h.messages.some(m=>m.type==='cancel'));assert.equal(h.el('cancel').hidden,true);
});
test('a finished PDF names its file and can be saved again',()=>{
 const h=ui(),output=sampleDownloads()[0];h.context.showDownloads([output]);
 assert.match(h.el('status').textContent,/Álvaro name tag\.pdf is ready/);assert.equal(h.el('status').className,'done');
 h.el('status').children[2].onclick();assert.equal(h.clicks.length,2);assert.equal(h.clicks[1].filename,output.filename);
});
test('show bleed sends the bleed in frame units for the selected frames',async()=>{const {window,el,messages}=ui();await window.onmessage({data:{pluginMessage:{type:'selection',frames:[frame('1',595,842)]}}});assert.equal(el('bleed').value,3);assert.equal(el('bleed-toggle').title,'Add bleed');assert.equal(el('bleed-toggle').disabled,false);el('bleed-toggle').onclick();const msg=messages.at(-1);assert.equal(msg.type,'show-bleed');assert.deepEqual([...msg.ids],['1']);assert(Math.abs(msg.bleed-3*72/25.4)<1e-9);});
test('frames with bleed list only their name, offer Remove bleed and give the sheet size',async()=>{const {window,el}=ui();await window.onmessage({data:{pluginMessage:{type:'selection',frames:[{...frame('1',595.28,841.89),bleed:3*72/25.4}]}}});assert.equal(el('frames').children[0].textContent,'Sheet 1');assert.equal(el('bleed').value,3);assert.equal(el('bleed-toggle').title,'Remove bleed');assert.equal(el('bleed-toggle').disabled,false);assert.match(el('sheet-hint').textContent,/PDF page 216 × 303 mm with bleed/);el('marks-toggle').onclick();assert.match(el('sheet-hint').textContent,/226 × 313 mm with crop marks/);});
test('crop marks closer to the trim than the bleed block export',async()=>{const {window,el,context}=ui();await window.onmessage({data:{pluginMessage:{type:'selection',frames:[{...frame('1',595,842),bleed:5*72/25.4}]}}});el('marks-toggle').onclick();assert.equal(el('marks-options').hidden,false);assert.equal(el('export').disabled,true);assert.match(el('marks-error').textContent,/at least the bleed \(5 mm\)/);el('mark-offset').value='5';el('mark-offset').oninput();assert.equal(el('export').disabled,false);el('export').onclick();assert.equal(vm.runInContext('job.marks.offset',context),5);});
test('the bleed field follows a selection that shares one bleed, and an offset inside it can be fixed in one click',async()=>{const {window,el}=ui();await window.onmessage({data:{pluginMessage:{type:'selection',frames:[{...frame('1',595,842),bleed:5*72/25.4}]}}});assert.equal(el('bleed').value,5);assert.equal(el('bleed-toggle').title,'Remove bleed');el('marks-toggle').onclick();assert.match(el('export-hint').textContent,/Fix the crop mark settings/);const fix=el('marks-error').children.find(c=>c.tag==='button');assert.equal(fix.textContent,'Use 5 mm');fix.onclick();assert.equal(el('mark-offset').value,5);assert.equal(el('export').disabled,false);});
test('the bleed button removes bleed once every frame has it, and a new amount resizes it',async()=>{const {window,el,messages}=ui();await window.onmessage({data:{pluginMessage:{type:'selection',frames:[{...frame('1',595,842),bleed:3*72/25.4}]}}});el('bleed-toggle').onclick();assert.equal(messages.at(-1).type,'hide-bleed');assert.deepEqual([...messages.at(-1).ids],['1']);el('bleed').value=5;el('bleed').oninput();el('bleed-toggle').onclick();assert.equal(messages.at(-1).type,'hide-bleed');el('bleed').onchange();assert.equal(messages.at(-1).type,'show-bleed');assert(Math.abs(messages.at(-1).bleed-5*72/25.4)<1e-9);});
test('a new amount does not add bleed to frames that have none',async()=>{const {window,el,messages}=ui();await window.onmessage({data:{pluginMessage:{type:'selection',frames:[{...frame('1',595,842),bleed:3*72/25.4},frame('2',595,842)]}}});assert.equal(el('bleed-toggle').title,'Add bleed');const before=messages.length;el('bleed').value=5;el('bleed').oninput();el('bleed').onchange();assert.equal(messages.length,before);});
test('PDF/X-4 waits for a color profile, and the export carries both print options',async()=>{const {window,el,context}=ui();await window.onmessage({data:{pluginMessage:{type:'selection',frames:[frame('1',595,842)]}}});el('pdfx').checked=true;el('pure-black').checked=true;el('profile-mode').value='none';el('profile-mode').onchange();assert.equal(el('pdfx').disabled,true);assert.equal(el('pdfx-hint').textContent,'PDF/X-4 needs a color profile.');el('export').onclick();const job=vm.runInContext('job',context);assert.equal(job.pdfx,false);assert.equal(job.pureBlack,true);});
test('with a profile, PDF/X-4 is on and Pure black can be turned off',async()=>{const {window,el,context}=ui();await window.onmessage({data:{pluginMessage:{type:'selection',frames:[frame('1',595,842)]}}});el('pdfx').checked=true;el('pure-black').checked=false;el('pure-black').onchange();el('profile-mode').value='custom';el('profile-mode').onchange();const bytes=icc('Test CMYK');await el('profile').onchange({target:{files:[{name:'test.icc',size:bytes.length,arrayBuffer:async()=>bytes}]}});assert.equal(el('pdfx').disabled,false);assert.equal(el('pdfx-hint').textContent,'');el('export').onclick();const job=vm.runInContext('job',context);assert.equal(job.pdfx,true);assert.equal(job.pureBlack,false);});
test('bleed and crop marks show their settings only once added, and add or remove from the header',async()=>{const {window,el,messages}=ui();await window.onmessage({data:{pluginMessage:{type:'selection',frames:[frame('1',595,842)]}}});assert.equal(el('bleed-options').hidden,true);assert.equal(el('bleed-section').className,'collapsed');assert.equal(el('bleed-hint').textContent,'');assert.equal(el('marks-options').hidden,true);assert.equal(el('marks-toggle').title,'Add crop marks');el('bleed-toggle').onclick();assert.equal(messages.at(-1).type,'show-bleed');await window.onmessage({data:{pluginMessage:{type:'selection',frames:[{...frame('1',595,842),bleed:3*72/25.4}]}}});assert.equal(el('bleed-options').hidden,false);assert.equal(el('bleed-section').className,'');assert.equal(el('bleed-toggle').title,'Remove bleed');assert.equal(el('sheet-hint').parentNode,el('bleed-section'));el('marks-toggle').onclick();assert.equal(el('marks-options').hidden,false);assert.equal(el('marks-toggle').title,'Remove crop marks');assert.equal(el('sheet-hint').parentNode,el('marks-section'));el('marks-toggle').onclick();assert.equal(el('marks-options').hidden,true);});
test('with some frames bleeding, the amount shows and + adds bleed to the rest',async()=>{const {window,el,messages}=ui();await window.onmessage({data:{pluginMessage:{type:'selection',frames:[{...frame('1',595,842),bleed:3*72/25.4},frame('2',595,842),frame('3',595,842)]}}});assert.equal(el('bleed-options').hidden,false);assert.equal(el('bleed-toggle').title,'Add bleed');assert.equal(el('bleed-hint').textContent,'1 of 3 frames has bleed.');el('bleed-toggle').onclick();assert.equal(messages.at(-1).type,'show-bleed');assert.deepEqual([...messages.at(-1).ids],['1','2','3']);});
test('with no frames selected, both + buttons are greyed out',async()=>{const {window,el}=ui();await window.onmessage({data:{pluginMessage:{type:'selection',frames:[]}}});assert.equal(el('bleed-toggle').disabled,true);assert.equal(el('marks-toggle').disabled,true);await window.onmessage({data:{pluginMessage:{type:'selection',frames:[frame('1',595,842)]}}});assert.equal(el('marks-toggle').disabled,false);el('marks-toggle').onclick();await window.onmessage({data:{pluginMessage:{type:'selection',frames:[]}}});assert.equal(el('marks-toggle').disabled,false);});
test('clicking a section header row adds or removes it like its button',async()=>{const {window,el,messages}=ui();await window.onmessage({data:{pluginMessage:{type:'selection',frames:[frame('1',595,842)]}}});el('marks-head').onclick({target:{}});assert.equal(el('marks-options').hidden,false);el('marks-head').onclick({target:{}});assert.equal(el('marks-options').hidden,true);el('bleed-head').onclick({target:{}});assert.equal(messages.at(-1).type,'show-bleed');await window.onmessage({data:{pluginMessage:{type:'selection',frames:[]}}});const before=messages.length;el('bleed-head').onclick({target:{}});assert.equal(messages.length,before);});
test('a custom page size scales frames to fit and blocks bleed it would shrink below 3 mm',async()=>{const {window,el,messages,context}=ui();const a4={...frame('1',595.28,841.89),bleed:3*72/25.4};await window.onmessage({data:{pluginMessage:{type:'selection',frames:[a4]}}});el('width').value='148';el('width').oninput();el('height').value='210';el('height').oninput();assert.equal(el('size-hint').textContent,'Your size applies to every page. Artwork scales to 70% to fit, centred.');assert.equal(el('export').disabled,true);assert.equal(el('export-hint').textContent,'Fix the bleed to export.');assert.match(el('bleed-hint').textContent,/^Scaling to 70% leaves 2\.1 mm of bleed\. Use 4\.3 mm bleed$/);el('bleed-hint').children.find(c=>c.tag==='button').onclick();assert.equal(messages.at(-1).type,'show-bleed');assert(Math.abs(messages.at(-1).bleed-4.3*72/25.4)<1e-9);await window.onmessage({data:{pluginMessage:{type:'selection',frames:[{...a4,bleed:4.3*72/25.4}]}}});assert.equal(el('export').disabled,false);el('export').onclick();const job=vm.runInContext('job',context);assert(Math.abs(job.fits[0].scale-148/210)<1e-3);assert(Math.abs(messages.at(-1).prints[0]-148/210)<1e-3);});
test('components export, and an instance points to its main component for bleed',async()=>{
 const h=ui(),{el,messages}=h;await select(h,[{id:'1',name:'Card',type:'COMPONENT',width:241,height:156,bleed:0}]);
 assert.equal(el('export').disabled,false);assert.equal(el('bleed-toggle').disabled,false);
 await select(h,[{id:'2',name:'Card',type:'INSTANCE',width:241,height:156,bleed:0,mainId:'1'}]);
 assert.equal(el('export').disabled,false);assert.equal(el('bleed-toggle').disabled,true);assert.match(el('bleed-hint').textContent,/This instance takes bleed from its main component/);
 const link=el('bleed-hint').children.find(c=>c.textContent==='Select main component');link.onclick();assert.deepEqual(JSON.parse(JSON.stringify(messages.at(-1))),{type:'select-layer',id:'1'});
 // With bleed on the main component, the instance shows it and the hint goes.
 await select(h,[{id:'2',name:'Card',type:'INSTANCE',width:241,height:156,bleed:8.5,mainId:'1'}]);
 assert.equal(el('bleed-options').hidden,false);assert.equal(el('bleed').disabled,true);assert.equal(el('bleed-hint').textContent,'');
});
test('a click on a header button toggles once, not again when it bubbles to the row',async()=>{const {window,el}=ui();await window.onmessage({data:{pluginMessage:{type:'selection',frames:[frame('1',595,842)]}}});el('marks-toggle').onclick();el('marks-head').onclick({target:{},composedPath:()=>[{},el('marks-toggle'),el('marks-head')]});assert.equal(el('marks-options').hidden,false);});
test('large frames a little off a standard size still get the suggestion',async()=>{const {window,el}=ui();await window.onmessage({data:{pluginMessage:{type:'selection',frames:[frame('1',2380,3368)]}}});assert.equal(el('size-match').hidden,false);assert.match(el('size-match-text').textContent,/A0/);await window.onmessage({data:{pluginMessage:{type:'selection',frames:[frame('2',590,842)]}}});assert.equal(el('size-match').hidden,true);});
test('New frame posts the chosen size and resets, and no selection leaves the page size hint empty',async()=>{const {window,el,messages}=ui();await window.onmessage({data:{pluginMessage:{type:'selection',frames:[]}}});assert.equal(el('size-hint').textContent,'');assert.equal(el('size-hint').hidden,true);el('new-frame').value='A5';el('new-frame').onchange();assert.deepEqual({...messages.at(-1)},{type:'new-frame',size:'A5'});assert.equal(el('new-frame').value,'');});
test('preflight shows a count in the footer and lists problems under their frame when shown',async()=>{
 const h=ui();h.el('pure-black').checked=true;await select(h,[frame('1',595,842)]);assert.equal(h.el('preflight').hidden,false);assert.equal(h.el('preflight-summary').textContent,'Checking…');
 await send(h,{type:'preflight',frames:[{id:'1',findings:[{kind:'image',nodeId:'5',name:'Photo',ppi:120},{kind:'image',nodeId:'6',name:'Logo',ppi:400},{kind:'text',nodeId:'7',name:'Caption',size:5,rich:null,pure:5,gap:20}]}]});
 assert.equal(h.el('preflight-summary').textContent,'2 errors');assert.match(h.el('preflight-summary').className,/error/);assert.equal(h.el('frames').children.length,1,'listed only when shown');
 h.el('preflight-toggle').onclick();const rows=h.el('frames').children;
 assert.deepEqual(rows.slice(1).map(r=>r.textContent.replace(/Show$/,'')),['120 ppi image · Photo','5 pt text · Caption']);assert.equal(rows[2].className,'issue warning');
 rows[1].children[1].onclick();assert.equal(h.messages.at(-1).type,'show-layer');assert.equal(h.messages.at(-1).id,'5');
 assert.equal(h.el('preflight-toggle').textContent,'Hide');h.el('preflight-toggle').onclick();assert.equal(h.el('frames').children.length,1);
});
test('preflight limits apply at print size, and pure black only counts as rich black when it is off',async()=>{
 const h=ui();h.el('pure-black').checked=true;await select(h,[frame('1',595,842)]);
 await send(h,{type:'preflight',frames:[{id:'1',findings:[{kind:'image',nodeId:'5',name:'Photo',ppi:310},{kind:'text',nodeId:'7',name:'Caption',size:10,rich:null,pure:10,gap:null}]}]});
 assert.equal(h.el('preflight-summary').textContent,'No errors');assert.match(h.el('preflight-summary').className,/ok/);
 // Doubling the page size halves the image's ppi.
 h.el('width').value='420';h.el('width').oninput();h.el('height').value='594';h.el('height').oninput();assert.equal(h.el('preflight-summary').textContent,'1 error');
 h.el('size-reset').onclick();assert.equal(h.el('preflight-summary').textContent,'No errors');
 h.el('pure-black').checked=false;h.el('pure-black').onchange();assert.equal(h.el('preflight-summary').textContent,'1 error');
 h.el('preflight-toggle').onclick();assert.match(h.el('frames').children[1].textContent,/Rich black 10 pt text · Caption/);
});
test('long preflight lists show three per frame until expanded',async()=>{
 const h=ui();await select(h,[frame('1',595,842)]);
 await send(h,{type:'preflight',frames:[{id:'1',findings:[1,2,3,4,5].map(n=>({kind:'stroke',nodeId:String(n),name:'Rule '+n,weight:0.1}))}]});
 h.el('preflight-toggle').onclick();let rows=h.el('frames').children;assert.equal(rows.length,5);assert.equal(rows[4].textContent,'2 more in this frame');
 rows[4].children[0].onclick();rows=h.el('frames').children;assert.equal(rows.length,6);assert.match(rows[5].textContent,/0.1 pt hairline · Rule 5/);
});
