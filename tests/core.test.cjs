const test=require('node:test');
const assert=require('node:assert/strict');
const {plan,match,sequence}=require('../core.js');
const ims=[{id:'a',width:60,height:100},{id:'b',width:60,height:100},{id:'c',width:60,height:100}];
const seam=(a,b,overlap,cut,confirmed=true)=>({beforeId:a,afterId:b,overlap,cut,confirmed});
test('uncertain seams preserve all input rows',()=>{assert.equal(plan(ims,[seam('a','b',40,20,false)],'vertical').height,300)});
test('cuts on both sides retain exactly one copy',()=>{const p=plan(ims,[seam('a','b',40,20),seam('b','c',30,10)],'vertical');assert.equal(p.height,230);assert.deepEqual(p.segments.map(s=>[s.start,s.end,s.offset]),[[0,80,0],[20,80,80],[10,100,140]])});
test('interacting cuts cannot empty a middle image',()=>{assert.throws(()=>plan(ims,[seam('a','b',90,85),seam('b','c',90,5)],'vertical'),/裁空/)});
test('overlap cannot exceed original dimensions',()=>assert.throws(()=>plan(ims,[seam('a','b',150,75)],'vertical'),/重叠/));
test('global crop crosses multiple sources without losing coordinate origin',()=>{const p=plan(ims,[],'vertical',{start:110,end:120});assert.deepEqual(p.segments.map(s=>[s.imageId,s.start,s.end,s.offset]),[['b',10,80,0]]);assert.equal(p.height,70)});
test('bars preserve first top and last bottom',()=>{const p=plan(ims,[],'vertical',{start:0,end:0},{start:10,end:15});assert.equal(p.height,250);assert.deepEqual(p.segments.map(s=>[s.start,s.end]),[[0,85],[10,85],[10,100]])});
test('different widths reject instead of silently scaling',()=>{assert.throws(()=>plan([...ims,{id:'d',width:61,height:100}],[],'vertical'),/宽度/)});
test('horizontal coordinates transpose cleanly',()=>{const horizontal=ims.map(im=>({...im,width:100,height:60}));const p=plan(horizontal,[seam('a','b',40,20)],'horizontal');assert.equal(p.width,260);assert.equal(p.height,60)});
test('sorting keeps disconnected groups and excludes cycles',()=>{const r=sequence(['c','b','a','d'],[{a:'a',b:'b',result:{status:'high',score:99}},{a:'b',b:'c',result:{status:'high',score:98}},{a:'c',b:'a',result:{status:'high',score:97}}]);assert.deepEqual(r,[['a','b','c'],['d']])});
test('uniform white regions never get high confidence',()=>{const a={pixels:new Uint8Array(72*100).fill(255),length:100,cross:72,ratio:1};assert.equal(match(a,a).status,'unmatched')});
test('known overlap recovered from textured synthetic data',()=>{let seed=17;const pixels=new Uint8Array(72*160);for(let i=0;i<pixels.length;i++){seed=(Math.imul(seed,1664525)+1013904223)>>>0;pixels[i]=seed>>>24;}const a={pixels:pixels.slice(0,72*100),length:100,cross:72,ratio:1},b={pixels:pixels.slice(60*72),length:100,cross:72,ratio:1};const m=match(a,b);assert.equal(m.overlap,40);assert.equal(m.status,'high')});
test('per-image trims retain original source coordinates',()=>{const p=plan(ims,[],'vertical',undefined, undefined, {a:{start:10,end:5},b:{start:20,end:0}});assert.equal(p.height,265);assert.deepEqual(p.segments.map(s=>[s.start,s.end,s.offset]),[[10,95,0],[20,100,85],[0,100,165]])});
test('seam cuts compose with per-image trims',()=>{const p=plan(ims,[seam('a','b',30,10)],'vertical',undefined, undefined, {a:{start:10,end:5},b:{start:20,end:0}});assert.equal(p.height,235);assert.deepEqual(p.segments.map(s=>[s.start,s.end]),[[10,75],[30,100],[0,100]])});

