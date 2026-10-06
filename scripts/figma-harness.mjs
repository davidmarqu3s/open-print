// Builds a script for Figma's use_figma tool that runs the plugin's own controller inside the
// "Open Print edge cases" file, then runs a driver against it. Used to set up and capture the
// edge-case fixtures in tests/fixtures/figma. See docs/development.md.
//   node scripts/figma-harness.mjs <driver.js> [controller.js]
// The driver gets `send(msg)` (a message from the UI to the controller), `sent` (every message
// the controller posted back) and `figma`. Plugin data is per plugin, so the controller's own
// plugin data is stored as shared plugin data under openprint.test.
import fs from 'node:fs';
const [driverPath,controllerPath='src/controller.js']=process.argv.slice(2);
const controller=fs.readFileSync(controllerPath,'utf8')
 .replace(/\.setPluginData\(/g,".setSharedPluginData('openprint.test',")
 .replace(/\.getPluginData\(/g,".getSharedPluginData('openprint.test',");
const driver=fs.readFileSync(driverPath,'utf8');
process.stdout.write(`const sent=[],ui={postMessage:m=>sent.push(m),resize(){},onmessage:null};
// Figma's global can't be proxied, so the controller gets an object passing through what it uses.
const host={showUI(){},on(){},ui,get currentPage(){return figma.currentPage;},get viewport(){return figma.viewport;},get clientStorage(){return figma.clientStorage;},
 createFrame:()=>figma.createFrame(),createRectangle:()=>figma.createRectangle(),createImage:b=>figma.createImage(b),getImageByHash:h=>figma.getImageByHash(h),
 getNodeByIdAsync:id=>figma.getNodeByIdAsync(id),setCurrentPageAsync:p=>figma.setCurrentPageAsync(p)};
(function(figma,__html__){
${controller}
})(host,'');
const send=msg=>ui.onmessage(msg);
${driver}
`);
