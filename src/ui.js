const el=id=>document.getElementById(id);let frames=[],profile=null,profileName='',worker=null,busy=false,job=null,profileRead=0,customProfile=null,customName='',engineAbort=null;
let unit='mm',dimensions={width:null,height:null},downloadUrls=[],downloadQueue=null,issues=[],selectionKey='';
const displayDimension=value=>value===null?'':unit==='in'?Math.round(value/25.4*1e6)/1e6:value;
const profiles={...BUNDLED_PROFILES};
const decodeProfile=OpenPrintAssets.decodeProfile;
const encodeProfile=bytes=>{let text='';for(let offset=0;offset<bytes.length;offset+=8192)text+=String.fromCharCode(...bytes.subarray(offset,offset+8192));return btoa(text);};
if(BUNDLED_PROFILES.custom){customProfile=decodeProfile(BUNDLED_PROFILES.custom);customName=PrintCore.profileDescription(customProfile)||'Custom CMYK profile';}
// Progress messages from every export stage, mapped to a step so long exports show how far along they are.
const STEPS=[['Preparing',1],['Exporting frame',1],['Combining',2],['Loading conversion',3],['Downloading',3],['Converting',4],['Setting print',5]],STEP_COUNT=5;
function status(text,tone=''){
 const step=tone==='busy'&&STEPS.find(([prefix])=>text.startsWith(prefix));
 if(step){const label=document.createElement('span'),count=document.createElement('span');label.textContent=text;count.className='step';count.textContent='Step '+step[1]+' of '+STEP_COUNT;el('status').replaceChildren(label,count);}
 else el('status').textContent=text;
 el('status').className=text?tone:'';
}
// A finished or failed export's message describes the old settings, so drop it once they change.
function clearResult(){if(busy||downloadQueue)return;issues=[];if(el('status').className!=='busy')status('');}
const FRAME_ICON='<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M5.5 2v2.5H3v1h2.5v5H3v1h2.5V14h1v-2.5h5V14h1v-2.5H15v-1h-2.5v-5H15v-1h-2.5V2h-1v2.5h-5V2zm1 3.5h5v5h-5z"/></svg>',WARNING_ICON='<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M8 2.5 14 13H2zm-.5 4v3h1v-3zm0 4v1h1v-1z"/></svg>';
const formatSize=size=>{const value=mm=>unit==='in'?Math.round(mm/25.4*100)/100:mm;return value(size.width)+' × '+value(size.height)+' '+unit;};
// Truncate in the middle so names that share a long prefix stay distinguishable. The kept end starts at a word.
const NAME_TAIL=14;
function tailStart(chars){if(chars.length<=NAME_TAIL+6)return chars.length;const start=chars.length-NAME_TAIL,space=chars.indexOf(' ',start);return space>=0&&space<chars.length-1?space:start;}
function nameNode(text){
 const name=document.createElement('span'),start=document.createElement('span'),end=document.createElement('span'),chars=[...text],cut=tailStart(chars);
 name.className='name';name.title=text;start.className='start';end.className='end';start.textContent=chars.slice(0,cut).join('');end.textContent=chars.slice(cut).join('');name.append(start,end);return name;
}
const ISSUE_LABELS={gradient:'Gradient',effect:'Effect'},ISSUES_PER_FRAME=3;
function renderIssues(frame){
 const own=issues.filter(issue=>issue.frameId===frame.id);
 for(const issue of own.slice(0,ISSUES_PER_FRAME)){
  const li=document.createElement('li'),show=document.createElement('button');li.className='issue';
  show.className='link';show.textContent='Show';show.title='Zoom to '+issue.name;show.onclick=()=>parent.postMessage({pluginMessage:{type:'show-layer',id:issue.nodeId}},'*');
  li.append(nameNode((ISSUE_LABELS[issue.kind]||'Issue')+' · '+issue.name),show);el('frames').append(li);
 }
 if(own.length>ISSUES_PER_FRAME){const li=document.createElement('li');li.className='issue more';li.textContent='+'+(own.length-ISSUES_PER_FRAME)+' more in this frame';el('frames').append(li);}
}
function renderFrames(){el('frames').replaceChildren();el('frames').className=issues.length?'expanded':'';if(!frames.length){const li=document.createElement('li');li.className='empty';li.textContent='Select one or more frames on the canvas.';el('frames').append(li);}for(const frame of frames){const valid=frame.type==='FRAME',li=document.createElement('li'),size=document.createElement('span');li.className=valid?'':'invalid';li.innerHTML=valid?FRAME_ICON:WARNING_ICON;size.className='size';size.textContent=valid?formatSize(PrintCore.frameSize(frame.width,frame.height)):'Not a frame';li.append(nameNode(frame.name),size);el('frames').append(li);renderIssues(frame);}}
function sizeProblem(){if(el('auto-size').checked)return '';if(dimensions.width===null||dimensions.height===null)return 'Enter a width and height.';try{PrintCore.points(dimensions.width);PrintCore.points(dimensions.height);return '';}catch(error){return error.message;}}
function fieldInvalid(id){if(el('auto-size').checked||dimensions[id]===null)return false;try{PrintCore.points(dimensions[id]);return false;}catch(error){return true;}}
function profileProblem(){if(el('profile-mode').value==='none'||profile)return '';const entry=PROFILE_CATALOG.find(p=>p.id===el('profile-mode').value);return entry?'Import '+entry.name+' to export.':'Choose a CMYK profile to export.';}
function refresh(){const invalid=frames.filter(f=>f.type!=='FRAME'),problem=sizeProblem(),count=frames.length-invalid.length,separate=el('export-mode').value==='separate';el('export').disabled=busy||!!downloadQueue||!!profileProblem()||!frames.length||invalid.length>0||!!problem;el('export').textContent=busy?'Exporting…':count<2?'Export CMYK PDF':separate?'Export '+count+' CMYK PDFs':'Export '+count+'-page CMYK PDF';el('export-hint').textContent=busy?'':!frames.length?'Select frames to export.':invalid.length?'Only frames can be exported. Deselect '+(invalid.length===1?'“'+invalid[0].name+'”':invalid.length+' layers')+'.':problem?'':profileProblem();
 const widthInvalid=fieldInvalid('width'),heightInvalid=fieldInvalid('height');el('width-field').className='field'+(widthInvalid?' invalid':'');el('height-field').className='field'+(heightInvalid?' invalid':'');el('size-error').textContent=problem;el('size-error').className='hint'+(widthInvalid||heightInvalid?' error':'');el('size-snap').disabled=busy||!!downloadQueue;el('frame-count').textContent=!frames.length?'':invalid.length?frames.length+' selected':frames.length+(frames.length===1?' page':' pages');el('cancel').hidden=!busy;el('cancel').textContent='Cancel';el('profile').disabled=busy||!!downloadQueue;el('profile-mode').disabled=busy||!!downloadQueue;el('width').disabled=busy||!!downloadQueue;el('height').disabled=busy||!!downloadQueue;el('auto-size').disabled=busy||!!downloadQueue;el('units').disabled=busy||!!downloadQueue;el('export-options').hidden=count<2;el('export-mode').disabled=busy||!!downloadQueue;}
