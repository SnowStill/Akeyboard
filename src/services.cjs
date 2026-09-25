const fs = require('node:fs');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { createWorker } = require('tesseract.js');
const OpenAI = require('openai');
const { OCR,defaults,contextFor,cacheKey } = require('./core.cjs');
const { recognizeOcr } = require('./ocr.cjs');
const unpacked = file => file.replace(/app\.asar([\\/])/, 'app.asar.unpacked$1');
class Store {
  constructor(dir, safeStorage) {
    this.dir=dir; this.safe=safeStorage; fs.mkdirSync(dir,{recursive:true});
    this.settings={...defaults,...this.read('settings.json',{})};
    this.history=this.read('history.json',[]); this.secret=this.read('key.json','');
  }
  read(name,fallback) { try { return JSON.parse(fs.readFileSync(path.join(this.dir,name),'utf8')); } catch {return fallback;} }
  write(name,value) { const file=path.join(this.dir,name); fs.writeFileSync(file+'.tmp',JSON.stringify(value,null,2)); fs.renameSync(file+'.tmp',file); }
  key() { if (!this.secret) return process.env.OPENAI_API_KEY || ''; return this.safe.decryptString(Buffer.from(this.secret,'base64')); }
  saveKey(key) { if (!this.safe.isEncryptionAvailable()) throw new Error('Windows secure storage is unavailable.'); this.secret=key ? this.safe.encryptString(key).toString('base64') : ''; this.write('key.json',this.secret); }
  add(record) { if (!this.settings.history) return; this.history.unshift(record); this.history=this.history.slice(0,200); this.write('history.json',this.history); }
  clear() {this.history=[];this.write('history.json',[]);fs.rmSync(path.join(this.dir,'captures'),{recursive:true,force:true});}
}
async function foreground() {
  if (process.platform!=='win32') return {name:'Unknown app',title:''};
  try { const {stdout}=await promisify(execFile)('powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',unpacked(path.join(__dirname,'foreground.ps1'))],{windowsHide:true,timeout:5000}); const value=JSON.parse(stdout.trim()); return {name:value.name||'Unknown app',title:value.title||''}; } catch {return {name:'Unknown app',title:''};}
}
class Translator {
  constructor(store) {this.store=store;this.worker=null;this.language='';this.cache=new Map();}
  async ocr(buffer, source, point, progress) {
    const lang=OCR[source];
    if (!this.worker || this.language!==lang) {
      progress('Loading OCR language… First use downloads language data.');
      if (this.worker) await this.worker.terminate();
      this.worker=null;
      this.worker=await createWorker(lang,1,{cachePath:this.store.dir,workerPath:unpacked(require.resolve('tesseract.js/src/worker-script/node/index.js'))}); this.language=lang;
    }
    progress('Reading the selected text…');
    return recognizeOcr(this.worker,buffer,point,progress);
  }
  async translate(text, app, signal) {
    const s={...this.store.settings};
    const key=this.store.key(); if (!key) throw new Error('Add your OpenAI API key in Settings to translate.');
    if (text.length>14000) throw new Error('Select a smaller region (up to 14,000 characters).');
    const context=contextFor(this.store.history,app,s), hash=cacheKey(text,s,context,app);
    if (this.cache.has(hash)) return {...this.cache.get(hash),cached:true};
    const client=new OpenAI({apiKey:key,timeout:30000,maxRetries:1});
    const response=await client.responses.create({model:s.model,store:false,instructions:'Translate source_text into target_language. Use context only for terminology. Translate clear text only; omit OCR noise, uncertain fragments, and stray symbols. Preserve intact code, URLs, and shortcuts. Return only the translation.',input:JSON.stringify({source_text:text,target_language:s.target,app:s.context?app.name:undefined,window_title:s.context?app.title:undefined,glossary:s.glossary,recent_translations:context})},{signal});
    const translation=response.output_text?.trim(); if (!translation) throw new Error('The model returned no translation. Try again.');
    const result={translation,target:s.target,model:s.model}; this.cache.set(hash,result); if(this.cache.size>100)this.cache.delete(this.cache.keys().next().value);
    return result;
  }
  async close(){if(this.worker)await this.worker.terminate();}
}
module.exports={Store,Translator,foreground};
