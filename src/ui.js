const el=id=>document.getElementById(id);let frames=[],profile=null,profileName='',worker=null,busy=false,job=null,profileRead=0,customProfile=null,customName='',engineAbort=null;
let unit='mm',dimensions={width:null,height:null},autoSize=true,bleedSetting=3,marksEnabled=false,marks={offset:3,length:5,weight:0.25},downloadUrls=[],downloadQueue=null,issues=[],selectionKey='';
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
// Figma's layer icons. A component is four diamonds, an instance one hollow diamond.
const COMPONENT_ICON='<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M8 2.2 10 4.2 8 6.2 6 4.2zM8 9.8 10 11.8 8 13.8 6 11.8zM4.2 6 6.2 8 4.2 10 2.2 8zM11.8 6 13.8 8 11.8 10 9.8 8z"/></svg>',INSTANCE_ICON='<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path fill-rule="evenodd" d="M8 2.3 13.7 8 8 13.7 2.3 8zm0 1.4L3.7 8 8 12.3 12.3 8z"/></svg>';
// Frames, components and instances export. Bleed is added to frames and components; an instance takes its main component's.
const printable=f=>f.type==='FRAME'||f.type==='COMPONENT'||f.type==='INSTANCE',editable=f=>f.type==='FRAME'||f.type==='COMPONENT';
const FRAME_ICON='<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M5.5 2v2.5H3v1h2.5v5H3v1h2.5V14h1v-2.5h5V14h1v-2.5H15v-1h-2.5v-5H15v-1h-2.5V2h-1v2.5h-5V2zm1 3.5h5v5h-5z"/></svg>',WARNING_ICON='<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M8 2.5 14 13H2zm-.5 4v3h1v-3zm0 4v1h1v-1z"/></svg>';
const formatSize=size=>{const value=mm=>unit==='in'?Math.round(mm/25.4*100)/100:mm;return value(size.width)+' × '+value(size.height)+' '+unit;};
const PLUS_ICON='<svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M11.5 7h1v4.5H17v1h-4.5V17h-1v-4.5H7v-1h4.5z"/></svg>',MINUS_ICON='<svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M7 11.5h10v1H7z"/></svg>';
// A + or − header button, named by its tooltip.
function setToggle(id,on,label){const button=el(id);if(button.on!==on){button.innerHTML=on?MINUS_ICON:PLUS_ICON;button.on=on;}button.title=label;button.ariaLabel=label;}
// Bleed arrives from the canvas in frame units, 72 to the inch.
const frameBleed=frame=>printable(frame)&&frame.bleed>0?Math.round(frame.bleed*25.4/72*100)/100:0;
const formatLength=mm=>(unit==='in'?Math.round(mm/25.4*1000)/1000:mm)+' '+unit;
const marksOn=()=>marksEnabled,pdfxOn=()=>el('pdfx').checked&&!!profile;
// A custom page size scales each frame to fit, so the bleed that reaches the PDF shrinks with it.
const fitFor=frame=>autoSize||dimensions.width===null||dimensions.height===null||sizeProblem()?null:PrintCore.fit(PrintCore.frameSize(frame.width,frame.height),dimensions);
const pdfBleed=frame=>{const fit=fitFor(frame);return Math.round(PrintCore.scaledBleed(frameBleed(frame),fit?fit.scale:1)*100)/100;};
function marksProblem(){return marksOn()?PrintCore.marksProblem(marks,Math.max(0,...frames.map(pdfBleed))):'';}
// Scaling down must leave enough bleed. The fix makes the canvas bleed big enough to survive the scale.
function scaleProblem(){
 let text='',needed=0;
 for(const frame of frames){const fit=frameBleed(frame)?fitFor(frame):null,problem=fit&&PrintCore.scaledBleedProblem(frameBleed(frame),fit.scale);if(!problem)continue;text=text||problem;needed=Math.max(needed,Math.ceil(PrintCore.MIN_SCALED_BLEED/fit.scale*10)/10);}
 return {text,needed};
}
function bleedProblem(){return Number.isFinite(bleedSetting)&&bleedSetting>0&&bleedSetting<=20?'':'Enter a bleed between 0 and 20 mm.';}
function showLengths(){el('bleed').value=displayDimension(bleedSetting);el('mark-offset').value=displayDimension(marks.offset);el('mark-length').value=displayDimension(marks.length);el('mark-weight').value=marks.weight;for(const id of ['bleed','mark-offset','mark-length']){el(id).step=unit==='in'?'.01':'.5';}}
// The finished sheet: trim plus the bleed, or plus the marks' offset and length.
function sheetHint(){
 const valid=frames.filter(printable),bleeds=[...new Set(valid.map(pdfBleed))];
 if(!valid.length||(!marksOn()&&bleeds.every(b=>!b)))return '';
 if(dimensions.width===null||dimensions.height===null||bleeds.length>1||marksProblem()||scaleProblem().text)return '';
 const margin=PrintCore.margin(bleeds[0],marksOn()?marks:null),round=v=>Math.round(v*100)/100;
 return 'PDF page '+formatSize({width:round(dimensions.width+2*margin),height:round(dimensions.height+2*margin)})+(marksOn()?' with crop marks.':' with bleed.');
}
// Truncate in the middle so names that share a long prefix stay distinguishable. The kept end starts at a word.
const NAME_TAIL=14;
function tailStart(chars){if(chars.length<=NAME_TAIL+6)return chars.length;const start=chars.length-NAME_TAIL,space=chars.indexOf(' ',start);return space>=0&&space<chars.length-1?space:start;}
function nameNode(text){
 const name=document.createElement('span'),start=document.createElement('span'),end=document.createElement('span'),chars=[...text],cut=tailStart(chars);
 name.className='name';name.title=text;start.className='start';end.className='end';start.textContent=chars.slice(0,cut).join('');end.textContent=chars.slice(cut).join('');name.append(start,end);return name;
}
const ISSUE_LABELS={effect:'Unsupported effect'},ISSUES_PER_FRAME=3;
// Preflight limits at print size, after any scaling to a typed page size. Errors are things the printer will reject or that print visibly wrong; warnings are worth a look.
const PREFLIGHT={lowPpi:150,targetPpi:300,smallText:6,richText:12,safe:3,hairline:0.25,bleed:3},POINTS_PER_MM=72/25.4;
let checks=new Map(),checksOpen=false,openFrames=new Set();
function preflightIssues(frame){
 const check=checks.get(frame.id);if(!check||!printable(frame))return [];
 const fit=fitFor(frame),scale=fit?fit.scale:1,pt=v=>Math.round(v*scale*10)/10+' pt',out=[];
 const add=(severity,label,f)=>out.push({severity,label,name:f.name,nodeId:f.nodeId,frameId:frame.id});
 for(const f of check.findings){
  if(f.kind==='effect')add('error','Unsupported effect',f);
  if(f.kind==='image'){const ppi=Math.round(f.ppi/scale);if(ppi<PREFLIGHT.targetPpi)add(ppi<PREFLIGHT.lowPpi?'error':'warning',ppi+' ppi image',f);}
  if(f.kind==='stroke'&&f.weight*scale<PREFLIGHT.hairline)add('warning',pt(f.weight)+' hairline',f);
  if(f.kind==='bleed')add('warning','Needs bleed',f);
  if(f.kind!=='text')continue;
   if(f.size!==null&&f.size*scale<PREFLIGHT.smallText)add('warning',pt(f.size)+' text',f);
  // Without Pure black as 100% K, #000000 prints in four inks too.
  const rich=Math.min(f.rich===null?Infinity:f.rich,f.pure!==null&&!el('pure-black').checked?f.pure:Infinity);
  if(rich*scale<PREFLIGHT.richText)add('warning','Rich black '+pt(rich)+' text',f);
  if(f.gap!==null&&f.gap*scale<PREFLIGHT.safe*POINTS_PER_MM)add('warning','Within '+PREFLIGHT.safe+' mm of the edge',f);
 }
 // Bleed shrunk by a smaller page size already blocks export, so this covers bleed that was set too small.
 const bleed=pdfBleed(frame);if(bleed>0&&bleed<PREFLIGHT.bleed-0.005&&!scaleProblem().text)add('warning','Bleed under '+PREFLIGHT.bleed+' mm',{name:frame.name,nodeId:frame.id});
 return out.sort((a,b)=>(a.severity==='error'?0:1)-(b.severity==='error'?0:1));
}
// The footer line works like InDesign's preflight light: a dot and a count, worded as errors like InDesign's (warnings count too), with the problems listed under their frames when shown.
function renderPreflight(){
 const valid=frames.filter(printable),checked=valid.every(f=>checks.has(f.id)),all=valid.flatMap(preflightIssues),errors=all.some(i=>i.severity==='error');
 el('preflight').hidden=!valid.length;if(!valid.length)return;
 el('preflight-summary').textContent=!checked?'Checking…':!all.length?'No errors':all.length===1?'1 error':all.length+' errors';
 el('preflight-summary').className='preflight-summary'+(!checked?'':!all.length?' ok':errors?' error':' warning');
 el('preflight-toggle').hidden=!all.length;el('preflight-toggle').textContent=checksOpen?'Hide':'Show';
}
function issueRow(issue,warning){
 const li=document.createElement('li'),show=document.createElement('button');li.className='issue'+(warning?' warning':'');
 show.className='link';show.textContent='Show';show.title='Zoom to '+issue.name;show.onclick=()=>parent.postMessage({pluginMessage:{type:'show-layer',id:issue.nodeId}},'*');
 li.append(nameNode(issue.label+' · '+issue.name),show);return li;
}
// Export errors always show. Preflight problems show when the footer line is open, a few per frame unless that frame is expanded.
function renderIssues(frame){
 const own=checksOpen?preflightIssues(frame):[];
 for(const issue of issues.filter(i=>i.frameId===frame.id))if(!own.some(i=>i.nodeId===issue.nodeId&&i.label===(ISSUE_LABELS[issue.kind]||'Issue')))own.unshift({severity:'error',label:ISSUE_LABELS[issue.kind]||'Issue',name:issue.name,nodeId:issue.nodeId,frameId:frame.id});
 const shown=openFrames.has(frame.id)?own:own.slice(0,ISSUES_PER_FRAME);
 for(const issue of shown)el('frames').append(issueRow(issue,issue.severity==='warning'));
 if(own.length>shown.length){const li=document.createElement('li'),more=document.createElement('button');li.className='issue more';more.className='link';more.textContent=(own.length-shown.length)+' more in this frame';more.onclick=()=>{openFrames.add(frame.id);renderFrames();};li.append(more);el('frames').append(li);}
 return own.length;
}
function renderFrames(){el('frames').replaceChildren();let listed=0;if(!frames.length){const li=document.createElement('li');li.className='empty';li.textContent='Select frames or components on the canvas.';el('frames').append(li);}for(const frame of frames){const valid=printable(frame),li=document.createElement('li'),size=document.createElement('span');li.className=valid?'':'invalid';li.innerHTML=!valid?WARNING_ICON:frame.type==='COMPONENT'?COMPONENT_ICON:frame.type==='INSTANCE'?INSTANCE_ICON:FRAME_ICON;size.className='size';// Page size and Bleed already give the sizes, so a frame row is just its name; only a non-frame says why it's flagged.
li.append(nameNode(frame.name));if(!valid){size.textContent='Not a frame or component';li.append(size);}el('frames').append(li);listed+=renderIssues(frame);}el('frames').className=listed?'expanded':'';}
function sizeProblem(){if(autoSize)return '';if(dimensions.width===null||dimensions.height===null)return 'Enter a width and height.';try{PrintCore.points(dimensions.width);PrintCore.points(dimensions.height);return '';}catch(error){return error.message;}}
function fieldInvalid(id){if(autoSize||dimensions[id]===null)return false;try{PrintCore.points(dimensions[id]);return false;}catch(error){return true;}}
function profileProblem(){if(el('profile-mode').value==='none'||profile)return '';const entry=PROFILE_CATALOG.find(p=>p.id===el('profile-mode').value);return entry?'Import '+entry.name+' to export.':'Choose a CMYK profile to export.';}
function refresh(){const invalid=frames.filter(f=>!printable(f)),problem=sizeProblem(),count=frames.length-invalid.length,separate=el('export-mode').value==='separate';const marking=marksProblem(),scaling=scaleProblem().text;el('export').disabled=busy||!!downloadQueue||!!profileProblem()||!frames.length||invalid.length>0||!!problem||!!marking||!!scaling;el('export').textContent=busy?'Exporting…':count<2?'Export CMYK PDF':separate?'Export '+count+' CMYK PDFs':'Export '+count+'-page CMYK PDF';el('export-hint').textContent=busy?'':!frames.length?'':invalid.length?'Only frames and components can be exported. Deselect '+(invalid.length===1?'“'+invalid[0].name+'”':invalid.length+' layers')+'.':problem?'':marking?'Fix the crop mark settings to export.':scaling?'Fix the bleed to export.':profileProblem();
 const widthInvalid=fieldInvalid('width'),heightInvalid=fieldInvalid('height');el('width-field').className='field'+(widthInvalid?' invalid':'');el('height-field').className='field'+(heightInvalid?' invalid':'');el('size-error').textContent=problem;el('size-error').className='hint'+(widthInvalid||heightInvalid?' error':'');el('size-snap').disabled=busy||!!downloadQueue;el('frame-count').textContent=!frames.length?'':invalid.length?frames.length+' selected':frames.length+(frames.length===1?' page':' pages');el('cancel').hidden=!busy;el('cancel').textContent='Cancel';el('profile').disabled=busy||!!downloadQueue;el('profile-mode').disabled=busy||!!downloadQueue;el('width').disabled=busy||!!downloadQueue;el('height').disabled=busy||!!downloadQueue;el('size-reset').disabled=busy||!!downloadQueue;el('units').disabled=busy||!!downloadQueue;el('new-frame').disabled=busy||!!downloadQueue;newFrameLabel();el('export-options').hidden=count<2;el('export-mode').disabled=busy||!!downloadQueue;
 const locked=busy||!!downloadQueue,bleeds=frames.map(frameBleed).filter(b=>b),shown=[...new Set(bleeds)];
 // The header button is − once every selected frame has bleed, otherwise +. The amount shows once any frame has bleed, and editing it resizes that bleed.
 // Instances can't take new layers, so the button acts on frames and components only, and instances show their main component's bleed.
 const owners=frames.filter(editable),instances=frames.filter(f=>f.type==='INSTANCE'),anyBleed=bleeds.length>0;
 const all=owners.length?owners.every(frameBleed):count>0&&bleeds.length===count;
 setToggle('bleed-toggle',all,!owners.length&&instances.length?'Add bleed to the main component':all?'Remove bleed':'Add bleed');el('bleed-toggle').disabled=locked||!owners.length||(!all&&anyBleed&&!!bleedProblem());
 el('bleed-options').hidden=!anyBleed;el('bleed-section').className=anyBleed?'':'collapsed';el('bleed').disabled=locked||!owners.length;
 el('bleed-field').className='field plain'+(bleedProblem()?' invalid':'');
 el('bleed-hint').textContent=!anyBleed?'':bleedProblem()||(shown.length>1?'Bleed varies between frames: '+shown.map(formatLength).join(', ')+'.':bleeds.length<count?bleeds.length+' of '+count+' frames '+(bleeds.length===1?'has':'have')+' bleed.':'');
 el('bleed-hint').className='hint'+(bleedProblem()?' error':'');
 // Bleed that a smaller page size would shrink too far has one fix: more bleed on the canvas.
 const scaled=scaleProblem();if(scaled.text&&!bleedProblem()){el('bleed-hint').className='hint error';el('bleed-hint').replaceChildren(document.createTextNode(scaled.text+' '));if(!locked){const fix=document.createElement('button');fix.className='link';fix.textContent='Use '+formatLength(scaled.needed)+' bleed';fix.onclick=()=>parent.postMessage({pluginMessage:{type:'show-bleed',ids:frames.filter(f=>editable(f)&&frameBleed(f)).map(f=>f.id),bleed:scaled.needed*72/25.4}},'*');el('bleed-hint').append(fix);}}
 // An instance without bleed gets it from its main component, so point there.
 const bare=instances.filter(f=>!frameBleed(f)),mains=[...new Set(bare.map(f=>f.mainId).filter(Boolean))];
 if(bare.length&&!el('bleed-hint').textContent){el('bleed-hint').className='hint';el('bleed-hint').replaceChildren(document.createTextNode((bare.length===1?'This instance takes':'Instances take')+' bleed from '+(mains.length>1?'their main components.':bare.length===1?'its main component.':'their main component.')+(mains.length===1&&!locked?' ':'')));if(mains.length===1&&!locked){const go=document.createElement('button');go.className='link';go.textContent='Select main component';go.onclick=()=>parent.postMessage({pluginMessage:{type:'select-layer',id:mains[0]}},'*');el('bleed-hint').append(go);}}
 setToggle('marks-toggle',marksOn(),marksOn()?'Remove crop marks':'Add crop marks');el('marks-toggle').disabled=locked||(!count&&!marksOn());
 el('marks-options').hidden=!marksOn();el('marks-section').className=marksOn()?'':'collapsed';for(const id of ['mark-offset','mark-length','mark-weight'])el(id).disabled=locked;
 el('marks-error').textContent=marking;
 // An offset inside the bleed has one obvious fix, so offer it.
 const needed=Math.max(0,...frames.map(pdfBleed));if(/at least the bleed/.test(marking)&&!locked){const fix=document.createElement('button');fix.className='link';fix.textContent='Use '+formatLength(needed);fix.onclick=()=>{marks.offset=needed;showLengths();clearResult();refresh();};el('marks-error').replaceChildren(document.createTextNode(marking+' '),fix);}el('mark-offset-field').className='field plain'+(/Offset/.test(marking)?' invalid':'');el('mark-length-field').className='field plain'+(/Length/.test(marking)?' invalid':'');el('mark-weight-field').className='field plain'+(/Thickness/.test(marking)?' invalid':'');
 // The page size sits under the last section that is on.
 el('sheet-hint').textContent=sheetHint();el('sheet-hint').hidden=!el('sheet-hint').textContent;if(!marksOn()&&anyBleed)el('bleed-section').append(el('sheet-hint'));else el('marks-section').append(el('sheet-hint'));
 // PDF/X needs an output intent, so it waits for a profile.
 el('pdfx').disabled=locked||!profile;el('pure-black').disabled=locked;el('pdfx-hint').textContent=profile||!el('pdfx').checked?'':'PDF/X-4 needs a color profile.';
 renderPreflight();if(checksOpen)renderFrames();}
