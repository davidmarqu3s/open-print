const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const KEY='open-print-language';
function controller(stored={},fail={}){
 const messages=[],writes=[];
 const figma={showUI(){},on(){},currentPage:{selection:[]},ui:{postMessage:m=>messages.push(m)},clientStorage:{
  async getAsync(key){if(key===KEY&&fail.read)throw new Error('Storage unavailable');return stored[key];},
  async setAsync(key,value){if(fail.write)throw new Error('Storage full');writes.push([key,value]);stored[key]=value;}
 }};
 const context={figma,__html__:'',Set,Map,setTimeout,clearTimeout};vm.createContext(context);vm.runInContext(fs.readFileSync('src/controller.js','utf8'),context);
 return {messages,writes,send:message=>figma.ui.onmessage(message)};
}
for(const language of ['auto','en','fr'])test('language '+language+' persists and is restored when the plugin reopens',async()=>{
 const stored={},first=controller(stored);
 await first.send({type:'set-language',language});assert.deepEqual(first.writes,[[KEY,language]]);
 const reopened=controller(stored);await reopened.send({type:'load-settings'});
 assert.equal(reopened.messages.at(-1)?.type,'settings');assert.equal(reopened.messages.at(-1)?.language,language);
});
test('missing and invalid saved language preferences fall back to automatic detection',async()=>{
 for(const language of [undefined,null,'de','FR','__proto__',{},1]){
  const {send,messages}=controller({[KEY]:language});await send({type:'load-settings'});
  assert.equal(messages.at(-1)?.type,'settings');assert.equal(messages.at(-1)?.language,'auto');
 }
});
test('invalid language messages cannot overwrite a saved preference',async()=>{
 const stored={[KEY]:'fr'},{send,writes,messages}=controller(stored);
 for(const language of [undefined,null,'de','FR','__proto__',{},1])await send({type:'set-language',language});
 assert.equal(writes.length,0);assert.equal(stored[KEY],'fr');
 await send({type:'load-settings'});assert.equal(messages.at(-1)?.language,'fr');
});
test('unavailable language storage still opens with automatic detection',async()=>{
 const {send,messages}=controller({}, {read:true});await send({type:'load-settings'});
 assert.equal(messages.at(-1)?.type,'settings');assert.equal(messages.at(-1)?.language,'auto');
});
test('language persistence failures are reported to the window',async()=>{
 const {send,messages,writes}=controller({}, {write:true});await send({type:'set-language',language:'fr'});
 assert.equal(writes.length,0);assert.equal(messages.at(-1)?.type,'language-storage-error');
});
