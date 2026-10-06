import fs from 'node:fs';
import vm from 'node:vm';
import zlib from 'node:zlib';
function packProfile(bytes){let best=null;for(const stride of [0,2,4,6,8,16,32]){const delta=Buffer.from(bytes);if(stride)for(let i=delta.length-1;i>=stride;i--)delta[i]=(delta[i]-delta[i-stride])&255;const compressed=zlib.deflateSync(delta,{level:9});if(!best||compressed.length<best.bytes.length)best={bytes:compressed,stride};}return {data:best.bytes.toString('base64'),stride:best.stride};}
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
for(const entry of catalog){if(!paths[entry.id])continue;const bytes=fs.readFileSync(paths[entry.id]);if(bytes.toString('ascii',16,20)!=='CMYK'||bytes.toString('ascii',36,40)!=='acsp')throw new Error('Invalid ICC: '+entry.name);if(core.PrintCore.profileDescription(bytes)!==entry.name)throw new Error('Profile name does not match '+entry.name);bundled[entry.id]=packProfile(bytes);}
if(preset){core.PrintCore.validateICC(preset);bundled.custom=packProfile(preset);}
const worker=read('vendor/ghostscript.js')+'\n'+read('src/worker.js');
const notices='/*! pdf-lib 1.17.1\n'+read('vendor/pdf-lib-LICENSE.md')+'\njs-sha256 0.11.1\n'+read('vendor/sha256-LICENSE.txt')+'*/\n';
const bundle=notices+read('vendor/pdf-lib.min.js')+'\n'+read('src/core.js')+'\n'+read('src/shading.js')+'\n'+read('vendor/sha256.js')+'\n'+read('src/assets.js')+'\nconst WORKER_SOURCE='+JSON.stringify(worker)+';\nconst PROFILE_CATALOG='+JSON.stringify(catalog)+';\nconst BUNDLED_PROFILES='+JSON.stringify(bundled)+';\n'+read('src/ui.js')+'\n'+read('src/menu.js')+'\n'+read('src/resize.js');
fs.writeFileSync('dist/ui.html',read('src/ui.html').replace('/*BUNDLE*/',()=>bundle.replace(/<\/script/gi,'<\\/script')));fs.copyFileSync('src/controller.js','dist/code.js');

const size=fs.statSync('dist/ui.html').size+fs.statSync('dist/code.js').size;console.log('Plugin code: '+size+' bytes (limit 15,000,000)');if(size>15000000)throw new Error('Plugin exceeds Figma’s 15 MB publishing limit.');
