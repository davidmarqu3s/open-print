import fs from 'node:fs';
import vm from 'node:vm';
fs.mkdirSync('dist',{recursive:true});const read=p=>fs.readFileSync(p,'utf8');
const index=process.argv.indexOf('--profile');
const preset=index<0?null:fs.readFileSync(process.argv[index+1]);
if(preset && (preset.toString('ascii',16,20)!=='CMYK'||preset.toString('ascii',36,40)!=='acsp'))throw new Error('Preset must be a CMYK ICC profile.');
const catalog=JSON.parse(read('src/profiles.json'));
const libraryIndex=process.argv.indexOf('--profiles');
const pathsFile=libraryIndex<0?(fs.existsSync('vendor/profiles/paths.json')?'vendor/profiles/paths.json':null):process.argv[libraryIndex+1];
const paths=pathsFile?JSON.parse(read(pathsFile)):{};
const core={Uint8Array,DataView,Number,Error};vm.createContext(core);vm.runInContext(read('src/core.js'),core);
const bundled={};
for(const entry of catalog){if(!paths[entry.id])continue;const bytes=fs.readFileSync(paths[entry.id]);if(bytes.toString('ascii',16,20)!=='CMYK'||bytes.toString('ascii',36,40)!=='acsp')throw new Error('Invalid ICC: '+entry.name);if(core.PrintCore.profileDescription(bytes)!==entry.name)throw new Error('Profile name does not match '+entry.name);bundled[entry.id]=bytes.toString('base64');}
if(preset){core.PrintCore.validateICC(preset);bundled.custom=preset.toString('base64');}
const worker=read('vendor/ghostscript.js')+'\n'+read('src/worker.js');
const bundle=read('vendor/pdf-lib.min.js')+'\n'+read('src/core.js')+'\nconst WORKER_SOURCE='+JSON.stringify(worker)+';\nconst WASM_BASE64='+JSON.stringify(fs.readFileSync('vendor/ghostscript.wasm').toString('base64'))+';\nconst PROFILE_CATALOG='+JSON.stringify(catalog)+';\nconst BUNDLED_PROFILES='+JSON.stringify(bundled)+';\n'+read('src/ui.js');
fs.writeFileSync('dist/ui.html',read('src/ui.html').replace('/*BUNDLE*/',()=>bundle.replace(/<\/script/gi,'<\\/script')));fs.copyFileSync('src/controller.js','dist/code.js');
