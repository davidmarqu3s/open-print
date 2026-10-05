import fs from 'node:fs';
fs.mkdirSync('dist',{recursive:true});const read=p=>fs.readFileSync(p,'utf8');
const index=process.argv.indexOf('--profile');
const preset=index<0?null:fs.readFileSync(process.argv[index+1]);
if(preset && (preset.toString('ascii',16,20)!=='CMYK'||preset.toString('ascii',36,40)!=='acsp'))throw new Error('Preset must be a CMYK ICC profile.');
const worker=read('vendor/ghostscript.js')+'\n'+read('src/worker.js');
const bundle=read('vendor/pdf-lib.min.js')+'\n'+read('src/core.js')+'\nconst WORKER_SOURCE='+JSON.stringify(worker)+';\nconst WASM_BASE64='+JSON.stringify(fs.readFileSync('vendor/ghostscript.wasm').toString('base64'))+';\nconst PRESET_ICC_BASE64='+JSON.stringify(preset?preset.toString('base64'):null)+';\n'+read('src/ui.js');
fs.writeFileSync('dist/ui.html',read('src/ui.html').replace('/*BUNDLE*/',()=>bundle.replace(/<\/script/gi,'<\\/script')));fs.copyFileSync('src/controller.js','dist/code.js');
