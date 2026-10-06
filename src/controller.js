figma.showUI(__html__, {width:320,height:560,themeColors:true});
// New frame creates a paper-size frame at 72 units per inch, the scale the export uses, rounded to whole pixels like Figma's own presets (A4 is 595 × 842).
const PAPER_FRAMES={'A0':[841,1189],'A1':[594,841],'A2':[420,594],'A3':[297,420],'A4':[210,297],'A5':[148,210],'A6':[105,148],'DL':[99,210],'Business card':[85,55],'50 × 70 cm poster':[500,700],'70 × 100 cm poster':[700,1000],'Letter':[215.9,279.4],'Tabloid':[279.4,431.8]};
// With frames or components selected, it resizes them instead, from their top left, keeping each one landscape or portrait. Bleed and trim layers stretch with them.
function newPaperFrame(name) {
 const mm=Object.prototype.hasOwnProperty.call(PAPER_FRAMES,name)?PAPER_FRAMES[name]:null;if(!mm)return;
 const [width,height]=mm.map(v=>Math.round(v*72/25.4)),selected=figma.currentPage.selection.filter(n=>PRINTABLE.includes(n.type));
 if(selected.length){for(const n of selected){const landscape=n.width>n.height,[w,h]=landscape===(width>height)?[width,height]:[height,width];n.resize(w,h);}return;}
 const view=figma.viewport.bounds,frame=figma.createFrame();
 frame.name=name;frame.resize(width,height);frame.x=Math.round(figma.viewport.center.x-width/2);frame.y=Math.round(figma.viewport.center.y-height/2);
 figma.currentPage.selection=[frame];
 if(width>view.width||height>view.height)figma.viewport.scrollAndZoomIntoView([frame]);
}
// The window is resizable vertically. Its height is clamped and remembered between sessions.
const UI_WIDTH=320,uiHeight=h=>Math.min(1600,Math.max(360,Math.round(Number(h)||560)));
(async()=>{try{const h=await figma.clientStorage.getAsync('open-print-height');if(h)figma.ui.resize(UI_WIDTH,uiHeight(h));}catch(error){/* Keep the default height. */}})();
let exportRun=Promise.resolve(),exportId=0,profileSave=Promise.resolve();
// Show bleed adds this layer at the bottom of a frame. It holds the frame's background, sized to trim plus bleed rounded to whole pixels, and its plugin data records the exact bleed in frame units, which export uses.
const BLEED_KEY='open-print-bleed',BLEED_GUIDE={type:'SOLID',color:{r:1,g:0.2,b:0.2}};
const bleedLayer=frame=>(frame.children||[]).find(c=>typeof c.getPluginData==='function'&&c.getPluginData(BLEED_KEY)!=='')||null;
// The trim outline is a locked, unfilled layer at the top of a frame with bleed, marking the original edge. Export hides it.
const TRIM_KEY='open-print-trim',TRIM_GUIDE={type:'SOLID',color:{r:1,g:0.2,b:0.2}};
const trimLayer=frame=>(frame.children||[]).find(c=>typeof c.getPluginData==='function'&&c.getPluginData(TRIM_KEY)!=='')||null;
const bleedOf=frame=>{const layer=bleedLayer(frame),bleed=layer?Number(layer.getPluginData(BLEED_KEY)):0;return Number.isFinite(bleed)&&bleed>0?bleed:0;};
// Frames, components and instances export. Instances can't take new layers, so they show their main component's bleed instead of their own.
const PRINTABLE=['FRAME','COMPONENT','INSTANCE'];
// An instance's layers match its main component's one for one, so its bleed and trim layers sit where the main component's do.
async function layerOf(node,find) {
 if(node.type!=='INSTANCE')return find(node);
 const main=await node.getMainComponentAsync(),layer=main&&find(main),i=layer?main.children.indexOf(layer):-1;
 return i>=0&&node.children[i]&&node.children[i].name===layer.name?node.children[i]:null;
}
const bleedLayerOf=node=>layerOf(node,bleedLayer);
// An instance may be resized or scaled, so its bleed is measured from the layer, then scaled from the main component's whole-pixel layer to its exact bleed.
async function bleedOfNode(node) {
 if(node.type!=='INSTANCE')return bleedOf(node);
 const layer=await bleedLayerOf(node);let bleed=layer?(layer.width-node.width)/2:0;
 const main=bleed>0?await node.getMainComponentAsync():null,mainLayer=main&&bleedLayer(main),drawn=mainLayer?(mainLayer.width-main.width)/2:0;
 if(drawn>0)bleed*=bleedOf(main)/drawn;
 return bleed>0.001?Math.round(bleed*1000)/1000:0;
}
// The main component is offered as the place to add bleed, unless it comes from a library.
async function describe(n) {
 const item={id:n.id,name:n.name,width:n.width,height:n.height,type:n.type,bleed:0};
 if(!PRINTABLE.includes(n.type))return item;
 try{item.bleed=await bleedOfNode(n);if(n.type==='INSTANCE'){const main=await n.getMainComponentAsync();if(main&&!main.remote)item.mainId=main.id;}}catch(error){/* Show the node without bleed. */}
 return item;
}
// Selection changes can overlap while main components load, so only the latest one is posted.
let selectionId=0;
async function selection() { const id=++selectionId,frames=await Promise.all(figma.currentPage.selection.map(describe));if(id===selectionId){figma.ui.postMessage({type:'selection',frames});await preflight();} }
// Layers added to a frame land above its trim outline, so the outline moves back on top. Instances follow their main component.
function keepTrimOnTop(frame) {
 if(!frame||frame.removed||frame.type==='INSTANCE'||!PRINTABLE.includes(frame.type))return;
 const trim=trimLayer(frame);if(trim&&frame.children[frame.children.length-1]!==trim)frame.appendChild(trim);
}
function watchPage(page) {
 if(!page||typeof page.on!=='function')return;
 page.on('nodechange',event=>{for(const change of event.nodeChanges){const node=change.node;try{if(change.type!=='DELETE'&&node&&!node.removed)keepTrimOnTop(node.parent);}catch(error){/* The layer went away mid-change. */}}schedulePreflight();});
}
watchPage(figma.currentPage);figma.on('currentpagechange',()=>watchPage(figma.currentPage));
figma.on('selectionchange',()=>{for(const n of figma.currentPage.selection)try{keepTrimOnTop(n.parent);}catch(error){/* Leave the order alone. */}selection();});
// Figma rasterises these effects at 144 ppi in PDF exports. Other effect types are untested.
const EFFECTS=['DROP_SHADOW','INNER_SHADOW','LAYER_BLUR','BACKGROUND_BLUR'];
// Figma's PDF export can't draw these, so layers that use them are swapped for a 300 ppi PNG of the layer in the scaled copy.
const RASTER_EFFECTS=['NOISE','TEXTURE'];
// Frames with effects are exported from a scaled copy so their bitmaps reach about 300 ppi at print size.
const EFFECT_PPI=144,TARGET_PPI=300,MAX_EFFECT_EDGE=16384,MAX_IMAGE_EDGE=4096;
const hasRaster=node=>(node.effects||[]).some(e=>e.visible!==false&&RASTER_EFFECTS.includes(e.type));
const containsRaster=node=>node.visible!==false&&(hasRaster(node)||(node.children||[]).some(containsRaster));
// Records whether the node uses supported effects and whether any must be rasterised. Each issue names its frame and layer so the UI can list it under that frame and zoom to it.
function inspect(node,issues,frame,found={effects:false,raster:false}) {
 if(node.visible===false)return found;
 // A rasterised layer is drawn as one image, so anything inside it renders as Figma shows it.
 if(hasRaster(node)){found.effects=found.raster=true;return found;}
 for(const effect of node.effects||[]){if(effect.visible===false)continue;if(EFFECTS.includes(effect.type))found.effects=true;else if(!issues.some(i=>i.nodeId===node.id))issues.push({kind:'effect',text:'Unsupported effect in '+node.name,frameId:frame.id,nodeId:node.id,name:node.name});}
 if(node.children)for(const child of node.children)inspect(child,issues,frame,found);
 return found;
}
const multiply=(a,b)=>[0,1].map(r=>[a[r][0]*b[0][0]+a[r][1]*b[1][0],a[r][0]*b[0][1]+a[r][1]*b[1][1],a[r][0]*b[0][2]+a[r][1]*b[1][2]+a[r][2]]);
function invert(m){const d=m[0][0]*m[1][1]-m[0][1]*m[1][0],a=m[1][1]/d,b=-m[0][1]/d,c=-m[1][0]/d,e=m[0][0]/d;return [[a,b,-(a*m[0][2]+b*m[1][2])],[c,e,-(c*m[0][2]+e*m[1][2])]];}
// Covers the copied layer with a PNG of the original and hides the copy, keeping its place in any auto layout. Returns the image's ppi at print size.
async function swapForImage(original,copy,topLevel,state) {
 // state.print is how much the page is scaled for a custom page size, so the image reaches 300 ppi at the size it prints.
 const bounds=topLevel?original.absoluteBoundingBox:original.absoluteRenderBounds,target=topLevel?copy.absoluteBoundingBox:copy.absoluteRenderBounds;
 if(!bounds||!target||!bounds.width||!bounds.height)return Infinity;
 const k=Math.min(TARGET_PPI*state.print/72,MAX_IMAGE_EDGE/Math.max(bounds.width,bounds.height));
 const png=await original.exportAsync({format:'PNG',constraint:{type:'SCALE',value:k},useAbsoluteBounds:topLevel});
 // Until Figma has decoded a new image it paints the fill as one flat colour, so wait for it and check the PDF later.
 const created=figma.createImage(png),size=await created.getSizeAsync();state.images.push(size);
 const fill={type:'IMAGE',imageHash:created.hash,scaleMode:'FILL'};
 if(topLevel){for(const child of [...copy.children])child.remove();copy.effects=[];copy.strokes=[];copy.fills=[fill];return Math.round(72*k/state.print);}
 const image=figma.createRectangle(),parent=copy.parent;
 parent.insertChild(parent.children.indexOf(copy)+1,image);
 if(parent.layoutMode&&parent.layoutMode!=='NONE')image.layoutPositioning='ABSOLUTE';
 image.name=copy.name;image.resize(target.width,target.height);
 // The image shares the copy's parent, so this places it at the copy's absolute render bounds whatever the parent's transform.
 image.relativeTransform=multiply(multiply(copy.relativeTransform,invert(copy.absoluteTransform)),[[1,0,target.x],[0,1,target.y]]);
 image.fills=[fill];image.blendMode=copy.blendMode;
 // Clearing the effects stops Figma baking a bitmap of the hidden layer.
 copy.opacity=0;copy.effects=[];
 return Math.round(72*k/state.print);
}
// Whether Figma's PDF embeds an image of each expected size. Figma writes image dictionaries uncompressed.
const RETRIES=10,RETRY_MS=300;
function hasImages(pdf,expected) {
 if(!expected.length)return true;
 let text='';// Figma's sandbox allows at most 65,534 arguments per call, so read the bytes in small chunks.
 for(let i=0;i<pdf.length;i+=8192)text+=String.fromCharCode.apply(null,pdf.subarray(i,i+8192));
 const found=(text.match(/<<[^<>]*\/Subtype\s*\/Image[^<>]*>>/g)||[]).map(d=>[Number((d.match(/\/Width\s+(\d+)/)||[])[1]),Number((d.match(/\/Height\s+(\d+)/)||[])[1])]);
 // Matching the aspect ratio still passes if Figma resamples the image.
 return expected.every(size=>found.some(([w,h])=>w&&h&&Math.abs(w/h-size.width/size.height)<0.01*size.width/size.height));
}
// Walks the original and its copy together. Instances in the copy are detached first, because layers can't be added inside them.
async function rasterise(original,copy,state,topLevel=false) {
 if(original.visible===false||!containsRaster(original))return Infinity;
 if(hasRaster(original))return swapForImage(original,copy,topLevel,state);
 if(copy.type==='INSTANCE')copy=copy.detachInstance();
 const originals=original.children,copies=[...copy.children];let ppi=Infinity;
 for(let i=0;i<originals.length;i++)ppi=Math.min(ppi,await rasterise(originals[i],copies[i],state));
 return ppi;
}
// Returns the PDF and the factor its page must be scaled down by. The copy never touches the original.
// print is how much a custom page size scales the frame; effects are rendered for that size.
// A frame with bleed is exported from a copy inside a clipping frame of trim plus bleed, without the bleed layer's guide outline or the trim outline.
async function exportFrame(node,found,bleed=0,print=1) {
 if(!found.effects&&!bleed)return {pdf:await node.exportAsync({format:'PDF'}),scale:1};
 const width=node.width+2*bleed,height=node.height+2*bleed;
 const scale=found.effects?Math.min((TARGET_PPI/EFFECT_PPI+0.02)*print,MAX_EFFECT_EDGE/(2*Math.max(width,height))):1;
 let copy=null,wrapper=null,copied=false;
 try{
  copy=node.clone();
  if(bleed){
   wrapper=figma.createFrame();wrapper.name=node.name;wrapper.fills=[];wrapper.clipsContent=true;figma.currentPage.appendChild(wrapper);wrapper.resize(width,height);
   wrapper.appendChild(copy);copy.x=bleed;copy.y=bleed;const guide=await bleedLayerOf(copy),trim=await layerOf(copy,trimLayer);if(guide)guide.strokes=[];if(trim)trim.visible=false;
  }else figma.currentPage.appendChild(copy);
  const target=wrapper||copy;if(scale!==1)target.rescale(scale);copied=true;
  const state={images:[],print},ppi=found.effects?Math.min(Math.round(EFFECT_PPI*scale/print),found.raster?await rasterise(node,copy,state,true):Infinity):null;
  let pdf=await target.exportAsync({format:'PDF'});
  for(let attempt=0;!hasImages(pdf,state.images);attempt++){if(attempt===RETRIES)throw new Error('Figma didn’t finish preparing the image. Try exporting again.');await new Promise(resolve=>setTimeout(resolve,RETRY_MS));pdf=await target.exportAsync({format:'PDF'});}
  return {pdf,scale,ppi};
 }
 catch(error){
  if(found.raster)throw new Error('Couldn’t render the noise or texture in '+node.name+(copied?': '+(error.message||error):'. Figma needs to make a temporary copy of the frame, so check you can edit this file.'));
  if(bleed)throw new Error('Couldn’t add the bleed to '+node.name+(copied?': '+(error.message||error):'. Figma needs to make a temporary copy of the frame, so check you can edit this file.'));
  return {pdf:await node.exportAsync({format:'PDF'}),scale:1,ppi:Math.round(EFFECT_PPI/print)};
 }
 finally{if(wrapper&&!wrapper.removed)wrapper.remove();else if(copy&&!copy.removed)copy.remove();}
}
// Puts the bleed on the canvas: the frame's fills move onto a locked layer of trim plus bleed with a dashed guide outline, and Clip content turns off so artwork past the edge shows. A solid outline on top marks the trim. Running it again resizes the layer.
function showBleed(frame,bleed) {
 let layer=bleedLayer(frame);
 if(!layer){
  layer=figma.createRectangle();layer.name='Bleed';frame.insertChild(0,layer);
  if(frame.layoutMode&&frame.layoutMode!=='NONE')layer.layoutPositioning='ABSOLUTE';
  layer.fills=frame.fills;frame.fills=[];
  layer.strokes=[BLEED_GUIDE];layer.strokeWeight=1;layer.strokeAlign='OUTSIDE';layer.dashPattern=[4,4];
  frame.setPluginData(BLEED_KEY+'-clip',frame.clipsContent?'true':'false');frame.clipsContent=false;
 }
 // On the canvas the bleed rounds to the nearest whole pixel, at least 1, so its edge sits on the pixel grid like the frame (3 mm shows as 9 px, not 8.5). Export cuts it to the exact bleed.
 const drawn=Math.max(1,Math.round(bleed));
 layer.locked=false;layer.resize(frame.width+2*drawn,frame.height+2*drawn);layer.x=-drawn;layer.y=-drawn;
 layer.constraints={horizontal:'STRETCH',vertical:'STRETCH'};layer.setPluginData(BLEED_KEY,String(bleed));layer.locked=true;
 // Frames given bleed before the trim outline existed get one the next time bleed is set.
 if(!trimLayer(frame)){
  const trim=figma.createRectangle();trim.name='Trim';frame.appendChild(trim);
  if(frame.layoutMode&&frame.layoutMode!=='NONE')trim.layoutPositioning='ABSOLUTE';
  trim.fills=[];trim.strokes=[TRIM_GUIDE];trim.strokeWeight=1;trim.strokeAlign='CENTER';
  trim.resize(frame.width,frame.height);trim.x=0;trim.y=0;trim.constraints={horizontal:'STRETCH',vertical:'STRETCH'};
  trim.setPluginData(TRIM_KEY,'true');trim.locked=true;
 }
}
// Undoes showBleed, keeping any change made to the background on the bleed layer.
function hideBleed(frame) {
 const layer=bleedLayer(frame);if(!layer)return;
 frame.fills=layer.fills;layer.remove();
 const trim=trimLayer(frame);if(trim)trim.remove();
 frame.clipsContent=frame.getPluginData(BLEED_KEY+'-clip')!=='false';frame.setPluginData(BLEED_KEY+'-clip','');
}
// Preflight walks each selected frame and reports measurements in frame units, 72 to the inch. The window applies the limits, because a typed page size scales the artwork.
const PREFLIGHT_LIMIT=5000,NEAR_BLACK=0.2;
const visiblePaint=p=>!!p&&p.visible!==false&&p.opacity!==0;
const isWhite=p=>p.type==='SOLID'&&p.color.r===1&&p.color.g===1&&p.color.b===1&&(p.opacity===undefined||p.opacity===1);
// Pure black is exactly #000000, which Pure black as 100% K prints in black ink only. Other very dark colours print in all four inks.
function blackOf(fills) {
 const solid=(Array.isArray(fills)?fills:[]).filter(p=>visiblePaint(p)&&p.type==='SOLID');
 if(solid.some(p=>p.color.r===0&&p.color.g===0&&p.color.b===0))return 'pure';
 return solid.some(p=>Math.max(p.color.r,p.color.g,p.color.b)<=NEAR_BLACK)?'rich':null;
}
// Image pixels per frame unit decide the ppi at print size. Crop and Tile set the scale themselves; Fill covers the layer and Fit sits inside it.
async function imagePpi(node,fill,sizes) {
 if(!sizes.has(fill.imageHash)){let size=null;try{const image=figma.getImageByHash(fill.imageHash);size=image?await image.getSizeAsync():null;}catch(error){/* An image that can't load isn't measured. */}sizes.set(fill.imageHash,size);}
 const size=sizes.get(fill.imageHash);if(!size||!size.width||!size.height||!node.width||!node.height)return Infinity;
 let units;
 if(fill.scaleMode==='TILE')units=fill.scalingFactor||1;
 else if(fill.scaleMode==='CROP'&&fill.imageTransform){const [[a,b],[c,d]]=fill.imageTransform;units=Math.max(node.width/(Math.hypot(a,c)||1)/size.width,node.height/(Math.hypot(b,d)||1)/size.height);}
 else{const x=node.width/size.width,y=node.height/size.height;units=fill.scaleMode==='FIT'?Math.min(x,y):Math.max(x,y);}
 return 72/units;
}
const strokeWeightOf=node=>typeof node.strokeWeight==='number'?node.strokeWeight:Math.min(...['strokeTopWeight','strokeRightWeight','strokeBottomWeight','strokeLeftWeight'].map(k=>node[k]).filter(w=>w>0));
function textRuns(node) {
 try{if(typeof node.getStyledTextSegments==='function')return node.getStyledTextSegments(['fontSize','fills']);}catch(error){/* Fall back to the layer's own style. */}
 return [{fontSize:node.fontSize,fills:node.fills}];
}
async function preflightFrame(frame) {
 const findings=[],sizes=new Map(),skip=new Set(),box=frame.absoluteBoundingBox,bleed=await bleedOfNode(frame);
 for(const layer of [await bleedLayerOf(frame),await layerOf(frame,trimLayer)])if(layer)skip.add(layer.id);
 // Without bleed, a coloured background or artwork reaching the edge leaves a white sliver when the sheet is trimmed.
 let count=0,edge=!bleed&&Array.isArray(frame.fills)&&frame.fills.some(p=>visiblePaint(p)&&!isWhite(p))?frame:null;
 const add=(kind,node,extra)=>findings.push({kind,nodeId:node.id,name:node.name,...extra});
 async function walk(node,rasterised) {
  if(node.visible===false||skip.has(node.id)||++count>PREFLIGHT_LIMIT)return;
  const bounds=node.absoluteRenderBounds||node.absoluteBoundingBox,inside=box&&bounds&&bounds.x<box.x+box.width&&bounds.y<box.y+box.height&&bounds.x+bounds.width>box.x&&bounds.y+bounds.height>box.y;
  if(node!==frame&&!edge&&!bleed&&inside&&(bounds.x<=box.x+0.5||bounds.y<=box.y+0.5||bounds.x+bounds.width>=box.x+box.width-0.5||bounds.y+bounds.height>=box.y+box.height-0.5))edge=node;
  // A rasterised layer is drawn as one image, so effects inside it are fine.
  rasterised=rasterised||hasRaster(node);
  if(!rasterised&&(node.effects||[]).some(e=>e.visible!==false&&!EFFECTS.includes(e.type)))add('effect',node);
  let ppi=Infinity;for(const fill of Array.isArray(node.fills)?node.fills:[])if(visiblePaint(fill)&&fill.type==='IMAGE'&&fill.imageHash)ppi=Math.min(ppi,await imagePpi(node,fill,sizes));
  if(ppi<Infinity)add('image',node,{ppi:Math.round(ppi)});
  if(Array.isArray(node.strokes)&&node.strokes.some(visiblePaint)){const weight=strokeWeightOf(node);if(weight>0&&weight<4)add('stroke',node,{weight});}
  if(node.type==='TEXT'){
   let size=Infinity,rich=Infinity,pure=Infinity;
   for(const run of textRuns(node)){if(typeof run.fontSize!=='number')continue;size=Math.min(size,run.fontSize);const black=blackOf(run.fills);if(black==='rich')rich=Math.min(rich,run.fontSize);if(black==='pure')pure=Math.min(pure,run.fontSize);}
   // How close the text comes to the trim. Text crossing the edge counts as touching it.
   const gap=inside?Math.max(0,Math.min(bounds.x-box.x,bounds.y-box.y,box.x+box.width-bounds.x-bounds.width,box.y+box.height-bounds.y-bounds.height)):null;
   add('text',node,{size:size<Infinity?size:null,rich:rich<Infinity?rich:null,pure:pure<Infinity?pure:null,gap});
  }
  for(const child of node.children||[])await walk(child,rasterised);
 }
 await walk(frame,false);
 if(edge)add('bleed',edge);
 return {id:frame.id,bleed,findings,partial:count>PREFLIGHT_LIMIT};
}
// Only the latest run posts, and runs pause while an export is copying frames.
let preflightId=0,preflightTimer=null,exporting=0;
async function preflight() {
 const id=++preflightId,frames=[];
 for(const node of figma.currentPage.selection){if(!PRINTABLE.includes(node.type))continue;try{frames.push(await preflightFrame(node));}catch(error){/* The frame changed mid-check; the next change runs it again. */}if(id!==preflightId)return;}
 figma.ui.postMessage({type:'preflight',frames});
}
// Edits re-run preflight once they settle.
function schedulePreflight() {
 if(exporting)return;clearTimeout(preflightTimer);
 preflightTimer=setTimeout(()=>{if(!exporting&&figma.currentPage.selection.length)preflight();},500);
}
async function runExport(ids,id,prints) {
 const current=()=>id===exportId;
 try {
  if(!Array.isArray(ids)||!ids.length||ids.length>32)throw new Error('Select 1–32 frames or components.');
  const nodes=[];
  for(const nodeId of ids){const n=await figma.getNodeByIdAsync(nodeId);if(!n||!PRINTABLE.includes(n.type)||n.parent===null)throw new Error('Select frames or components.');nodes.push(n);}
  const issues=[],effects=nodes.map(n=>inspect(n,issues,n));
  if(issues.length){if(current())figma.ui.postMessage({type:'error',text:issues.slice(0,5).map(i=>i.text).join('\n'),issues});return;}
  const pdfs=[],sizes=[],bleeds=[],scales=[],ppi=[];
  for(let i=0;i<nodes.length;i++){if(!current())return;figma.ui.postMessage({type:'status',text:'Exporting frame '+(i+1)+' of '+nodes.length+'…'});sizes.push({width:nodes[i].width,height:nodes[i].height});bleeds.push(await bleedOfNode(nodes[i]));const print=Array.isArray(prints)&&prints[i]>0&&prints[i]<=100?prints[i]:1;const result=await exportFrame(nodes[i],effects[i],bleeds[i],print);pdfs.push(result.pdf);scales.push(result.scale);if(result.ppi)ppi.push(result.ppi);}
  if(current())figma.ui.postMessage({type:'pdfs',pdfs,sizes,bleeds,scales,effectPpi:ppi.length?Math.min(...ppi):null});
 }catch(error){if(current())figma.ui.postMessage({type:'error',text:error.message||String(error)});}
}
figma.ui.onmessage=async msg=>{
 if(msg.type==='load-profiles'){try{figma.ui.postMessage({type:'profiles',profiles:await figma.clientStorage.getAsync('open-print-profiles')||{}});}catch(error){figma.ui.postMessage({type:'profiles',profiles:{}});}return;}
 if(msg.type==='save-profile'){try{if(typeof msg.id!=='string'||msg.id.length>100||typeof msg.encoded!=='string'||msg.encoded.length>7*1024*1024)throw new Error('Invalid profile');profileSave=profileSave.catch(()=>{}).then(async()=>{const profiles=await figma.clientStorage.getAsync('open-print-profiles')||{};profiles[msg.id]=msg.encoded;await figma.clientStorage.setAsync('open-print-profiles',profiles);});await profileSave;}catch(error){figma.ui.postMessage({type:'profile-storage-error'});}return;}
 if(msg.type==='resize'||msg.type==='resize-end'){const h=uiHeight(msg.height);figma.ui.resize(UI_WIDTH,h);if(msg.type==='resize-end')try{await figma.clientStorage.setAsync('open-print-height',h);}catch(error){/* The height is kept for this session only. */}return;}
 if(msg.type==='ready'){await selection();return;}
 if(msg.type==='show-layer'){try{const node=await figma.getNodeByIdAsync(String(msg.id));if(node&&node.type!=='PAGE'&&node.type!=='DOCUMENT')figma.viewport.scrollAndZoomIntoView([node]);}catch(error){/* The layer was deleted. */}return;}
 // Selects a layer that may be on another page, such as an instance's main component.
 if(msg.type==='select-layer'){try{const node=await figma.getNodeByIdAsync(String(msg.id));let page=node;while(page&&page.type!=='PAGE')page=page.parent;if(!node||!page)return;if(page!==figma.currentPage)await figma.setCurrentPageAsync(page);figma.currentPage.selection=[node];figma.viewport.scrollAndZoomIntoView([node]);}catch(error){/* The layer was deleted. */}return;}
 if(msg.type==='new-frame'){try{newPaperFrame(String(msg.size));}catch(error){figma.ui.postMessage({type:'error',text:error.message||String(error)});}await selection();return;}
 if(msg.type==='cancel'){exportId++;return;}
 if(msg.type==='show-bleed'||msg.type==='hide-bleed'){
  try{
   const bleed=Number(msg.bleed);if(msg.type==='show-bleed'&&!(bleed>0&&bleed<=1000))throw new Error('Enter a bleed between 0 and 1000 units.');
   const nodes=[];for(const nodeId of Array.isArray(msg.ids)?msg.ids:[]){const n=await figma.getNodeByIdAsync(nodeId);if(n&&(n.type==='FRAME'||n.type==='COMPONENT'))nodes.push(n);}
   if(!nodes.length)throw new Error('Select one or more frames or components.');
   for(const n of nodes)if(msg.type==='show-bleed')showBleed(n,bleed);else hideBleed(n);
  }catch(error){figma.ui.postMessage({type:'error',text:error.message||String(error)});}
  await selection();return;
 }
 if(msg.type!=='export')return;
 // Exports run one at a time. Cancel bumps exportId so a running export stops posting, and a new one waits its turn.
 const id=++exportId;exportRun=exportRun.then(async()=>{exporting++;try{await runExport(msg.ids,id,msg.prints);}finally{exporting--;}});await exportRun;
};
