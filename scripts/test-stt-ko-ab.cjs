/**
 * test-stt-ko-ab.cjs — A/B Moonshine base-ko (đang dùng) vs SenseVoice-Small (sherpa-native, non-autoregressive)
 * trên CÙNG audio: 20 clip FLEURS ko_kr (giọng người thật) + 10 clip IT/họp TTS. So RAW output (chưa hậu xử lý)
 * với transcript chuẩn để cô lập độ chính xác acoustic/lexical. Báo char-overlap + RTF + soi lỗi substitution.
 *
 * node scripts/test-stt-ko-ab.cjs    (cần internet để lấy ref FLEURS; clip wav đã có sẵn ở temp từ test trước)
 */
require('onnxruntime-node');                 // PHẢI trước sherpa (dlopen)
const fs = require('fs');
const os = require('os');
const path = require('path');
const https = require('https');
const sherpa = require('sherpa-onnx-node');
const { createMoonshine } = require('../src/stt-moonshine');

const SV_DIR = path.join(__dirname, '..', 'bin', 'stt', 'sense-voice');
const KO_DIR = path.join(__dirname, '..', 'bin', 'stt', 'ko');
const IT_DIR = 'C:/Users/OS/AppData/Local/Temp/ct-test-ko';
const FL_DIR = 'C:/Users/OS/AppData/Local/Temp/ct-fleurs-ko';

// Ref cho 10 clip IT/họp (khớp scripts/test-stt-ko.js).
const IT_REF = [
  '안녕하세요, 오늘 정기 회의를 시작하겠습니다. 오늘 논의할 주요 안건은 다음 분기 사업 계획과 예산 배정입니다.',
  '이번 분기 매출이 이십오억 원으로 전년 동기 대비 십이 퍼센트 증가했습니다. 특히 온라인 채널의 성장이 두드러졌습니다.',
  '그렇다면 결론을 내리겠습니다. 첫째 마케팅 예산을 삼십 퍼센트 증액하고, 둘째 신규 채용은 내년 상반기로 연기합니다.',
  '혹시 이 부분에 대해서 조금 더 설명해 주실 수 있으신가요? 특히 비용 대비 효과 측면에서 어떻게 계획하고 계신지 궁금합니다.',
  '오늘 오후 여섯 시에 프로덕션 서버 배포를 진행하겠습니다. 배포 전 체크리스트를 다시 한번 확인해 주시기 바랍니다.',
  '현재 API 서버에서 간헐적으로 오백 삼 에러가 발생하고 있습니다. 로그를 분석한 결과 데이터베이스 커넥션 풀이 고갈되는 것이 원인입니다.',
  '풀 리퀘스트 검토 결과, 전반적인 코드 품질은 양호하지만 예외 처리 부분이 미흡합니다. 특히 네트워크 오류 발생 시 재시도 로직이 없습니다.',
  '쿠버네티스 클러스터의 노드 중 하나가 다운되었습니다. 자동으로 다른 노드로 페일오버가 완료되었으며, 서비스 중단 시간은 약 삼 초입니다.',
  '과학기술정보통신부는 오늘 인공지능 기술 개발에 이천억 원을 추가 투자하겠다고 발표했습니다. 이번 투자는 주로 대규모 언어 모델 연구와 반도체 에이아이 칩 개발에 집중될 예정입니다.',
  '지난 삼 년 동안 우리 회사는 디지털 전환을 위해 많은 노력을 기울여 왔습니다. 클라우드 마이그레이션을 완료하고, 마이크로서비스 아키텍처를 도입하며, 데브옵스 문화를 정착시켰습니다. 그 결과 개발 주기가 기존 삼 개월에서 이 주일로 단축되었고, 서비스 가용성도 구십구 점 구 퍼센트로 향상되었습니다.',
];

function get(url, redir = 6) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    https.get({ hostname: u.hostname, path: u.pathname + u.search, headers: { 'User-Agent': 'ct/1.0', Accept: '*/*' } }, res => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode)) { res.resume(); return get(new URL(res.headers.location, url).toString(), redir - 1).then(resolve, reject); }
      if (res.statusCode !== 200) { res.resume(); return reject(new Error('HTTP ' + res.statusCode)); }
      const ch = []; res.on('data', c => ch.push(c)); res.on('end', () => resolve(Buffer.concat(ch))); res.on('error', reject);
    }).on('error', reject);
  });
}

function readWav16(p) {
  const buf = fs.readFileSync(p);
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const numCh = view.getUint16(22, true);
  let off = 44;
  for (let i = 12; i < Math.min(buf.length - 8, 1024);) { const id = buf.toString('ascii', i, i + 4); const sz = view.getUint32(i + 4, true); if (id === 'data') { off = i + 8; break; } i += 8 + sz + (sz & 1); }
  const n = Math.floor((buf.length - off) / 2 / numCh);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = view.getInt16(off + i * numCh * 2, true) / 32768;
  return out;
}

