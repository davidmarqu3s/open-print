figma.showUI(__html__, {width:320,height:560,themeColors:true});
let exportRun=Promise.resolve(),exportId=0,profileSave=Promise.resolve();
// Show bleed adds this layer at the bottom of a frame. It holds the frame's background, sized to trim plus bleed, and its plugin data records the bleed in frame units.
const BLEED_KEY='open-print-bleed',BLEED_GUIDE={type:'SOLID',color:{r:1,g:0.2,b:0.2}};
const bleedLayer=frame=>(frame.children||[]).find(c=>typeof c.getPluginData==='function'&&c.getPluginData(BLEED_KEY)!=='')||null;
const bleedOf=frame=>{const layer=bleedLayer(frame),bleed=layer?Number(layer.getPluginData(BLEED_KEY)):0;return Number.isFinite(bleed)&&bleed>0?bleed:0;};
function selection() { const selected=figma.currentPage.selection;figma.ui.postMessage({type:'selection',frames:selected.map(n=>({id:n.id,name:n.name,width:n.width,height:n.height,type:n.type,bleed:n.type==='FRAME'?bleedOf(n):0}))}); }
figma.on('selectionchange',selection);
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
 const bounds=topLevel?original.absoluteBoundingBox:original.absoluteRenderBounds,target=topLevel?copy.absoluteBoundingBox:copy.absoluteRenderBounds;
 if(!bounds||!target||!bounds.width||!bounds.height)return Infinity;
 const k=Math.min(TARGET_PPI/72,MAX_IMAGE_EDGE/Math.max(bounds.width,bounds.height));
 const png=await original.exportAsync({format:'PNG',constraint:{type:'SCALE',value:k},useAbsoluteBounds:topLevel});
 // Until Figma has decoded a new image it paints the fill as one flat colour, so wait for it and check the PDF later.
 const created=figma.createImage(png),size=await created.getSizeAsync();state.images.push(size);
 const fill={type:'IMAGE',imageHash:created.hash,scaleMode:'FILL'};
 if(topLevel){for(const child of [...copy.children])child.remove();copy.effects=[];copy.strokes=[];copy.fills=[fill];return Math.round(72*k);}
 const image=figma.createRectangle(),parent=copy.parent;
 parent.insertChild(parent.children.indexOf(copy)+1,image);
 if(parent.layoutMode&&parent.layoutMode!=='NONE')image.layoutPositioning='ABSOLUTE';
 image.name=copy.name;image.resize(target.width,target.height);
 // The image shares the copy's parent, so this places it at the copy's absolute render bounds whatever the parent's transform.
 image.relativeTransform=multiply(multiply(copy.relativeTransform,invert(copy.absoluteTransform)),[[1,0,target.x],[0,1,target.y]]);
 image.fills=[fill];image.blendMode=copy.blendMode;
 // Clearing the effects stops Figma baking a bitmap of the hidden layer.
 copy.opacity=0;copy.effects=[];
 return Math.round(72*k);
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
// A frame with bleed is exported from a copy inside a clipping frame of trim plus bleed, without the bleed layer's guide outline.
async function exportFrame(node,found,bleed=0) {
 if(!found.effects&&!bleed)return {pdf:await node.exportAsync({format:'PDF'}),scale:1};
 const width=node.width+2*bleed,height=node.height+2*bleed;
 const scale=found.effects?Math.min(TARGET_PPI/EFFECT_PPI+0.02,MAX_EFFECT_EDGE/(2*Math.max(width,height))):1;
 let copy=null,wrapper=null,copied=false;
 try{
  copy=node.clone();
  if(bleed){
   wrapper=figma.createFrame();wrapper.name=node.name;wrapper.fills=[];wrapper.clipsContent=true;figma.currentPage.appendChild(wrapper);wrapper.resize(width,height);
   wrapper.appendChild(copy);copy.x=bleed;copy.y=bleed;const guide=bleedLayer(copy);if(guide)guide.strokes=[];
  }else figma.currentPage.appendChild(copy);
  const target=wrapper||copy;if(scale!==1)target.rescale(scale);copied=true;
  const state={images:[]},ppi=found.effects?Math.min(Math.round(EFFECT_PPI*scale),found.raster?await rasterise(node,copy,state,true):Infinity):null;
  let pdf=await target.exportAsync({format:'PDF'});
  for(let attempt=0;!hasImages(pdf,state.images);attempt++){if(attempt===RETRIES)throw new Error('Figma didn’t finish preparing the image. Try exporting again.');await new Promise(resolve=>setTimeout(resolve,RETRY_MS));pdf=await target.exportAsync({format:'PDF'});}
  return {pdf,scale,ppi};
 }
 catch(error){
  if(found.raster)throw new Error('Couldn’t render the noise or texture in '+node.name+(copied?': '+(error.message||error):'. Figma needs to make a temporary copy of the frame, so check you can edit this file.'));
  if(bleed)throw new Error('Couldn’t add the bleed to '+node.name+(copied?': '+(error.message||error):'. Figma needs to make a temporary copy of the frame, so check you can edit this file.'));
  return {pdf:await node.exportAsync({format:'PDF'}),scale:1,ppi:EFFECT_PPI};
 }
 finally{if(wrapper&&!wrapper.removed)wrapper.remove();else if(copy&&!copy.removed)copy.remove();}
}
// Puts the bleed on the canvas: the frame's fills move onto a locked layer of trim plus bleed with a dashed guide outline, and Clip content turns off so artwork past the edge shows. Running it again resizes the layer.
function showBleed(frame,bleed) {
 let layer=bleedLayer(frame);
 if(!layer){
  layer=figma.createRectangle();layer.name='Bleed';frame.insertChild(0,layer);
  if(frame.layoutMode&&frame.layoutMode!=='NONE')layer.layoutPositioning='ABSOLUTE';
  layer.fills=frame.fills;frame.fills=[];
  layer.strokes=[BLEED_GUIDE];layer.strokeWeight=1;layer.strokeAlign='OUTSIDE';layer.dashPattern=[4,4];
  frame.setPluginData(BLEED_KEY+'-clip',frame.clipsContent?'true':'false');frame.clipsContent=false;
 }
 layer.locked=false;layer.resize(frame.width+2*bleed,frame.height+2*bleed);layer.x=-bleed;layer.y=-bleed;
 layer.constraints={horizontal:'STRETCH',vertical:'STRETCH'};layer.setPluginData(BLEED_KEY,String(bleed));layer.locked=true;
}
// Undoes showBleed, keeping any change made to the background on the bleed layer.
function hideBleed(frame) {
 const layer=bleedLayer(frame);if(!layer)return;
 frame.fills=layer.fills;layer.remove();
 frame.clipsContent=frame.getPluginData(BLEED_KEY+'-clip')!=='false';frame.setPluginData(BLEED_KEY+'-clip','');
}
async function runExport(ids,id) {
 const current=()=>id===exportId;
 try {
  if(!Array.isArray(ids)||!ids.length||ids.length>32)throw new Error('Select 1–32 frames.');
  const nodes=[];
  for(const nodeId of ids){const n=await figma.getNodeByIdAsync(nodeId);if(!n||n.type!=='FRAME'||n.parent===null)throw new Error('Selection must contain frames.');nodes.push(n);}
  const issues=[],effects=nodes.map(n=>inspect(n,issues,n));
  if(issues.length){if(current())figma.ui.postMessage({type:'error',text:issues.slice(0,5).map(i=>i.text).join('\n'),issues});return;}
  const pdfs=[],sizes=[],bleeds=[],scales=[],ppi=[];
  for(let i=0;i<nodes.length;i++){if(!current())return;figma.ui.postMessage({type:'status',text:'Exporting frame '+(i+1)+' of '+nodes.length+'…'});sizes.push({width:nodes[i].width,height:nodes[i].height});bleeds.push(bleedOf(nodes[i]));const result=await exportFrame(nodes[i],effects[i],bleeds[i]);pdfs.push(result.pdf);scales.push(result.scale);if(result.ppi)ppi.push(result.ppi);}
  if(current())figma.ui.postMessage({type:'pdfs',pdfs,sizes,bleeds,scales,effectPpi:ppi.length?Math.min(...ppi):null});
 }catch(error){if(current())figma.ui.postMessage({type:'error',text:error.message||String(error)});}
}
figma.ui.onmessage=async msg=>{
 if(msg.type==='load-profiles'){try{figma.ui.postMessage({type:'profiles',profiles:await figma.clientStorage.getAsync('open-print-profiles')||{}});}catch(error){figma.ui.postMessage({type:'profiles',profiles:{}});}return;}
 if(msg.type==='save-profile'){try{if(typeof msg.id!=='string'||msg.id.length>100||typeof msg.encoded!=='string'||msg.encoded.length>7*1024*1024)throw new Error('Invalid profile');profileSave=profileSave.catch(()=>{}).then(async()=>{const profiles=await figma.clientStorage.getAsync('open-print-profiles')||{};profiles[msg.id]=msg.encoded;await figma.clientStorage.setAsync('open-print-profiles',profiles);});await profileSave;}catch(error){figma.ui.postMessage({type:'profile-storage-error'});}return;}
 if(msg.type==='ready'){selection();return;}
 if(msg.type==='show-layer'){try{const node=await figma.getNodeByIdAsync(String(msg.id));if(node&&node.type!=='PAGE'&&node.type!=='DOCUMENT')figma.viewport.scrollAndZoomIntoView([node]);}catch(error){/* The layer was deleted. */}return;}
 if(msg.type==='cancel'){exportId++;return;}
 if(msg.type==='show-bleed'||msg.type==='hide-bleed'){
  try{
   const bleed=Number(msg.bleed);if(msg.type==='show-bleed'&&!(bleed>0&&bleed<=1000))throw new Error('Enter a bleed between 0 and 1000 units.');
   const nodes=[];for(const nodeId of Array.isArray(msg.ids)?msg.ids:[]){const n=await figma.getNodeByIdAsync(nodeId);if(n&&n.type==='FRAME')nodes.push(n);}
   if(!nodes.length)throw new Error('Select one or more frames.');
   for(const n of nodes)if(msg.type==='show-bleed')showBleed(n,bleed);else hideBleed(n);
  }catch(error){figma.ui.postMessage({type:'error',text:error.message||String(error)});}
  selection();return;
 }
 if(msg.type!=='export')return;
 // Exports run one at a time. Cancel bumps exportId so a running export stops posting, and a new one waits its turn.
 const id=++exportId;exportRun=exportRun.then(()=>runExport(msg.ids,id));await exportRun;
};