const {refine}=require('../core.js');
const {detectBars}=require('../core.js');
function phoneSample(top,bottom=0){
  const cross=96,length=900,pixels=new Uint8Array(cross*length).fill(20);
  pixels.fill(55,0,top*cross);if(bottom)pixels.fill(55,(length-bottom)*cross);
  for(let y=30;y<48;y++)for(let x=12;x<35;x++)pixels[y*cross+x]=240;
  if(bottom)for(let y=length-bottom+20;y<length-bottom+38;y++)for(let x=15;x<45;x++)pixels[y*cross+x]=240;
  return {cross,length,pixels};
}
test('browser chrome uses each image boundary and removes outermost bars',()=>{
  const result=detectBars([phoneSample(130,80),phoneSample(90),phoneSample(90)]);
  assert.deepEqual(result.map(r=>[r.start,r.end]),[[130,80],[90,0],[90,0]]);
});
test('blank margins, whole blank images and unmatched bar colors are preserved',()=>{
  const blank=phoneSample(130);blank.pixels.fill(55,0,130*blank.cross);
  assert.equal(detectBars([blank,blank])[0].start,0);
  const uniform={cross:96,length:900,pixels:new Uint8Array(96*900).fill(55)};
  assert.equal(detectBars([uniform,uniform])[0].start,0);
  assert.equal(detectBars([phoneSample(130)])[0].start,0);
});
test('sticky header requires a detailed band repeated inside the previous capture',()=>{
  const previous=phoneSample(90),current=phoneSample(90),w=current.cross;
  for(let y=94;y<145;y++)for(let x=10;x<35;x++)current.pixels[y*w+x]=(x%3&&y%4)?225:20;
  current.pixels.fill(65,150*w,152*w);
  previous.pixels.set(current.pixels.slice(94*w,150*w),430*w);
  assert.equal(detectBars([previous,current])[1].start,152);
  previous.pixels.fill(20,430*w,486*w);
  assert.equal(detectBars([previous,current])[1].start,90);
});
test('fine matching recovers exact overlap despite coarse rounding',()=>{let seed=31;const w=72,pixels=new Uint8Array(w*700);for(let i=0;i<pixels.length;i++){seed=(Math.imul(seed,1664525)+1013904223)>>>0;pixels[i]=seed>>>24;}const a={pixels:pixels.slice(0,w*420),cross:w,length:420},b={pixels:pixels.slice(w*283),cross:w,length:417};const r=refine(a,b,{overlap:133,candidates:[133,200],ratio:.12});assert.equal(r.overlap,137);assert.equal(r.status,'high');});
test('fine verification rejects blank and repeating areas',()=>{const a={pixels:new Uint8Array(72*300).fill(255),cross:72,length:300};assert.notEqual(refine(a,a,{overlap:100,candidates:[100],ratio:.1}).status,'high');for(let y=0;y<300;y++)for(let x=0;x<72;x++)a.pixels[y*72+x]=(y%10<5&&x%10<5)?30:240;assert.notEqual(refine(a,a,{overlap:100,candidates:[100,110,120],ratio:.1}).status,'high');});
test('sparse unique glyph on blank background can be matched exactly',()=>{const w=160,full=new Uint8Array(w*810).fill(245);let seed=91;for(let y=410;y<422;y++)for(let x=40;x<49;x++){seed=(Math.imul(seed,1664525)+1013904223)>>>0;full[y*w+x]=40+(seed>>>27);}const a={pixels:full.slice(0,500*w),cross:w,length:500},b={pixels:full.slice(310*w),cross:w,length:500};const r=refine(a,b,{overlap:194,candidates:[194,110],ratio:.12});assert.equal(r.overlap,190);assert.equal(r.status,'high');const changed={...b,pixels:b.pixels.slice()};for(let y=100;y<112;y++)for(let x=40;x<49;x++)changed.pixels[y*w+x]=150;assert.notEqual(refine(a,changed,{overlap:194,candidates:[194,110],ratio:.12}).status,'high');});
