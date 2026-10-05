// Replaces native <select> popups with Figma-style menus. macOS draws native popups as system menus whose
// checkmark keeps the system size while the text follows the select's 11px font, so they never line up.
// The hidden <select> stays the source of truth: ui.js keeps reading and writing value, disabled and onchange.
(()=>{
const CHECK='<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.25" aria-hidden="true"><path d="M4.5 8.25 6.75 10.5 11.5 5.5"/></svg>';
const CHEVRON='<svg width="8" height="5" viewBox="0 0 8 5" fill="none" stroke="currentColor" stroke-width="1.2" aria-hidden="true"><path d="M.5.5 4 4 7.5.5"/></svg>';
let open=null,ids=0;
function close(focus=false){if(!open)return;const {trigger,menu}=open;open=null;menu.remove();trigger.setAttribute('aria-expanded','false');trigger.removeAttribute('aria-activedescendant');if(focus)trigger.focus();}
function enhance(select){
 const trigger=document.createElement('button'),label=document.createElement('span');
 trigger.type='button';trigger.className='select'+(select.classList.contains('compact')?' compact':'');trigger.setAttribute('aria-haspopup','listbox');trigger.setAttribute('aria-expanded','false');
 if(select.getAttribute('aria-label'))trigger.setAttribute('aria-label',select.getAttribute('aria-label'));
 label.className='select-label';trigger.append(label);trigger.insertAdjacentHTML('beforeend',CHEVRON);
 select.classList.add('native');select.tabIndex=-1;select.setAttribute('aria-hidden','true');select.after(trigger);
 const sync=()=>{const option=select.options[select.selectedIndex];label.textContent=option?option.textContent:'';trigger.disabled=select.disabled;if(select.disabled&&open&&open.select===select)close();};
 // ui.js sets value and disabled directly, which fires no events, so mirror them on the instance.
 for(const key of ['value','disabled','selectedIndex']){const base=Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,key);Object.defineProperty(select,key,{configurable:true,get(){return base.get.call(this);},set(v){base.set.call(this,v);sync();}});}
 new MutationObserver(sync).observe(select,{childList:true,subtree:true,characterData:true});
 const choose=value=>{close(true);if(select.value===value)return;select.value=value;select.dispatchEvent(new Event('change'));};
 const show=()=>{
  if(select.disabled)return;close();
  const menu=document.createElement('div'),items=[];menu.className='menu';menu.setAttribute('role','listbox');menu.id='menu-'+(++ids);
  if(select.getAttribute('aria-label'))menu.setAttribute('aria-label',select.getAttribute('aria-label'));
  const add=(option,group)=>{const item=document.createElement('div'),text=document.createElement('span');item.className='menu-item';item.id=menu.id+'-'+items.length;item.setAttribute('role','option');item.setAttribute('aria-selected',String(option.selected));item.insertAdjacentHTML('afterbegin',option.selected?CHECK:'<span class="menu-check"></span>');text.textContent=option.textContent;item.append(text);item.onmousemove=()=>activate(items.indexOf(item));item.onclick=()=>choose(option.value);(group||menu).append(item);items.push(item);};
  for(const child of select.children){
   if(child.tagName==='OPTGROUP'){const group=document.createElement('div'),title=document.createElement('div');group.setAttribute('role','group');title.className='menu-title';title.textContent=child.label;group.setAttribute('aria-label',child.label);if(menu.children.length)menu.append(Object.assign(document.createElement('div'),{className:'menu-divider'}));group.append(title);menu.append(group);for(const option of child.children)add(option,group);}
   else add(child);
  }
  const activate=index=>{items.forEach((item,i)=>item.classList.toggle('active',i===index));open.active=index;if(index>=0){trigger.setAttribute('aria-activedescendant',items[index].id);items[index].scrollIntoView({block:'nearest'});}};
  document.body.append(menu);open={select,trigger,menu,items,active:-1,activate,choose};trigger.setAttribute('aria-expanded','true');trigger.setAttribute('aria-controls',menu.id);
  // Place the menu below the trigger, flipping above when there is more room there.
  const rect=trigger.getBoundingClientRect(),gap=4,margin=8,below=innerHeight-rect.bottom-gap-margin,above=rect.top-gap-margin;
  menu.style.minWidth=rect.width+'px';menu.style.maxWidth=(innerWidth-margin*2)+'px';
  const up=menu.offsetHeight>below&&above>below;menu.style.maxHeight=Math.max(up?above:below,96)+'px';
  menu.style.top=(up?rect.top-gap-menu.offsetHeight:rect.bottom+gap)+'px';
  menu.style.left=Math.max(margin,Math.min(rect.left,innerWidth-margin-menu.offsetWidth))+'px';
  activate(Math.max(0,select.selectedIndex));
 };
 trigger.onclick=()=>open&&open.select===select?close():show();
 trigger.onkeydown=event=>{
  if(!open||open.select!==select){if(['ArrowDown','ArrowUp','Enter',' '].includes(event.key)){event.preventDefault();show();}return;}
  const last=open.items.length-1;
  if(event.key==='ArrowDown'){event.preventDefault();open.activate(Math.min(last,open.active+1));}
  else if(event.key==='ArrowUp'){event.preventDefault();open.activate(Math.max(0,open.active-1));}
  else if(event.key==='Home'||event.key==='End'){event.preventDefault();open.activate(event.key==='Home'?0:last);}
  else if(event.key==='Enter'||event.key===' '){event.preventDefault();open.items[open.active].click();}
  else if(event.key==='Escape'){event.preventDefault();close(true);}
  else if(event.key==='Tab')close();
 };
 sync();
}
document.addEventListener('mousedown',event=>{if(open&&!open.menu.contains(event.target)&&!open.trigger.contains(event.target))close();});
addEventListener('blur',()=>close());addEventListener('resize',()=>close());
document.addEventListener('scroll',event=>{if(open&&!open.menu.contains(event.target))close();},true);
for(const select of document.querySelectorAll('select'))enhance(select);
})();
