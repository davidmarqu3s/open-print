var PrintCore = {
 frameSize(width,height) {
  if(!Number.isFinite(width)||!Number.isFinite(height)||width<=0||height<=0)throw new Error('Invalid frame dimensions.');
  return {width:Math.round(width*25.4/72*100)/100,height:Math.round(height*25.4/72*100)/100};
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
 async finish(bytes,icc,width,height,profileName,pageSizes) {
  if(icc) this.validateICC(icc);
  const {PDFDocument,PDFName,PDFString}=PDFLib;
  const doc=await PDFDocument.load(bytes);
  this.cleanPaths(doc);
  this.normalizeAlphaMasks(doc);
  const pages=doc.getPages();
  if(pageSizes && pageSizes.length!==pages.length)throw new Error('Frame and PDF page counts do not match.');
  const sizes=pages.map((page,i)=>{const size=pageSizes?pageSizes[i]:{width,height};return {width:this.points(size.width),height:this.points(size.height)};});
  for(let i=0;i<pages.length;i++) { const page=pages[i],w=sizes[i].width,h=sizes[i].height; const old=page.getHeight();page.translateContent(0,h-old);page.setMediaBox(0,0,w,h);page.setCropBox(0,0,w,h);page.setTrimBox(0,0,w,h);page.setBleedBox(0,0,w,h); }
  doc.catalog.delete(PDFName.of('OutputIntents'));
  if(icc) {
  const profile=doc.context.register(doc.context.flateStream(icc,{N:4}));
  const intent=doc.context.register(doc.context.obj({Type:'OutputIntent',S:'GTS_PDFX',OutputConditionIdentifier:PDFString.of(profileName),Info:PDFString.of(profileName),DestOutputProfile:profile}));
  doc.catalog.set(PDFName.of('OutputIntents'),doc.context.obj([intent]));
  }
  doc.setProducer('Open Print · Ghostscript + pdf-lib');
  return doc.save();
 }
};
