// Ghostscript cannot convert an RGB shading's colour function to CMYK, so it rasterises the gradient at
// low resolution (and drops mesh shadings entirely). Rewriting every RGB shading as DeviceCMYK before
// conversion keeps gradients vector. The CMYK values come from Ghostscript itself, via a probe page of
// solid fills painted in each shading's own colour space, so gradients match flat colours exactly.
var PrintShading = (() => {
 const SAMPLES=2048,GRID=64;
 const {PDFDocument,PDFName,PDFDict,PDFArray,PDFRawStream,PDFRef,decodePDFRawStream}=PDFLib;
 const name=n=>PDFName.of(n),latin1=bytes=>{let s='';for(let i=0;i<bytes.length;i+=8192)s+=String.fromCharCode.apply(null,bytes.subarray(i,i+8192));return s;};
 const numbers=array=>array?array.asArray().map(n=>n.asNumber()):null,dictOf=o=>o instanceof PDFRawStream?o.dict:o instanceof PDFDict?o:null;

 // PDF FunctionType 4 (PostScript calculator), the form Figma uses for every gradient.
 function parseCalculator(source){
  let i=0;const token=()=>{while(i<source.length&&/\s/.test(source[i]))i++;if(i>=source.length)return null;if('{}'.includes(source[i]))return source[i++];const start=i;while(i<source.length&&!/[\s{}]/.test(source[i]))i++;return source.slice(start,i);};
  const block=()=>{const out=[];for(let t;(t=token())!==null;){if(t==='{')out.push(block());else if(t==='}')return out;else out.push(/^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(t)?Number(t):t);}throw new Error('Unterminated gradient function.');};
  if(token()!=='{')throw new Error('Invalid gradient function.');return block();
 }
 function runCalculator(code,stack){
  const pop=()=>{if(!stack.length)throw new Error('Invalid gradient function.');return stack.pop();},both=f=>{const y=pop(),x=pop();stack.push(f(x,y));},one=f=>stack.push(f(pop()));
  const bool=(x,y,b,i)=>typeof x==='boolean'?b(x,y):i(x,y);
  for(const op of code){
   if(typeof op==='number'||Array.isArray(op)){stack.push(op);continue;}
   switch(op){
    case 'add':both((x,y)=>x+y);break;case 'sub':both((x,y)=>x-y);break;case 'mul':both((x,y)=>x*y);break;case 'div':both((x,y)=>x/y);break;
    case 'idiv':both((x,y)=>Math.trunc(x/y));break;case 'mod':both((x,y)=>x%y);break;case 'exp':both((x,y)=>Math.pow(x,y));break;
    case 'atan':both((y,x)=>{const a=Math.atan2(y,x)*180/Math.PI;return a<0?a+360:a;});break;
    case 'neg':one(x=>-x);break;case 'abs':one(Math.abs);break;case 'ceiling':one(Math.ceil);break;case 'floor':one(Math.floor);break;case 'round':one(Math.round);break;
    case 'truncate':case 'cvi':one(Math.trunc);break;case 'cvr':break;case 'sqrt':one(Math.sqrt);break;case 'ln':one(Math.log);break;case 'log':one(Math.log10);break;
    case 'sin':one(x=>Math.sin(x*Math.PI/180));break;case 'cos':one(x=>Math.cos(x*Math.PI/180));break;
    case 'eq':both((x,y)=>x===y);break;case 'ne':both((x,y)=>x!==y);break;case 'gt':both((x,y)=>x>y);break;case 'ge':both((x,y)=>x>=y);break;case 'lt':both((x,y)=>x<y);break;case 'le':both((x,y)=>x<=y);break;
    case 'and':both((x,y)=>bool(x,y,(a,b)=>a&&b,(a,b)=>a&b));break;case 'or':both((x,y)=>bool(x,y,(a,b)=>a||b,(a,b)=>a|b));break;case 'xor':both((x,y)=>bool(x,y,(a,b)=>a!==b,(a,b)=>a^b));break;
    case 'not':one(x=>typeof x==='boolean'?!x:~x);break;case 'bitshift':both((x,y)=>y>=0?x<<y:x>>-y);break;case 'true':stack.push(true);break;case 'false':stack.push(false);break;
    case 'pop':pop();break;case 'exch':{const y=pop(),x=pop();stack.push(y,x);break;}case 'dup':{const x=pop();stack.push(x,x);break;}
    case 'copy':{const n=pop();stack.push(...stack.slice(stack.length-n));break;}case 'index':{const n=pop();stack.push(stack[stack.length-1-n]);break;}
    case 'roll':{const j=pop(),n=pop();if(n){const part=stack.splice(stack.length-n,n),s=((j%n)+n)%n;stack.push(...part.slice(n-s),...part.slice(0,n-s));}break;}
    case 'if':{const p=pop(),c=pop();if(c)runCalculator(p,stack);break;}case 'ifelse':{const b=pop(),a=pop(),c=pop();runCalculator(c?a:b,stack);break;}
    default:throw new Error('Unsupported gradient function operator: '+op);
   }
  }
  return stack;
 }
 // Returns a JavaScript evaluator for a PDF function (types 0, 2, 3 and 4, or an array of functions).
 function evaluator(doc,ref){
  const object=doc.context.lookup(ref);
  if(object instanceof PDFArray){const parts=object.asArray().map(r=>evaluator(doc,r));return x=>parts.flatMap(f=>f(x));}
  const d=dictOf(object);if(!d)throw new Error('Invalid gradient function.');
  const type=d.get(name('FunctionType')).asNumber(),domain=numbers(d.get(name('Domain'))),range=numbers(d.get(name('Range')));
  const clipIn=x=>x.map((v,i)=>Math.min(domain[2*i+1],Math.max(domain[2*i],v))),clipOut=y=>range?y.map((v,i)=>Math.min(range[2*i+1],Math.max(range[2*i],v))):y;
  if(type===2){const c0=numbers(d.get(name('C0')))||[0],c1=numbers(d.get(name('C1')))||[1],n=d.get(name('N')).asNumber();return x=>{const t=Math.pow(clipIn(x)[0],n);return clipOut(c0.map((v,i)=>v+t*(c1[i]-v)));};}
  if(type===3){
   const parts=d.get(name('Functions')).asArray().map(r=>evaluator(doc,r)),bounds=numbers(d.get(name('Bounds'))),encode=numbers(d.get(name('Encode')));
   return x=>{const t=clipIn(x)[0];let k=0;while(k<bounds.length&&t>=bounds[k])k++;const lo=k?bounds[k-1]:domain[0],hi=k<bounds.length?bounds[k]:domain[1],e0=encode[2*k],e1=encode[2*k+1];return clipOut(parts[k]([hi===lo?e0:e0+(t-lo)*(e1-e0)/(hi-lo)]));};
  }
  if(type===4){if(!(object instanceof PDFRawStream))throw new Error('Invalid gradient function.');const code=parseCalculator(latin1(decodePDFRawStream(object).decode()));return x=>clipOut(runCalculator(code,clipIn(x)).map(Number));}
  if(type===0){
   const size=numbers(d.get(name('Size'))),bits=d.get(name('BitsPerSample')).asNumber();if(size.length!==1||!(object instanceof PDFRawStream))throw new Error('Unsupported gradient function.');
   const data=decodePDFRawStream(object).decode(),n=range.length/2,enc=numbers(d.get(name('Encode')))||[0,size[0]-1],dec=numbers(d.get(name('Decode')))||range,max=2**bits-1;
   const sample=(j,c)=>{const start=(j*n+c)*bits;let v=0;for(let b=0;b<bits;b++){const p=start+b;v=v*2+((data[p>>3]>>(7-(p&7)))&1);}return v;};
   return x=>{const t=clipIn(x)[0],e=Math.min(size[0]-1,Math.max(0,enc[0]+(t-domain[0])*(enc[1]-enc[0])/(domain[1]-domain[0]))),j=Math.floor(e),f=e-j,j2=Math.min(j+1,size[0]-1);
    return clipOut([...Array(n)].map((_,c)=>dec[2*c]+(sample(j,c)*(1-f)+sample(j2,c)*f)/max*(dec[2*c+1]-dec[2*c])));};
  }
  throw new Error('Unsupported gradient function type '+type+'.');
 }
 function isRGB(doc,space){
  space=doc.context.lookup(space);
  if(space===name('DeviceRGB'))return true;
  if(space instanceof PDFArray){const family=space.get(0);if(family===name('CalRGB'))return true;if(family===name('ICCBased')){const icc=dictOf(doc.context.lookup(space.get(1)));return !!icc&&icc.get(name('N'))?.asNumber()===3;}}
  return false;
 }
 // Every RGB shading in the file, including inline pattern and resource dictionaries.
 function find(doc){
  const found=new Map(),seen=new Set();
  const visit=value=>{
   const object=value instanceof PDFRef?doc.context.lookup(value):value;if(object==null||seen.has(object))return;seen.add(object);
   const d=dictOf(object);
   if(d){if(d.get(name('ShadingType'))&&isRGB(doc,d.get(name('ColorSpace'))))found.set(object,{shading:object});for(const [,v] of d.entries())visit(v);}
   else if(object instanceof PDFArray)for(const v of object.asArray())visit(v);
  };
  for(const [,object] of doc.context.enumerateIndirectObjects())visit(object);
  return [...found.values()];
 }
 // Lists the RGB colours each shading needs converted. Throws for shadings that would otherwise be lost.
 function plan(doc){
  const jobs=[];
  for(const item of find(doc)){
   const d=dictOf(item.shading),type=d.get(name('ShadingType')).asNumber(),space=d.get(name('ColorSpace'));
   if(type>=1&&type<=3&&d.get(name('Function'))){
    const f=evaluator(doc,d.get(name('Function'))),colors=[];
    if(type===1){const dom=numbers(d.get(name('Domain')))||[0,1,0,1];for(let j=0;j<GRID;j++)for(let i=0;i<GRID;i++)colors.push(f([dom[0]+(dom[1]-dom[0])*i/(GRID-1),dom[2]+(dom[3]-dom[2])*j/(GRID-1)]));}
    else{const dom=numbers(d.get(name('Domain')))||[0,1];for(let i=0;i<SAMPLES;i++)colors.push(f([dom[0]+(dom[1]-dom[0])*i/(SAMPLES-1)]));}
    jobs.push({item,type,space,colors});continue;
   }
   if((type===4||type===5)&&item.shading instanceof PDFRawStream){
    const flagBits=type===4?d.get(name('BitsPerFlag')).asNumber():0,coordBits=d.get(name('BitsPerCoordinate')).asNumber(),compBits=d.get(name('BitsPerComponent')).asNumber(),decode=numbers(d.get(name('Decode')));
    if(!d.get(name('Function'))&&flagBits%8===0&&coordBits%8===0&&compBits%8===0&&decode&&decode.length>=10){
     const data=decodePDFRawStream(item.shading).decode(),head=(flagBits+2*coordBits)/8,size=head+3*compBits/8,count=Math.floor(data.length/size),max=2**compBits-1,colors=[];
     const read=(p,bytes)=>{let v=0;for(let b=0;b<bytes;b++)v=v*256+data[p+b];return v;};
     for(let v=0;v<count;v++)colors.push([0,1,2].map(c=>decode[4+2*c]+read(v*size+head+c*compBits/8,compBits/8)/max*(decode[5+2*c]-decode[4+2*c])));
     jobs.push({item,type,space,colors,data,head,size,count,compBits,decode});continue;
    }
   }
   throw new Error('This file uses a gradient type that cannot be converted to CMYK yet (shading type '+type+').');
  }
  return jobs;
 }
 const clamp=v=>Math.min(1,Math.max(0,v)),key=(c,space)=>c.map(v=>Math.round(clamp(v)*4095)).join(',')+'|'+space.toString();
 // A page with one filled square per unique colour, painted in the source colour space.
 async function probe(doc,jobs){
  const unique=new Map();for(const job of jobs)for(const c of job.colors){const k=key(c,job.space);if(!unique.has(k))unique.set(k,{c,space:job.space});}
  const out=await PDFDocument.create(),page=out.addPage([1000,1000]),spaces=new Map(),resources={};
  for(const {space} of unique.values()){
   const id=space.toString();if(spaces.has(id))continue;const label='C'+spaces.size;spaces.set(id,label);
   const source=doc.context.lookup(space);
   if(source instanceof PDFName)resources[label]=source;
   else{const copy=source.asArray().map(v=>{const o=doc.context.lookup(v);if(o instanceof PDFRawStream)return out.context.register(PDFRawStream.of(o.dict.clone(out.context),o.contents));if(o instanceof PDFDict)return o.clone(out.context);return o;});resources[label]=out.context.obj(copy);}
  }
  const lines=[];let current='',i=0;
  for(const {c,space} of unique.values()){const label=spaces.get(space.toString());if(label!==current){lines.push('/'+label+' cs');current=label;}lines.push(c.map(v=>clamp(v).toFixed(5)).join(' ')+' scn '+(i%1000)+' '+Math.floor(i/1000)+' 1 1 re f');i++;}
  page.node.set(name('Resources'),out.context.obj({ColorSpace:resources}));
  page.node.set(name('Contents'),out.context.register(out.context.flateStream(Uint8Array.from(lines.join('\n'),ch=>ch.charCodeAt(0)))));
  return {bytes:await out.save(),keys:[...unique.keys()]};
 }
 // Reads the converted probe back. Ghostscript skips k when a colour repeats, so carry the current colour.
 async function read(bytes,keys){
  const doc=await PDFDocument.load(bytes),contents=doc.context.lookup(doc.getPages()[0].node.get(name('Contents')));
  const streams=contents instanceof PDFArray?contents.asArray().map(r=>doc.context.lookup(r)):[contents];
  const text=streams.map(s=>latin1(decodePDFRawStream(s).decode())).join('\n'),colors=new Map();let current=null,n=0;
  for(const m of text.matchAll(/([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+k\b|\bf\b/g)){if(m[1])current=m.slice(1,5).map(Number);else if(n<keys.length)colors.set(keys[n++],current);}
  if(n!==keys.length||[...colors.values()].some(c=>!c))throw new Error('Gradient colour conversion failed. Please try again.');
  return colors;
 }
 function apply(doc,jobs,colors){
  for(const job of jobs){
   const d=dictOf(job.item.shading),cmyk=job.colors.map(c=>colors.get(key(c,job.space)));
   if(job.type<=3){
    const bytes=new Uint8Array(cmyk.length*8);cmyk.forEach((c,i)=>c.forEach((v,k)=>{const n=Math.round(clamp(v)*65535);bytes[i*8+k*2]=n>>8;bytes[i*8+k*2+1]=n&255;}));
    const domain=numbers(d.get(name('Domain')))||(job.type===1?[0,1,0,1]:[0,1]);
    d.set(name('Function'),doc.context.register(doc.context.flateStream(bytes,{FunctionType:0,Domain:domain,Range:[0,1,0,1,0,1,0,1],Size:job.type===1?[GRID,GRID]:[SAMPLES],BitsPerSample:16})));
    d.set(name('ColorSpace'),name('DeviceCMYK'));continue;
   }
   const bytesPer=job.compBits/8,size=job.head+4*bytesPer,out=new Uint8Array(job.count*size),max=2**job.compBits-1;
   for(let v=0;v<job.count;v++){
    out.set(job.data.subarray(v*job.size,v*job.size+job.head),v*size);
    cmyk[v].forEach((c,k)=>{let n=Math.round(clamp(c)*max);for(let b=bytesPer-1;b>=0;b--){out[v*size+job.head+k*bytesPer+b]=n&255;n=Math.floor(n/256);}});
   }
   const stream=doc.context.flateStream(out,{});
   for(const [k,v] of d.entries())if(!['Length','Filter','DecodeParms','Decode','ColorSpace'].includes(k.decodeText()))stream.dict.set(k,v);
   stream.dict.set(name('ColorSpace'),name('DeviceCMYK'));stream.dict.set(name('Decode'),doc.context.obj(job.decode.slice(0,4).concat([0,1,0,1,0,1,0,1])));
   // Streams are always indirect, so replacing the object updates every pattern that uses it.
   doc.context.assign(doc.context.getObjectRef(job.item.shading),stream);
  }
 }
 // Converts all RGB shadings in place. convert(bytes) runs Ghostscript with the export's settings.
 async function toCMYK(doc,convert){
  const jobs=plan(doc);if(!jobs.length)return 0;
  const page=await probe(doc,jobs);apply(doc,jobs,await read(await convert(page.bytes),page.keys));return jobs.length;
 }
 return {parseCalculator,runCalculator,evaluator,find,plan,probe,read,apply,toCMYK};
})();
