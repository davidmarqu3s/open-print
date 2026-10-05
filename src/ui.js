const el=id=>document.getElementById(id);let frames=[],profile=null,profileName='',worker=null,busy=false,job=null,profileRead=0,customProfile=null,customName='';
let unit='mm',dimensions={width:null,height:null};
const displayDimension=value=>value===null?'':unit==='in'?Math.round(value/25.4*1e6)/1e6:value;
const profiles={...BUNDLED_PROFILES};
const decodeProfile=encoded=>Uint8Array.from(atob(encoded),c=>c.charCodeAt(0));
const encodeProfile=bytes=>{let text='';for(let offset=0;offset<bytes.length;offset+=8192)text+=String.fromCharCode(...bytes.subarray(offset,offset+8192));return btoa(text);};
if(BUNDLED_PROFILES.custom){customProfile=decodeProfile(BUNDLED_PROFILES.custom);customName=PrintCore.profileDescription(customProfile)||'Custom CMYK profile';}
function status(text,tone=''){el('status').textContent=text;el('status').className=text?tone:'';}
const FRAME_ICON='<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M5.5 2v2.5H3v1h2.5v5H3v1h2.5V14h1v-2.5h5V14h1v-2.5H15v-1h-2.5v-5H15v-1h-2.5V2h-1v2.5h-5V2zm1 3.5h5v5h-5z"/></svg>',WARNING_ICON='<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M8 2.5 14 13H2zm-.5 4v3h1v-3zm0 4v1h1v-1z"/></svg>';
const formatSize=size=>{const value=mm=>unit==='in'?Math.round(mm/25.4*100)/100:mm;return value(size.width)+' × '+value(size.height)+' '+unit;};
function renderFrames(){el('frames').replaceChildren();if(!frames.length){const li=document.createElement('li');li.className='empty';li.textContent='Select one or more frames on the canvas.';el('frames').append(li);}for(const frame of frames){const valid=frame.type==='FRAME',li=document.createElement('li'),name=document.createElement('span'),size=document.createElement('span');li.className=valid?'':'invalid';li.innerHTML=valid?FRAME_ICON:WARNING_ICON;name.className='name';name.textContent=frame.name;name.title=frame.name;size.className='size';size.textContent=valid?formatSize(PrintCore.frameSize(frame.width,frame.height)):'Not a frame';li.append(name,size);el('frames').append(li);}}
function sizeProblem(){if(el('auto-size').checked)return '';if(dimensions.width===null||dimensions.height===null)return 'Enter a width and height.';try{PrintCore.points(dimensions.width);PrintCore.points(dimensions.height);return '';}catch(error){return error.message;}}
function refresh(){const invalid=frames.filter(f=>f.type!=='FRAME'),problem=sizeProblem();el('export').disabled=busy||(el('profile-mode').value!=='none'&&!profile)||!frames.length||invalid.length>0||!!problem;el('export').textContent=busy?'Exporting…':'Export CMYK PDF';el('export-hint').textContent=busy?'':!frames.length?'Select frames to export.':invalid.length?'Only frames can be exported. Deselect '+(invalid.length===1?'“'+invalid[0].name+'”':invalid.length+' layers')+'.':problem;el('frame-count').textContent=!frames.length?'':invalid.length?frames.length+' selected':frames.length+(frames.length===1?' page':' pages');el('cancel').hidden=!worker;el('profile').disabled=busy;el('profile-mode').disabled=busy;el('width').disabled=busy;el('height').disabled=busy;el('auto-size').disabled=busy;el('units').disabled=busy;}
function stop(){if(worker){worker.terminate();worker=null;}busy=false;job=null;refresh();parent.postMessage({pluginMessage:{type:'ready'}},'*');}
function updateSize(){
 const valid=frames.filter(f=>f.type==='FRAME');
 if(el('auto-size').checked){
  const sizes=valid.map(f=>PrintCore.frameSize(f.width,f.height));
  const same=sizes.length && sizes.every(s=>s.width===sizes[0].width && s.height===sizes[0].height);
  dimensions={width:same?sizes[0].width:null,height:same?sizes[0].height:null};
  el('width').value=displayDimension(dimensions.width);el('height').value=displayDimension(dimensions.height);
  el('width').placeholder=sizes.length?'Varies':'';el('height').placeholder=sizes.length?'Varies':'';
  el('size-hint').textContent=!sizes.length?'Select frames to infer their print size.':same?'':'Each PDF page uses its own frame’s inferred size. Enter dimensions to override all pages.';
 }else el('size-hint').textContent='Your size applies to every page. Artwork keeps its size, aligned top left; smaller pages crop it.';
 el('size-hint').hidden=!el('size-hint').textContent;
 refresh();
}
el('units').value='mm';
el('units').onchange=()=>{unit=el('units').value;for(const id of ['width','height']){el(id+'-unit').textContent=unit;el(id).min=unit==='in'?10/25.4:10;el(id).max=unit==='in'?2000/25.4:2000;el(id).step=unit==='in'?'.001':'.01';el(id).value=displayDimension(dimensions[id]);}updateSize();renderFrames();};
el('auto-size').onchange=updateSize;
for(const id of ['width','height'])el(id).oninput=()=>{dimensions[id]=el(id).value===''?null:Number(el(id).value)*(unit==='in'?25.4:1);el('auto-size').checked=false;updateSize();};
el('profile').onchange=async event=>{const generation=++profileRead;const mode=el('profile-mode').value;try{const file=event.target.files[0];if(!file)return;profile=null;refresh();if(file.size>5*1024*1024)throw new Error('ICC profile is too large.');const bytes=new Uint8Array(await file.arrayBuffer());if(generation!==profileRead)return;PrintCore.validateICC(bytes);const name=PrintCore.profileDescription(bytes);const entry=PROFILE_CATALOG.find(p=>p.id===mode);if(entry && name!==entry.name)throw new Error('Choose '+entry.name+'. This file contains '+(name||'an unnamed profile')+'.');if(entry){const encoded=encodeProfile(bytes);profiles[mode]=encoded;parent.postMessage({pluginMessage:{type:'save-profile',id:mode,encoded}},'*');}else{customProfile=bytes;customName=name||file.name;}chooseProfile();}catch(error){if(generation!==profileRead)return;status(error.message,'error');}refresh();};
el('export').onclick=()=>{try{const width=dimensions.width,height=dimensions.height;const auto=el('auto-size').checked;const sizes=auto?frames.map(f=>PrintCore.frameSize(f.width,f.height)):null;if(sizes)for(const size of sizes){PrintCore.points(size.width);PrintCore.points(size.height);}else{PrintCore.points(width);PrintCore.points(height);}job={width,height,auto,sizes,unit,displayWidth:el('width').value,displayHeight:el('height').value,icc:profile?profile.slice():null,name:profileName};busy=true;refresh();status('Preparing frames…','busy');parent.postMessage({pluginMessage:{type:'export',ids:frames.map(f=>f.id)}},'*');}catch(error){status(error.message,'error');}};
el('cancel').onclick=()=>{stop();status('Conversion cancelled.');};
window.onmessage=async event=>{
 const msg=event.data.pluginMessage;if(!msg)return;
 if(msg.type==='profiles'){for(const entry of PROFILE_CATALOG){const encoded=msg.profiles && msg.profiles[entry.id];if(typeof encoded==='string' && !profiles[entry.id]){try{const bytes=decodeProfile(encoded);PrintCore.validateICC(bytes);if(PrintCore.profileDescription(bytes)===entry.name)profiles[entry.id]=encoded;}catch(error){/* Ignore invalid stored files. */}}}if(!busy)chooseProfile(false);}
 if(msg.type==='profile-storage-error')status('Profile imported for this session. Figma could not save it for next time.','error');
 if(msg.type==='selection'){if(busy)return;frames=msg.frames.sort((a,b)=>a.name.localeCompare(b.name,undefined,{numeric:true}));updateSize();renderFrames();refresh();}
 if(msg.type==='status')status(msg.text,'busy');
 if(msg.type==='error'){stop();status(msg.text,'error');}
 if(msg.type==='pdfs' && job){const current=job;try{if(current.auto && msg.sizes)current.sizes=msg.sizes.map(size=>PrintCore.frameSize(size.width,size.height));
  status('Combining pages…','busy');const merged=await PDFLib.PDFDocument.create();for(const bytes of msg.pdfs){const source=await PDFLib.PDFDocument.load(new Uint8Array(bytes));for(const page of await merged.copyPages(source,source.getPageIndices()))merged.addPage(page);}
  const pdf=await merged.save();if(job!==current)return;status('Converting colors to CMYK…','busy');
  const url=URL.createObjectURL(new Blob([WORKER_SOURCE],{type:'text/javascript'}));worker=new Worker(url);URL.revokeObjectURL(url);refresh();
  worker.onerror=event=>{stop();status('Conversion could not start: '+event.message,'error');};
  worker.onmessage=async event=>{if(job!==current)return;worker.terminate();worker=null;refresh();try{if(event.data.error)throw new Error(event.data.error);status(current.icc?'Setting print size and embedding profile…':'Setting print size…','busy');const output=await PrintCore.finish(event.data.bytes,current.icc,current.width,current.height,current.name,current.sizes);if(job!==current)return;const url=URL.createObjectURL(new Blob([output],{type:'application/pdf'}));const a=document.createElement('a');a.href=url;a.download=current.auto?'Open-Print-frame-size.pdf':'Open-Print-'+current.displayWidth+'x'+current.displayHeight+current.unit+'.pdf';a.textContent='Save PDF';el('status').replaceChildren(document.createTextNode('Export complete.'),a);el('status').className='done';a.click();setTimeout(()=>URL.revokeObjectURL(url),60000);stop();}catch(error){stop();status(error.message,'error');}};
  const wasm=Uint8Array.from(atob(WASM_BASE64),c=>c.charCodeAt(0));worker.postMessage({wasm,pdf,icc:current.icc?current.icc.slice():null},[wasm.buffer,pdf.buffer]);
 }catch(error){stop();status(error.message,'error');}}
 };
