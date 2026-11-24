const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const locales=Object.fromEntries(fs.readdirSync('src/locales').filter(f=>f.endsWith('.json')).map(f=>[f.slice(0,-5),JSON.parse(fs.readFileSync('src/locales/'+f,'utf8'))]));
function i18n(languages){const context={LOCALES:locales,navigator:{languages,language:languages[0]}};vm.createContext(context);vm.runInContext(fs.readFileSync('src/i18n.js','utf8'),context);return vm.runInContext('OpenPrintI18n',context);}
// English text the window shows: string literals passed to t() in ui.js, and the fixed text and labels in ui.html.
function uiStrings(){
 const source=fs.readFileSync('src/ui.js','utf8'),found=new Set();
 for(const match of source.matchAll(/(?<![\w.])t\(/g)){
  let depth=1,i=match.index+match[0].length,quote=null,first='';
  for(;i<source.length&&depth;i++){const c=source[i];if(quote){if(c===quote)quote=null;}else if(c==="'")quote=c;else if('({['.includes(c))depth++;else if(')}]'.includes(c))depth--;else if(c===','&&depth===1)break;if(depth)first+=c;}
  for(const literal of first.matchAll(/'([^']*)'/g))if(literal[1])found.add(literal[1]);
 }
 const html=fs.readFileSync('src/ui.html','utf8').replace(/<style>[\s\S]*?<\/style>|<script>[\s\S]*?<\/script>/g,'');
 for(const match of html.matchAll(/>([^<>]*\S[^<>]*)</g))found.add(match[1].trim());
 for(const match of html.matchAll(/\s(?:title|aria-label|label|placeholder)="([^"]+)"/g))found.add(match[1]);
 return [...found].filter(text=>!/^(A\d|DL\b|\d|PDF\/X-4$|mm$|in$|pt$)/.test(text));
}
const placeholders=text=>[...text.matchAll(/\{(\w+)\}/g)].map(m=>m[1]).sort();
for(const [language,strings] of Object.entries(locales)){
 test(language+' translates every string the window shows',()=>{const missing=uiStrings().filter(text=>!(text in strings));assert.deepEqual(missing,[]);});
 test(language+' translations keep their placeholders',()=>{for(const [english,translated] of Object.entries(strings)){assert.ok(translated.trim(),english);assert.deepEqual(placeholders(translated),placeholders(english),english);}});
}
test('the window language picks the translation and falls back to English',()=>{
 assert.equal(i18n(['fr-FR']).language,'fr');assert.equal(i18n(['fr-CA','en-US']).t('Bleed'),'Fond perdu');
 assert.equal(i18n(['de-DE','fr-FR']).language,'fr');assert.equal(i18n(['en-GB','fr-FR']).language,'en');
 assert.equal(i18n(['pt-PT']).t('Bleed'),'Bleed');assert.equal(i18n([]).language,'en');
});
test('finished English messages from the controller and core are translated with their values',()=>{
 const {t}=i18n(['fr']);
 assert.equal(t('Exporting frame 2 of 5…'),'Exportation de la frame 2 sur 5…');
 assert.equal(t('Scaling to 80% leaves 2.4 mm of bleed.'),'La mise à l’échelle à 80 % ne laisse que 2.4 mm de fond perdu.');
 assert.equal(t('Couldn’t add the bleed to Poster: Locked'),'Impossible d’ajouter le fond perdu à Poster : Locked');
 assert.equal(t('Export {count} {mode} PDFs',{count:3,mode:t('CMYK')}),'Exporter 3 PDF CMJN');
 assert.equal(t('Something new'),'Something new');
});
test('an explicit choice overrides detection, and Automatic restores it',()=>{
 const api=i18n(['fr-FR']);api.setLanguage('en');assert.equal(api.language,'en');assert.equal(api.preference,'en');assert.equal(api.t('Bleed'),'Bleed');
 api.setLanguage('auto');assert.equal(api.language,'fr');assert.equal(api.preference,'auto');assert.equal(api.t('Bleed'),'Fond perdu');
 api.setLanguage('unknown');assert.equal(api.language,'fr');assert.equal(api.preference,'auto');
});
test('switching languages rebuilds finished-message matching',()=>{
 const api=i18n(['en']);api.setLanguage('fr');assert.equal(api.t('Exporting frame 2 of 5…'),'Exportation de la frame 2 sur 5…');
 api.setLanguage('en');assert.equal(api.t('Exporting frame 2 of 5…'),'Exporting frame 2 of 5…');
 api.setLanguage('fr');assert.equal(api.t('Exporting frame 2 of 5…'),'Exportation de la frame 2 sur 5…');
});
