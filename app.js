'use strict';
const $ = s => document.querySelector(s);
const icon = name => `<svg aria-hidden="true"><use href="#i-${name}"/></svg>`;
const escapeHTML = s => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const registry = new Map();
let state = { ids: [], seams: [], direction: 'vertical', crop: {start:0,end:0}, bars:{start:0,end:0}, demo:false };
let history = [], future = [], zoom = 1, busy = false, worker = null, generation = 0, toastTimer, editor = null, editorBitmaps = [], exportUrls = [];
const clone = o => JSON.parse(JSON.stringify(o));
const images = () => state.ids.map(id => registry.get(id));
const currentPlan = () => StitchCore.plan(images(), state.seams, state.direction, state.crop, state.bars, state.trims||{});
function toast(message) { $('#toast').textContent=message; $('#toast').classList.add('show'); clearTimeout(toastTimer); toastTimer=setTimeout(()=>$('#toast').classList.remove('show'),3800); }
function checkpoint() { history.push(clone(state)); if(history.length>40) history.shift(); future=[]; }
function transaction(fn) { const previous=clone(state); checkpoint(); try { fn(); currentPlan(); render(); return true; } catch(e) {state=previous;history.pop();toast(e.message);return false;} }
function info(title, html) { $('#infoTitle').textContent=title;$('#infoBody').innerHTML=html;$('#infoDialog').showModal(); }
function seamId(a,b) { return a+'|'+b; }
function syncSeams() {
  const old = new Map(state.seams.map(s=>[seamId(s.beforeId,s.afterId),s]));
  state.seams=state.ids.slice(0,-1).map((a,i)=>old.get(seamId(a,state.ids[i+1])) || {beforeId:a,afterId:state.ids[i+1],overlap:0,cut:0,confirmed:false,status:'unmatched',suggested:0,manual:false});
}
let homeView=false, inlineEdit=null, pageStep=1, selectedImageId=null, sortImageId=null, cropEditing=null, lastAnalysisKey='', suppressClickUntil=0;
const trimFor = id => state.trims?.[id] || {start:0,end:0};
const analysisKey = () => JSON.stringify([state.ids,state.direction,state.trims||{}]);
function setStep(n){if(busy)return;pageStep=n;render();}
function render() {
  syncSeams();
  const retained=new Set([state,...history,...future].flatMap(s=>s.ids));
  for(const [id,im] of registry)if(!retained.has(id)){URL.revokeObjectURL(im.preview);const entry=hdBitmaps.get(id);if(entry){entry.promise.then(closeBitmap).catch(()=>{});hdBitmaps.delete(id);}registry.delete(id);}
  if(!state.ids.length)pageStep=1;
  const ims=images(),plan=currentPlan(),pending=state.seams.filter(s=>!s.confirmed).length;
  $('#selectScreen').hidden=pageStep!==1;$('#stitchScreen').hidden=pageStep!==2;$('#exportScreen').hidden=pageStep!==3;
  $('#brand').hidden=(!!ims.length&&!homeView)||pageStep!==1;$('#pageTitle').hidden=!ims.length&&pageStep===1;
  $('#pageTitle').textContent=['','',''][pageStep-1];$('#back').hidden=pageStep===1;
  $('#back').disabled=busy;$('#historyActions').hidden=pageStep!==2||!!inlineEdit;
  document.querySelectorAll('.step-indicator span').forEach((el,i)=>{el.classList.toggle('active',i===pageStep-1);if(i===pageStep-1)el.setAttribute('aria-current','step');else el.removeAttribute('aria-current');});
  $('#welcome').hidden=!!ims.length&&!homeView;$('#collection').hidden=!ims.length||homeView;$('#selectFooter').hidden=!ims.length||homeView;$('#resume').hidden=!ims.length||!homeView;
  $('#imageCount').textContent=ims.length;
  $('#autoBars').disabled=busy||state.direction!=='vertical';
  $('#imageList').innerHTML=ims.map((im,i)=>`<div class="image-card" draggable="true" data-id="${im.id}"><button class="thumb-button" data-sort="${im.id}" aria-label="截图 ${i+1}，长按拖动排序"><img class="image-thumb" src="${im.preview}" alt="${escapeHTML(im.name)}" draggable="false"><span class="number">${i+1}</span></button><div class="reorder-buttons"><button data-move="-1" data-owner="${im.id}" aria-label="上移截图 ${i+1}" ${i===0?'disabled':''}>${icon('up')}</button><button data-move="1" data-owner="${im.id}" aria-label="下移截图 ${i+1}" ${i===ims.length-1?'disabled':''}>${icon('down')}</button></div><button class="remove-image" data-delete="${im.id}" aria-label="移除截图 ${i+1}">${icon('close')}</button></div>`).join('');
  for(const d of ['vertical','horizontal']){$('#'+d).classList.toggle('selected',state.direction===d);$('#'+d).setAttribute('aria-pressed',state.direction===d);$('#'+d).disabled=busy;}
  $('#undo').disabled=!history.length||busy;$('#redo').disabled=!future.length||busy;
  for(const el of document.querySelectorAll('#imageList button,#demo,#add,#upload,#nextStitch,#nextExport')){if(busy)el.disabled=true;else if(!el.dataset.move)el.disabled=false;}
  $('#pendingButton').hidden=!pending;$('#pendingCount').textContent=pending;$('#pendingButton').setAttribute('aria-label',`待确认接缝 ${pending} 处`);
  if(pageStep===2){if(inlineEdit)renderInline();else renderPreview(plan);}
  if(pageStep===3)renderExportThumb(plan);
}
function renderPreview(plan=currentPlan()) {
  const vertical=state.direction==='vertical',crossSize=(vertical?Math.min(350,Math.max(180,$('#viewport').clientWidth-90)):Math.min(320,Math.max(180,$('#viewport').clientHeight-75)))*zoom,ratio=plan.cross?crossSize/plan.cross:1;
  const track=$('#previewTrack');track.className='preview-track'+(vertical?'':' horizontal');track.style.cssText='';
  track.innerHTML=plan.segments.map((seg,i)=>{
    const im=registry.get(seg.imageId),sourceIndex=state.ids.indexOf(seg.imageId),seam=sourceIndex?state.seams[sourceIndex-1]:null;
    const w=vertical?crossSize:seg.length*ratio,h=vertical?seg.length*ratio:crossSize;
    return `<div class="preview-piece" style="width:${w}px;height:${h}px"><button class="preview-crop" data-hd-source="${im.id}" data-hd-start="${seg.start}" data-hd-ratio="${ratio}" data-image="${im.id}" aria-label="编辑截图 ${sourceIndex+1}"><img src="${im.preview}" alt="截图 ${sourceIndex+1}" style="width:${im.width*ratio}px;height:${im.height*ratio}px;${vertical?'top':'left'}:${-seg.start*ratio}px"></button>${i>0&&seam?`<button class="seam-marker ${seam.confirmed?'':'pending'}" data-seam="${sourceIndex-1}" aria-label="检查接缝 ${sourceIndex}"><span></span></button>`:''}</div>`;
  }).join('');
  scheduleHD();
}
let cropOriginalUrl=null;
let hdFrame=0,hdVersion=0;
const hdBitmaps=new Map();
function scheduleHD(){
  hdVersion++;if(hdFrame)return;
  hdFrame=requestAnimationFrame(()=>{hdFrame=0;paintHD(hdVersion);});
}
async function hdBitmap(id){
  let entry=hdBitmaps.get(id);
  if(!entry){entry={used:0,promise:decode(registry.get(id).file)};hdBitmaps.set(id,entry);entry.bitmap=await entry.promise;}
  entry.used=performance.now();return entry.bitmap||await entry.promise;
}
async function paintHD(version){
  const viewport=$('#viewport'),rect=viewport.getBoundingClientRect(),v=state.direction==='vertical',dpr=Math.min(3,window.devicePixelRatio||1),visible=[];
  if(pageStep!==2)return;
  for(const frame of document.querySelectorAll('[data-hd-source]')){
    const bounds=frame.getBoundingClientRect(),x=Math.max(0,rect.left-bounds.left-24),y=Math.max(0,rect.top-bounds.top-24),right=Math.min(bounds.width,rect.right-bounds.left+24),bottom=Math.min(bounds.height,rect.bottom-bounds.top+24);
    if(right<=x||bottom<=y){const tile=frame.querySelector('.hd-tile');if(tile){tile.width=tile.height=1;tile.remove();}continue;}
    visible.push({frame,x,y,width:right-x,height:bottom-y});
  }
  for(const area of visible){
    try{
      const {frame,x,y,width,height}=area,id=frame.dataset.hdSource,bitmap=await hdBitmap(id);
      if(version!==hdVersion||!frame.isConnected)return;
      let tile=frame.querySelector('.hd-tile');if(!tile){tile=document.createElement('canvas');tile.className='hd-tile';tile.setAttribute('aria-hidden','true');frame.append(tile);}
      tile.width=Math.max(1,Math.ceil(width*dpr));tile.height=Math.max(1,Math.ceil(height*dpr));tile.style.cssText=`left:${x}px;top:${y}px;width:${width}px;height:${height}px`;
      const ctx=tile.getContext('2d'),ratio=Number(frame.dataset.hdRatio),start=Number(frame.dataset.hdStart)||0;
      ctx.imageSmoothingEnabled=true;ctx.imageSmoothingQuality='high';
      ctx.drawImage(bitmap,x/ratio+(v?0:start),y/ratio+(v?start:0),width/ratio,height/ratio,0,0,tile.width,tile.height);
    }catch(error){/* Keep the thumbnail if a source cannot be decoded. */}
  }
  for(const [id,entry] of [...hdBitmaps].sort((a,b)=>a[1].used-b[1].used)){
    if(hdBitmaps.size<=3)break;if(!entry.bitmap)continue;closeBitmap(entry.bitmap);hdBitmaps.delete(id);
  }
}
function renderExportThumb(plan){
  const ratio=112/plan.width,vertical=state.direction==='vertical';
  $('#exportThumb').style.display=vertical?'block':'flex';
  $('#exportThumb').innerHTML=plan.segments.map(seg=>{const im=registry.get(seg.imageId);return `<div class="export-thumb-piece" style="flex-shrink:0;width:${(vertical?im.width:seg.length)*ratio}px;height:${(vertical?seg.length:im.height)*ratio}px"><img alt="" src="${im.preview}" style="width:${im.width*ratio}px;height:${im.height*ratio}px;${vertical?'top':'left'}:${-seg.start*ratio}px"></div>`;}).join('');
}
async function nextStitch(){
  if(busy||!state.ids.length)return;
  if(!(await applyAutoBars()))return;
  setStep(2);const key=analysisKey();
  if(key!==lastAnalysisKey)await analyze();
}
async function chromeSample(im){
  const bitmap=await decode(im.file);
  try{
    const ratio=Math.min(1,4096/im.height),height=Math.round(im.height*ratio),c=canvas(192,height),ctx=c.getContext('2d',{willReadFrequently:true});
    ctx.imageSmoothingQuality='high';ctx.drawImage(bitmap,0,0,192,height);const rgba=ctx.getImageData(0,0,192,height).data,pixels=new Uint8Array(192*height);
    for(let i=0;i<pixels.length;i++)pixels[i]=Math.round(rgba[i*4]*.299+rgba[i*4+1]*.587+rgba[i*4+2]*.114);
    c.width=c.height=1;return {pixels,cross:192,length:height,ratio};
  }finally{closeBitmap(bitmap);}
}
let barCancel=null;
function detectBarSamples(samples){
  return new Promise((resolve,reject)=>{
    const url=URL.createObjectURL(new Blob([`const detect=${StitchCore.detectBars.toString()};self.onmessage=e=>self.postMessage(detect(e.data));`],{type:'text/javascript'}));
    try{worker=new Worker(url);}catch(error){reject(error);return;}finally{URL.revokeObjectURL(url);}
    const finish=()=>{worker?.terminate();worker=null;barCancel=null;};
    barCancel=()=>{finish();reject(new Error('cancelled'));};
    worker.onmessage=e=>{finish();resolve(e.data);};worker.onerror=()=>{finish();reject(new Error('worker'));};
    worker.postMessage(samples,samples.map(s=>s.pixels.buffer));
  });
}
async function applyAutoBars(){
  const enabled=$('#autoBars').checked&&state.direction==='vertical';
  const signature=JSON.stringify([state.ids,enabled]);if(state.chromeKey===signature)return true;
  const token=++generation;
  busy=true;render();$('#progressArea').hidden=false;$('#progressText').textContent='识别上下信息栏';$('#progress').value=0;
  try{
    let detected=images().map(()=>({start:0,end:0}));
    if(enabled&&state.ids.length>=2){
      const samples=[];for(const im of images()){samples.push(await chromeSample(im));if(token!==generation)return false;$('#progress').value=samples.length/state.ids.length*80;}
      detected=(await detectBarSamples(samples)).map((bar,i)=>({start:Math.round(bar.start/samples[i].ratio),end:Math.round(bar.end/samples[i].ratio)}));
      if(token!==generation)return false;
    }
    const ok=transaction(()=>{
      state.trims=state.trims||{};const old=state.autoBars||{},next={},changed=new Set();
      state.ids.forEach((id,i)=>{
        const t=trimFor(id),previous=old[id]||{start:0,end:0},bar=detected[i];
        const updated={start:Math.max(0,t.start-previous.start)+bar.start,end:Math.max(0,t.end-previous.end)+bar.end};
        if(updated.start!==t.start||updated.end!==t.end)changed.add(id);
        state.trims[id]=updated;next[id]=bar;
      });
      state.autoBars=next;state.chromeKey=signature;state.seams=state.seams.filter(s=>!changed.has(s.beforeId)&&!changed.has(s.afterId));syncSeams();
    });
    if(ok){lastAnalysisKey='';const count=detected.filter(b=>b.start||b.end).length;$('#barSummary').textContent=count?`已裁剪 ${count} 张，可在拼接页调整`:enabled?'未检测到可靠信息栏':'已保留原图信息栏';}
    return ok;
  }catch(error){if(error.message!=='cancelled')toast('信息栏识别未完成，请在拼接页手动裁剪');return false;}
  finally{busy=false;$('#progressArea').hidden=true;render();}
}
function showImageActions(id){
  if(busy)return;selectedImageId=id;const i=state.ids.indexOf(id);
  $('#selectedTitle').textContent=`${i+1}`;$('#adjustImage').disabled=state.ids.length<2;
  $('#adjustImage').innerHTML=icon('cut')+'<span>拼接</span>';
  $('#imageActions').showModal();
}
function openImageCrop(){
  const im=registry.get(selectedImageId);if(!im)return;
  cropEditing={id:im.id,...trimFor(im.id),length:state.direction==='vertical'?im.height:im.width};
  if(cropOriginalUrl)URL.revokeObjectURL(cropOriginalUrl);cropOriginalUrl=URL.createObjectURL(im.file);
  $('#cropTitle').textContent=`裁剪`;$('#cropPreview').src=cropOriginalUrl;
  const vertical=state.direction==='vertical';$('#cropFrame').classList.toggle('horizontal',!vertical);
  $('#cropStartLabel').firstChild.textContent=vertical?'顶部':'左侧';$('#cropEndLabel').firstChild.textContent=vertical?'底部':'右侧';
  $('#cropDialog').showModal();
  const maxWidth=$('#cropViewport').clientWidth-76,maxHeight=$('#cropViewport').clientHeight-65;
  const scale=Math.min(maxWidth/im.width,maxHeight/im.height);$('#cropFrame').style.width=im.width*scale+'px';$('#cropFrame').style.height=im.height*scale+'px';
  updateCrop();
}
function updateCrop(){
  if(!cropEditing)return;const e=cropEditing,vertical=state.direction==='vertical';
  e.start=Math.round(Math.max(0,Math.min(e.start,e.length-e.end-1)));e.end=Math.round(Math.max(0,Math.min(e.end,e.length-e.start-1)));
  $('#cropStart').value=e.start;$('#cropEnd').value=e.end;$('#cropStart').max=e.length-e.end-1;$('#cropEnd').max=e.length-e.start-1;
  $('#cropShadeStart').style.cssText=`${vertical?'height':'width'}:${e.start/e.length*100}%`;
  $('#cropShadeEnd').style.cssText=`${vertical?'height':'width'}:${e.end/e.length*100}%`;
  $('#cropHandleStart').style.cssText=`${vertical?'top':'left'}:${e.start/e.length*100}%`;
  $('#cropHandleEnd').style.cssText=`${vertical?'top':'left'}:${(1-e.end/e.length)*100}%`;
}

