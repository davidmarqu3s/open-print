const OpenPrintAssets=(()=>{
 const ENGINE_URL='https://raw.githubusercontent.com/davidmarqu3s/open-print/436f731594ae50c359e70c03c0135e63cbd47cf8/vendor/ghostscript.wasm';
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
 // Streams the body when a progress callback is given, so the UI can show how much has arrived.
 async function readBody(response,onProgress){
  if(!onProgress||!response.body||!response.body.getReader)return new Uint8Array(await response.arrayBuffer());
  const reader=response.body.getReader(),bytes=new Uint8Array(ENGINE_SIZE);let received=0;
  for(;;){
   const {done,value}=await reader.read();if(done)break;
   if(received+value.length>ENGINE_SIZE){reader.cancel();throw new Error('The conversion engine download is incomplete. Please try again.');}
   bytes.set(value,received);received+=value.length;onProgress(received/ENGINE_SIZE);
  }
  return received===ENGINE_SIZE?bytes:bytes.slice(0,received);
 }
 async function loadEngine(signal,onProgress){
  if(engine)return engine.slice();
  let response;
  try{response=await fetch(ENGINE_URL,{signal,credentials:'omit',referrerPolicy:'no-referrer'});}catch(error){throw new Error('Could not download the conversion engine. Check your internet connection and try again.');}
  if(!response.ok)throw new Error('Could not download the conversion engine. Please try again.');
  const bytes=await readBody(response,onProgress);
  if(bytes.length!==ENGINE_SIZE)throw new Error('The conversion engine download is incomplete. Please try again.');
  const hash=sha256(bytes);
  if(hash!==ENGINE_SHA256)throw new Error('The conversion engine could not be verified. Please try again.');
  engine=bytes;return bytes.slice();
 }
 return {decodeProfile,loadEngine,ENGINE_URL,ENGINE_SIZE,ENGINE_SHA256};
})();