function stop(){if(engineAbort){engineAbort.abort();engineAbort=null;}if(worker){worker.terminate();worker=null;}busy=false;job=null;refresh();parent.postMessage({pluginMessage:{type:'ready'}},'*');}
function updateSize(){
 const valid=frames.filter(f=>f.type==='FRAME');
 if(el('auto-size').checked){
  const sizes=valid.map(f=>PrintCore.frameSize(f.width,f.height));
  const same=sizes.length && sizes.every(s=>s.width===sizes[0].width && s.height===sizes[0].height);
  dimensions={width:same?sizes[0].width:null,height:same?sizes[0].height:null};
  el('width').value=displayDimension(dimensions.width);el('height').value=displayDimension(dimensions.height);
  el('width').placeholder=sizes.length?'Varies':'';el('height').placeholder=sizes.length?'Varies':'';
  el('size-hint').textContent=!sizes.length?'Select frames to infer their print size.':same?'':'Each PDF page uses its own frame’s inferred size. Enter dimensions to override all pages.';
  showPaperMatch(same?paperMatch(sizes[0]):null);
 }else{el('size-hint').textContent='Your size applies to every page. Artwork keeps its size, aligned top left; smaller pages crop it.';showPaperMatch(null);}
 el('size-hint').hidden=!el('size-hint').textContent;
 refresh();
}
// Frames drawn at 72 units per inch land a fraction of a millimetre off standard sizes.
const PAPER=[['A0',841,1189],['A1',594,841],['A2',420,594],['A3',297,420],['A4',210,297],['A5',148,210],['A6',105,148],['SRA3',320,450],['Letter',215.9,279.4],['Legal',215.9,355.6],['Tabloid',279.4,431.8],['Business card',85,55],['US business card',88.9,50.8]],PAPER_TOLERANCE=0.5;
function paperMatch(size){for(const [name,w,h] of PAPER)for(const [width,height] of [[w,h],[h,w]])if(Math.abs(size.width-width)<=PAPER_TOLERANCE&&Math.abs(size.height-height)<=PAPER_TOLERANCE)return size.width===width&&size.height===height?null:{name,width,height};return null;}
function showPaperMatch(match){
 el('size-match').hidden=!match;if(!match)return;
 el('size-match-text').textContent='Close to '+match.name+' ('+formatSize(match)+')';el('size-snap').textContent='Use '+match.name;
 el('size-snap').onclick=()=>{dimensions={width:match.width,height:match.height};el('auto-size').checked=false;for(const id of ['width','height'])el(id).value=displayDimension(dimensions[id]);clearResult();updateSize();};
}
el('export-mode').value='combined';el('export-mode').onchange=()=>{clearResult();refresh();};
el('units').value='mm';
el('units').onchange=()=>{clearResult();unit=el('units').value;for(const id of ['width','height']){el(id+'-unit').textContent=unit;el(id).min=unit==='in'?10/25.4:10;el(id).max=unit==='in'?2000/25.4:2000;el(id).step=unit==='in'?'.001':'.01';el(id).value=displayDimension(dimensions[id]);}updateSize();renderFrames();};
el('auto-size').onchange=()=>{clearResult();updateSize();};
for(const id of ['width','height'])el(id).oninput=()=>{dimensions[id]=el(id).value===''?null:Number(el(id).value)*(unit==='in'?25.4:1);el('auto-size').checked=false;clearResult();updateSize();};
el('profile').onchange=async event=>{const generation=++profileRead;const mode=el('profile-mode').value;try{const file=event.target.files[0];if(!file)return;profile=null;refresh();if(file.size>5*1024*1024)throw new Error('ICC profile is too large.');const bytes=new Uint8Array(await file.arrayBuffer());if(generation!==profileRead)return;PrintCore.validateICC(bytes);const name=PrintCore.profileDescription(bytes);const entry=PROFILE_CATALOG.find(p=>p.id===mode);if(entry && name!==entry.name)throw new Error('Choose '+entry.name+'. This file contains '+(name||'an unnamed profile')+'.');if(entry){const encoded=encodeProfile(bytes);profiles[mode]=encoded;parent.postMessage({pluginMessage:{type:'save-profile',id:mode,encoded}},'*');}else{customProfile=bytes;customName=name||file.name;}chooseProfile();}catch(error){if(generation!==profileRead)return;status(error.message,'error');}refresh();};
el('export').onclick=()=>{try{const width=dimensions.width,height=dimensions.height;const auto=el('auto-size').checked;const sizes=auto?frames.map(f=>PrintCore.frameSize(f.width,f.height)):null;if(sizes)for(const size of sizes){PrintCore.points(size.width);PrintCore.points(size.height);}else{PrintCore.points(width);PrintCore.points(height);}stopDownloadQueue();for(const url of downloadUrls)URL.revokeObjectURL(url);downloadUrls=[];job={individual:frames.length>1&&el('export-mode').value!=='combined',separate:frames.length>1&&el('export-mode').value==='separate',filenames:frames.map(f=>f.name+'.pdf'),filename:frames[0].name+'.pdf',width,height,auto,sizes,unit,displayWidth:el('width').value,displayHeight:el('height').value,icc:profile?profile.slice():null,name:profileName};busy=true;refresh();status('Preparing frames…','busy');parent.postMessage({pluginMessage:{type:'export',ids:frames.map(f=>f.id)}},'*');}catch(error){status(error.message,'error');}};
el('cancel').onclick=()=>{parent.postMessage({pluginMessage:{type:'cancel'}},'*');stop();status('Export cancelled.');};
window.onmessage=async event=>{
 const msg=event.data.pluginMessage;if(!msg)return;
 if(msg.type==='profiles'){for(const entry of PROFILE_CATALOG){const encoded=msg.profiles && msg.profiles[entry.id];if(typeof encoded==='string' && !profiles[entry.id]){try{const bytes=decodeProfile(encoded);PrintCore.validateICC(bytes);if(PrintCore.profileDescription(bytes)===entry.name)profiles[entry.id]=encoded;}catch(error){/* Ignore invalid stored files. */}}}if(!busy&&!downloadQueue)chooseProfile(false);}
 if(msg.type==='profile-storage-error')status('Profile imported for this session. Figma could not save it for next time.','error');
 if(msg.type==='selection'){if(busy||downloadQueue)return;frames=msg.frames.sort((a,b)=>a.name.localeCompare(b.name,undefined,{numeric:true}));
  // The plugin re-sends the selection after every export; only a real change clears the result.
  const key=JSON.stringify(frames.map(f=>[f.id,f.name,f.type,f.width,f.height]));if(key!==selectionKey){selectionKey=key;clearResult();}
  updateSize();renderFrames();refresh();}
 if(msg.type==='status')status(msg.text,'busy');
 if(msg.type==='error'){stop();if(Array.isArray(msg.issues)&&msg.issues.length){issues=msg.issues;renderFrames();const layers=new Set(issues.map(i=>i.nodeId)).size;status((layers===1?'1 layer uses':layers+' layers use')+' a gradient or effect, listed under its frame above. Remove or flatten them, then export again.','error');}else status(msg.text,'error');}
 if(msg.type==='pdfs' && job){const current=job;try{if(current.auto && msg.sizes)current.sizes=msg.sizes.map(size=>PrintCore.frameSize(size.width,size.height));
  status('Combining pages…','busy');const merged=await PDFLib.PDFDocument.create();for(const bytes of msg.pdfs){const source=await PDFLib.PDFDocument.load(new Uint8Array(bytes));for(const page of await merged.copyPages(source,source.getPageIndices()))merged.addPage(page);}
  const pdf=await merged.save();if(job!==current)return;status('Loading conversion engine…','busy');const downloadAbort=new AbortController();engineAbort=downloadAbort;refresh();const downloadTimer=setTimeout(()=>downloadAbort.abort(),60000);let wasm;try{wasm=await OpenPrintAssets.loadEngine(downloadAbort.signal,fraction=>{if(job===current)status('Downloading engine… '+Math.floor(fraction*100)+'%','busy');});}finally{clearTimeout(downloadTimer);}if(job!==current)return;engineAbort=null;status('Converting colors to CMYK…','busy');
  const url=URL.createObjectURL(new Blob([WORKER_SOURCE],{type:'text/javascript'}));worker=new Worker(url);URL.revokeObjectURL(url);refresh();
  worker.onerror=event=>{stop();status('Conversion could not start: '+event.message,'error');};
  worker.onmessage=async event=>{if(job!==current)return;worker.terminate();worker=null;refresh();try{if(event.data.error)throw new Error(event.data.error);status(current.icc?'Setting print size and embedding profile…':'Setting print size…','busy');const outputs=await prepareDownloads(event.data.bytes,current);if(job!==current)return;stop();showDownloads(outputs,current.separate);}catch(error){stop();status(error.message,'error');}};
  worker.postMessage({wasm,pdf,icc:current.icc?current.icc.slice():null},[wasm.buffer,pdf.buffer]);
 }catch(error){if(job!==current)return;stop();status(error.message,'error');}}
 };