function stop(){if(engineAbort){engineAbort.abort();engineAbort=null;}if(worker){worker.terminate();worker=null;}busy=false;job=null;refresh();parent.postMessage({pluginMessage:{type:'ready'}},'*');}
function updateSize(){
 const valid=frames.filter(printable);
 if(autoSize){
  const sizes=valid.map(f=>PrintCore.frameSize(f.width,f.height));
  const same=sizes.length && sizes.every(s=>s.width===sizes[0].width && s.height===sizes[0].height);
  dimensions={width:same?sizes[0].width:null,height:same?sizes[0].height:null};
  el('width').value=displayDimension(dimensions.width);el('height').value=displayDimension(dimensions.height);
  el('width').placeholder=sizes.length?'Varies':'';el('height').placeholder=sizes.length?'Varies':'';
  el('size-hint').textContent=!sizes.length||same?'':'Each PDF page uses its own frame’s size. Enter dimensions to override all pages.';
  showPaperMatch(same?paperMatch(sizes[0]):null);
 }else{
  // Every page takes your size, and each frame scales to fit it, centred.
  const scales=[...new Set(valid.map(f=>{const fit=fitFor(f);return fit?Math.round(fit.scale*100):null;}).filter(v=>v!==null))];
  el('size-hint').textContent='Your size applies to every page. Artwork scales'+(scales.length===1&&scales[0]!==100?' to '+scales[0]+'%':'')+' to fit, centred.';showPaperMatch(null);}
 el('size-hint').hidden=!el('size-hint').textContent;el('size-reset').hidden=autoSize||!valid.length;
 refresh();
}
const PAPER=PrintCore.PAPER,PAPER_TOLERANCE=0.5,PAPER_TOLERANCE_SHARE=0.002;
// Within 0.5 mm, or 0.2% on big sheets, so a whole-pixel A0 such as 2380 × 3368 still counts.
const near=mm=>Math.max(PAPER_TOLERANCE,mm*PAPER_TOLERANCE_SHARE);
function paperMatch(size){for(const [name,w,h] of PAPER)for(const [width,height] of [[w,h],[h,w]])if(Math.abs(size.width-width)<=near(width)&&Math.abs(size.height-height)<=near(height))return size.width===width&&size.height===height?null:{name,width,height};return null;}
function showPaperMatch(match){
 el('size-match').hidden=!match;if(!match)return;
 el('size-match-text').textContent='Close to '+match.name+' ('+formatSize(match)+')';el('size-snap').textContent='Use '+match.name;
 el('size-snap').onclick=()=>{dimensions={width:match.width,height:match.height};autoSize=false;for(const id of ['width','height'])el(id).value=displayDimension(dimensions[id]);clearResult();updateSize();};
}
el('preflight-toggle').onclick=()=>{checksOpen=!checksOpen;openFrames.clear();renderPreflight();renderFrames();};
el('export-mode').value='combined';el('export-mode').onchange=()=>{clearResult();refresh();};
el('units').value='mm';
el('units').onchange=()=>{clearResult();unit=el('units').value;for(const id of ['width','height']){el(id+'-unit').textContent=unit;el(id).min=unit==='in'?10/25.4:10;el(id).max=unit==='in'?2000/25.4:2000;el(id).step=unit==='in'?'.001':'.01';el(id).value=displayDimension(dimensions[id]);}for(const node of document.querySelectorAll?document.querySelectorAll('.length-unit'):[])node.textContent=unit;showLengths();updateSize();renderFrames();};
// New frame adds an exact paper-size frame to the canvas, which then becomes the selection. With frames selected, it resizes them instead.
function newFrameLabel(){const label=frames.some(printable)?'Resize to paper size':'New frame',select=el('new-frame'),trigger=select.nextElementSibling;select.setAttribute('aria-label',label);if(trigger&&trigger.className==='icon'){trigger.title=label;trigger.setAttribute('aria-label',label);}}
el('new-frame').onchange=()=>{const size=el('new-frame').value;el('new-frame').value='';if(size)parent.postMessage({pluginMessage:{type:'new-frame',size}},'*');};
el('size-reset').onclick=()=>{autoSize=true;clearResult();updateSize();};
const readLength=id=>el(id).value===''?NaN:Number(el(id).value)*(unit==='in'?25.4:1);
el('bleed').oninput=()=>{bleedSetting=readLength('bleed');refresh();};
el('mark-offset').oninput=()=>{marks.offset=readLength('mark-offset');clearResult();refresh();};
el('mark-length').oninput=()=>{marks.length=readLength('mark-length');clearResult();refresh();};
el('mark-weight').oninput=()=>{marks.weight=el('mark-weight').value===''?NaN:Number(el('mark-weight').value);clearResult();refresh();};
el('marks-toggle').onclick=()=>{marksEnabled=!marksEnabled;clearResult();refresh();};
// Clicking anywhere on a header row does what its button does. A click on the button itself is left to the button: it redraws its icon, so the clicked element has left the page by the time the click reaches the row.
for(const [head,button] of [['bleed-head','bleed-toggle'],['marks-head','marks-toggle']])el(head).onclick=event=>{if(event&&event.composedPath&&event.composedPath().includes(el(button)))return;if(!el(button).disabled)el(button).onclick();};
el('pdfx').onchange=el('pure-black').onchange=()=>{clearResult();refresh();};
const frameIds=()=>frames.filter(editable).map(f=>f.id),allBleed=()=>{const valid=frames.filter(editable);return valid.length>0&&valid.every(frameBleed);};
const addBleed=()=>{if(bleedProblem())return;parent.postMessage({pluginMessage:{type:'show-bleed',ids:frameIds(),bleed:bleedSetting*72/25.4}},'*');};
el('bleed-toggle').onclick=()=>{if(allBleed())parent.postMessage({pluginMessage:{type:'hide-bleed',ids:frameIds()}},'*');else{if(bleedProblem()&&el('bleed-options').hidden){bleedSetting=3;showLengths();}addBleed();}};
// A committed amount (Enter or leaving the field) resizes bleed the selection already has.
el('bleed').onchange=()=>{if(busy||downloadQueue)return;if(allBleed()&&frames.some(f=>editable(f)&&frameBleed(f)!==bleedSetting))addBleed();};
showLengths();
for(const id of ['width','height'])el(id).oninput=()=>{dimensions[id]=el(id).value===''?null:Number(el(id).value)*(unit==='in'?25.4:1);autoSize=false;clearResult();updateSize();};
el('profile').onchange=async event=>{const generation=++profileRead;const mode=el('profile-mode').value;try{const file=event.target.files[0];if(!file)return;profile=null;refresh();if(file.size>5*1024*1024)throw new Error('ICC profile is too large.');const bytes=new Uint8Array(await file.arrayBuffer());if(generation!==profileRead)return;PrintCore.validateICC(bytes);const name=PrintCore.profileDescription(bytes);const entry=PROFILE_CATALOG.find(p=>p.id===mode);if(entry && name!==entry.name)throw new Error('Choose '+entry.name+'. This file contains '+(name||'an unnamed profile')+'.');if(entry){const encoded=encodeProfile(bytes);profiles[mode]=encoded;parent.postMessage({pluginMessage:{type:'save-profile',id:mode,encoded}},'*');}else{customProfile=bytes;customName=name||file.name;}chooseProfile();}catch(error){if(generation!==profileRead)return;status(error.message,'error');}refresh();};
el('export').onclick=()=>{try{const width=dimensions.width,height=dimensions.height;const auto=autoSize;const sizes=auto?frames.map(f=>PrintCore.frameSize(f.width,f.height)):null;if(sizes)for(const size of sizes){PrintCore.points(size.width);PrintCore.points(size.height);}else{PrintCore.points(width);PrintCore.points(height);}stopDownloadQueue();for(const url of downloadUrls)URL.revokeObjectURL(url);downloadUrls=[];job={individual:frames.length>1&&el('export-mode').value!=='combined',filenames:frames.map(f=>f.name+'.pdf'),filename:frames[0].name+'.pdf',width,height,auto,sizes,unit,displayWidth:el('width').value,displayHeight:el('height').value,icc:profile?profile.slice():null,name:profileName,marks:marksOn()?{...marks}:null,fits:auto?null:frames.map(fitFor),pureBlack:el('pure-black').checked,pdfx:pdfxOn()};busy=true;refresh();status('Preparing frames…','busy');parent.postMessage({pluginMessage:{type:'export',ids:frames.map(f=>f.id),prints:job.fits?job.fits.map(f=>f.scale):null}},'*');}catch(error){status(error.message,'error');}};
el('cancel').onclick=()=>{parent.postMessage({pluginMessage:{type:'cancel'}},'*');stop();status('Export cancelled.');};
window.onmessage=async event=>{
 const msg=event.data.pluginMessage;if(!msg)return;
 if(msg.type==='profiles'){for(const entry of PROFILE_CATALOG){const encoded=msg.profiles && msg.profiles[entry.id];if(typeof encoded==='string' && !profiles[entry.id]){try{const bytes=decodeProfile(encoded);PrintCore.validateICC(bytes);if(PrintCore.profileDescription(bytes)===entry.name)profiles[entry.id]=encoded;}catch(error){/* Ignore invalid stored files. */}}}if(!busy&&!downloadQueue)chooseProfile(false);}
 if(msg.type==='profile-storage-error')status('Profile imported for this session. Figma could not save it for next time.','error');
 if(msg.type==='selection'){if(busy||downloadQueue)return;frames=msg.frames.sort((a,b)=>a.name.localeCompare(b.name,undefined,{numeric:true}));
  // The plugin re-sends the selection after every export; only a real change clears the result.
  const key=JSON.stringify(frames.map(f=>[f.id,f.name,f.type,f.width,f.height,f.bleed]));if(key!==selectionKey){selectionKey=key;clearResult();
   // The bleed field follows the selection when its frames share one bleed, so editing it starts from what is on the canvas.
   const shown=[...new Set(frames.map(frameBleed).filter(b=>b))];if(shown.length===1&&shown[0]!==bleedSetting){bleedSetting=shown[0];showLengths();}}
  updateSize();renderFrames();refresh();}
 // Preflight results replace the last set and are kept per frame, so they can arrive before or after the selection.
 if(msg.type==='preflight'){checks=new Map((msg.frames||[]).map(f=>[f.id,f]));renderPreflight();renderFrames();}
 if(msg.type==='status')status(msg.text,'busy');
 if(msg.type==='error'){stop();if(Array.isArray(msg.issues)&&msg.issues.length){issues=msg.issues;renderFrames();const layers=new Set(issues.map(i=>i.nodeId)).size;status((layers===1?'1 layer uses':layers+' layers use')+' an unsupported effect, listed under its frame above. Remove the effect or flatten the layer, then export again.','error');}else status(msg.text,'error');}
 if(msg.type==='pdfs' && job){const current=job;try{current.bleeds=(msg.bleeds||[]).map(px=>px*25.4/72);if(current.auto && msg.sizes)current.sizes=msg.sizes.map(size=>PrintCore.frameSize(size.width,size.height));
  status('Combining pages…','busy');const merged=await PDFLib.PDFDocument.create();
  for(let i=0;i<msg.pdfs.length;i++){const source=await PDFLib.PDFDocument.load(new Uint8Array(msg.pdfs[i])),scale=(msg.scales&&msg.scales[i]||1)/(current.fits?current.fits[i].scale:1);for(const page of await merged.copyPages(source,source.getPageIndices())){if(scale!==1)page.scale(1/scale,1/scale);merged.addPage(page);}}
  if(job!==current)return;status('Loading conversion engine…','busy');const downloadAbort=new AbortController();engineAbort=downloadAbort;refresh();const downloadTimer=setTimeout(()=>downloadAbort.abort(),60000);let wasm;try{wasm=await OpenPrintAssets.loadEngine(downloadAbort.signal,fraction=>{if(job===current)status('Downloading engine… '+Math.floor(fraction*100)+'%','busy');});}finally{clearTimeout(downloadTimer);}if(job!==current)return;engineAbort=null;
  const convert=bytes=>new Promise((resolve,reject)=>{
   const url=URL.createObjectURL(new Blob([WORKER_SOURCE],{type:'text/javascript'})),w=new Worker(url);URL.revokeObjectURL(url);worker=w;refresh();const engine=wasm.slice();
   w.onerror=event=>reject(new Error('Conversion could not start: '+event.message));
   w.onmessage=event=>{w.terminate();if(worker===w)worker=null;refresh();if(event.data.error)reject(new Error(event.data.error));else resolve(event.data.bytes);};
   w.postMessage({wasm:engine,pdf:bytes,icc:current.icc?current.icc.slice():null,compatibility:current.pdfx?'1.6':'1.7'},[engine.buffer,bytes.buffer]);
  });
  if(current.pureBlack)PrintCore.pureBlack(merged);
  status('Converting colors to CMYK…','busy');
  await PrintShading.toCMYK(merged,async bytes=>{const output=await convert(bytes);if(job!==current)throw new Error('Conversion cancelled.');return output;});
  if(job!==current)return;const converted=await convert(await merged.save());if(job!==current)return;
  const lowest=await PrintCore.imageResolution(converted);if(job!==current)return;
  status(current.icc?'Setting print size and embedding profile…':'Setting print size…','busy');const outputs=await prepareDownloads(converted,current);if(job!==current)return;stop();showDownloads(outputs);
  if(msg.effectPpi&&msg.effectPpi<300){const note=document.createElement('span');note.className='note';note.textContent='Effects are '+msg.effectPpi+' ppi, below the 300 ppi print target.';el('status').append(note);}
  if(lowest&&lowest.ppi<300){const note=document.createElement('span');note.className='note';note.textContent='Some images are as low as '+lowest.ppi+' ppi'+(lowest.pages>1?' on page '+lowest.page:'')+', below the 300 ppi print target.';el('status').append(note);}
 }catch(error){if(job!==current)return;stop();status(error.message,'error');}}
 };
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
function showDownloads(outputs){
 stopDownloadQueue();
 if(outputs.length>1){
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

 const output=outputs[0],links=document.createElement('div');links.className='downloads';links.hidden=true;
 const url=URL.createObjectURL(new Blob([output.bytes],{type:'application/pdf'})),a=document.createElement('a');
 a.href=url;a.download=output.filename;a.textContent='Save PDF';links.append(a);downloadUrls.push(url);
 const again=document.createElement('button');again.className='link again';again.textContent='Save again';again.onclick=()=>a.click();
 el('status').replaceChildren(document.createTextNode(output.filename+' is ready.'),links,again);el('status').className='done';
 a.click();return [a];
}
async function prepareDownloads(bytes,current){
 if(!current.individual)return [{filename:current.filename,bytes:await PrintCore.finish(bytes,current.icc,current.width,current.height,current.name,current.sizes,{bleeds:current.bleeds,fits:current.fits,marks:current.marks,pdfx:current.pdfx,title:current.filename.replace(/\.pdf$/,'')})}];
 const converted=await PDFLib.PDFDocument.load(bytes);
 if(converted.getPageCount()!==current.filenames.length)throw new Error('The exported page count does not match the selected frames. Please try again.');
 const outputs=[];
 for(let i=0;i<converted.getPageCount();i++){
  const single=await PDFLib.PDFDocument.create();const [page]=await single.copyPages(converted,[i]);single.addPage(page);
  const sizes=current.auto?[current.sizes[i]]:null;
  outputs.push({filename:current.filenames[i],bytes:await PrintCore.finish(await single.save(),current.icc,current.width,current.height,current.name,sizes,{bleeds:current.bleeds?[current.bleeds[i]]:[],fits:current.fits?[current.fits[i]]:null,marks:current.marks,pdfx:current.pdfx,title:current.filenames[i].replace(/\.pdf$/,'')})});
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
