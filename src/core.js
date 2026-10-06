var PrintCore = {
 // Standard sizes in mm, portrait. Frames drawn at 72 units per inch land a fraction of a millimetre off them.
 PAPER:[['A0',841,1189],['A1',594,841],['A2',420,594],['A3',297,420],['A4',210,297],['A5',148,210],['A6',105,148],['DL',99,210],['B1',707,1000],['B2',500,707],['B3',353,500],['B4',250,353],['B5',176,250],['SRA3',320,450],['50 × 70 cm poster',500,700],['70 × 100 cm poster',700,1000],['Letter',215.9,279.4],['Legal',215.9,355.6],['Tabloid',279.4,431.8],['Business card',85,55],['US business card',88.9,50.8]],
 // A frame at a paper size rounded to whole pixels, like Figma's presets (A4 is 595 × 842), prints at that paper size exactly.
 frameSize(width,height) {
  if(!Number.isFinite(width)||!Number.isFinite(height)||width<=0||height<=0)throw new Error('Invalid frame dimensions.');
  return this.paperSize(width,height)||{width:Math.round(width*25.4/72*100)/100,height:Math.round(height*25.4/72*100)/100};
 },
 paperSize(width,height) {
  const px=mm=>Math.round(mm*72/25.4),same=(a,b)=>Math.abs(a-b)<0.01;
  for(const [,w,h] of this.PAPER)for(const [a,b] of [[w,h],[h,w]])if(same(width,px(a))&&same(height,px(b)))return {width:a,height:b};
  return null;
 },
 points(mm) { if (!Number.isFinite(mm) || mm < 10 || mm > 2000) throw new Error('Page size must be between 10 and 2000 mm.'); return mm * 72 / 25.4; },
 validateICC(bytes) {
  const text=(start,n)=>String.fromCharCode(...bytes.slice(start,start+n));
  if(bytes.length < 132 || bytes.length > 5*1024*1024 || text(36,4)!=='acsp') throw new Error('Invalid ICC profile.');
  const size=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength).getUint32(0);
  if(size!==bytes.length) throw new Error('Incomplete ICC profile.');
  if(text(16,4)!=='CMYK') throw new Error('Choose a CMYK ICC profile.');
  return true;
 },
 profileDescription(bytes) {
  this.validateICC(bytes);
  const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  const text=(offset,length)=>String.fromCharCode(...bytes.slice(offset,offset+length));
  const count=view.getUint32(128);if(count>(bytes.length-132)/12)throw new Error('Invalid ICC tag table.');
  for(let i=0;i<count;i++) {const tag=132+i*12;if(text(tag,4)!=='desc')continue;
   const offset=view.getUint32(tag+4),length=view.getUint32(tag+8);if(offset>bytes.length-length||length<12)throw new Error('Invalid ICC description.');
   const type=text(offset,4);
   if(type==='desc'){const size=view.getUint32(offset+8);if(size<1||size>length-12)throw new Error('Invalid ICC description.');return text(offset+12,size-1).trim();}
   if(type==='mluc'){if(length<16)throw new Error('Invalid ICC description.');const records=view.getUint32(offset+8),recordSize=view.getUint32(offset+12);if(length<16||recordSize<12||records>(length-16)/recordSize)throw new Error('Invalid ICC description.');let fallback='';for(let n=0;n<records;n++){const record=offset+16+n*recordSize,size=view.getUint32(record+4),start=view.getUint32(record+8);if(size%2||start>length-size)throw new Error('Invalid ICC description.');let name='';for(let j=0;j<size;j+=2)name+=String.fromCharCode(view.getUint16(offset+start+j));if(text(record,2)==='en')return name.trim();if(!fallback)fallback=name.trim();}return fallback;}
  }
  return '';
 },
 // Alpha masks depend on coverage, not paint colour. White also imports correctly
 // into editors that translate these masks into luminosity-based opacity masks.
 whiteMaskPaint(bytes) {
  let text='';for(let i=0;i<bytes.length;i+=8192)text+=String.fromCharCode(...bytes.subarray(i,i+8192));
  const arity={m:2,l:2,c:6,v:4,y:4,re:4,h:0,f:0,'f*':0,F:0,S:0,s:0,B:0,'B*':0,b:0,'b*':0,n:0,q:0,Q:0,cm:6,w:1,J:1,j:1,M:1,k:4,K:4,rg:3,RG:3,g:1,G:1};
  const colors={k:'0 0 0 0',K:'0 0 0 0',rg:'1 1 1',RG:'1 1 1',g:'1',G:'1'},replacements=[];let operands=[];
  for(const match of text.matchAll(/\S+/g)){
   const token=match[0];if(/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(token)){operands.push(match);continue;}
   if(!Object.prototype.hasOwnProperty.call(arity,token)||operands.length!==arity[token])return bytes;
   if(colors[token])replacements.push({start:operands[0].index,end:match.index,text:colors[token]+' '});
   operands=[];
  }
  if(operands.length||!replacements.length)return bytes;
  for(const replacement of replacements.reverse())text=text.slice(0,replacement.start)+replacement.text+text.slice(replacement.end);
  return Uint8Array.from(text,c=>c.charCodeAt(0));
 },
 normalizeAlphaMasks(doc) {
  const {PDFName,PDFDict,PDFRawStream,decodePDFRawStream}=PDFLib;
  for(const [ref,mask] of doc.context.enumerateIndirectObjects()){
   if(!(mask instanceof PDFDict)||mask.get(PDFName.of('S'))!==PDFName.of('Alpha'))continue;
   const form=doc.context.lookup(mask.get(PDFName.of('G')));if(!(form instanceof PDFRawStream)||form.dict.get(PDFName.of('Subtype'))!==PDFName.of('Form'))continue;
   const bytes=decodePDFRawStream(form).decode(),paint=this.whiteMaskPaint(bytes);if(paint===bytes)continue;
   const white=doc.context.flateStream(paint);
   for(const [key,value] of form.dict.entries())if(!['Length','Filter','DecodeParms'].includes(key.decodeText()))white.dict.set(key,value);
   // Do not recolour a Form shared with visible artwork or a luminosity mask.
   mask.set(PDFName.of('G'),doc.context.register(white));
  }
 },
 // PDF path state is separate from q/Q graphics state. A paint or n clears it.
 cleanContent(bytes,state={active:false}) {
  if(state.unsupported)return bytes;const originalActive=state.active;
  let text='';for(let i=0;i<bytes.length;i+=8192)text+=String.fromCharCode(...bytes.subarray(i,i+8192));
  const removed=[],space=c=>/[\x00\t\n\f\r ]/.test(c),delimiter=c=>/[()[\]<>\/%]/.test(c);let depth=0;
  for(let i=0;i<text.length;){
   const c=text[i];if(space(c)){i++;continue;}
   if(c==='%'){while(i<text.length&&!/[\r\n]/.test(text[i]))i++;continue;}
   if(c==='('){let nesting=1;i++;while(i<text.length&&nesting){if(text[i]==='\\'){i+=2;continue;}if(text[i]==='(')nesting++;if(text[i]===')')nesting--;i++;}continue;}
   if(c==='<'&&text[i+1]!=='<'){i++;while(i<text.length&&text[i]!=='>')i++;i++;continue;}
   if(c==='['||text.slice(i,i+2)==='<<'){depth++;i+=c==='['?1:2;continue;}
   if(c===']'||text.slice(i,i+2)==='>>'){depth--;i+=c===']'?1:2;continue;}
   if(c==='/'){i++;while(i<text.length&&!space(text[i])&&!delimiter(text[i]))i++;continue;}
   if(delimiter(c)){i++;continue;}
   const start=i;while(i<text.length&&!space(text[i])&&!delimiter(text[i]))i++;
   const token=text.slice(start,i);if(depth)continue;
   // Never tokenize inline-image binary data. The converter emits external images.
   if(token==='BI'){state.active=originalActive;state.unsupported=true;return bytes;}
   if(token==='h'&&!state.active)removed.push(start);
   if(['m','l','c','v','y','re'].includes(token))state.active=true;
   if(['S','s','f','F','f*','B','B*','b','b*','n'].includes(token))state.active=false;
  }
  if(!removed.length)return bytes;
  let result='',start=0;for(const offset of removed){result+=text.slice(start,offset);start=offset+1;}result+=text.slice(start);
  return Uint8Array.from(result,c=>c.charCodeAt(0));
 },
 cleanPaths(doc) {
  const {PDFName,PDFRawStream,PDFArray,PDFRef,decodePDFRawStream}=PDFLib;
  const uses=new Map();
  for(const page of doc.getPages()){
   const contents=page.node.get(PDFName.of('Contents'));if(!contents)continue;
   const object=doc.context.lookup(contents),refs=object instanceof PDFArray?object.asArray():[contents];
   for(const ref of refs)if(ref instanceof PDFRef)uses.set(ref.toString(),(uses.get(ref.toString())||0)+1);
  }
  const replace=(ref,state,clone=false)=>{
   const stream=doc.context.lookup(ref);if(!(stream instanceof PDFRawStream))return ref;
   const bytes=decodePDFRawStream(stream).decode(),cleaned=this.cleanContent(bytes,state);if(cleaned===bytes)return ref;
   const fixed=doc.context.flateStream(cleaned);
   for(const [key,value] of stream.dict.entries())if(!['Length','Filter','DecodeParms'].includes(key.decodeText()))fixed.dict.set(key,value);
   if(ref instanceof PDFRef){if(clone)return doc.context.register(fixed);doc.context.assign(ref,fixed);return ref;}return fixed;
  };
  for(const [ref,object] of doc.context.enumerateIndirectObjects())if(object instanceof PDFRawStream&&object.dict.get(PDFName.of('Subtype'))===PDFName.of('Form'))replace(ref,{active:false});
  for(const page of doc.getPages()){
   const contents=page.node.get(PDFName.of('Contents'));if(!contents)continue;
   const array=doc.context.lookup(contents),state={active:false};
   const clean=ref=>replace(ref,state,ref instanceof PDFRef&&uses.get(ref.toString())>1);
   if(array instanceof PDFArray)page.node.set(PDFName.of('Contents'),doc.context.obj(array.asArray().map(clean)));
   else page.node.set(PDFName.of('Contents'),clean(contents));
  }
 },
 // Ghostscript leaves the source RGB colour spaces in /Resources after converting everything to CMYK.
 // Drop entries the owning content never names, then any objects nothing reaches, so preflight sees no RGB.
 dropUnusedColorSpaces(doc) {
  const {PDFName,PDFDict,PDFArray,PDFRef,PDFStream,PDFRawStream,decodePDFRawStream}=PDFLib;
  const text=bytes=>{let t='';for(let i=0;i<bytes.length;i+=8192)t+=String.fromCharCode(...bytes.subarray(i,i+8192));return t;};
  const decode=ref=>{const stream=doc.context.lookup(ref);return stream instanceof PDFRawStream?text(decodePDFRawStream(stream).decode()):'';};
  // Resources and their ColorSpace dictionaries can be shared, so collect the content of every owner before pruning.
  const owners=new Map(),own=(resources,content)=>{resources=resources&&doc.context.lookup(resources);const spaces=resources instanceof PDFDict&&doc.context.lookup(resources.get(PDFName.of('ColorSpace')));if(spaces instanceof PDFDict)owners.set(spaces,[...(owners.get(spaces)||[resources]),content]);};
  for(const page of doc.getPages()){const contents=page.node.get(PDFName.of('Contents'));const object=contents&&doc.context.lookup(contents);own(page.node.get(PDFName.of('Resources')),contents?(object instanceof PDFArray?object.asArray():[contents]).map(decode).join('\n'):'');}
  for(const [ref,object] of doc.context.enumerateIndirectObjects()){
   if(object instanceof PDFRawStream&&(object.dict.get(PDFName.of('Subtype'))===PDFName.of('Form')||object.dict.has(PDFName.of('PatternType'))))own(object.dict.get(PDFName.of('Resources')),decode(ref));
   if(object instanceof PDFDict&&object.get(PDFName.of('Subtype'))===PDFName.of('Type3')){const procs=doc.context.lookup(object.get(PDFName.of('CharProcs')));own(object.get(PDFName.of('Resources')),procs instanceof PDFDict?procs.values().map(decode).join('\n'):'');}
  }
  for(const [spaces,[resources,...contents]] of owners){
   const content=contents.join('\n');
   for(const key of spaces.keys()){const name=key.asString().replace(/[.*+?^${}()|[\]\\]/g,'\\$&');if(!new RegExp(name+'(?![^\\x00\\t\\n\\f\\r ()<>\\[\\]{}/%])').test(content))spaces.delete(key);}
   if(!spaces.keys().length)resources.delete(PDFName.of('ColorSpace'));
  }
  const reached=new Set(),pending=[doc.context.trailerInfo.Root,doc.context.trailerInfo.Info,doc.context.trailerInfo.Encrypt];
  while(pending.length){
   let value=pending.pop();if(!value)continue;
   if(value instanceof PDFRef){if(reached.has(value.toString()))continue;reached.add(value.toString());value=doc.context.lookup(value);}
   if(value instanceof PDFStream)value=value.dict;
   if(value instanceof PDFDict)pending.push(...value.values());else if(value instanceof PDFArray)pending.push(...value.asArray());
  }
  for(const [ref] of doc.context.enumerateIndirectObjects())if(!reached.has(ref.toString()))doc.context.delete(ref);
 },
 // Lowest effective resolution of any raster image at final print size, following each Do through q/Q/cm and Form matrices.
 async imageResolution(bytes) {
  const {PDFDocument,PDFName,PDFDict,PDFArray,PDFNumber,PDFRawStream,decodePDFRawStream}=PDFLib;
  const doc=await PDFDocument.load(bytes),seen=new Set();let lowest=null;
  const multiply=(a,b)=>[a[0]*b[0]+a[1]*b[2],a[0]*b[1]+a[1]*b[3],a[2]*b[0]+a[3]*b[2],a[2]*b[1]+a[3]*b[3],a[4]*b[0]+a[5]*b[2]+b[4],a[4]*b[1]+a[5]*b[3]+b[5]];
  const numbers=array=>array instanceof PDFArray?array.asArray().map(n=>doc.context.lookup(n)).map(n=>n instanceof PDFNumber?n.asNumber():0):null;
  const walk=(content,resources,ctm,page,depth)=>{
   if(depth>8)return;resources=doc.context.lookup(resources);
   const xobjects=resources instanceof PDFDict?doc.context.lookup(resources.get(PDFName.of('XObject'))):null;
   let text='';for(let i=0;i<content.length;i+=8192)text+=String.fromCharCode(...content.subarray(i,i+8192));
   const stack=[];let operands=[];
   for(const [token] of text.matchAll(/\/[^\s/\[\]<>(){}%]+|[^\s/\[\]<>(){}%]+/g)){
    if(token==='BI')return;
    if(token==='q')stack.push(ctm);else if(token==='Q')ctm=stack.pop()||ctm;
    else if(token==='cm'&&operands.length>=6)ctm=multiply(operands.slice(-6).map(Number),ctm);
    else if(token==='Do'&&xobjects instanceof PDFDict&&operands.length){
     const object=doc.context.lookup(xobjects.get(PDFName.of(operands.at(-1).slice(1))));
     if(object instanceof PDFRawStream){const dict=object.dict,subtype=dict.get(PDFName.of('Subtype'));
      if(subtype===PDFName.of('Image')&&dict.get(PDFName.of('ImageMask'))!==PDFLib.PDFBool.True){
       const w=doc.context.lookup(dict.get(PDFName.of('Width'))).asNumber(),h=doc.context.lookup(dict.get(PDFName.of('Height'))).asNumber();
       const across=Math.hypot(ctm[0],ctm[1]),down=Math.hypot(ctm[2],ctm[3]);
       if(across>0&&down>0){const ppi=Math.min(w*72/across,h*72/down);if(!lowest||ppi<lowest.ppi)lowest={ppi,page};}
      }else if(subtype===PDFName.of('Form'))walk(decodePDFRawStream(object).decode(),dict.get(PDFName.of('Resources')),multiply(numbers(dict.get(PDFName.of('Matrix')))||[1,0,0,1,0,0],ctm),page,depth+1);
     }
    }
    if(/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(token)||token[0]==='/')operands.push(token);else operands=[];
   }
  };
  doc.getPages().forEach((page,i)=>{
   const contents=page.node.get(PDFName.of('Contents'));if(!contents)return;const object=doc.context.lookup(contents);
   const streams=(object instanceof PDFArray?object.asArray():[contents]).map(ref=>doc.context.lookup(ref)).filter(s=>s instanceof PDFRawStream);
   const joined=streams.map(s=>decodePDFRawStream(s).decode()),content=new Uint8Array(joined.reduce((n,b)=>n+b.length+1,0));let at=0;for(const b of joined){content.set(b,at);at+=b.length;content[at++]=10;}
   walk(content,page.node.get(PDFName.of('Resources')),[1,0,0,1,0,0],i+1,0);
   // Tiling patterns draw in the page's default space through their own matrix.
   const resources=doc.context.lookup(page.node.get(PDFName.of('Resources'))),patterns=resources instanceof PDFDict?doc.context.lookup(resources.get(PDFName.of('Pattern'))):null;
   if(patterns instanceof PDFDict)for(const ref of patterns.values()){const pattern=doc.context.lookup(ref);if(pattern instanceof PDFRawStream&&!seen.has(pattern)){seen.add(pattern);walk(decodePDFRawStream(pattern).decode(),pattern.dict.get(PDFName.of('Resources')),numbers(pattern.dict.get(PDFName.of('Matrix')))||[1,0,0,1,0,0],i+1,1);}}
  });
  return lowest&&{ppi:Math.round(lowest.ppi),page:lowest.page,pages:doc.getPageCount()};
 },
 // Figma's pure black (#000000) converts to rich four-ink black, which blurs small type when plates misregister.
 // Figma also exports text as outlines, so text and shapes look the same here. Like InDesign's [Black],
 // every pure black fill and stroke becomes 100% K that overprints. Ghostscript keeps DeviceCMYK as it is.
 pureBlackContent(bytes) {
  let text='';for(let i=0;i<bytes.length;i+=8192)text+=String.fromCharCode(...bytes.subarray(i,i+8192));
  const space=c=>/[\x00\t\n\f\r ]/.test(c),delimiter=c=>/[()[\]<>\/%]/.test(c),zero=o=>o.number&&Number(o.text)===0;
  const edits=[],stack=[],FILL={cs:1,rg:1,g:1,k:1,sc:1,scn:1},STROKE={CS:1,RG:1,G:1,K:1,SC:1,SCN:1};
  // Per side: the colour space name the content set, whether 0 0 0 1 k replaced it, and whether it is black now.
  let operands=[],depth=0,arrayStart=0,state={fill:{space:'',swapped:false,black:false},stroke:{space:'',swapped:false,black:false}},shown='00';
  for(let i=0;i<text.length;){
   const c=text[i],start=i;if(space(c)){i++;continue;}
   if(c==='%'){while(i<text.length&&!/[\r\n]/.test(text[i]))i++;continue;}
   if(c==='('){let nesting=1;i++;while(i<text.length&&nesting){if(text[i]==='\\'){i+=2;continue;}if(text[i]==='(')nesting++;if(text[i]===')')nesting--;i++;}if(!depth)operands.push({start});continue;}
   if(c==='<'&&text[i+1]!=='<'){i++;while(i<text.length&&text[i]!=='>')i++;i++;if(!depth)operands.push({start});continue;}
   if(c==='['||text.slice(i,i+2)==='<<'){if(!depth++)arrayStart=start;i+=c==='['?1:2;continue;}
   if(c===']'||text.slice(i,i+2)==='>>'){i+=c===']'?1:2;if(!--depth)operands.push({start:arrayStart});continue;}
   if(c==='/'){i++;while(i<text.length&&!space(text[i])&&!delimiter(text[i]))i++;if(!depth)operands.push({start,text:text.slice(start,i)});continue;}
   if(delimiter(c)){i++;continue;}
   while(i<text.length&&!space(text[i])&&!delimiter(text[i]))i++;
   const token=text.slice(start,i);if(depth)continue;
   if(/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(token)){operands.push({start,text:token,number:true});continue;}
   const from=operands.length?operands[0].start:start;
   if(token==='BI')return {bytes,used:false};
   if(FILL[token]||STROKE[token]){
    const stroke=!!STROKE[token],side=stroke?state.stroke:state.fill,op=token.toLowerCase();
    if(op==='cs'){side.space=operands.length?operands[0].text:'';side.swapped=false;side.black=false;}
    else{
     side.black=(op==='rg'||((op==='sc'||op==='scn')&&side.space!=='/Pattern'))&&operands.length===3&&operands.every(zero);
     let replacement=null;
     if(side.black){replacement=stroke?'0 0 0 1 K':'0 0 0 1 k';side.swapped=true;}
     // 0 0 0 1 k changed the colour space, so sc and scn need theirs back.
     else if((op==='sc'||op==='scn')&&side.swapped&&side.space){replacement=side.space+(stroke?' CS ':' cs ')+text.slice(from,i);side.swapped=false;}
     else if(op!=='sc'&&op!=='scn')side.swapped=false;
     const want=(state.fill.black?'1':'0')+(state.stroke.black?'1':'0');
     if(want!==shown){replacement='/OPK'+want+' gs '+(replacement===null?text.slice(from,i):replacement);shown=want;}
     if(replacement!==null)edits.push({from,to:i,text:replacement});
    }
   }
   // Images, shadings and Forms paint their own colours, and a Form inherits its caller's overprint, so switch it off around them.
   else if((token==='Do'||token==='sh')&&shown!=='00')edits.push({from,to:from,text:'/OPK00 gs '},{from:i,to:i,text:' /OPK'+shown+' gs'});
   else if(token==='q')stack.push({state:JSON.parse(JSON.stringify(state)),shown});
   else if(token==='Q'){const saved=stack.pop();if(saved)({state,shown}=saved);}
   operands=[];
  }
  if(!edits.length)return {bytes,used:false};
  let result='',last=0;for(const edit of edits){result+=text.slice(last,edit.from)+edit.text;last=edit.to;}result+=text.slice(last);
  return {bytes:Uint8Array.from(result,c=>c.charCodeAt(0)),used:true};
 },
 pureBlack(doc) {
  const {PDFName,PDFDict,PDFRawStream,PDFArray,PDFRef,decodePDFRawStream}=PDFLib;
  // Overprint for the fill and stroke separately: OPK10 is a black fill only, OPK01 a black stroke only.
  const states=()=>Object.fromEntries(['00','10','01','11'].map(k=>['OPK'+k,doc.context.obj({Type:'ExtGState',op:k[0]==='1',OP:k[1]==='1',OPM:k==='00'?0:1})]));
  const addStates=resources=>{let gs=doc.context.lookup(resources.get(PDFName.of('ExtGState')));if(!(gs instanceof PDFDict)){gs=doc.context.obj({});resources.set(PDFName.of('ExtGState'),gs);}for(const [name,value] of Object.entries(states()))gs.set(PDFName.of(name),value);};
  const rewrite=stream=>{const {bytes,used}=this.pureBlackContent(decodePDFRawStream(stream).decode());if(!used)return null;const fixed=doc.context.flateStream(bytes);for(const [key,value] of stream.dict.entries())if(!['Length','Filter','DecodeParms'].includes(key.decodeText()))fixed.dict.set(key,value);return fixed;};
  // Soft masks paint coverage, not ink, so their content stays as it is.
  const masks=new Set();
  // Graphics states are often direct objects inside resources, so look inside every dictionary and array.
  const find=(value,depth)=>{if(depth>12)return;if(value instanceof PDFDict){const mask=doc.context.lookup(value.get(PDFName.of('SMask')));if(mask instanceof PDFDict&&mask.get(PDFName.of('G')))masks.add(mask.get(PDFName.of('G')).toString());for(const child of value.values())if(!(child instanceof PDFRef))find(child,depth+1);}else if(value instanceof PDFArray)for(const child of value.asArray())if(!(child instanceof PDFRef))find(child,depth+1);};
  for(const [,object] of doc.context.enumerateIndirectObjects())find(object instanceof PDFRawStream?object.dict:object,0);
  for(const [ref,object] of doc.context.enumerateIndirectObjects()){
   if(!(object instanceof PDFRawStream)||object.dict.get(PDFName.of('Subtype'))!==PDFName.of('Form')||masks.has(ref.toString()))continue;
   const fixed=rewrite(object);if(!fixed)continue;
   let resources=doc.context.lookup(fixed.dict.get(PDFName.of('Resources')));if(!(resources instanceof PDFDict)){resources=doc.context.obj({});fixed.dict.set(PDFName.of('Resources'),resources);}
   addStates(resources);doc.context.assign(ref,fixed);
  }
  for(const page of doc.getPages()){
   const contents=page.node.get(PDFName.of('Contents'));if(!contents)continue;
   const object=doc.context.lookup(contents),refs=object instanceof PDFArray?object.asArray():[contents];
   // Pages draw their content as one stream, so join them and keep the result as one.
   const streams=refs.map(ref=>doc.context.lookup(ref)).filter(s=>s instanceof PDFRawStream);if(streams.length!==refs.length)continue;
   const parts=streams.map(s=>decodePDFRawStream(s).decode()),joined=new Uint8Array(parts.reduce((n,b)=>n+b.length+1,0));let at=0;for(const b of parts){joined.set(b,at);at+=b.length;joined[at++]=10;}
   const result=this.pureBlackContent(joined);if(!result.used)continue;
   page.node.set(PDFName.of('Contents'),doc.context.register(doc.context.flateStream(result.bytes)));
   addStates(page.node.normalizedEntries().Resources);
  }
 },
 // Crop marks: offset and length in mm, weight in points. Offset may not be less than the bleed, so marks never sit on artwork.
 marksProblem(marks,bleed=0) {
  if(!marks)return '';
  const ok=(v,min,max)=>Number.isFinite(v)&&v>=min&&v<=max;
  if(!ok(marks.offset,0,20))return 'Offset must be between 0 and 20 mm.';
  if(!ok(marks.length,2,20))return 'Length must be between 2 and 20 mm.';
  if(!ok(marks.weight,0.1,2))return 'Thickness must be between 0.1 and 2 pt.';
  if(marks.offset+1e-6<bleed)return 'Offset must be at least the bleed ('+Math.round(bleed*100)/100+' mm).';
  return '';
 },
 // How artwork of one size fits a page of another, in mm: scaled proportionally and centred.
 fit(art,page) { const scale=Math.min(page.width/art.width,page.height/art.height);return {scale,dx:(page.width-art.width*scale)/2,dy:(page.height-art.height*scale)/2}; },
 // Bleed that ends up in the PDF. Scaling down shrinks it; scaling up adds more than the BleedBox keeps.
 scaledBleed(bleed,scale) { return bleed*Math.min(scale,1); },
 // Printers usually ask for 3 mm, so scaling must not take the bleed below that.
 MIN_SCALED_BLEED:3,
 scaledBleedProblem(bleed,scale) { const left=this.scaledBleed(bleed,scale);return bleed>0&&scale<1&&left+0.005<this.MIN_SCALED_BLEED?'Scaling to '+Math.round(scale*100)+'% leaves '+Math.round(left*10)/10+' mm of bleed.':''; },
 // The margin around the trim on each side, in mm: the bleed, or the marks' offset plus length when there are marks.
 margin(bleed=0,marks=null) { return Math.max(bleed,marks?marks.offset+marks.length:0); },
 // Draws two marks per corner in a Separation All colour space, which prints on every plate (Registration).
 drawMarks(doc,page,trim,margin,marks) {
  const {PDFName,PDFOperator,PDFNumber}=PDFLib,pt=mm=>mm*72/25.4;
  if(!doc.__registration)doc.__registration=doc.context.register(doc.context.obj([PDFName.of('Separation'),PDFName.of('All'),PDFName.of('DeviceCMYK'),doc.context.obj({FunctionType:2,Domain:[0,1],C0:[0,0,0,0],C1:[1,1,1,1],N:1})]));
  const {Resources}=page.node.normalizedEntries();
  let spaces=Resources.lookup(PDFName.of('ColorSpace'));if(!spaces){spaces=doc.context.obj({});Resources.set(PDFName.of('ColorSpace'),spaces);}
  spaces.set(PDFName.of('OPRegistration'),doc.__registration);
  const off=pt(marks.offset),len=pt(marks.length),x0=margin,y0=margin,x1=margin+trim.width,y1=margin+trim.height;
  const op=(name,...args)=>PDFOperator.of(name,args.map(a=>typeof a==='number'?PDFNumber.of(a):a));
  const ops=[op('q'),op('CS',PDFName.of('OPRegistration')),op('SCN',1),op('w',marks.weight*1),op('J',0)];
  const line=(ax,ay,bx,by)=>ops.push(op('m',ax,ay),op('l',bx,by),op('S'));
  for(const [x,sx] of [[x0,-1],[x1,1]])for(const [y,sy] of [[y0,-1],[y1,1]]){line(x+sx*off,y,x+sx*(off+len),y);line(x,y+sy*off,x,y+sy*(off+len));}
  ops.push(op('Q'));
  // A stream of its own after everything else, so the artwork's translation doesn't apply to the marks.
  page.node.addContentStream(doc.context.register(doc.context.contentStream(ops)));
 },
 // PDF/X-4 (ISO 15930-7) is PDF 1.6 with an output intent, trim boxes, a Trapped key, a document ID and XMP
 // naming the standard. finish() already sets the rest; Ghostscript wrote PDF 1.6 for the same export.
 markPDFX4(doc,title,now=new Date()) {
  const {PDFName,PDFHexString,PDFRawStream}=PDFLib;
  now=new Date(Math.floor(now.getTime()/1000)*1000);const date=now.toISOString().replace('.000','');
  const random=()=>{const bytes=new Uint8Array(16);if(typeof crypto!=='undefined'&&crypto.getRandomValues)crypto.getRandomValues(bytes);else for(let i=0;i<16;i++)bytes[i]=Math.random()*256|0;return [...bytes].map(b=>b.toString(16).padStart(2,'0')).join('');};
  const id=random(),instance=random(),uuid=hex=>'uuid:'+hex.slice(0,8)+'-'+hex.slice(8,12)+'-'+hex.slice(12,16)+'-'+hex.slice(16,20)+'-'+hex.slice(20);
  const producer='Open Print · Ghostscript + pdf-lib',xml=text=>text.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  doc.setTitle(title);doc.setCreator('Figma');doc.setProducer(producer);doc.setCreationDate(now);doc.setModificationDate(now);
  doc.getInfoDict().set(PDFName.of('Trapped'),PDFName.of('False'));
  doc.context.trailerInfo.ID=doc.context.obj([PDFHexString.of(id),PDFHexString.of(instance)]);
  const packet='<?xpacket begin="\uFEFF" id="W5M0MpCehiHzreSzNTczkc9d"?>\n<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">\n'+
   '<rdf:Description rdf:about="" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:xmp="http://ns.adobe.com/xap/1.0/" xmlns:pdf="http://ns.adobe.com/pdf/1.3/" xmlns:xmpMM="http://ns.adobe.com/xap/1.0/mm/" xmlns:pdfxid="http://www.npes.org/pdfx/ns/id/">\n'+
   '<dc:format>application/pdf</dc:format><dc:title><rdf:Alt><rdf:li xml:lang="x-default">'+xml(title)+'</rdf:li></rdf:Alt></dc:title>\n'+
   '<xmp:CreateDate>'+date+'</xmp:CreateDate><xmp:ModifyDate>'+date+'</xmp:ModifyDate><xmp:MetadataDate>'+date+'</xmp:MetadataDate><xmp:CreatorTool>Figma</xmp:CreatorTool>\n'+
   '<pdf:Producer>'+xml(producer)+'</pdf:Producer><pdf:Trapped>False</pdf:Trapped>\n'+
   '<xmpMM:DocumentID>'+uuid(id)+'</xmpMM:DocumentID><xmpMM:InstanceID>'+uuid(instance)+'</xmpMM:InstanceID><xmpMM:VersionID>1</xmpMM:VersionID><xmpMM:RenditionClass>default</xmpMM:RenditionClass>\n'+
   '<pdfxid:GTS_PDFXVersion>PDF/X-4</pdfxid:GTS_PDFXVersion>\n</rdf:Description></rdf:RDF></x:xmpmeta>\n<?xpacket end="w"?>';
  const bytes=new TextEncoder().encode(packet);
  doc.catalog.set(PDFName.of('Metadata'),doc.context.register(PDFRawStream.of(doc.context.obj({Type:'Metadata',Subtype:'XML',Length:bytes.length}),bytes)));
  doc.catalog.delete(PDFName.of('Version'));
 },
 // options.bleeds: each page's bleed in mm, already exported around the artwork. options.marks: crop marks, or null.
 // options.pdfx: mark the file PDF/X-4, titled options.title.
 async finish(bytes,icc,width,height,profileName,pageSizes,options={}) {
  if(icc) this.validateICC(icc);
  const {PDFDocument,PDFName,PDFString}=PDFLib;
  const doc=await PDFDocument.load(bytes);
  this.cleanPaths(doc);
  this.normalizeAlphaMasks(doc);
  this.dropUnusedColorSpaces(doc);
  const pages=doc.getPages(),marks=options.marks||null,pt=mm=>mm*72/25.4;
  if(pageSizes && pageSizes.length!==pages.length)throw new Error('Frame and PDF page counts do not match.');
  const sizes=pages.map((page,i)=>{const size=pageSizes?pageSizes[i]:{width,height};return {width:this.points(size.width),height:this.points(size.height)};});
  for(let i=0;i<pages.length;i++) {
   const page=pages[i],w=sizes[i].width,h=sizes[i].height,canvasBleed=options.bleeds&&options.bleeds[i]||0;
   // Artwork for a page of another size arrives already scaled; fit says by how much and where it sits on the trim.
   const fit=options.fits&&options.fits[i]||null,scale=fit?fit.scale:1,bleedMm=this.scaledBleed(canvasBleed,scale);
   const problem=this.marksProblem(marks,bleedMm);if(problem)throw new Error(problem);
   const b=pt(bleedMm),m=pt(this.margin(bleedMm,marks)),old=page.getHeight(),cb=pt(canvasBleed*scale),dx=fit?pt(fit.dx):0,dy=fit?pt(fit.dy):0;
   // A whole-pixel paper-size frame prints at the exact paper size, so its artwork stretches by a fraction of a point to fill the trim.
   const sx=(w-2*dx)/(page.getWidth()-2*cb),sy=(h-2*dy)/(old-2*cb),stretch=Math.abs(sx-1)*(w-2*dx)>0.02||Math.abs(sy-1)*(h-2*dy)>0.02;
   if(stretch)page.scaleContent(sx,sy);
   // The exported page is the frame plus its bleed. Its top left goes to the bleed corner, so the trim lands on the TrimBox.
   page.translateContent(m+dx-(stretch?sx:1)*cb,h+m-dy-(stretch?sy:1)*(old-cb));
   // Scaled artwork is clipped to its own trim plus the bleed, inside the BleedBox, so surplus bleed never shows in white space or under the marks.
   // The clip streams must be registered: a stream written inline in /Contents makes the whole file unreadable.
   if(fit){const aw=w-2*dx,ah=h-2*dy,x0=Math.max(m-b,m+dx-b),y0=Math.max(m-b,m+dy-b),x1=Math.min(m+w+b,m+dx+aw+b),y1=Math.min(m+h+b,m+dy+ah+b);const ref=stream=>doc.context.register(stream);page.node.wrapContentStreams(ref(page.createContentStream(PDFLib.pushGraphicsState(),PDFLib.rectangle(x0,y0,x1-x0,y1-y0),PDFLib.clip(),PDFLib.endPath())),ref(page.createContentStream(PDFLib.popGraphicsState())));}
   page.setMediaBox(0,0,w+2*m,h+2*m);page.setCropBox(0,0,w+2*m,h+2*m);page.setTrimBox(m,m,w,h);page.setBleedBox(m-b,m-b,w+2*b,h+2*b);
   if(marks)this.drawMarks(doc,page,{width:w,height:h},m,marks);
  }
  doc.catalog.delete(PDFName.of('OutputIntents'));
  if(icc) {
  const profile=doc.context.register(doc.context.flateStream(icc,{N:4}));
  const intent=doc.context.register(doc.context.obj({Type:'OutputIntent',S:'GTS_PDFX',OutputConditionIdentifier:PDFString.of(profileName),Info:PDFString.of(profileName),DestOutputProfile:profile}));
  doc.catalog.set(PDFName.of('OutputIntents'),doc.context.obj([intent]));
  }
  doc.setProducer('Open Print · Ghostscript + pdf-lib');
  if(!options.pdfx)return doc.save();
  if(!icc)throw new Error('PDF/X-4 needs a colour profile.');
  this.markPDFX4(doc,options.title||'Untitled');
  // pdf-lib always writes a 1.7 header. 1.6 is the same length, so no offsets move.
  const saved=await doc.save(),header=String.fromCharCode(...saved.subarray(0,8));if(header!=='%PDF-1.7')throw new Error('Unexpected PDF header.');
  saved[7]=0x36;return saved;
 }
};