function packageDownloads(outputs){
 if(outputs.length===1)return {...outputs[0],type:'application/pdf'};
 const files=Object.create(null),used=new Set();
 for(const output of outputs){
  const original=output.filename.replace(/[\\/\x00-\x1f]/g,'_');let name=original,n=2;
  while(used.has(name.toLowerCase()))name=original.replace(/\.pdf$/i,'')+' ('+(n++)+').pdf';
  used.add(name.toLowerCase());files[name]=output.bytes;
 }
 return {filename:outputs[0].filename.replace(/[\\/\x00-\x1f]/g,'_').replace(/\.pdf$/i,'')+'.zip',bytes:fflate.zipSync(files,{level:0}),type:'application/zip'};
}
function stopDownloadQueue(){
 const q=downloadQueue;if(!q)return;
 downloadQueue=null;clearTimeout(q.timer);clearTimeout(q.watchdog);
 window.removeEventListener('blur',q.blur);window.removeEventListener('focus',q.focus);refresh();
 parent.postMessage({pluginMessage:{type:'ready'}},'*');
}
function startDownloadQueue(anchors,message){
 stopDownloadQueue();const q={anchors,message,next:0,phase:'waiting',blurred:false,timer:null,watchdog:null};downloadQueue=q;
 const finish=(text,tone)=>{stopDownloadQueue();message.textContent=text;el('status').className=tone;};
 const request=()=>{
  if(downloadQueue!==q)return;
  q.phase='waiting';q.blurred=false;
  message.textContent='Choose where to save PDF '+(q.next+1)+' of '+anchors.length+'. Cancel skips this file.';el('status').className='queue';
  // Desktop Figma drops overlapping Save dialogs. Wait for blur then focus before requesting another.
  q.watchdog=setTimeout(()=>{if(downloadQueue===q&&!q.blurred)finish('Automatic downloads paused. Please export again.','error');},3000);
  anchors[q.next++].click();
 };
 q.blur=()=>{if(downloadQueue===q&&q.phase==='waiting'){q.blurred=true;clearTimeout(q.watchdog);}};
 q.focus=()=>{
  if(downloadQueue!==q||q.phase!=='waiting'||!q.blurred)return;
  q.phase='delay';q.blurred=false;clearTimeout(q.watchdog);
  if(q.next===anchors.length){finish('All '+anchors.length+' PDFs sent to save. Check your destination folder.','done');return;}
  message.textContent='Next PDF in a moment.';
  q.timer=setTimeout(()=>{if(downloadQueue!==q)return;if(document.hasFocus())request();else{q.phase='waiting';q.blurred=true;}},1000);
 };
 window.addEventListener('blur',q.blur);window.addEventListener('focus',q.focus);refresh();request();
}
function showDownloads(outputs,separate=false){
 stopDownloadQueue();
 if(separate&&outputs.length>1){
  const links=document.createElement('div');links.className='downloads';links.hidden=true;const used=new Set(),anchors=[];
  for(const output of outputs){
   const original=output.filename.replace(/[\\/\x00-\x1f]/g,'_');let name=original,n=2;
   while(used.has(name.toLowerCase()))name=original.replace(/\.pdf$/i,'')+' ('+(n++)+').pdf';
   used.add(name.toLowerCase());
   const url=URL.createObjectURL(new Blob([output.bytes],{type:'application/pdf'})),a=document.createElement('a');
   a.href=url;a.download=name;a.textContent=name;links.append(a);downloadUrls.push(url);anchors.push(a);
  }
  const message=document.createElement('span');
  el('status').replaceChildren(message,links);el('status').className='queue';
  startDownloadQueue(anchors,message);return anchors;
 }

 const output=packageDownloads(outputs),links=document.createElement('div');links.className='downloads';links.hidden=true;
 const url=URL.createObjectURL(new Blob([output.bytes],{type:output.type})),a=document.createElement('a');
 a.href=url;a.download=output.filename;a.textContent=outputs.length===1?'Save PDF':'Save ZIP';links.append(a);downloadUrls.push(url);
 const again=document.createElement('button');again.className='link again';again.textContent='Save again';again.onclick=()=>a.click();
 el('status').replaceChildren(document.createTextNode(output.filename+' is ready'+(outputs.length===1?'.':' ('+outputs.length+' PDFs).')),links,again);el('status').className='done';
 a.click();return [a];
}
async function prepareDownloads(bytes,current){
 if(!current.individual)return [{filename:current.filename,bytes:await PrintCore.finish(bytes,current.icc,current.width,current.height,current.name,current.sizes)}];
 const converted=await PDFLib.PDFDocument.load(bytes);
 if(converted.getPageCount()!==current.filenames.length)throw new Error('The exported page count does not match the selected frames. Please try again.');
 const outputs=[];
 for(let i=0;i<converted.getPageCount();i++){
  const single=await PDFLib.PDFDocument.create();const [page]=await single.copyPages(converted,[i]);single.addPage(page);
  const sizes=current.auto?[current.sizes[i]]:null;
  outputs.push({filename:current.filenames[i],bytes:await PrintCore.finish(await single.save(),current.icc,current.width,current.height,current.name,sizes)});
 }
 return outputs;
}
function chooseProfile(invalidate=true){
 stopDownloadQueue();
 if(invalidate)++profileRead;const mode=el('profile-mode').value;const entry=PROFILE_CATALOG.find(p=>p.id===mode);
 if(entry){profile=profiles[mode]?decodeProfile(profiles[mode]):null;profileName=entry.name;}
 else if(mode==='none'){profile=null;profileName='';}
 else {profile=customProfile;profileName=customName;}
 if(profile)PrintCore.validateICC(profile);
 el('custom-profile').hidden=mode!=='custom'&&!!(profile||mode==='none');
 el('profile-hint').textContent=mode==='none'?'Exports CMYK using the default conversion. No ICC profile is embedded.':entry?(profile?'':'This profile isn’t bundled. Import its ICC file once; Figma keeps it locally when storage has space.'):profile?'Using '+profileName+'. It will be embedded in the PDF.':'Choose your printer’s CMYK ICC profile. It will be embedded in the PDF.';
 el('profile-hint').hidden=!el('profile-hint').textContent;
 status('');refresh();
}
for(const group of [...new Set(PROFILE_CATALOG.map(p=>p.group))]){const optgroup=document.createElement('optgroup');optgroup.label=group;for(const entry of PROFILE_CATALOG.filter(p=>p.group===group)){const option=document.createElement('option');option.value=entry.id;option.textContent=entry.name;optgroup.append(option);}el('profile-mode').append(optgroup);}
el('profile-mode').value=profiles.CoatedFOGRA39?'CoatedFOGRA39':customProfile?'custom':'none';
el('profile-mode').onchange=()=>{el('profile').value='';chooseProfile();};chooseProfile();
parent.postMessage({pluginMessage:{type:'load-profiles'}},'*');
parent.postMessage({pluginMessage:{type:'ready'}},'*');
