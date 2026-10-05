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
 async finish(bytes,icc,width,height,profileName,pageSizes) {
  if(icc) this.validateICC(icc);
  const {PDFDocument,PDFName,PDFString}=PDFLib;
  const doc=await PDFDocument.load(bytes);
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
