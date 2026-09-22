const {test}=require('node:test');
const assert=require('node:assert/strict');
const {defaults,validateSettings,cropRect,contextFor,cacheKey,pickText}=require('../src/core.cjs');
test('capture coordinates scale for mixed-DPI monitors and clamp at screen edges',()=>{
  assert.deepEqual(cropRect({x:100,y:50,width:200,height:100},{width:1920,height:1080},{width:2880,height:1620}),{left:150,top:75,width:300,height:150});
  assert.deepEqual(cropRect({x:1900,y:1060,width:300,height:100},{width:1920,height:1080},{width:1920,height:1080}),{left:1900,top:1060,width:20,height:20});
  assert.throws(()=>cropRect({x:NaN,y:0,width:1,height:2},{width:1,height:1},{width:1,height:1}));
});
test('context does not leak across app, document, or target language',()=>{
  const history=[{app:'editor',title:'a',target:'English',source:'yes',translation:'yes'},{app:'editor',title:'b',target:'English',source:'secret',translation:'secret'},{app:'chat',title:'a',target:'English',source:'other',translation:'other'}];
  assert.deepEqual(contextFor(history,{name:'editor',title:'a'},defaults),[{source:'yes',translation:'yes'}]);
  assert.deepEqual(contextFor(history,{name:'editor',title:'a'},{...defaults,context:false}),[]);
});
test('translation cache includes model, glossary and context',()=>{
  const base=cacheKey('a',defaults,[],{name:'editor'});
  assert.notEqual(base,cacheKey('a',{...defaults,glossary:'term'},[],{name:'editor'}));
  assert.notEqual(base,cacheKey('a',defaults,[{source:'b'}],{name:'editor'}));
});
test('click selects the closest OCR paragraph, not all captured text',()=>{
  const data={text:'all',blocks:[{paragraphs:[{text:'first',bbox:{x0:0,y0:0,x1:100,y1:30}},{text:'second',bbox:{x0:0,y0:60,x1:100,y1:90}}]}]};
  assert.equal(pickText(data,{x:20,y:75}),'second');
  assert.throws(()=>pickText(data,{x:1000,y:1000}),/No text/);
});
test('invalid settings rejected at the main process boundary',()=>{
  assert.deepEqual(validateSettings(defaults),defaults);
  assert.throws(()=>validateSettings({...defaults,hotkey:'garbage'}));
  assert.throws(()=>validateSettings({...defaults,target:'invalid'}));
});
