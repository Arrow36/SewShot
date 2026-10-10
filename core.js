(function (root) {
  'use strict';
  // Detect bounded, shared browser chrome; never infer a crop from a blank page.
  function detectBars(samples) {
    const median = values => [...values].sort((a,b)=>a-b)[Math.floor(values.length/2)];
    const pixel = (im,y,x) => im.pixels[y*im.cross+x];
    const edge = (im,y) => median([.008,.015,.985,.992].map(x=>pixel(im,y,Math.min(im.cross-1,Math.floor(im.cross*x)))));
    const bases = samples.map(im=>median(Array.from({length:8},(_,i)=>edge(im,i))));
    const result = samples.map((im,i)=>{
      const limit=Math.floor(im.length*.23),base=bases[i],shared=bases.filter(b=>Math.abs(b-base)<5).length>=2;
      let top=0,bottom=0;
      const run=(reverse)=>{
        let misses=0;
        for(let n=0;n<=limit;n++){
          const y=reverse?im.length-1-n:n;
          if(Math.abs(edge(im,y)-base)>9)misses++;else misses=0;
          if(misses===3)return n-2;
        }
        return 0;
      };
      const hasControls=(from,to)=>{
        let details=0;
        for(let y=from;y<to;y+=3)for(let x=6;x<im.cross-6;x+=3)if(Math.abs(pixel(im,y,x)-base)>28)details++;
        return details>=24;
      };
      if(shared){
        const n=run(false);
        if(n>=im.length*.035&&hasControls(0,n))top=n;
        if(top){const n=run(true);if(n>=im.length*.025&&hasControls(im.length-n,im.length))bottom=n;}
      }
      return {start:top,end:bottom,sticky:0};
    });
    // A sticky page header is cropped only if its entire band also appears
    // inside an earlier screenshot, with text detail and a full-width separator.
    samples.forEach((im,i)=>{
      const start=result[i].start;if(!start||!i)return;
      const w=im.cross,from=start+4,base=median(Array.from({length:w-8},(_,x)=>pixel(im,from,x+4)));
      for(let end=start+Math.max(32,Math.round(im.length*.018));end<start+im.length*.085;end++){
        let border=0;
        for(let x=4;x<w-4;x++)if(Math.abs(pixel(im,end,x)-base)>18)border++;
        if(border/(w-8)<.9)continue;
        let detail=0;
        for(let y=from;y<end-2;y+=5)for(let x=6;x<w-6;x+=4)if(Math.abs(pixel(im,y,x)-base)>35)detail++;
        if(detail<20)continue;
        const height=end-from;
        let best=Infinity;
        for(let j=Math.max(0,i-1);j<i;j++){
          const prev=samples[j];if(prev.cross!==w)continue;
          for(let offset=result[j].start+20;offset<prev.length-result[j].end-height;offset++){
            let error=0,count=0;
            for(let y=0;y<height;y+=6)for(let x=4;x<w-4;x+=4){error+=Math.abs(pixel(im,from+y,x)-pixel(prev,offset+y,x));count++;}
            best=Math.min(best,error/count);
          }
        }
        if(best<2){
          let boundary=end;
          while(boundary<end+8&&Math.abs(median(Array.from({length:w-8},(_,x)=>pixel(im,boundary,x+4)))-base)>9)boundary++;
          result[i].sticky=boundary-start;result[i].start=boundary;
        }
        break;
      }
    });
    return result;
  }
  function match(a, b) {
    const w = a.cross, max = Math.min(a.length, b.length) - 3;
    if (a.cross !== b.cross || max < 12) return { overlap: 0, status: 'unmatched', score: 0 };
    const candidates = [];
    for (let n = 12; n <= max; n++) {
      let sum = 0, energy = 0, count = 0, bad = 0;
      const step = Math.max(1, Math.floor(n / 55));
      for (let y = 1; y < n - 1; y += step) {
        for (let x = 3; x < w - 3; x += 2) {
          const ia = (a.length - n + y) * w + x, ib = y * w + x;
          const gradient = Math.abs(a.pixels[ia] - a.pixels[ia - 2]);
          if (gradient < 9 && Math.abs(a.pixels[ia] - a.pixels[ia - w]) < 9) continue;
          const diff = Math.abs(a.pixels[ia] - b.pixels[ib]);
          sum += Math.min(diff, 90); energy += gradient; bad += diff > 26 ? 1 : 0; count++;
        }
      }
      if (count > Math.max(26, n * .45)) candidates.push({ n, error: sum / count, information: energy / count, bad: bad / count });
    }
    candidates.sort((a, b) => a.error - b.error);
    if (!candidates.length) return { overlap: 0, status: 'unmatched', score: 0 };
    const best = candidates[0], next = candidates.find(c => Math.abs(c.n - best.n) > 4);
    const gap = next ? next.error - best.error : 0;
    const strong = best.error < 10 && best.bad < .10 && gap > 5 && best.information > 13;
    const possible = best.error < 25;
    return { overlap: possible ? Math.round(best.n / a.ratio) : 0, status: strong ? 'high' : possible ? 'uncertain' : 'unmatched', score: Math.max(0, Math.round(100 - best.error * 2)), error: best.error, gap, candidates: candidates.filter((c,i,all)=>all.slice(0,i).every(p=>Math.abs(p.n-c.n)>2)).slice(0,6).map(c=>Math.round(c.n/a.ratio)) };
  }
  // Verify at original scroll-axis resolution, after coarse downsampled search.
  function refine(a,b,coarse){
    const w=a.cross,max=Math.min(a.length,b.length)-1;
    if(w!==b.cross||max<16)return {overlap:0,status:'unmatched',score:0};
    const seeds=(coarse.candidates||[coarse.overlap]).filter(n=>n>0),radius=Math.max(3,Math.ceil(2.5/(coarse.ratio||1))),tested=new Set(),scores=[];
    for(const seed of seeds)for(let n=Math.max(16,seed-radius);n<=Math.min(max,seed+radius);n++){
      if(tested.has(n))continue;tested.add(n);let error=0,bad=0,count=0,rows=0,dot=0,normA=0,normB=0,denseError=0,denseCount=0;
      for(let y=2;y<n-2;y+=Math.max(1,Math.floor(n/160))){let rowCount=0;
        for(let x=3;x<w-3;x+=2){const ia=(a.length-n+y)*w+x,ib=y*w+x;
          denseError+=Math.abs(a.pixels[ia]-b.pixels[ib]);denseCount++;
          const ga=Math.abs(a.pixels[ia]-a.pixels[ia-2])+Math.abs(a.pixels[ia]-a.pixels[ia-w]);
          const gb=Math.abs(b.pixels[ib]-b.pixels[ib-2])+Math.abs(b.pixels[ib]-b.pixels[ib-w]);
          if(Math.max(ga,gb)<18)continue;dot+=ga*gb;normA+=ga*ga;normB+=gb*gb;const diff=Math.abs(a.pixels[ia]-b.pixels[ib]);error+=Math.min(diff,100);bad+=diff>24?1:0;count++;rowCount++;
        }
        if(rowCount>=3){rows++;}
      }

      if(count>=32&&rows>=6)scores.push({n,error:error/count,bad:bad/count,denseError:denseError/denseCount,correlation:dot/Math.sqrt(normA*normB||1),rows,count});
    }
    scores.sort((a,b)=>a.error-b.error);if(!scores.length)return {overlap:coarse.overlap||0,status:'uncertain',score:0};
    const best=scores[0],next=scores.find(s=>Math.abs(s.n-best.n)>3),gap=next?next.error-best.error:100;
    const enoughDetail=best.count>=100;
    const high=enoughDetail ? best.error<7&&best.bad<.06&&gap>3&&best.correlation>.94 : best.rows>=8&&best.error<1&&best.denseError<.5&&best.bad<.005&&gap>12&&best.correlation>.995;
    return {overlap:best.n,status:high?'high':'uncertain',score:Math.max(0,Math.round(100-best.error*3)),error:best.error,gap,correlation:best.correlation,bad:best.bad};
  }
  function sequence(ids, pairs) {
    const next = new Map(), previous = new Map();
    const edges = pairs.filter(p => p.result.status === 'high').sort((a,b) => b.result.score - a.result.score);
    for (const edge of edges) {
      if (next.has(edge.a) || previous.has(edge.b)) continue;
      let cursor = edge.b;
      while (next.has(cursor)) cursor = next.get(cursor);
      if (cursor === edge.a) continue;
      next.set(edge.a, edge.b); previous.set(edge.b, edge.a);
    }
    const groups = [];
    for (const id of ids) {
      if (previous.has(id)) continue;
      const group = [id];
      while (next.has(group[group.length - 1])) group.push(next.get(group[group.length - 1]));
      groups.push(group);
    }
    return groups;
  }
  function plan(images, seams, direction, crop = { start: 0, end: 0 }, bars = { start: 0, end: 0 }, trims = {}) {
    if (!images.length) return { width: 0, height: 0, length: 0, segments: [] };
    const vertical = direction === 'vertical';
    const cross = vertical ? images[0].width : images[0].height;
    const starts = images.map((im, i) => (i ? bars.start : 0) + (trims[im.id]?.start || 0));
    const ends = images.map((im, i) => (vertical ? im.height : im.width) - (i < images.length - 1 ? bars.end : 0) - (trims[im.id]?.end || 0));
    const lengths = ends.map((end,i) => end - starts[i]);
    for (let i = 0; i < images.length - 1; i++) {
      const s = seams.find(s => s.beforeId === images[i].id && s.afterId === images[i+1].id);
      if (!s || !s.confirmed || !s.overlap) continue;
      const overlap = Math.round(s.overlap), cut = Math.round(s.cut);
      if (overlap < 0 || overlap >= Math.min(lengths[i], lengths[i+1])) throw new Error('重叠长度超出有效图片范围');
      if (cut < 0 || cut > overlap) throw new Error('接缝位置超出重叠范围');
      ends[i] -= overlap - cut; starts[i+1] += cut;
    }
    let offset = 0;
    const segments = images.map((im, i) => {
      if ((vertical ? im.width : im.height) !== cross) throw new Error(vertical ? '请使用相同宽度的截图' : '横向拼接需要相同高度的截图');
      if (starts[i] < 0 || ends[i] <= starts[i]) throw new Error(`第 ${i+1} 张已被裁空，请减小重叠或裁剪范围`);
      const result = { imageId: im.id, start: starts[i], end: ends[i], offset, length: ends[i] - starts[i] };
      offset += result.length;
      return result;
    });
    if (crop.start < 0 || crop.end < 0 || crop.start + crop.end >= offset) throw new Error('裁剪范围超出长图');
    const length = offset - crop.start - crop.end;
    const clipped = segments.map(s => {
      const from = Math.max(s.offset, crop.start), to = Math.min(s.offset + s.length, offset - crop.end);
      return { ...s, start: s.start + Math.max(0, from - s.offset), end: s.start + Math.max(0, to - s.offset), length: Math.max(0, to - from), offset: from - crop.start };
    }).filter(s => s.length > 0);
    return { width: vertical ? cross : length, height: vertical ? length : cross, length, cross, segments: clipped };
  }
  const api = { match, refine, sequence, plan, detectBars };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.StitchCore = api;
})(typeof self !== 'undefined' ? self : globalThis);
