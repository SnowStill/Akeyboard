const sharp=require('sharp');
const {PSM}=require('tesseract.js');
const {pickText,cleanOcrText}=require('./core.cjs');

async function prepareOcrImage(buffer,point){
  const meta=await sharp(buffer).metadata();
  // Bound enlargement for large captures while helping small screen fonts.
  const scale=Math.max(1,Math.min(3,2400/meta.width,1600/meta.height));
  const width=Math.round(meta.width*scale),height=Math.round(meta.height*scale),padding=12;
  const gray=await sharp(buffer).flatten({background:'#fff'}).resize(width,height)
    .grayscale().normalize().png().toBuffer();
  const stats=await sharp(gray).stats();
  const dark=stats.channels[0].mean<127;
  const light=dark?await sharp(gray).negate().png().toBuffer():gray;
  const image=await sharp(light).extend({top:padding,bottom:padding,left:padding,right:padding,background:'#fff'}).png().toBuffer();
  return {image,point:point?{x:point.x*width/meta.width+padding,y:point.y*height/meta.height+padding}:null};
}

async function recognizeOcr(worker,buffer,point,progress){
  const prepared=await prepareOcrImage(buffer,point);
  const attempts=[
    {mode:point?PSM.SPARSE_TEXT:PSM.SINGLE_BLOCK,threshold:'0'},
    {mode:PSM.SPARSE_TEXT,threshold:'2'}
  ];
  let best=null;
  for(let index=0;index<attempts.length;index++){
    if(index)progress('Retrying OCR for clearer text…');
    const attempt=attempts[index];
    try {
      await worker.setParameters({tessedit_pageseg_mode:attempt.mode,thresholding_method:attempt.threshold,user_defined_dpi:'300',preserve_interword_spaces:'1'});
      const {data}=await worker.recognize(prepared.image,{}, {text:true,blocks:true});
      let rawText='';
      try {rawText=pickText(data,prepared.point);} catch(error){
        if(!point)throw error;
        // A different threshold may find the clicked paragraph on the retry.
      }
      const text=cleanOcrText(rawText);
      const confidence=Number.isFinite(data.confidence)?data.confidence:0;
      console.log('[OCR pass %d before regex]\n%s',index+1,rawText);
      console.log('[OCR pass %d after regex]\n%s',index+1,text);
      if(text&&(!best||confidence>best.confidence))best={text,confidence};
      if(best&&best.confidence>=80)break;
    } catch(error){
      if(!index||!best)throw error;
      // Keep usable first-pass text if the optional retry fails.
      console.warn('[OCR retry failed] %s',error.message);
    }
  }
  if(!best)throw new Error('No readable text was detected. Capture a tighter region or check the OCR language in Settings.');
  return best;
}

module.exports={prepareOcrImage,recognizeOcr};
