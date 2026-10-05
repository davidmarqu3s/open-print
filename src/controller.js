figma.showUI(__html__, {width:320,height:560,themeColors:true});
let busy=false,profileSave=Promise.resolve();
function selection() { const selected=figma.currentPage.selection;figma.ui.postMessage({type:'selection',frames:selected.map(n=>({id:n.id,name:n.name,width:n.width,height:n.height,type:n.type}))}); }
figma.on('selectionchange',selection);
function inspect(node,issues) {
 if(node.visible===false)return;
 const paints=[...(Array.isArray(node.fills)?node.fills:[]),...(Array.isArray(node.strokes)?node.strokes:[])];
 if(node.type==='TEXT' && node.characters.length) for(const segment of node.getStyledTextSegments(['fills'])) paints.push(...segment.fills);
 if(paints.some(p=>p.visible!==false && p.type.startsWith('GRADIENT')))issues.add('Gradient in '+node.name);
 if(node.effects && node.effects.some(e=>e.visible!==false))issues.add('Effect in '+node.name+' (may rasterize)');
 if(node.children)for(const child of node.children)inspect(child,issues);
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
  const issues=new Set();for(const n of nodes)inspect(n,issues);if(issues.size)throw new Error([...issues].slice(0,5).join('\n'));
  const pdfs=[],sizes=[];for(let i=0;i<nodes.length;i++){figma.ui.postMessage({type:'status',text:'Exporting frame '+(i+1)+' of '+nodes.length+'…'});sizes.push({width:nodes[i].width,height:nodes[i].height});pdfs.push(await nodes[i].exportAsync({format:'PDF'}));}
  figma.ui.postMessage({type:'pdfs',pdfs,sizes});
 }catch(error){figma.ui.postMessage({type:'error',text:error.message||String(error)});}
 finally{busy=false;}
};
