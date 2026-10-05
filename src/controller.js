figma.showUI(__html__, {width:320,height:560,themeColors:true});
let busy=false,profileSave=Promise.resolve();
function selection() { const selected=figma.currentPage.selection;figma.ui.postMessage({type:'selection',frames:selected.map(n=>({id:n.id,name:n.name,width:n.width,height:n.height,type:n.type}))}); }
figma.on('selectionchange',selection);
// Figma rasterises these effects at 144 ppi in PDF exports. Other effect types are untested.
const EFFECTS=['DROP_SHADOW','INNER_SHADOW','LAYER_BLUR','BACKGROUND_BLUR'];
// Frames with effects are exported from a scaled copy so their bitmaps reach about 300 ppi at print size.
const EFFECT_PPI=144,TARGET_PPI=300,MAX_EFFECT_EDGE=16384;
function inspect(node,issues) {
 if(node.visible===false)return false;
 let effects=false;
 for(const effect of node.effects||[]){if(effect.visible===false)continue;if(EFFECTS.includes(effect.type))effects=true;else issues.add('Unsupported effect in '+node.name);}
 if(node.children)for(const child of node.children)if(inspect(child,issues))effects=true;
 return effects;
}
// Returns the PDF and the factor its page must be scaled down by. The copy never touches the original.
async function exportFrame(node,hasEffects) {
 if(!hasEffects)return {pdf:await node.exportAsync({format:'PDF'}),scale:1};
 const scale=Math.min(TARGET_PPI/EFFECT_PPI+0.02,MAX_EFFECT_EDGE/(2*Math.max(node.width,node.height)));
 let copy=null;
 try{copy=node.clone();figma.currentPage.appendChild(copy);copy.rescale(scale);return {pdf:await copy.exportAsync({format:'PDF'}),scale,ppi:Math.round(EFFECT_PPI*scale)};}
 catch(error){return {pdf:await node.exportAsync({format:'PDF'}),scale:1,ppi:EFFECT_PPI};}
 finally{if(copy&&!copy.removed)copy.remove();}
}
figma.ui.onmessage=async msg=>{
 if(msg.type==='load-profiles'){try{figma.ui.postMessage({type:'profiles',profiles:await figma.clientStorage.getAsync('open-print-profiles')||{}});}catch(error){figma.ui.postMessage({type:'profiles',profiles:{}});}return;}
 if(msg.type==='save-profile'){try{if(typeof msg.id!=='string'||msg.id.length>100||typeof msg.encoded!=='string'||msg.encoded.length>7*1024*1024)throw new Error('Invalid profile');profileSave=profileSave.catch(()=>{}).then(async()=>{const profiles=await figma.clientStorage.getAsync('open-print-profiles')||{};profiles[msg.id]=msg.encoded;await figma.clientStorage.setAsync('open-print-profiles',profiles);});await profileSave;}catch(error){figma.ui.postMessage({type:'profile-storage-error'});}return;}
 if(msg.type==='ready'){selection();return;}
 if(msg.type!=='export'||busy)return;
 busy=true;
 try {
  if(!Array.isArray(msg.ids)||!msg.ids.length||msg.ids.length>32)throw new Error('Select 1–32 frames.');
  const nodes=[];
  for(const id of msg.ids){const n=await figma.getNodeByIdAsync(id);if(!n||n.type!=='FRAME'||n.parent===null)throw new Error('Selection must contain frames.');nodes.push(n);}
  const issues=new Set(),effects=nodes.map(n=>inspect(n,issues));if(issues.size)throw new Error([...issues].slice(0,5).join('\n'));
  const pdfs=[],sizes=[],scales=[],ppi=[];
  for(let i=0;i<nodes.length;i++){figma.ui.postMessage({type:'status',text:'Exporting frame '+(i+1)+' of '+nodes.length+'…'});sizes.push({width:nodes[i].width,height:nodes[i].height});const result=await exportFrame(nodes[i],effects[i]);pdfs.push(result.pdf);scales.push(result.scale);if(result.ppi)ppi.push(result.ppi);}
  figma.ui.postMessage({type:'pdfs',pdfs,sizes,scales,effectPpi:ppi.length?Math.min(...ppi):null});
 }catch(error){figma.ui.postMessage({type:'error',text:error.message||String(error)});}
 finally{busy=false;}
};
