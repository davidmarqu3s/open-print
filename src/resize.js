// The grip in the bottom-right corner drags the window taller or shorter. Width stays fixed.
(()=>{
 const grip=document.getElementById('resize-grip');if(!grip)return;
 let offset=null,frame=0,height=0;
 const send=type=>parent.postMessage({pluginMessage:{type,height}},'*');
 grip.onpointerdown=e=>{offset=window.innerHeight-e.clientY;height=window.innerHeight;grip.setPointerCapture(e.pointerId);e.preventDefault();};
 grip.onpointermove=e=>{if(offset===null)return;height=Math.round(e.clientY+offset);if(!frame)frame=requestAnimationFrame(()=>{frame=0;send('resize');});};
 grip.onpointerup=grip.onpointercancel=e=>{if(offset===null)return;offset=null;grip.releasePointerCapture(e.pointerId);send('resize-end');};
})();
