figma.showUI(__html__, {width:320,height:560,themeColors:true});
let exportRun=Promise.resolve(),exportId=0,profileSave=Promise.resolve();
function selection() { const selected=figma.currentPage.selection;figma.ui.postMessage({type:'selection',frames:selected.map(n=>({id:n.id,name:n.name,width:n.width,height:n.height,type:n.type}))}); }
figma.on('selectionchange',selection);
// Each issue names its frame and layer so the UI can list it under that frame and zoom to it.
function inspect(node,issues,frame) {
 if(node.visible===false)return;
 const paints=[...(Array.isArray(node.fills)?node.fills:[]),...(Array.isArray(node.strokes)?node.strokes:[])];
 if(node.type==='TEXT' && node.characters.length) for(const segment of node.getStyledTextSegments(['fills'])) paints.push(...segment.fills);
 if(paints.some(p=>p.visible!==false && p.type.startsWith('GRADIENT')))issues.push({kind:'gradient',text:'Gradient in '+node.name,frameId:frame.id,nodeId:node.id,name:node.name});
 if(node.effects && node.effects.some(e=>e.visible!==false))issues.push({kind:'effect',text:'Effect in '+node.name+' (may rasterize)',frameId:frame.id,nodeId:node.id,name:node.name});
 if(node.children)for(const child of node.children)inspect(child,issues,frame);
}
async function runExport(ids,id) {
 const current=()=>id===exportId;
 try {
  if(!Array.isArray(ids)||!ids.length||ids.length>32)throw new Error('Select 1–32 frames.');
  const nodes=[];
  for(const nodeId of ids){const n=await figma.getNodeByIdAsync(nodeId);if(!n||n.type!=='FRAME'||n.parent===null)throw new Error('Selection must contain frames.');nodes.push(n);}
  const issues=[];for(const n of nodes)inspect(n,issues,n);
  if(issues.length){if(current())figma.ui.postMessage({type:'error',text:issues.slice(0,5).map(i=>i.text).join('\n'),issues});return;}
  const pdfs=[],sizes=[];
  for(let i=0;i<nodes.length;i++){if(!current())return;figma.ui.postMessage({type:'status',text:'Exporting frame '+(i+1)+' of '+nodes.length+'…'});sizes.push({width:nodes[i].width,height:nodes[i].height});pdfs.push(await nodes[i].exportAsync({format:'PDF'}));}
  if(current())figma.ui.postMessage({type:'pdfs',pdfs,sizes});
 }catch(error){if(current())figma.ui.postMessage({type:'error',text:error.message||String(error)});}
}
figma.ui.onmessage=async msg=>{
 if(msg.type==='load-profiles'){try{figma.ui.postMessage({type:'profiles',profiles:await figma.clientStorage.getAsync('open-print-profiles')||{}});}catch(error){figma.ui.postMessage({type:'profiles',profiles:{}});}return;}
 if(msg.type==='save-profile'){try{if(typeof msg.id!=='string'||msg.id.length>100||typeof msg.encoded!=='string'||msg.encoded.length>7*1024*1024)throw new Error('Invalid profile');profileSave=profileSave.catch(()=>{}).then(async()=>{const profiles=await figma.clientStorage.getAsync('open-print-profiles')||{};profiles[msg.id]=msg.encoded;await figma.clientStorage.setAsync('open-print-profiles',profiles);});await profileSave;}catch(error){figma.ui.postMessage({type:'profile-storage-error'});}return;}
 if(msg.type==='ready'){selection();return;}
 if(msg.type==='show-layer'){try{const node=await figma.getNodeByIdAsync(String(msg.id));if(node&&node.type!=='PAGE'&&node.type!=='DOCUMENT')figma.viewport.scrollAndZoomIntoView([node]);}catch(error){/* The layer was deleted. */}return;}
 if(msg.type==='cancel'){exportId++;return;}
 if(msg.type!=='export')return;
 // Exports run one at a time. Cancel bumps exportId so a running export stops posting, and a new one waits its turn.
 const id=++exportId;exportRun=exportRun.then(()=>runExport(msg.ids,id));await exportRun;
};
