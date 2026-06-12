// test-full-pipeline.cjs — STT streaming 5 ngôn ngữ (độ chuẩn + cắt câu) + dịch (server thật) qua audio-stt.
require('onnxruntime-node');
const fs = require('fs'), Module = require('module');

// ── mock state/caption-service; DÙNG translation THẬT (hit llama-server 8080) ──
const events = [];
const fakeState = { provider: 'local', targetLang: 'Vietnamese', localBaseUrl: 'http://127.0.0.1:8080',
  captureSource: 'system', audioPaused: false, audioEntryId: 0,
  win: { webContents: { send: (ch, d) => { if (ch === 'caption-live') events.push({ t: Date.now(), ...d }); } } } };
const orig = Module._load;
Module._load = function (req) {
  if (req === './state') return fakeState;
  if (req === './caption-service') return { timestamp: () => '00:00' };
  return orig.apply(this, arguments);
};
const audio = require('../src/audio-stt');
const stt = require('../src/stt');

function rw(p){const b=fs.readFileSync(p);const v=new DataView(b.buffer,b.byteOffset,b.byteLength);const nc=v.getUint16(22,true);let o=44;for(let i=12;i<Math.min(b.length-8,1024);){const id=b.toString('ascii',i,i+4);const s=v.getUint32(i+4,true);if(id==='data'){o=i+8;break;}i+=8+s+(s&1);}const n=Math.floor((b.length-o)/2/nc);const out=new Float32Array(n);for(let i=0;i<n;i++)out[i]=v.getInt16(o+i*nc*2,true)/32768;return out;}
const sleep = ms => new Promise(r => setTimeout(r, ms));
function norm(s){return (s||'').toLowerCase().replace(/[\s\p{P}\p{S}]/gu,'');}
function lev(a,b){const m=a.length,n=b.length;if(!m)return n;if(!n)return m;let p=Array.from({length:n+1},(_,i)=>i);for(let i=1;i<=m;i++){let prev=p[0];p[0]=i;for(let j=1;j<=n;j++){const t=p[j];p[j]=Math.min(p[j]+1,p[j-1]+1,prev+(a[i-1]===b[j-1]?0:1));prev=t;}}return p[n];}
function acc(hyp,ref){const a=norm(hyp),b=norm(ref);if(!b)return null;return Math.max(0,1-lev(a,b)/Math.max(a.length,b.length));}

const T='C:/Users/OS/AppData/Local/Temp';
const fm=JSON.parse(fs.readFileSync(T+'/ct-fleurs-multi/refs.json','utf8'));
const zv=JSON.parse(fs.readFileSync(T+'/ct-test-zhvi/refs.json','utf8'));
const CASES=[
  {lang:'vi', clips:[[T+'/ct-test-zhvi/vi_1.wav',zv.vi[0]],[T+'/ct-test-zhvi/vi_2.wav',zv.vi[1]],[T+'/ct-test-zhvi/vi_3.wav',zv.vi[2]]]},
  {lang:'zh-CN', code:'zh', clips:[[T+'/ct-test-zhvi/zh_1.wav',zv.zh[0]],[T+'/ct-test-zhvi/zh_2.wav',zv.zh[1]],[T+'/ct-test-zhvi/zh_3.wav',zv.zh[2]]]},
  {lang:'ja', clips: fm.ja.slice(0,3).map(([p,t])=>[p.replace(/\\/g,'/'),t])},
  {lang:'en', clips: fm.en.slice(0,3).map(([p,t])=>[p.replace(/\\/g,'/'),t])},
  {lang:'ko', clips:[[T+'/ct-fleurs-ko/f_0.wav',null],[T+'/ct-fleurs-ko/f_1.wav',null],[T+'/ct-fleurs-ko/f_2.wav',null]]},
];

async function runClip(wav){
  const idStart=fakeState.audioEntryId, evStart=events.length;   // KHÔNG clear events; lọc theo id>idStart (tránh lẫn clip)
  const s=rw(wav); const dur=s.length/16000; const FR=4000;
  const t0=Date.now();
  for(let i=0;i<s.length;i+=FR){ audio.handlePcm(s.subarray(i,Math.min(i+FR,s.length))); await sleep(25); }
  const sil=new Float32Array(FR); for(let k=0;k<8;k++){ audio.handlePcm(sil); await sleep(25); }   // im lặng → endpoint chốt
  // CHỜ tới khi caption-live NGỪNG (idle 2.5s) → đảm bảo endpoint đã chốt MỌI câu + dịch xong (kể cả clip nhiều câu)
  const finalizedOf=()=>{ const m=new Map(); for(const e of events.slice(evStart)) if(e.id>idStart && !e.isPartial) m.set(e.id,e); return [...m.values()]; };
  let last=events.length, idle=0;
  while(idle<2500 && Date.now()-t0<40000){ await sleep(300); if(events.length!==last){last=events.length;idle=0;}else idle+=300; }
  const procMs=Date.now()-t0;
  const committed=finalizedOf().map(e=>({original:e.original, translated:e.translated}));
  // KHÔNG resetSegmentation giữa clip: endpoint (im lặng) đã tự sess.reset(). Reset thủ công lúc pump async còn
  // drain = artifact (nuốt session). Chỉ chờ thêm cho pump drain hẳn trước clip kế.
  await sleep(500);
  return { dur, sttMs:procMs, committed };
}

(async()=>{
  await stt.warm();
  console.log('\n================= STT STREAMING + CẮT CÂU + DỊCH (full pipeline) =================');
  const accAll={};
  for(const c of CASES){
    stt.setLanguage(c.lang);
    console.log('\n########## '+c.lang.toUpperCase()+' ##########');
    const accs=[];
    for(const [wav,ref] of c.clips){
      if(!fs.existsSync(wav)){console.log('  (thiếu '+wav+')');continue;}
      const r=await runClip(wav);
      const hypFull=r.committed.map(x=>x.original).join(' ');
      const a=ref?acc(hypFull,ref):null; if(a!=null)accs.push(a);
      console.log('\n  ▶ '+wav.split('/').pop()+'  ('+r.dur.toFixed(1)+'s, xử lý '+r.sttMs+'ms, '+r.committed.length+' câu chốt'+(a!=null?', STT acc '+(a*100).toFixed(0)+'%':'')+')');
      r.committed.forEach(x=>console.log('     • "'+x.original+'"\n       → '+x.translated));
      if(ref) console.log('     [ref] '+ref);
    }
    if(accs.length) accAll[c.lang]=(accs.reduce((a,b)=>a+b,0)/accs.length*100).toFixed(1);
  }
  console.log('\n================= STT ACCURACY TRUNG BÌNH (char-level vs ref) =================');
  for(const [k,v] of Object.entries(accAll)) console.log('  '+k+': '+v+'%');
  console.log('  (ko: không có ref — xem output thủ công)');
  process.exit(0);
})().catch(e=>{console.error('LỖI:',e);process.exit(1);});
