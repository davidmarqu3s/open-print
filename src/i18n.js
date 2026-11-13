// Interface text in other languages. English is the source text: each file in src/locales maps English to a translation,
// and {name} placeholders carry numbers and names across. Text without a translation stays in English.
// The Plugin API doesn't expose Figma's interface language, so the plugin window's language stands in for it.
const OpenPrintI18n=(()=>{
 const locales=typeof LOCALES==='undefined'?{}:LOCALES;
 const languages=typeof navigator==='undefined'?[]:[...(navigator.languages||[]),navigator.language].filter(Boolean);
 const language=languages.map(tag=>tag.toLowerCase().split('-')[0]).find(code=>code==='en'||locales[code])||'en';
 const strings=locales[language]||{};
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
 // Translates the window's fixed text and labels once, before menus copy them and before any layer names appear.
 function translateDocument(root){
  if(language==='en'||!root||typeof document.createTreeWalker!=='function')return;
  document.documentElement.lang=language;
  const walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT);
  for(let node=walker.nextNode();node;node=walker.nextNode()){const text=node.nodeValue.trim();if(text&&t(text)!==text)node.nodeValue=node.nodeValue.replace(text,t(text));}
  for(const element of root.querySelectorAll('[title],[aria-label],[placeholder],optgroup[label]'))for(const name of ['title','aria-label','placeholder','label'])if(element.hasAttribute(name))element.setAttribute(name,t(element.getAttribute(name)));
 }
 return {language,t,translateDocument};
})();
const t=OpenPrintI18n.t;
if(typeof document!=='undefined')OpenPrintI18n.translateDocument(document.body);
