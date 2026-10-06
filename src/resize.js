// The grip in the bottom-right corner drags the window taller or shorter. Width stays fixed.
// The drag is tracked on the whole window, not just the grip, because the grip moves as the window resizes.
// It ends as soon as no button is held, so a release Figma swallows never leaves it following the mouse.
(()=>{
 const grip=document.getElementById('resize-grip');if(!grip)return;
 let offset=null,frame=0,height=0;
 const send=type=>parent.postMessage({pluginMessage:{type,height}},'*');
 const end=()=>{if(offset===null)return;offset=null;if(frame){cancelAnimationFrame(frame);frame=0;}send('resize-end');};
 grip.onpointerdown=e=>{if(e.button!==0)return;offset=window.innerHeight-e.clientY;height=window.innerHeight;try{grip.setPointerCapture(e.pointerId);}catch(error){/* Window listeners still follow the drag. */}e.preventDefault();};
 window.addEventListener('pointermove',e=>{if(offset===null)return;if(!(e.buttons&1)){end();return;}height=Math.round(e.clientY+offset);if(!frame)frame=requestAnimationFrame(()=>{frame=0;send('resize');});});
 window.addEventListener('pointerup',end);window.addEventListener('pointercancel',end);window.addEventListener('blur',end);
})();
