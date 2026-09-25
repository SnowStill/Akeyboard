const {test}=require('node:test');
const assert=require('node:assert/strict');
const sharp=require('sharp');
const {prepareOcrImage,recognizeOcr}=require('../src/ocr.cjs');
const {OCR}=require('../src/core.cjs');
const capture=()=>sharp({create:{width:100,height:40,channels:3,background:'#111'}}).png().toBuffer();
function worker(results){
  return {parameters:[],calls:0,async setParameters(value){this.parameters.push(value);},async recognize(){const next=results[this.calls++];if(next instanceof Error)throw next;return {data:next};}};
}
test('OCR preparation enlarges dark captures, adds a white border, and maps clicks',async()=>{
  const {image,point}=await prepareOcrImage(await capture(),{x:20,y:10});
  const {data,info}=await sharp(image).raw().toBuffer({resolveWithObject:true});
  assert.equal(info.width,324);assert.equal(info.height,144);
  assert.deepEqual(point,{x:72,y:42});
  assert.equal(data[0],255);
  assert.ok(data[(30*info.width+30)*info.channels]>200);
});
test('Chinese language selection uses dedicated recognition models',()=>{
  assert.equal(OCR['Chinese (Simplified)'],'chi_sim');
  assert.equal(OCR['Chinese (Traditional)'],'chi_tra');
});
test('low-confidence OCR retries and selects the stronger Chinese result',async()=>{
  const w=worker([{text:'错字',confidence:40},{text:'你好世界',confidence:92}]);
  const result=await recognizeOcr(w,await capture(),null,()=>{});
  assert.deepEqual(result,{text:'你好世界',confidence:92});
  assert.equal(w.calls,2);assert.equal(w.parameters[0].tessedit_pageseg_mode,'6');
  assert.equal(w.parameters[1].thresholding_method,'2');
});
test('high-confidence OCR avoids retry and noise-only output cannot win',async()=>{
  const good=worker([{text:'你好世界',confidence:92}]);
  await recognizeOcr(good,await capture(),null,()=>{});assert.equal(good.calls,1);
  const noisy=worker([{text:'|||',confidence:98},{text:'你好',confidence:65}]);
  assert.equal((await recognizeOcr(noisy,await capture(),null,()=>{})).text,'你好');
});
test('retry failure retains usable text; empty results fail without translation',async()=>{
  const w=worker([{text:'你好',confidence:55},new Error('retry failed')]);
  assert.equal((await recognizeOcr(w,await capture(),null,()=>{})).text,'你好');
  await assert.rejects(recognizeOcr(worker([{text:'',confidence:0},{text:'|||',confidence:90}]),await capture(),null,()=>{}),/No readable text/);
});
test('click recognition uses the transformed point rather than unrelated screen text',async()=>{
  const w=worker([{text:'wrong paragraph',confidence:90,blocks:[{paragraphs:[{text:'你好',bbox:{x0:60,y0:30,x1:90,y1:60}}]}]}]);
  assert.equal((await recognizeOcr(w,await capture(),{x:20,y:10},()=>{})).text,'你好');
  assert.equal(w.parameters[0].tessedit_pageseg_mode,'11');
});