async function decode(blob) {
  if(typeof createImageBitmap==='function') { try{return await createImageBitmap(blob);}catch{} }
  const url=URL.createObjectURL(blob), img=new Image();img.src=url;
  try{await img.decode();return img;}finally{URL.revokeObjectURL(url);}
}
function closeBitmap(b) { if(b&&typeof b.close==='function') b.close(); }
function canvas(w,h) {const c=document.createElement('canvas');c.width=w;c.height=h;return c;}
async function registerFile(file, name=file.name) {
  const bitmap=await decode(file);
  try{
    const width=bitmap.width||bitmap.naturalWidth,height=bitmap.height||bitmap.naturalHeight;
    if(width<8||height<8)throw new Error('图片尺寸太小');
    if(width*height>24e6)throw new Error('单张超过 2400 万像素，请先裁小');
    const scale=Math.min(1,360/width,1200/height), c=canvas(Math.round(width*scale),Math.round(height*scale));
    c.getContext('2d').drawImage(bitmap,0,0,c.width,c.height);
    const blob=await new Promise(r=>c.toBlob(r,'image/png'));if(!blob)throw new Error('缩略图生成失败');
    const im={id:crypto.randomUUID?crypto.randomUUID():String(Date.now())+Math.random(),file,name,width,height,preview:URL.createObjectURL(blob)};
    registry.set(im.id,im);c.width=c.height=1;return im;
  }finally{closeBitmap(bitmap);}
}
async function importFiles(files) {
  if(busy)return;homeView=false;const list=Array.from(files);if(!list.length)return;
  if(list.length+(state.demo?0:state.ids.length)>30){toast('每个任务最多 30 张截图');return;}
  busy=true;render();const added=[],errors=[];
  try{
    let expected=state.demo?null:images()[0];
    for(const file of list){
      if(file.size>25*1024*1024){errors.push(`${file.name}：文件大于 25 MB`);continue;}
      if(!/image\/(png|jpeg|webp)/i.test(file.type)&&! /\.(png|jpe?g|webp)$/i.test(file.name)){errors.push(`${file.name}：暂不支持此格式`);continue;}
      try{
        const im=await registerFile(file);
        if(expected&&(state.direction==='vertical'?expected.width!==im.width:expected.height!==im.height)){URL.revokeObjectURL(im.preview);registry.delete(im.id);errors.push(`${file.name}：${state.direction==='vertical'?'宽度':'高度'}与当前任务不同`);continue;}
        expected=expected||im;added.push(im.id);
      }catch(e){errors.push(`${file.name}：${e.message||'解码失败'}`);}
    }
    if(added.length){checkpoint();if(state.demo){state.ids=[];state.seams=[];state.crop={start:0,end:0};state.bars={start:0,end:0};}if(state.demo)state.trims={};state.demo=false;state.ids.push(...added);syncSeams();toast(`已添加 ${added.length} 张截图`);}
  }finally{busy=false;$('#fileInput').value='';render();}
  if(errors.length)info('部分图片未导入',`<p>其余图片已保留，可继续拼接。</p><ul>${errors.map(s=>`<li>${escapeHTML(s)}</li>`).join('')}</ul>`);
}
function moveImage(index,delta) { if(busy||index+delta<0||index+delta>=state.ids.length)return;transaction(()=>{const j=index+delta;[state.ids[index],state.ids[j]]=[state.ids[j],state.ids[index]];syncSeams();}); }
function changeDirection(direction) {if(busy||state.direction===direction)return;if(transaction(()=>{state.direction=direction;state.seams=[];state.trims={};state.autoBars={};state.chromeKey='';state.crop={start:0,end:0};state.bars={start:0,end:0};syncSeams();}))toast('方向已切换，接缝需重新检查；可撤销恢复');}
async function analysisData(im, precise=false) {
  const b=await decode(im.file);
  try{
    const vertical=state.direction==='vertical', fullLength=vertical?im.height:im.width, cross=vertical?im.width:im.height;
    const trim=trimFor(im.id),start=state.bars.start+trim.start,end=state.bars.end+trim.end,length=fullLength-start-end;
    if(length<=0)throw new Error('重复栏范围超出图片');
    const sampleCross=Math.min(precise?320:128,cross),ratio=precise?1:sampleCross/cross,c=canvas(vertical?sampleCross:Math.round(length*ratio),vertical?Math.round(length*ratio):sampleCross),ctx=c.getContext('2d',{willReadFrequently:true});
    ctx.imageSmoothingQuality='high';
    ctx.fillStyle='#fff';ctx.fillRect(0,0,c.width,c.height);
    ctx.drawImage(b,vertical?0:start,vertical?start:0,vertical?cross:length,vertical?length:cross,0,0,c.width,c.height);
    const rgba=ctx.getImageData(0,0,c.width,c.height).data,l=vertical?c.height:c.width,pixels=new Uint8Array(l*sampleCross);
    for(let y=0;y<l;y++)for(let x=0;x<sampleCross;x++){const p=(vertical?y*c.width+x:x*c.width+y)*4;pixels[y*sampleCross+x]=Math.round(rgba[p]*.299+rgba[p+1]*.587+rgba[p+2]*.114);}
    c.width=c.height=1;return {id:im.id,pixels,cross:sampleCross,length:l,ratio};
  }finally{closeBitmap(b);}
}
async function analyze() {
  if(busy||state.ids.length<2)return;
  const token=++generation;busy=true;$('#progressArea').hidden=false;$('#progress').value=0;$('#progressText').textContent='读取图片';render();
  try{
    const data=[];for(const im of images()){data.push(await analysisData(im));if(token!==generation)return;$('#progress').value=data.length/state.ids.length*15;}
    const shouldSort=false, pairs=[];
    if(shouldSort){for(let a=0;a<data.length;a++)for(let b=0;b<data.length;b++)if(a!==b)pairs.push([a,b]);}
    else for(let i=0;i<data.length-1;i++)pairs.push([i,i+1]);
    const source=`const match = ${StitchCore.match.toString()};self.onmessage=e=>{const {data,pairs}=e.data;const results=[];for(let i=0;i<pairs.length;i++){const [a,b]=pairs[i];results.push({a:data[a].id,b:data[b].id,result:match(data[a],data[b])});self.postMessage({progress:(i+1)/pairs.length});}self.postMessage({results});};`;
    const url=URL.createObjectURL(new Blob([source],{type:'text/javascript'}));
    try{worker=new Worker(url);}finally{URL.revokeObjectURL(url);}
    worker.onmessage=async event=>{
      if(token!==generation)return;
      if(event.data.results){
        const results=event.data.results;worker.terminate();worker=null;
        try {
          const verified=[];let previous=null;
          for(let i=0;i<results.length;i++){
            if(token!==generation)return;const pair=results[i],existing=state.seams.find(s=>s.beforeId===pair.a&&s.afterId===pair.b);
            if(existing?.manual)continue;
            const a=previous?.id===pair.a?previous:await analysisData(registry.get(pair.a),true),b=await analysisData(registry.get(pair.b),true);previous=b;
            const coarse={...pair.result,ratio:data.find(d=>d.id===pair.a).ratio};
            const refined=StitchCore.refine(a,b,coarse);verified.push({...pair,result:refined});
            $('#progressText').textContent='校准接缝';$('#progress').value=85+(i+1)/results.length*15;
          }
          if(token!==generation)return;checkpoint();syncSeams();let automatic=0;
          for(const pair of verified){const s=state.seams.find(s=>s.beforeId===pair.a&&s.afterId===pair.b);if(!s||s.manual)continue;const r=pair.result;
            Object.assign(s,{autoBase:{end:trimFor(s.beforeId).end,start:trimFor(s.afterId).start},suggested:r.overlap,status:r.status,confirmed:r.status==='high',overlap:r.status==='high'?r.overlap:0,cut:r.status==='high'?Math.round(r.overlap/2):0});
            try{currentPlan();if(s.confirmed)automatic++;}catch{Object.assign(s,{confirmed:false,overlap:0,cut:0,status:'uncertain'});}
          }
          lastAnalysisKey=analysisKey();busy=false;$('#progressArea').hidden=true;render();toast(automatic?'已自动拼接 '+automatic+' 处':'请拖动接缝手动对齐');
        }catch(error){if(token!==generation)return;busy=false;$('#progressArea').hidden=true;render();toast('自动拼接未完成，可手动调整');}
      }else{ $('#progress').value=15+event.data.progress*85;$('#progressText').textContent=shouldSort?'查找连续截图':'识别重叠区域'; }
    };
    worker.onerror=()=>{if(token!==generation)return;worker?.terminate();worker=null;busy=false;$('#progressArea').hidden=true;render();toast('分析失败，仍可手动调整接缝');};
    worker.postMessage({data,pairs});
  }catch(e){if(token!==generation)return;busy=false;$('#progressArea').hidden=true;render();toast(e.message||'分析失败');}
}
function cancelAnalysis(){generation++;barCancel?.();worker?.terminate();worker=null;busy=false;$('#progressArea').hidden=true;render();toast('已取消，截图和编辑均保留');}
function closeEditorResources(){editorBitmaps.forEach(closeBitmap);editorBitmaps=[];editor=null;}
async function openSeam(index) {
  if(busy)return;const seam=state.seams[index];if(!seam)return;
  closeEditorResources();const a=registry.get(seam.beforeId),b=registry.get(seam.afterId),vertical=state.direction==='vertical';
  const ta=trimFor(a.id),tb=trimFor(b.id);const limit=Math.min((vertical?a.height:a.width)-ta.start-ta.end,(vertical?b.height:b.width)-tb.start-tb.end)-state.bars.start-state.bars.end-1;
  editor={index,seam:clone(seam),a,b,vertical,overlap:seam.confirmed?seam.overlap:seam.suggested,cutRatio:seam.overlap?seam.cut/seam.overlap:.5,opacity:.5,zoom:1,limit};
  $('#seamTitle').textContent='拼接';$('#editorStatus').textContent=seam.suggested?`建议重叠 ${seam.suggested} px · 请核对文字`:'未找到可靠重叠 · 默认完整保留';
  $('#overlapRange').max=limit;$('#overlapNumber').max=limit;$('#opacityRange').value=50;$('#cutRange').value=editor.cutRatio*100;$('#opacityValue').textContent='50%';$('#cutValue').textContent=`${Math.round(editor.cutRatio*100)}%`;
  $('#seamDialog').showModal();$('#confirmSeam').disabled=true;const localEditor=editor;
  try{const ab=await decode(a.file);if(editor!==localEditor){closeBitmap(ab);return;}editorBitmaps.push(ab);const bb=await decode(b.file);if(editor!==localEditor){closeBitmap(bb);return;}editorBitmaps.push(bb);$('#confirmSeam').disabled=false;updateEditor();}
  catch(e){$('#editorStatus').textContent='原图读取失败，请关闭后重试';}
}
function updateEditor(){
  if(!editor||editorBitmaps.length!==2)return;
  const e=editor;e.overlap=Math.max(0,Math.min(e.limit,Math.round(e.overlap)));
  $('#overlapNumber').value=e.overlap;$('#overlapRange').value=e.overlap;
  const c=$('#editorCanvas'),cross=e.vertical?e.a.width:e.a.height,viewLength=Math.min(760,Math.max(380,e.overlap+120)),scale=(e.vertical?285:300)/cross*e.zoom;
  const lenA=(e.vertical?e.a.height:e.a.width)-state.bars.end-trimFor(e.a.id).end;
  const seamLocal=lenA-e.overlap+e.overlap*e.cutRatio;
  const start=Math.max(0,seamLocal-viewLength/2),end=start+viewLength;
  const width=e.vertical?cross:viewLength,height=e.vertical?viewLength:cross;
  c.width=Math.round(width);c.height=Math.round(height);c.style.width=`${width*scale}px`;c.style.height=`${height*scale}px`;e.scale=scale;e.viewStart=start;e.seamLocal=seamLocal;
  const ctx=c.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,c.width,c.height);
  ctx.save();ctx.beginPath();if(e.vertical)ctx.rect(0,0,cross,Math.max(0,lenA-start));else ctx.rect(0,0,Math.max(0,lenA-start),cross);ctx.clip();ctx.drawImage(editorBitmaps[0],e.vertical?0:-start,e.vertical?-start:0);ctx.restore();
  const bOrigin=lenA-e.overlap-state.bars.start-trimFor(e.b.id).start;
  ctx.save();ctx.globalAlpha=e.overlap?e.opacity:1;ctx.beginPath();const bStart=lenA-e.overlap-start;if(e.vertical)ctx.rect(0,Math.max(0,bStart),cross,viewLength);else ctx.rect(Math.max(0,bStart),0,viewLength,cross);ctx.clip();ctx.drawImage(editorBitmaps[1],e.vertical?0:bOrigin-start,e.vertical?bOrigin-start:0);ctx.restore();
  const line=seamLocal-start;ctx.strokeStyle='#c7994c';ctx.lineWidth=2/scale;ctx.setLineDash([7/scale,4/scale]);ctx.beginPath();if(e.vertical){ctx.moveTo(0,line);ctx.lineTo(cross,line);}else{ctx.moveTo(line,0);ctx.lineTo(line,cross);}ctx.stroke();
  try{const seams=clone(state.seams);seams[e.index]={...seams[e.index],overlap:e.overlap,cut:Math.round(e.overlap*e.cutRatio),confirmed:true};StitchCore.plan(images(),seams,state.direction,state.crop,state.bars,state.trims||{});$('#editorWarning').textContent='';$('#confirmSeam').disabled=false;}catch(err){$('#editorWarning').textContent=err.message;$('#confirmSeam').disabled=true;}
}
function clearExport(){for(const url of exportUrls)URL.revokeObjectURL(url);exportUrls=[];$('#downloadResults').innerHTML='';}
function exportSettings(){const p=currentPlan(),scale=Number($('#scale').value);return {p,scale,width:Math.max(1,Math.round(p.width*scale)),height:Math.max(1,Math.round(p.height*scale)),vertical:state.direction==='vertical',format:$('#format').value,segmented:$('#exportMode').value==='segments'};}
function updateExport(){
  clearExport();const s=exportSettings(),pending=state.seams.some(s=>!s.confirmed);
  $('#exportDimensions').textContent=`${s.width} × ${s.height} px`;$('#formatSummary').textContent=(s.format==='png'?'PNG':'JPG')+' · '+(s.scale===1?'原尺寸':Math.round(s.scale*100)+'%');
  $('#qualityLabel').hidden=s.format!=='jpeg';$('#ackRow').hidden=!pending;
  const tooLarge=s.width*s.height>14e6||Math.max(s.width,s.height)>16384;
  const cross=s.vertical?s.width:s.height;
  const segmentTooLarge=cross*4096>14e6||cross>8192;
  const blocked=s.segmented?segmentTooLarge:tooLarge;
  $('#exportNotice').hidden=!blocked;
  $('#exportNotice').textContent=blocked?'此尺寸超出审核版的保守预算。请选择缩小尺寸，或分段导出。':pending?'仍有接缝待确认，生成时将保留这些位置的完整内容。':'';
  $('#generate').disabled=blocked||(pending&&!$('#acknowledge').checked);if(blocked){$('#exportOptions').hidden=false;$('#moreOptions').setAttribute('aria-expanded','true');}return !blocked;
}
function openExport(){if(busy||!state.ids.length)return;$('#acknowledge').checked=false;setStep(3);updateExport();}
async function drawOutput(settings,axisStart,axisEnd){
  const s=settings,axisLength=axisEnd-axisStart,c=canvas(s.vertical?s.width:axisLength,s.vertical?axisLength:s.height),ctx=c.getContext('2d');
  if(!ctx)throw new Error('无法创建导出画布');
  ctx.fillStyle='#fff';ctx.fillRect(0,0,c.width,c.height);
  try{
    for(const seg of s.p.segments){
      const dStart=Math.round(seg.offset*s.scale),dEnd=Math.round((seg.offset+seg.length)*s.scale),from=Math.max(axisStart,dStart),to=Math.min(axisEnd,dEnd);
      if(to<=from)continue;
      const im=registry.get(seg.imageId),b=await decode(im.file);
      try{
        const sourceStart=seg.start+(from-dStart)/(dEnd-dStart)*seg.length,sourceLength=(to-from)/(dEnd-dStart)*seg.length;
        if(s.vertical)ctx.drawImage(b,0,sourceStart,im.width,sourceLength,0,from-axisStart,s.width,to-from);
        else ctx.drawImage(b,sourceStart,0,sourceLength,im.height,from-axisStart,0,to-from,s.height);
      }finally{closeBitmap(b);}
    }
    const blob=await new Promise((resolve,reject)=>{try{c.toBlob(b=>b?resolve(b):reject(new Error('编码失败，请尝试分段或缩小')),'image/'+s.format,Number($('#quality').value)/100);}catch(e){reject(e);}});
    if(!blob.size)throw new Error('导出为空，请尝试分段');return blob;
  }finally{c.width=c.height=1;}
}
async function generateExport(){
  if(busy||!updateExport())return;if(state.seams.some(s=>!s.confirmed)&&!$('#acknowledge').checked)return;
  const settings=exportSettings(),length=settings.vertical?settings.height:settings.width,chunk=settings.segmented?4096:length,count=Math.ceil(length/chunk);
  busy=true;render();const generate=$('#generate'),controls=[...document.querySelectorAll('#exportDialog select,#exportDialog input,#exportDialog .close-dialog')];controls.forEach(c=>c.disabled=true);generate.disabled=true;
  let completed=0;
  try{
    const files=[];
    for(let i=0;i<count;i++){
      generate.textContent=`正在生成 ${i+1} / ${count}`;
      const blob=await drawOutput(settings,i*chunk,Math.min(length,(i+1)*chunk));
      const url=URL.createObjectURL(blob);exportUrls.push(url);completed++;
      const today=new Date(),date=[today.getFullYear(),String(today.getMonth()+1).padStart(2,'0'),String(today.getDate()).padStart(2,'0')].join('-');
      const ext=settings.format==='jpeg'?'jpg':'png',name=`SewShot-${date}${count>1?'-'+String(i+1).padStart(2,'0'):''}.${ext}`;
      const a=document.createElement('a');a.href=url;a.download=name;a.textContent=`↓  ${count>1?`第 ${i+1} 段`:'下载长图'} · ${(blob.size/1024/1024).toFixed(1)} MB`;$('#downloadResults').append(a);files.push(new File([blob],name,{type:blob.type}));
      await new Promise(r=>setTimeout(r,0));
    }
    if(navigator.canShare&&navigator.canShare({files})){
      const button=document.createElement('button');button.className='button dark full';button.innerHTML=icon('share')+'系统分享';button.onclick=async()=>{try{await navigator.share({files,title:'SewShot · 长图'});}catch(e){if(e.name!=='AbortError')toast('分享未完成，请使用下载入口');}};$('#downloadResults').append(button);
    }
    toast('图片已生成，点击下载或系统分享');
  }catch(e){$('#exportNotice').hidden=false;$('#exportNotice').textContent=`${completed?`已完成 ${completed} 段，其余`:'导出'}失败：${e.message}。可缩小尺寸或改为分段后重试。`;}
  finally{busy=false;controls.forEach(c=>c.disabled=false);generate.innerHTML=icon('download')+'重新生成';generate.disabled=false;render();}
}
function rounded(ctx,x,y,w,h,r,fill){ctx.fillStyle=fill;ctx.beginPath();ctx.roundRect(x,y,w,h,r);ctx.fill();}
async function loadDemo(){
  if(busy)return;busy=true;render();
  try{
    const long=canvas(600,2180),c=long.getContext('2d');c.fillStyle='#fafbf7';c.fillRect(0,0,600,2180);
    c.fillStyle='#74866c';c.font='18px "Segoe UI", "Microsoft YaHei"';c.fillText('SLOW DAYS  /  生活里的小事',43,56);
    c.fillStyle='#334d38';c.font='bold 34px "Microsoft YaHei"';c.fillText('把日子过成喜欢的样子',43,112);
    c.fillStyle='#98a28e';c.font='17px "Microsoft YaHei"';c.fillText('周末灵感手记   ·   VOL. 028',43,150);
    rounded(c,40,187,520,312,14,'#e1e9d1');
    // Original vector illustration, drawn locally: a window, a plant and a warm cup.
    rounded(c,79,210,280,236,8,'#f6f7eb');rounded(c,90,220,258,206,4,'#c2d5b2');
    c.fillStyle='#b1c49d';c.beginPath();c.arc(180,365,94,Math.PI,0);c.fill();c.fillStyle='#cfdfbd';c.beginPath();c.arc(289,369,100,Math.PI,0);c.fill();
    c.fillStyle='#f4f4e4';c.fillRect(215,220,9,206);c.fillRect(90,312,258,8);c.fillStyle='#d1c7a4';c.fillRect(40,447,520,52);
    rounded(c,409,389,62,64,9,'#869e69');c.strokeStyle='#74945c';c.lineWidth=5;c.beginPath();c.moveTo(439,400);c.lineTo(430,292);c.stroke();
    [[414,327,-.6],[447,306,.6],[413,366,-.6],[455,350,.6]].forEach(([x,y,r])=>{c.save();c.translate(x,y);c.rotate(r);c.fillStyle='#8dab73';c.beginPath();c.ellipse(0,0,23,10,0,0,Math.PI*2);c.fill();c.restore();});
    rounded(c,276,413,67,44,9,'#faf8ee');c.strokeStyle='#faf8ee';c.lineWidth=7;c.beginPath();c.arc(345,432,12,-Math.PI/2,Math.PI/2);c.stroke();
    c.fillStyle='#8a997a';c.font='14px "Microsoft YaHei"';c.fillText('慢一点，也没关系。',42,533);
    const sections=[
      ['01','给自己一段留白','不赶时间的早晨，打开窗，','让光和风一起进来。','一杯咖啡，一页书，就是很好的开始。'],
      ['02','去附近走一走','沿着树荫散步，不急着抵达。','记下路边新开的花，','也记下那些让你停下来的瞬间。'],
      ['03','收集微小的快乐','洗好的床单，刚出炉的面包。','把手机放远一点，','把注意力留给眼前的人和事。'],
      ['04','把喜欢的留住','生活不需要每一刻都很精彩。','那些平常、安静的小事，','也值得被好好记录。']
    ];
    sections.forEach((s,i)=>{const y=601+i*343;c.fillStyle='#b2c29c';c.font='18px Georgia';c.fillText(s[0],43,y);c.fillStyle='#3d553d';c.font='bold 27px "Microsoft YaHei"';c.fillText(s[1],43,y+46);c.fillStyle='#85917c';c.font='20px "Microsoft YaHei"';s.slice(2).forEach((line,j)=>c.fillText(line,43,y+94+j*39));c.strokeStyle='#e1e7d8';c.lineWidth=1;c.beginPath();c.moveTo(43,y+258);c.lineTo(557,y+258);c.stroke();});
    c.fillStyle='#8ea27e';c.font='16px "Microsoft YaHei"';c.fillText('让每一个普通日子，都有一点绿意。',43,2083);
    const positions=[0,460,930,1460],lengths=[720,720,720,720],added=[];
    for(let i=0;i<4;i++){const shot=canvas(600,lengths[i]);shot.getContext('2d').drawImage(long,0,positions[i],600,lengths[i],0,0,600,lengths[i]);const blob=await new Promise(r=>shot.toBlob(r,'image/png'));const im=await registerFile(blob,`示例截图-${i+1}.png`);added.push(im.id);shot.width=1;}
    checkpoint();state={ids:added,direction:'vertical',demo:true,crop:{start:0,end:0},bars:{start:0,end:0},seams:[]};syncSeams();
    lastAnalysisKey='';
    zoom=1;
  }finally{busy=false;render();}
}
function bind(){
  $('#autoBars').onchange=()=>{if(!busy)applyAutoBars();};
  // Lock browser zoom while retaining one-finger scrolling and crop dragging.
  for(const type of ['gesturestart','gesturechange','gestureend'])document.addEventListener(type,e=>e.preventDefault(),{passive:false});
  document.addEventListener('touchmove',e=>{if(e.touches.length>1)e.preventDefault();},{passive:false});
  document.addEventListener('wheel',e=>{if(e.ctrlKey)e.preventDefault();},{passive:false});
  $('#upload').onclick=$('#add').onclick=()=>$('#fileInput').click();$('#fileInput').onchange=e=>importFiles(e.target.files);$('#demo').onclick=loadDemo;
  $('#resume').onclick=()=>{homeView=false;render();};$('#previousSelect').onclick=()=>{homeView=true;render();};$('#previousStitch').onclick=()=>{cancelInline();setStep(1);};$('#previousExport').onclick=()=>setStep(2);$('#nextStitch').onclick=nextStitch;$('#nextExport').onclick=()=>{if(inlineEdit&&!saveInline())return;openExport();};$('#back').onclick=()=>{cancelInline();setStep(Math.max(1,pageStep-1));};
  $('#vertical').onclick=()=>changeDirection('vertical');$('#horizontal').onclick=()=>changeDirection('horizontal');$('#cancel').onclick=cancelAnalysis;
  $('#undo').onclick=()=>{if(!history.length||busy)return;future.push(clone(state));state=history.pop();clearExport();render();};
  $('#redo').onclick=()=>{if(!future.length||busy)return;history.push(clone(state));state=future.pop();clearExport();render();};
  document.addEventListener('keydown',e=>{if(document.querySelector('dialog[open]')||['INPUT','SELECT','TEXTAREA'].includes(document.activeElement.tagName))return;if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='z'){e.preventDefault();if(inlineEdit)restoreEditHistory(e.shiftKey);else $(e.shiftKey?'#redo':'#undo').click();}});
  $('#imageList').onclick=e=>{
    if(busy||Date.now()<suppressClickUntil)return;
    const del=e.target.closest('[data-delete]'),sort=e.target.closest('[data-sort]');
    if(del)transaction(()=>{state.ids=state.ids.filter(id=>id!==del.dataset.delete);state.crop={start:0,end:0};syncSeams();});
    else {const move=e.target.closest('[data-move]');if(move)moveImage(state.ids.indexOf(move.dataset.owner),Number(move.dataset.move));}
  };
  $('#moveEarlier').onclick=()=>{moveImage(state.ids.indexOf(sortImageId),-1);$('#sortActions').close();};$('#moveLater').onclick=()=>{moveImage(state.ids.indexOf(sortImageId),1);$('#sortActions').close();};
  const reorder=(a,b)=>{if(!a||!b||a===b||busy)return;transaction(()=>{const from=state.ids.indexOf(a),to=state.ids.indexOf(b);state.ids.splice(to,0,state.ids.splice(from,1)[0]);syncSeams();});};
  let dragId=null,touchDrag=null;
  const clearDrag=()=>{document.querySelectorAll('.dragging,.drag-over').forEach(el=>el.classList.remove('dragging','drag-over'));};
  $('#imageList').ondragstart=e=>{if(busy){e.preventDefault();return;}const card=e.target.closest('.image-card');if(!card)return;dragId=card.dataset.id;e.dataTransfer.setData('text/plain',dragId);e.dataTransfer.effectAllowed='move';card.classList.add('dragging');};
  $('#imageList').ondragover=e=>{if(!dragId)return;e.preventDefault();document.querySelectorAll('.drag-over').forEach(el=>el.classList.remove('drag-over'));e.target.closest('.image-card')?.classList.add('drag-over');};
  $('#imageList').ondrop=e=>{e.preventDefault();const card=e.target.closest('.image-card');reorder(dragId,card?.dataset.id);dragId=null;clearDrag();suppressClickUntil=Date.now()+400;};$('#imageList').ondragend=()=>{dragId=null;clearDrag();};
  $('#imageList').addEventListener('touchmove',e=>{if(touchDrag?.active)e.preventDefault();},{passive:false});
  $('#imageList').addEventListener('contextmenu',e=>{if(touchDrag)e.preventDefault();});
  $('#imageList').addEventListener('pointerdown',e=>{
    if(e.pointerType==='mouse'||busy||e.target.closest('[data-delete],[data-move]'))return;const card=e.target.closest('.image-card');if(!card)return;
    touchDrag={id:card.dataset.id,pointer:e.pointerId,x:e.clientX,y:e.clientY,target:card.dataset.id,active:false};
    touchDrag.timer=setTimeout(()=>{if(!touchDrag)return;touchDrag.active=true;card.classList.add('dragging');card.setPointerCapture(e.pointerId);suppressClickUntil=Date.now()+10000;},360);
  });
  $('#imageList').addEventListener('pointermove',e=>{if(!touchDrag)return;if(!touchDrag.active){if(Math.hypot(e.clientX-touchDrag.x,e.clientY-touchDrag.y)>8){clearTimeout(touchDrag.timer);touchDrag=null;}return;}e.preventDefault();const target=document.elementFromPoint(e.clientX,e.clientY)?.closest('.image-card');if(target){touchDrag.target=target.dataset.id;document.querySelectorAll('.drag-over').forEach(el=>el.classList.remove('drag-over'));if(target.dataset.id!==touchDrag.id)target.classList.add('drag-over');}const bounds=$('#collection').getBoundingClientRect();if(e.clientY<bounds.top+45)$('#collection').scrollTop-=12;if(e.clientY>bounds.bottom-45)$('#collection').scrollTop+=12;},{passive:false});
  const finishTouch=(e,cancelled)=>{if(!touchDrag)return;clearTimeout(touchDrag.timer);if(touchDrag.active){e.preventDefault();if(!cancelled)reorder(touchDrag.id,touchDrag.target);suppressClickUntil=Date.now()+500;}touchDrag=null;clearDrag();};
  $('#imageList').addEventListener('pointerup',e=>finishTouch(e,false));$('#imageList').addEventListener('pointercancel',e=>finishTouch(e,true));
  document.addEventListener('dragover',e=>{if([...e.dataTransfer.types].includes('Files')){e.preventDefault();document.body.classList.add('drop-active');}});
  document.addEventListener('dragleave',e=>{if(!e.relatedTarget)document.body.classList.remove('drop-active');});document.addEventListener('drop',e=>{document.body.classList.remove('drop-active');if(e.dataTransfer.files.length){e.preventDefault();if(!busy){setStep(1);importFiles(e.dataTransfer.files);}}});
  $('#previewTrack').onclick=e=>{const seam=e.target.closest('[data-seam]'),im=e.target.closest('[data-image]');if(inlineEdit)return;if(seam)startInline(Number(seam.dataset.seam),e);else if(im){const i=state.ids.indexOf(im.dataset.image);startInline(i?i-1:0,e);}};
  $('#pendingButton').onclick=()=>{const i=state.seams.findIndex(s=>!s.confirmed);if(i>=0)startInline(i);};
  $('#adjustImage').onclick=()=>{const i=state.ids.indexOf(selectedImageId);$('#imageActions').close();openSeam(i?i-1:0);};$('#cropImage').onclick=()=>{$('#imageActions').close();openImageCrop();};
  document.querySelectorAll('.close-dialog').forEach(b=>b.onclick=()=>b.closest('dialog').close());
  $('#seamDialog').addEventListener('close',closeEditorResources);$('#cropDialog').addEventListener('close',()=>{cropEditing=null;if(cropOriginalUrl)URL.revokeObjectURL(cropOriginalUrl);cropOriginalUrl=null;$('#cropPreview').removeAttribute('src');});
  $('#overlapRange').oninput=$('#overlapNumber').oninput=e=>{if(!editor)return;editor.overlap=Number(e.target.value)||0;updateEditor();};
  $('#opacityRange').oninput=e=>{if(!editor)return;editor.opacity=Number(e.target.value)/100;$('#opacityValue').textContent=e.target.value+'%';updateEditor();};
  $('#cutRange').oninput=e=>{if(!editor)return;editor.cutRatio=Number(e.target.value)/100;$('#cutValue').textContent=e.target.value+'%';updateEditor();};
  $('#keepBoth').onclick=()=>{if(editor){editor.overlap=0;updateEditor();}};$('#applySuggestion').onclick=()=>{if(editor){editor.overlap=editor.seam.suggested||0;updateEditor();}};
  let pointer=null;
  $('#editorCanvas').onpointerdown=e=>{if(!editor)return;pointer={id:e.pointerId,start:editor.vertical?e.clientY:e.clientX,overlap:editor.overlap};e.target.setPointerCapture(e.pointerId);};
  $('#editorCanvas').onpointermove=e=>{if(!pointer||!editor||pointer.id!==e.pointerId)return;editor.overlap=pointer.overlap-((editor.vertical?e.clientY:e.clientX)-pointer.start)/editor.scale;updateEditor();};$('#editorCanvas').onpointerup=$('#editorCanvas').onpointercancel=()=>pointer=null;
  $('#confirmSeam').onclick=()=>{if(!editor)return;const e=editor;if(transaction(()=>{state.seams[e.index]={...state.seams[e.index],overlap:e.overlap,cut:Math.round(e.overlap*e.cutRatio),confirmed:true,manual:true};}))$('#seamDialog').close();};
  for(const side of ['Start','End']){
    $('#crop'+side).oninput=e=>{if(!cropEditing)return;cropEditing[side.toLowerCase()]=Number(e.target.value)||0;updateCrop();};
    const handle=$('#cropHandle'+side);let dragging=false;
    handle.onpointerdown=e=>{dragging=true;handle.setPointerCapture(e.pointerId);e.preventDefault();};
    handle.onpointermove=e=>{if(!dragging||!cropEditing)return;e.preventDefault();const r=$('#cropFrame').getBoundingClientRect(),v=state.direction==='vertical',fraction=(v?e.clientY-r.top:e.clientX-r.left)/(v?r.height:r.width);cropEditing[side.toLowerCase()]=Math.round((side==='Start'?fraction:1-fraction)*cropEditing.length);updateCrop();};handle.onpointerup=handle.onpointercancel=()=>dragging=false;
    handle.onkeydown=e=>{if(!cropEditing||!['ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.key))return;e.preventDefault();cropEditing[side.toLowerCase()]+=(e.key==='ArrowDown'||e.key==='ArrowRight'?1:-1)*(e.shiftKey?10:1);updateCrop();};
  }
  $('#resetCrop').onclick=()=>{cropEditing.start=0;cropEditing.end=0;updateCrop();};
  $('#confirmCrop').onclick=()=>{if(!cropEditing)return;const e=cropEditing;if(transaction(()=>{state.trims=state.trims||{};state.trims[e.id]={start:e.start,end:e.end};state.seams=state.seams.filter(s=>s.beforeId!==e.id&&s.afterId!==e.id);syncSeams();})){$('#cropDialog').close();toast('裁剪已应用');}};
  $('#moreOptions').onclick=()=>{$('#exportOptions').hidden=!$('#exportOptions').hidden;$('#moreOptions').setAttribute('aria-expanded',!$('#exportOptions').hidden);};
  for(const id of ['#format','#scale','#exportMode','#acknowledge','#quality'])$(id).onchange=updateExport;$('#generate').onclick=generateExport;

  window.addEventListener('resize',()=>{if(pageStep===2&&!busy){if(inlineEdit)renderInline();else renderPreview();}});bindInline();
}

function captureViewAnchor(event){
 const viewport=$('#viewport'),v=state.direction==='vertical',rect=viewport.getBoundingClientRect(),client=event?(v?event.clientY:event.clientX):(v?rect.top+rect.height/2:rect.left+rect.width/2),trackRect=$('#previewTrack').getBoundingClientRect(),local=client-(v?trackRect.top:trackRect.left);
 if(inlineEdit){const e=inlineEdit;let index=0;for(let i=0;i<e.ids.length;i++)if((e.origins[i]+e.shift+e.trims[e.ids[i]].start)*e.ratio<=local)index=i;return {id:e.ids[index],source:local/e.ratio-e.origins[index]-e.shift,client};}
 const plan=currentPlan(),pieces=[...document.querySelectorAll('.preview-piece')];let index=0;
 if(event?.target.closest('[data-image]'))index=plan.segments.findIndex(s=>s.imageId===event.target.closest('[data-image]').dataset.image);
 else for(let i=0;i<pieces.length;i++){const r=pieces[i].getBoundingClientRect();if((v?r.top:r.left)<=client)index=i;}
 const seg=plan.segments[index],piece=pieces[index];if(!seg||!piece)return null;const r=piece.getBoundingClientRect(),ratio=(v?r.height:r.width)/seg.length;
 return {id:seg.imageId,source:seg.start+(client-(v?r.top:r.left))/ratio,client};
}
function restoreViewAnchor(anchor){
 if(!anchor)return;const v=state.direction==='vertical',vp=$('#viewport'),track=$('#previewTrack').getBoundingClientRect();let point;
 if(inlineEdit){const e=inlineEdit,i=e.ids.indexOf(anchor.id);if(i<0)return;point=(e.origins[i]+e.shift+anchor.source)*e.ratio;}
 else {const plan=currentPlan(),i=plan.segments.findIndex(s=>s.imageId===anchor.id);if(i<0)return;const seg=plan.segments[i],piece=document.querySelectorAll('.preview-piece')[i].getBoundingClientRect();point=(v?piece.top-track.top:piece.left-track.left)+Math.max(0,Math.min(seg.length,anchor.source-seg.start))*(v?piece.height:piece.width)/seg.length;}
 vp[v?'scrollTop':'scrollLeft']+=(v?track.top:track.left)+point-anchor.client;
}
function editSnapshot(){const e=inlineEdit;return {trims:clone(e.trims),seams:clone(e.seams),touched:[...e.touched],activeId:e.activeId};}
function pushEditHistory(){inlineEdit.undo.push(editSnapshot());if(inlineEdit.undo.length>40)inlineEdit.undo.shift();inlineEdit.redo=[];}
function restoreEditHistory(redo){const e=inlineEdit,from=redo?e.redo:e.undo,to=redo?e.undo:e.redo;if(!from.length)return;const anchor=captureViewAnchor();to.push(editSnapshot());const snap=from.pop();Object.assign(e,snap,{touched:new Set(snap.touched),dragging:false});renderInline();restoreViewAnchor(anchor);}
function startInline(index,event){
 const anchor=captureViewAnchor(event);
 if(busy)return;const ids=[...state.ids];
 inlineEdit={index,ids,trims:Object.fromEntries(ids.map(id=>[id,{...trimFor(id)}])),seams:state.seams.map((s,i)=>({...s,overlap:s.confirmed?s.overlap:(i===index?s.suggested||0:0)})),touched:new Set(),undo:[],redo:[],activeId:null,dragging:false};
 if(state.seams[index])inlineEdit.touched.add(index);
 $('#inlineToolbar').hidden=false;$('#pendingButton').hidden=true;$('#historyActions').hidden=true;renderInline();
 restoreViewAnchor(anchor);
}
function renderInline(){
 const e=inlineEdit;if(!e)return;$('#editUndo').disabled=!e.undo.length;$('#editRedo').disabled=!e.redo.length;const v=state.direction==='vertical',ims=e.ids.map(id=>registry.get(id));
 const cross=v?ims[0].width:ims[0].height,r=Math.min(350,Math.max(100,(v?$('#viewport').clientWidth:$('#viewport').clientHeight)-130))/cross;e.ratio=r;
 const lengths=ims.map(im=>(v?im.height:im.width)-e.trims[im.id].start-e.trims[im.id].end),origins=[0];
 e.seams.forEach((s,i)=>{s.overlap=Math.round(Math.max(0,Math.min(s.overlap,lengths[i]-1,lengths[i+1]-1)));origins.push(origins[i]+(v?ims[i].height:ims[i].width)-e.trims[ims[i].id].end-s.overlap-e.trims[ims[i+1].id].start);});
 e.origins=origins;const min=Math.min(0,...origins);e.shift=-min;
 const total=Math.max(...ims.map((im,i)=>origins[i]+(v?im.height:im.width)))-min;
 const track=$('#previewTrack');track.className='preview-track direct-edit'+(v?'':' horizontal');track.style.cssText=`position:relative;width:${(v?cross:total)*r}px;height:${(v?total:cross)*r}px`;
 track.innerHTML=ims.map((im,i)=>{const length=v?im.height:im.width,t=e.trims[im.id];return `<div class="source-frame source-${i%2} ${e.activeId===im.id?'active-source':''} ${e.dragging&&e.activeId===im.id?'cropping':''}" data-frame="${im.id}" data-hd-source="${im.id}" data-hd-ratio="${r}" style="width:${im.width*r}px;height:${im.height*r}px;--trim-start:${t.start/length*100}%;--trim-end:${t.end/length*100}%;${v?'top':'left'}:${(origins[i]-min)*r}px"><img draggable="false" src="${im.preview}" alt="原图 ${i+1}"><span class="source-number">${i+1}</span><div class="direct-shade shade-start" style="${v?'height':'width'}:${t.start*r}px"></div><div class="direct-shade shade-end" style="${v?'height':'width'}:${t.end*r}px"></div></div>`;}).join('')+ims.map((im,i)=>{const length=v?im.height:im.width,t=e.trims[im.id];return ['start','end'].map(side=>`<button class="direct-handle trim-${side} color-${i%2}" data-edge="${side}" data-source="${im.id}" style="${v?'top':'left'}:${(origins[i]-min+(side==='start'?t.start:length-t.end))*r}px" aria-label="截图 ${i+1} ${side==='start'?'起始':'末尾'}裁切边缘"><i></i></button>`).join('');}).join('')+e.seams.map((s,i)=>`<button class="join-drag" data-join="${i}" style="${v?'top':'left'}:${(origins[i+1]-min+e.trims[ims[i+1].id].start+s.overlap/2)*r}px" aria-label="拖动调整接缝 ${i+1}"><svg viewBox="0 0 24 24"><path d="M12 3v18M8 7l4-4 4 4M8 17l4 4 4-4"/></svg></button><button class="join-reset" data-reset="${i}" style="${v?'top':'left'}:${(origins[i+1]-min+e.trims[ims[i+1].id].start+s.overlap/2)*r+52}px" aria-label="恢复接缝 ${i+1} 自动拼接">${icon('reset')}</button>`).join('');
 scheduleHD();
}
function cancelInline(){const anchor=captureViewAnchor();inlineEdit=null;$('#inlineToolbar').hidden=true;$('#previewTrack').style.cssText='';if(pageStep===2){renderPreview();restoreViewAnchor(anchor);}}
function saveInline(){
 if(!inlineEdit)return true;const anchor=captureViewAnchor(),e=inlineEdit;
 const ok=transaction(()=>{state.trims={...state.trims,...e.trims};state.seams=e.seams.map((s,i)=>e.touched.has(i)?{...s,cut:Math.round(s.overlap/2),confirmed:true,manual:true}:s);});
 if(ok){cancelInline();render();restoreViewAnchor(anchor);}return ok;
}
function changeInlineEdge(id,side,value){
 const e=inlineEdit,im=registry.get(id),t=e.trims[id],length=state.direction==='vertical'?im.height:im.width;
 const next=Math.round(Math.max(0,Math.min(value,length-t[side==='start'?'end':'start']-1))),delta=next-t[side];t[side]=next;
 const i=e.ids.indexOf(id),seamIndex=side==='start'?i-1:i;
 if(e.seams[seamIndex]){e.seams[seamIndex].overlap-=delta;e.touched.add(seamIndex);}
}
function bindInline(){
 $('#cancelInline').onclick=()=>{cancelInline();render();};$('#saveInline').onclick=saveInline;
 $('#editUndo').onclick=()=>restoreEditHistory(false);$('#editRedo').onclick=()=>restoreEditHistory(true);
 $('#previewTrack').addEventListener('click',ev=>{const reset=ev.target.closest('[data-reset]');if(!reset||!inlineEdit)return;pushEditHistory();const e=inlineEdit,i=Number(reset.dataset.reset),s=e.seams[i],base=s.autoBase||{start:0,end:0};s.overlap=Math.max(0,(s.suggested||0)-(e.trims[s.beforeId].end-base.end)-(e.trims[s.afterId].start-base.start));e.touched.add(i);renderInline();});

 let drag=null;const viewport=$('#viewport');
 viewport.addEventListener('scroll',scheduleHD,{passive:true});
 viewport.addEventListener('pointerdown',ev=>{const h=ev.target.closest('[data-edge],[data-join]');if(!h||!inlineEdit)return;ev.preventDefault();const v=state.direction==='vertical';pushEditHistory();inlineEdit.activeId=h.dataset.source||null;inlineEdit.dragging=!!h.dataset.edge;drag={pointer:ev.pointerId,start:v?ev.clientY:ev.clientX,edge:h.dataset.edge,id:h.dataset.source,join:Number(h.dataset.join),seams:clone(inlineEdit.seams),trims:clone(inlineEdit.trims),touched:new Set(inlineEdit.touched)};viewport.setPointerCapture(ev.pointerId);renderInline();});
 viewport.addEventListener('pointermove',ev=>{if(!drag||!inlineEdit)return;ev.preventDefault();const e=inlineEdit,v=state.direction==='vertical',delta=((v?ev.clientY:ev.clientX)-drag.start)/e.ratio;
 e.trims=clone(drag.trims);e.seams=clone(drag.seams);
 if(drag.edge)changeInlineEdge(drag.id,drag.edge,drag.trims[drag.id][drag.edge]+(drag.edge==='start'?delta:-delta));else {e.seams[drag.join].overlap=drag.seams[drag.join].overlap-delta;e.touched.add(drag.join);}
 renderInline();});
 viewport.addEventListener('pointerup',()=>{if(inlineEdit){inlineEdit.dragging=false;renderInline();}drag=null;});viewport.addEventListener('pointercancel',()=>{if(drag&&inlineEdit){inlineEdit.trims=drag.trims;inlineEdit.seams=drag.seams;inlineEdit.touched=drag.touched;inlineEdit.dragging=false;inlineEdit.undo.pop();renderInline();}drag=null;});
 viewport.addEventListener('keydown',ev=>{const h=ev.target.closest('[data-edge],[data-join]');if(!h||!inlineEdit||!['ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(ev.key))return;ev.preventDefault();pushEditHistory();inlineEdit.activeId=h.dataset.source||null;const amount=(ev.key==='ArrowDown'||ev.key==='ArrowRight'?1:-1)*(ev.shiftKey?10:1);if(h.dataset.edge){changeInlineEdge(h.dataset.source,h.dataset.edge,inlineEdit.trims[h.dataset.source][h.dataset.edge]+(h.dataset.edge==='start'?amount:-amount));}else {const i=Number(h.dataset.join);inlineEdit.seams[i].overlap-=amount;inlineEdit.touched.add(i);}const selector=h.dataset.edge?`[data-source="${h.dataset.source}"][data-edge="${h.dataset.edge}"]`:`[data-join="${h.dataset.join}"]`;renderInline();$(selector)?.focus({preventScroll:true});});
}
bind();render();
