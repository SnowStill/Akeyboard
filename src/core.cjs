const crypto = require('node:crypto');
const LANGUAGES = ['English','Spanish','French','German','Italian','Portuguese','Japanese','Korean','Chinese (Simplified)','Chinese (Traditional)','Arabic','Hindi','Russian','Ukrainian','Vietnamese','Thai','Turkish','Indonesian'];
const OCR = { English:'eng', Spanish:'spa', French:'fra', German:'deu', Italian:'ita', Portuguese:'por', Japanese:'jpn+eng', Korean:'kor+eng', 'Chinese (Simplified)':'chi_sim', 'Chinese (Traditional)':'chi_tra', Arabic:'ara+eng', Hindi:'hin+eng', Russian:'rus+eng', Ukrainian:'ukr+eng', Vietnamese:'vie+eng', Thai:'tha+eng', Turkish:'tur+eng', Indonesian:'ind+eng' };
const defaults = { target:'English', source:'English', model:'gpt-4.1-mini', hotkey:'Alt+Shift+T', gestureCapture:true, context:true, history:true, glossary:'', blockedApps:'' };
function validateSettings(input) {
  if (!input || !LANGUAGES.includes(input.target) || !OCR[input.source]) throw new Error('Choose supported source and target languages.');
  if (typeof input.model !== 'string' || !/^[a-zA-Z0-9._-]{1,100}$/.test(input.model)) throw new Error('Enter a valid OpenAI model ID.');
  if (typeof input.hotkey !== 'string' || input.hotkey.length > 80 || !/^(?:(?:Alt|Control|Ctrl|Shift|Super|CommandOrControl)\+)+[A-Za-z0-9]$/.test(input.hotkey)) throw new Error('Use a shortcut such as Alt+Shift+T.');
  return { target:input.target, source:input.source, model:input.model, hotkey:input.hotkey, gestureCapture:input.gestureCapture!==false, context:!!input.context, history:!!input.history, glossary:String(input.glossary || '').slice(0,4000), blockedApps:String(input.blockedApps || '').slice(0,2000) };
}
function cropRect(rect, logical, pixels) {
  if (!rect || !['x','y','width','height'].every(k => Number.isFinite(rect[k]))) throw new Error('Invalid selection.');
  if (rect.width<=0 || rect.height<=0) throw new Error('Drag a rectangle with both width and height.');
  const sx = pixels.width/logical.width, sy = pixels.height/logical.height;
  const left = Math.max(0, Math.min(pixels.width-1, Math.floor(rect.x*sx)));
  const top = Math.max(0, Math.min(pixels.height-1, Math.floor(rect.y*sy)));
  return { left, top, width:Math.max(1, Math.min(pixels.width-left, Math.round(rect.width*sx))), height:Math.max(1, Math.min(pixels.height-top, Math.round(rect.height*sy))) };
}
function contextFor(history, app, settings) {
  if (!settings.context || !app.name || app.name === 'Unknown app') return [];
  return history.filter(r => r.app === app.name && r.target === settings.target && (!app.title || r.title === app.title)).slice(0,4).map(r => ({ source:r.source.slice(0,1000), translation:r.translation.slice(0,1000) }));
}
function cacheKey(text, settings, context, app) {
  return crypto.createHash('sha256').update(JSON.stringify([text,settings.source,settings.target,settings.model,settings.glossary,context,settings.context ? app : null])).digest('hex');
}
function cleanOcrText(text) {
  return text.replace(/\r\n?/g,'\n')
    .split('\n')
    .map(line=>line
      // Remove standalone runs of visual noise, without changing URLs or code.
      .replace(/(^|\s)[|¦_~^`\\\u2500-\u259f]{2,}(?=\s|$)/gu,'$1')
      .trim())
    .filter(line=>{
      // Keep numbers and non-Latin characters, which may be complete words.
      if (/^[\p{P}\p{S}\s]+$/u.test(line)) return false;
      if (/^\p{Script=Latin}\p{M}*$/u.test(line) && !/^[aAI]$/.test(line)) return false;
      return true;
    })
    .join('\n').replace(/\n{3,}/g,'\n\n').trim();
}
function pickText(data, point) {
  if (!point) return data.text.trim();
  const blocks = data.blocks || [];
  const paras = blocks.flatMap(b => b.paragraphs || []);
  const items = paras.length ? paras : blocks;
  const distance = b => Math.hypot(Math.max(b.x0-point.x,0,point.x-b.x1),Math.max(b.y0-point.y,0,point.y-b.y1));
  const nearest = items.filter(x=>x.bbox).sort((a,b)=>distance(a.bbox)-distance(b.bbox))[0];
  if (!nearest || distance(nearest.bbox)>160) throw new Error('No text near that point. Drag a rectangle around the text instead.');
  return (nearest.text || (nearest.lines || []).map(l=>l.text).join('\n')).trim();
}
module.exports = {LANGUAGES,OCR,defaults,validateSettings,cropRect,contextFor,cacheKey,pickText,cleanOcrText};
