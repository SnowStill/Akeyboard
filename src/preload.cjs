const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('lens',{
  state:()=>ipcRenderer.invoke('state'),
  save:payload=>ipcRenderer.invoke('save',payload),
  capture:()=>ipcRenderer.invoke('capture'),
  select:rect=>ipcRenderer.invoke('select',rect),
  dismiss:()=>ipcRenderer.invoke('dismiss'),
  clear:()=>ipcRenderer.invoke('clear'),
  copy:text=>ipcRenderer.invoke('copy',text),
  retry:text=>ipcRenderer.invoke('retry',text),
  settings:()=>ipcRenderer.invoke('settings'),
  expand:value=>ipcRenderer.invoke('expand',value),
  passthrough:value=>ipcRenderer.invoke('passthrough',value),
  onUpdate:callback=>{const handler=(_,data)=>callback(data);ipcRenderer.on('update',handler);return()=>ipcRenderer.removeListener('update',handler);}
});