const _normRe = /[\s.,!?。、！？·"'""''()\[\]<>|]/g;
function charOverlap(ref, hyp) {
  const norm = s => (s || '').replace(_normRe, '');
  const rc = new Set([...norm(ref)]), hc = new Set([...norm(hyp)]);
  if (!rc.size || !hc.size) return 0;
  let c = 0; for (const x of rc) if (hc.has(x)) c++;
  return c / Math.max(rc.size, hc.size);
}
function stripTags(s) { return (s || '').replace(/<\|[^|]*\|>/g, '').replace(/\s+/g, ' ').trim(); }

(async () => {
  // Model files
  const svModel = ['model.int8.onnx', 'model.onnx'].map(f => path.join(SV_DIR, f)).find(fs.existsSync);
  const svTokens = path.join(SV_DIR, 'tokens.txt');
  if (!svModel || !fs.existsSync(svTokens)) { console.error('SenseVoice model thiếu ở', SV_DIR, '— files:', fs.existsSync(SV_DIR) ? fs.readdirSync(SV_DIR) : 'NO DIR'); process.exit(1); }
  console.log('SenseVoice model:', path.basename(svModel));

  const moon = await createMoonshine(KO_DIR, { threads: 2 });
  const sv = new sherpa.OfflineRecognizer({
    featConfig: { sampleRate: 16000, featureDim: 80 },
    modelConfig: { senseVoice: { model: svModel, language: 'ko', useInverseTextNormalization: 1 }, tokens: svTokens, numThreads: 2, provider: 'cpu', debug: 0 },
  });
  const svTranscribe = (samples) => { const st = sv.createStream(); st.acceptWaveform({ samples, sampleRate: 16000 }); sv.decode(st); return stripTags(sv.getResult(st).text); };

  // Lấy ref FLEURS (audio đã có local f_0..f_19.wav)
  let flRef = [];
  try {
    const data = JSON.parse((await get('https://datasets-server.huggingface.co/rows?dataset=google/fleurs&config=ko_kr&split=test&offset=0&length=20')).toString('utf8'));
    flRef = data.rows.map(r => r.row.raw_transcription || r.row.transcription || '');
  } catch (e) { console.warn('FLEURS ref fetch lỗi:', e.message, '— bỏ qua set FLEURS'); }

  const sets = [];
  const flClips = [];
  for (let i = 0; i < flRef.length; i++) { const p = path.join(FL_DIR, `f_${i}.wav`); if (fs.existsSync(p)) flClips.push({ wav: p, ref: flRef[i], tag: `FL${i}` }); }
  if (flClips.length) sets.push({ name: 'FLEURS (giọng người thật)', clips: flClips });
  const itClips = [];
  for (let i = 0; i < IT_REF.length; i++) { const p = path.join(IT_DIR, `ko_${i + 1}.wav`); if (fs.existsSync(p)) itClips.push({ wav: p, ref: IT_REF[i], tag: `IT${i + 1}` }); }
  if (itClips.length) sets.push({ name: 'IT/họp (TTS)', clips: itClips });

  const agg = { moon: { acc: 0, ms: 0, sec: 0, n: 0 }, sv: { acc: 0, ms: 0, sec: 0, n: 0 } };
  for (const set of sets) {
    console.log(`\n${'='.repeat(70)}\n${set.name} — ${set.clips.length} clip\n${'='.repeat(70)}`);
    const sub = { moon: 0, sv: 0, n: 0 };
    for (const c of set.clips) {
      const samples = readWav16(c.wav); const sec = samples.length / 16000;
      let t = Date.now(); const mRaw = await moon.transcribe(samples); const mMs = Date.now() - t;
      t = Date.now(); const sRaw = svTranscribe(samples); const sMs = Date.now() - t;
      const mAcc = charOverlap(c.ref, mRaw), sAcc = charOverlap(c.ref, sRaw);
      agg.moon.acc += mAcc; agg.moon.ms += mMs; agg.moon.sec += sec; agg.moon.n++;
      agg.sv.acc += sAcc; agg.sv.ms += sMs; agg.sv.sec += sec; agg.sv.n++;
      sub.moon += mAcc; sub.sv += sAcc; sub.n++;
      const win = sAcc > mAcc + 0.02 ? ' SV+' : mAcc > sAcc + 0.02 ? ' MOON+' : ' ~';
      console.log(`\n[${c.tag}] ${sec.toFixed(1)}s  Moon ${Math.round(mAcc * 100)}% (rtf ${(mMs / 1000 / sec).toFixed(2)}) | SV ${Math.round(sAcc * 100)}% (rtf ${(sMs / 1000 / sec).toFixed(2)})${win}`);
      console.log(`   REF : ${c.ref}`);
      console.log(`   MOON: ${mRaw}`);
      console.log(`   SV  : ${sRaw}`);
    }
    console.log(`\n  → ${set.name}: Moon ${Math.round(sub.moon / sub.n * 100)}% | SV ${Math.round(sub.sv / sub.n * 100)}%`);
  }

  console.log(`\n${'#'.repeat(70)}\nTỔNG (${agg.moon.n} clip):`);
  console.log(`  Moonshine : ${Math.round(agg.moon.acc / agg.moon.n * 100)}% char-overlap | avg RTF ${(agg.moon.ms / 1000 / agg.moon.sec).toFixed(3)}`);
  console.log(`  SenseVoice: ${Math.round(agg.sv.acc / agg.sv.n * 100)}% char-overlap | avg RTF ${(agg.sv.ms / 1000 / agg.sv.sec).toFixed(3)}`);
})().catch(e => { console.error('FATAL:', e.message, e.stack); process.exit(1); });
