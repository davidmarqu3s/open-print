self.onmessage=async event=>{
 try {
  const {wasm,pdf,icc,compatibility}=event.data;
  const log=[];const module=await GhostscriptModule({instantiateWasm:(imports,receive)=>{const instance=new WebAssembly.Instance(new WebAssembly.Module(wasm),imports);receive(instance);return instance.exports;},print:s=>log.push(s),printErr:s=>log.push(s)});
  module.FS.mkdirTree('/work');module.FS.writeFile('/work/input.pdf',pdf);if(icc)module.FS.writeFile('/work/output.icc',icc);
  const args=['-dNoOutputFonts','-dMaxInlineImageSize=0','-dCompatibilityLevel='+(compatibility||'1.7'),'-sColorConversionStrategy=CMYK','-dProcessColorModel=/DeviceCMYK','-dOverrideICC=false','-dDownsampleColorImages=false','-dDownsampleGrayImages=false','-dDownsampleMonoImages=false','-dAutoFilterColorImages=false','-dColorImageFilter=/FlateEncode','-dAutoFilterGrayImages=false','-dGrayImageFilter=/FlateEncode'];
  if(icc)args.push('--permit-file-read=/work/output.icc','-sOutputICCProfile=/work/output.icc');
  const code=module.cwrap('gs_process_pdf_argv','number',['string','string','string'])('/work/input.pdf','/work/output.pdf',args.join('\n'));
  if(code!==0)throw new Error(module.ccall('gs_get_last_error','string',[],[])||log.slice(-5).join('\n')||'CMYK conversion failed.');
  const bytes=module.FS.readFile('/work/output.pdf').slice();self.postMessage({bytes},[bytes.buffer]);
 }catch(error){self.postMessage({error:error.message||String(error)});}
};