function chooseProfile(invalidate=true){
 if(invalidate)++profileRead;const mode=el('profile-mode').value;const entry=PROFILE_CATALOG.find(p=>p.id===mode);
 if(entry){profile=profiles[mode]?decodeProfile(profiles[mode]):null;profileName=entry.name;}
 else if(mode==='none'){profile=null;profileName='';}
 else {profile=customProfile;profileName=customName;}
 if(profile)PrintCore.validateICC(profile);
 el('custom-profile').hidden=mode!=='custom'&&!!(profile||mode==='none');
 el('profile-hint').textContent=mode==='none'?'Exports CMYK using the default conversion. No ICC profile is embedded.':entry?(profile?'':'This profile isn’t bundled. Import its ICC file once; Figma keeps it locally when storage has space.'):profile?'Using '+profileName+'. It will be embedded in the PDF.':'Choose your printer’s CMYK ICC profile. It will be embedded in the PDF.';
 el('profile-hint').hidden=!el('profile-hint').textContent;
 status(entry&&!profile?'Import '+entry.name+' to begin.':mode==='custom'&&!profile?'Choose a CMYK profile to begin.':'');refresh();
}
for(const group of [...new Set(PROFILE_CATALOG.map(p=>p.group))]){const optgroup=document.createElement('optgroup');optgroup.label=group;for(const entry of PROFILE_CATALOG.filter(p=>p.group===group)){const option=document.createElement('option');option.value=entry.id;option.textContent=entry.name;optgroup.append(option);}el('profile-mode').append(optgroup);}
el('profile-mode').value=profiles.CoatedFOGRA39?'CoatedFOGRA39':customProfile?'custom':'none';
el('profile-mode').onchange=()=>{el('profile').value='';chooseProfile();};chooseProfile();
parent.postMessage({pluginMessage:{type:'load-profiles'}},'*');
parent.postMessage({pluginMessage:{type:'ready'}},'*');
