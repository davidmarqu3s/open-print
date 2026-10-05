const OpenPrintAssets=(()=>{
 const ENGINE_URL='https://raw.githubusercontent.com/J0shua-code/pdf-tools/51131feb82b37ad51687718889b788bf425ce594/web/ghostscript.wasm';
 const ENGINE_SIZE=17614404,ENGINE_SHA256='5a2b1b4daecc0003a70020106dc78c566a59d89524c502ad2a3eecbce0c7bf36';
 let engine=null;
 function decodeProfile(encoded){
  const packed=typeof encoded!=='string';
  const compressed=Uint8Array.from(atob(packed?encoded.data:encoded),c=>c.charCodeAt(0));
  if(!packed)return compressed;
  const context=PDFLib.PDFContext.create();
  const bytes=PDFLib.decodePDFRawStream(PDFLib.PDFRawStream.of(context.obj({Filter:'FlateDecode'}),compressed)).decode();
  const stride=encoded.stride;
  for(let i=stride;stride&&i<bytes.length;i++)bytes[i]=(bytes[i]+bytes[i-stride])&255;
  return bytes;
 }
 async function loadEngine(signal){
  if(engine)return engine.slice();
  let response;
  try{response=await fetch(ENGINE_URL,{signal,credentials:'omit',referrerPolicy:'no-referrer'});}catch(error){throw new Error('Could not download the conversion engine. Check your internet connection and try again.');}
  if(!response.ok)throw new Error('Could not download the conversion engine. Please try again.');
  const bytes=new Uint8Array(await response.arrayBuffer());
  if(bytes.length!==ENGINE_SIZE)throw new Error('The conversion engine download is incomplete. Please try again.');
  const digest=new Uint8Array(await crypto.subtle.digest('SHA-256',bytes));
  const hash=Array.from(digest,b=>b.toString(16).padStart(2,'0')).join('');
  if(hash!==ENGINE_SHA256)throw new Error('The conversion engine could not be verified. Please try again.');
  engine=bytes;return bytes.slice();
 }
 return {decodeProfile,loadEngine,ENGINE_URL,ENGINE_SIZE,ENGINE_SHA256};
})();
