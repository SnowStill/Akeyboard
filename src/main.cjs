const {app,BrowserWindow,ipcMain,globalShortcut,desktopCapturer,screen,safeStorage,clipboard,Tray,Menu,nativeImage}=require('electron');
const path=require('node:path');
const fs=require('node:fs');
const {spawn}=require('node:child_process');
const {randomUUID}=require('node:crypto');
const sharp=require('sharp');
const {Store,Translator,foreground}=require('./services.cjs');
const {LANGUAGES,validateSettings,cropRect}=require('./core.cjs');
const unpacked=file=>file.replace(/app\.asar([\\/])/, 'app.asar.unpacked$1');
let main,selection,overlay,dragIndicator,tray,store,translator,snapshot,dragListener,dragDisplayId,dragHideTimer,job=0,controller,busy=false,quitting=false;
let resultState={type:'result',status:'idle'},captureState=null,lastApp={name:'Unknown app',title:''};
const smoke=process.argv.includes('--smoke-test');
if(smoke)app.setPath('userData',path.join(app.getPath('temp'),'lens-translate-smoke'));
if(!app.requestSingleInstanceLock())app.quit();
else {
  app.on('second-instance',()=>{main?.show();main?.focus();});
  app.whenReady().then(start).catch(error=>{console.error(error);app.exit(1);});
}
function makeWindow(view,options={}) {
  const win=new BrowserWindow({width:1080,height:760,minWidth:820,minHeight:620,show:false,backgroundColor:'#212121',autoHideMenuBar:true,title:'Lens Translate',...options,webPreferences:{preload:path.join(__dirname,'preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true}});
  win.webContents.setWindowOpenHandler(()=>({action:'deny'}));
  win.webContents.on('will-navigate',event=>event.preventDefault());
  win.loadFile(path.join(__dirname,'ui/index.html'),{query:{view}});
  return win;
}
function send(win,data){if(win&&!win.isDestroyed())win.webContents.send('update',data);}
function update(data){resultState={...resultState,...data};send(overlay,resultState);}
function hideDragIndicator(){clearTimeout(dragHideTimer);dragDisplayId=undefined;dragIndicator?.hide();}
function dismiss(hideDrag=true){job++;controller?.abort();selection?.destroy();selection=null;snapshot=null;captureState=null;if(hideDrag)hideDragIndicator();overlay?.hide();overlay?.setIgnoreMouseEvents(false);globalShortcut.unregister('Alt+Shift+X');}
function bindShortcut(key){return globalShortcut.register(key,()=>capture().catch(showError));}
function showError(error){hideDragIndicator();update({status:'error',error:error.message||String(error)});if(overlay&&!overlay.isDestroyed())overlay.showInactive();send(main,{type:'error',error:error.message});}
async function start(){
  store=new Store(app.getPath('userData'),safeStorage); translator=new Translator(store);
  // Register IPC before loading renderers or awaiting tray icon generation.
  const allow={state:['main','result','select','drag'],save:['main'],capture:['main','result'],select:['select'],dismiss:['result','select'],clear:['main'],copy:['main','result'],retry:['result'],settings:['result'],passthrough:['result'],expand:['result']};
  const handlers={
    state:()=>({settings:store.settings,hasKey:!!store.key(),history:store.history,languages:LANGUAGES,capture:captureState,result:resultState}),
    save:(_,payload)=>{
      const next=validateSettings(payload?.settings);
      if(typeof payload?.apiKey!=='string'||payload.apiKey.length>1000)throw new Error('Invalid API key.');
      const changed=next.hotkey!==store.settings.hotkey;
      if(changed&&!bindShortcut(next.hotkey))throw new Error('That shortcut is already in use. Choose another.');
      try {if(payload.apiKey.trim())store.saveKey(payload.apiKey.trim());if(payload.removeKey)store.saveKey('');store.write('settings.json',next);}catch(error){if(changed)globalShortcut.unregister(next.hotkey);throw error;}
      if(changed)globalShortcut.unregister(store.settings.hotkey);store.settings=next;translator.cache.clear();return {hasKey:!!store.key()};
    },
    capture:()=>capture(),select:(_,rect)=>selected(rect),dismiss:()=>dismiss(),
    clear:()=>{store.clear();translator.cache.clear();return true;},
    copy:(_,text)=>{if(typeof text!=='string'||text.length>30000)throw new Error('Invalid text.');clipboard.writeText(text);},
    retry:(_,text)=>{if(busy)throw new Error('Wait for the current request to finish.');if(typeof text!=='string'||!text.trim())throw new Error('Enter source text first.');return runTranslation(text.trim(),lastApp);},
    settings:()=>{main.show();main.focus();},
    expand:(_,payload)=>{const expanded=!!payload?.expanded,bounds=overlay.getBounds(),display=screen.getDisplayNearestPoint({x:bounds.x,y:bounds.y}),area=display.workArea,width=expanded?430:Math.max(180,Math.min(420,Math.round(payload?.width||360))),height=expanded?440:Math.max(64,Math.min(360,Math.round(payload?.height||150)));overlay.setBounds({x:Math.max(area.x,Math.min(area.x+area.width-width,bounds.x)),y:Math.max(area.y,Math.min(area.y+area.height-height,bounds.y)),width,height});},
    passthrough:(_,enabled)=>{if(enabled&&!globalShortcut.register('Alt+Shift+X',()=>{overlay.setIgnoreMouseEvents(false);globalShortcut.unregister('Alt+Shift+X');update({clickThrough:false});}))throw new Error('Cannot enable click-through because its restore shortcut is in use.');overlay.setIgnoreMouseEvents(!!enabled,{forward:true});update({clickThrough:!!enabled});}
  };
  for(const [channel,handler] of Object.entries(handlers))ipcMain.handle(channel,(event,...args)=>{
    const sender=BrowserWindow.fromWebContents(event.sender);const role=sender===main?'main':sender===selection?'select':sender===overlay?'result':sender===dragIndicator?'drag':null;
    if(!role||!allow[channel].includes(role)||event.senderFrame!==event.sender.mainFrame)throw new Error('Unauthorized request.');
    return handler(event,...args);
  });
  main=makeWindow('main');
  main.once('ready-to-show',()=>{if(!smoke)main.show();});
  main.on('close',event=>{if(!quitting){event.preventDefault();main.hide();}});
  overlay=makeWindow('result',{width:360,height:150,minWidth:160,minHeight:50,frame:false,transparent:true,backgroundColor:'#00000000',alwaysOnTop:true,skipTaskbar:true,resizable:true});
  overlay.setAlwaysOnTop(true,'screen-saver');
  overlay.on('close',event=>{if(!quitting){event.preventDefault();dismiss();}});
  dragIndicator=makeWindow('drag',{width:1,height:1,minWidth:1,minHeight:1,frame:false,transparent:true,backgroundColor:'#00000000',alwaysOnTop:true,skipTaskbar:true,resizable:false,focusable:false});
  dragIndicator.setAlwaysOnTop(true,'screen-saver');dragIndicator.setIgnoreMouseEvents(true);
  const svg=Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect width="32" height="32" rx="8" fill="#b4f078"/><text x="6" y="25" font-family="Arial" font-weight="bold" font-size="26" fill="#10131a">L</text></svg>');
  const icon=nativeImage.createFromBuffer(await sharp(svg).png().toBuffer());
  main.setIcon(icon);tray=new Tray(icon);tray.setToolTip('Lens Translate');
  tray.setContextMenu(Menu.buildFromTemplate([{label:'Translate screen',click:()=>capture().catch(showError)},{label:'Settings & history',click:()=>main.show()},{type:'separator'},{label:'Quit Lens',click:()=>app.quit()}]));tray.on('double-click',()=>main.show());
  if(!bindShortcut(store.settings.hotkey))main.webContents.once('did-finish-load',()=>send(main,{type:'error',error:'Shortcut unavailable. Choose another shortcut in Settings.'}));
  startDragListener();
  if(smoke){
    await Promise.all([main.webContents.isLoading()?new Promise(r=>main.webContents.once('did-finish-load',r)):null,overlay.webContents.isLoading()?new Promise(r=>overlay.webContents.once('did-finish-load',r)):null]);
    const checks=await main.webContents.executeJavaScript(`(async()=>({title:document.title,bridge:typeof window.lens.state,settings:!!(await window.lens.state()).settings,heading:document.querySelector('h1')?.textContent}))()`);
    const sources=await desktopCapturer.getSources({types:['screen'],thumbnailSize:{width:200,height:200}});
    fs.writeFileSync(path.join(process.cwd(),'smoke-result.json'),JSON.stringify({...checks,displays:sources.length,captureAvailable:sources.some(s=>!s.thumbnail.isEmpty())},null,2));
    app.quit();
  }
}
async function capture(){
  if(busy)throw new Error('A translation is still running. Dismiss it to cancel, then try again.');
  dismiss();const id=job;
  overlay.setIgnoreMouseEvents(false);globalShortcut.unregister('Alt+Shift+X');
  // Snapshot the foreground application before any selection window gains focus.
  lastApp=await foreground();
  if(id!==job)return;
  if(main.isFocused()){main.hide();await new Promise(r=>setTimeout(r,200));lastApp=await foreground();}
  if(id!==job)return;
  const blocked=store.settings.blockedApps.split(/[,\n]/).map(s=>s.trim().toLowerCase()).filter(Boolean);
  if(blocked.some(s=>(lastApp.name||'').toLowerCase().includes(s)))throw new Error('Translation is disabled for this app in Settings.');
  const display=screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  const sources=await desktopCapturer.getSources({types:['screen'],thumbnailSize:{width:Math.round(display.size.width*display.scaleFactor),height:Math.round(display.size.height*display.scaleFactor)}});
  if(id!==job)return;
  const source=sources.find(s=>s.display_id===String(display.id));
  if(!source||source.thumbnail.isEmpty())throw new Error('This screen cannot be captured. Protected content and exclusive fullscreen apps may be unavailable.');
  snapshot={buffer:source.thumbnail.toPNG(),pixels:source.thumbnail.getSize(),display};
  captureState={image:source.thumbnail.toDataURL(),width:display.bounds.width,height:display.bounds.height};
  selection=makeWindow('select',{...display.bounds,minWidth:1,minHeight:1,frame:false,resizable:false,alwaysOnTop:true,skipTaskbar:true});
  selection.setAlwaysOnTop(true,'screen-saver');selection.once('ready-to-show',()=>{selection?.show();selection?.focus();});
}
function startDragListener(){
  if(process.platform!=='win32'||smoke)return;
  dragListener=spawn('powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',unpacked(path.join(__dirname,'drag-listener.ps1'))],{windowsHide:true,stdio:['ignore','pipe','ignore']});
  let pending='';
  dragListener.stdout.on('data',data=>{
    pending+=data.toString();let newline;
    while((newline=pending.indexOf('\n'))>=0){const line=pending.slice(0,newline).trim();pending=pending.slice(newline+1);try{const drag=JSON.parse(line);if(store.settings.gestureCapture!==false){if(drag.type==='start'||drag.type==='move')showDragIndicator(drag);else if(drag.type==='end')captureDrag(drag).catch(showError);else if(drag.type==='click')dismissOutsideClick(drag);}}catch{}}
  });
  dragListener.on('error',()=>{});
}
function dismissOutsideClick(drag){
  if(!overlay?.isVisible()||!Number.isFinite(drag?.x2)||!Number.isFinite(drag?.y2)||!Number.isFinite(drag?.mx)||!Number.isFinite(drag?.my))return;
  const display=screen.getDisplayNearestPoint(screen.getCursorScreenPoint()),scale=display.scaleFactor,point={x:display.bounds.x+(drag.x2-drag.mx)/scale,y:display.bounds.y+(drag.y2-drag.my)/scale},bounds=overlay.getBounds();
  if(point.x<bounds.x||point.x>bounds.x+bounds.width||point.y<bounds.y||point.y>bounds.y+bounds.height)dismiss();
}
function showDragIndicator(drag){
  if(!Number.isFinite(drag?.x1)||!Number.isFinite(drag?.y1)||!Number.isFinite(drag?.x2)||!Number.isFinite(drag?.y2)||!Number.isFinite(drag?.mx)||!Number.isFinite(drag?.my)||!dragIndicator||dragIndicator.isDestroyed())return;
  const display=screen.getDisplayNearestPoint(screen.getCursorScreenPoint()),scale=display.scaleFactor;
  const x=(Math.min(drag.x1,drag.x2)-drag.mx)/scale,y=(Math.min(drag.y1,drag.y2)-drag.my)/scale;
  const width=Math.abs(drag.x2-drag.x1)/scale,height=Math.abs(drag.y2-drag.y1)/scale;
  if(dragDisplayId!==display.id){dragIndicator.setBounds({...display.bounds});dragDisplayId=display.id;}
  if(!dragIndicator.isVisible())dragIndicator.showInactive();send(dragIndicator,{type:'drag',x,y,width,height});
}
async function captureDrag(drag){
  if(busy||!Number.isFinite(drag?.x1)||!Number.isFinite(drag?.y1)||!Number.isFinite(drag?.x2)||!Number.isFinite(drag?.y2)||!Number.isFinite(drag?.mx)||!Number.isFinite(drag?.my)){hideDragIndicator();return;}
  dismiss();const id=job;const foregroundPromise=foreground();
  const display=screen.getDisplayNearestPoint(screen.getCursorScreenPoint()),scale=display.scaleFactor;
  const sourcesPromise=desktopCapturer.getSources({types:['screen'],thumbnailSize:{width:Math.round(display.size.width*scale),height:Math.round(display.size.height*scale)}});
  const x=(Math.min(drag.x1,drag.x2)-drag.mx)/scale,y=(Math.min(drag.y1,drag.y2)-drag.my)/scale;
  const width=Math.abs(drag.x2-drag.x1)/scale,height=Math.abs(drag.y2-drag.y1)/scale;
  lastApp=await foregroundPromise;if(id!==job)return;
  const blocked=store.settings.blockedApps.split(/[,\n]/).map(s=>s.trim().toLowerCase()).filter(Boolean);
  if(blocked.some(s=>(lastApp.name||'').toLowerCase().includes(s))){hideDragIndicator();return;}
  if(width<4||height<4){hideDragIndicator();return;}
  const sources=await sourcesPromise;
  if(id!==job)return;
  const source=sources.find(s=>s.display_id===String(display.id));
  if(!source||source.thumbnail.isEmpty())throw new Error('This screen cannot be captured. Protected content and exclusive fullscreen apps may be unavailable.');
  snapshot={buffer:source.thumbnail.toPNG(),pixels:source.thumbnail.getSize(),display};
  await selected({x,y,width,height,click:false});
}
async function selected(input){
  if(!snapshot||busy)return;
  const snap=snapshot;const id=++job;let imagePath='',sourceText='';busy=true;
  try {
    const logical=snap.display.bounds;
    if(!input||typeof input.click!=='boolean')throw new Error('Invalid selection.');
    const scaleX=Number.isFinite(input.viewportWidth)&&input.viewportWidth>0?logical.width/input.viewportWidth:1;
    const scaleY=Number.isFinite(input.viewportHeight)&&input.viewportHeight>0?logical.height/input.viewportHeight:1;
    const adjusted={...input,x:input.x*scaleX,y:input.y*scaleY,width:input.width*scaleX,height:input.height*scaleY};
    let rect=adjusted,point=null;
    if(input.click){
      if(!Number.isFinite(adjusted.x)||!Number.isFinite(adjusted.y))throw new Error('Invalid point.');
      rect={x:Math.max(0,adjusted.x-450),y:Math.max(0,adjusted.y-230),width:900,height:460};
    }
    const crop=cropRect(rect,logical,snap.pixels);
    if(input.click)point={x:adjusted.x*snap.pixels.width/logical.width-crop.left,y:adjusted.y*snap.pixels.height/logical.height-crop.top};
    selection?.destroy();selection=null;snapshot=null;captureState=null;
    const area=snap.display.workArea;
    const x=Math.max(area.x,Math.min(area.x+area.width-360,logical.x+Math.round(adjusted.x)+20));
    const y=Math.max(area.y,Math.min(area.y+area.height-150,logical.y+Math.round(adjusted.y)+30));
    overlay.setBounds({x,y,width:360,height:150});resultState={type:'result',status:'loading',message:'Reading your screen…',source:'',translation:'',app:lastApp.name,target:store.settings.target,clickThrough:false};
    overlay.showInactive();update({});
    const image=await sharp(snap.buffer).extract(crop).png().toBuffer();
    if(store.settings.history){const captures=path.join(app.getPath('userData'),'captures');await fs.promises.mkdir(captures,{recursive:true});imagePath=path.join(captures,`${randomUUID()}.png`);await fs.promises.writeFile(imagePath,image);}
    const ocr=await translator.ocr(image,store.settings.source,point,message=>{if(id===job)update({message});});
    if(id!==job)return;
    sourceText=ocr.text;
    update({source:ocr.text,confidence:ocr.confidence});
    await performTranslation(ocr.text,lastApp,id,imagePath);
  }catch(error){if(id===job){if(imagePath) {store.add({id:randomUUID(),createdAt:new Date().toISOString(),source:sourceText,translation:'',target:store.settings.target,app:lastApp.name,title:store.settings.context?lastApp.title:'',imagePath,error:error.message||String(error)});send(main,{type:'history',history:store.history});}showError(error);}}finally{busy=false;}
}
async function performTranslation(text,appContext,id,imagePath=''){
  controller=new AbortController();update({status:'loading',source:text,message:'Translating with context…',error:''});
  const result=await translator.translate(text,appContext,controller.signal);
  if(id!==job)return;
  update({...result,status:'done'});
  store.add({id:randomUUID(),createdAt:new Date().toISOString(),source:text,...result,app:appContext.name,title:store.settings.context?appContext.title:'',imagePath});
  send(main,{type:'history',history:store.history});
}
async function runTranslation(text,appContext){const id=++job;busy=true;try{await performTranslation(text,appContext,id);}catch(error){if(id===job)showError(error);}finally{busy=false;}}
app.on('before-quit',()=>{quitting=true;controller?.abort();dragListener?.kill();translator?.close();});
app.on('will-quit',()=>globalShortcut.unregisterAll());
app.on('window-all-closed',()=>{});
