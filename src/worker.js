self.onmessage=async event=>{
 const timings=[],measure=stage=>{const start=Date.now();return ()=>timings.push({stage,ms:Date.now()-start});};
 try {
  const {wasm,pdf,icc,compatibility}=event.data;
  const boot=measure('ghostscript.init'),log=[];const module=await GhostscriptModule({instantiateWasm:(imports,receive)=>{const instance=new WebAssembly.Instance(new WebAssembly.Module(wasm),imports);receive(instance);return instance.exports;},print:s=>log.push(s),printErr:s=>log.push(s)});
  boot();const files=measure('ghostscript.input');module.FS.mkdirTree('/work');module.FS.writeFile('/work/input.pdf',pdf);if(icc)module.FS.writeFile('/work/output.icc',icc);
  files();
  // -r72 keeps coordinates in points. At Ghostscript's default 720 dpi everything sits under a 0.1 scale, which macOS Preview and Quick Look apply to soft masks twice, leaving only a corner of any transparent artwork.
  const args=['-r72','-dNoOutputFonts','-dMaxInlineImageSize=0','-dCompatibilityLevel='+(compatibility||'1.7'),'-sColorConversionStrategy=CMYK','-dProcessColorModel=/DeviceCMYK','-dOverrideICC=false','-dDownsampleColorImages=false','-dDownsampleGrayImages=false','-dDownsampleMonoImages=false','-dAutoFilterColorImages=false','-dColorImageFilter=/FlateEncode','-dAutoFilterGrayImages=false','-dGrayImageFilter=/FlateEncode'];
  if(icc)args.push('--permit-file-read=/work/output.icc','-sOutputICCProfile=/work/output.icc');
  const processEnd=measure('ghostscript.convert');const code=module.cwrap('gs_process_pdf_argv','number',['string','string','string'])('/work/input.pdf','/work/output.pdf',args.join('\n'));
  processEnd();if(code!==0)throw new Error(module.ccall('gs_get_last_error','string',[],[])||log.slice(-5).join('\n')||'CMYK conversion failed.');
  const output=measure('ghostscript.output');const bytes=module.FS.readFile('/work/output.pdf').slice();output();self.postMessage({bytes,timings},[bytes.buffer]);
 }catch(error){self.postMessage({timings,error:error.message||String(error)});}
};
