// Interface text in other languages. English is the source text: each file in src/locales maps English to a translation,
// and {name} placeholders carry numbers and names across. Text without a translation stays in English.
// The Plugin API doesn't expose Figma's interface language, so the plugin window's language stands in for it.
const OpenPrintI18n=(()=>{
 const locales=typeof LOCALES==='undefined'?{}:LOCALES;
 const languages=typeof navigator==='undefined'?[]:[...(navigator.languages||[]),navigator.language].filter(Boolean);
 const automatic=languages.map(tag=>tag.toLowerCase().split('-')[0]).find(code=>code==='en'||locales[code])||'en';
 let preference='auto',language=automatic,strings=locales[language]||{};
 const fill=(text,values)=>text.replace(/\{(\w+)\}/g,(match,key)=>key in values?values[key]:match);
 // Messages written outside the window (the controller, core checks, the engine) arrive as finished English,
 // so templates with placeholders are matched against the whole message.
 let patterns=null;
 const compile=()=>Object.keys(strings).filter(key=>/\{\w+\}/.test(key)).map(key=>{
  const names=[],source=key.split(/(\{\w+\})/).map(part=>{const name=/^\{(\w+)\}$/.exec(part);if(name){names.push(name[1]);return '([\\s\\S]+?)';}return part.replace(/[.*+?^$()|[\]\\{}]/g,'\\$&');}).join('');
  return {pattern:new RegExp('^'+source+'$'),names,translation:strings[key]};
 });
 function t(text,values){
  if(typeof text!=='string'||!text)return text;
  if(values)return fill(strings[text]||text,values);
  if(Object.prototype.hasOwnProperty.call(strings,text))return strings[text];
  for(const {pattern,names,translation} of patterns||(patterns=compile())){const match=pattern.exec(text);if(match)return fill(translation,Object.fromEntries(names.map((name,i)=>[name,match[i+1]])));}
  return text;
 }
 // Capture only the initial interface, before layer names and other user content arrive.
 // Keep English originals so switching back never tries to reverse a translation.
 let originalText=null,originalAttributes=null;
 function translateDocument(root){
  if(!root||typeof document.createTreeWalker!=='function')return;
  document.documentElement.lang=language;
  if(!originalText){
   originalText=[];originalAttributes=[];
   const walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT);
   for(let node=walker.nextNode();node;node=walker.nextNode())if(!node.parentElement.closest('script,style')&&node.nodeValue.trim())originalText.push([node,node.nodeValue]);
   for(const element of root.querySelectorAll('[title],[aria-label],[placeholder],optgroup[label]'))for(const name of ['title','aria-label','placeholder','label'])if(element.hasAttribute(name))originalAttributes.push([element,name,element.getAttribute(name)]);
  }
  for(const [node,text] of originalText)if(node.isConnected)node.nodeValue=text.replace(text.trim(),t(text.trim()));
  for(const [element,name,text] of originalAttributes)if(element.isConnected)element.setAttribute(name,t(text));
 }
 function setLanguage(value){
  preference=value==='en'||Object.prototype.hasOwnProperty.call(locales,value)?value:'auto';
  language=preference==='auto'?automatic:preference;strings=locales[language]||{};patterns=null;
  if(typeof document!=='undefined')translateDocument(document.body);
 }
 return {get language(){return language;},get preference(){return preference;},setLanguage,t,translateDocument};
})();
const t=OpenPrintI18n.t;
if(typeof document!=='undefined')OpenPrintI18n.translateDocument(document.body);
