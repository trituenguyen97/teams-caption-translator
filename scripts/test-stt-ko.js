#!/usr/bin/env node
/**
 * test-stt-ko.js — A/B test Korean STT: Moonshine offline (app) vs Windows Live Captions
 *
 * Tạo clip Korean TTS (edge-tts) cho 10 kịch bản hội họp + IT → chạy qua Moonshine → báo kết quả.
 * Chế độ --with-lc: phát audio qua loa + đọc LC qua UI Automation → so sánh 2 chiều.
 *
 * Dùng: node scripts/test-stt-ko.js [--with-lc] [--regen] [--clip N]
 *   --with-lc   : Bật so sánh LC (cần LC đang chạy + model ko-KR đã cài)
 *   --regen     : Tái tạo file WAV dù đã có (dùng khi đổi kịch bản)
 *   --clip N    : Chỉ chạy clip số N (1-based)
 */
'use strict';

// ⚠️ BẮT BUỘC: ort phải load TRƯỚC sherpa — xem main.js và korean-stt-moonshine memory
try { require('onnxruntime-node'); } catch (e) { console.warn('[test-ko] ort preload lỗi:', e.message); }

const path = require('path');
const fs   = require('fs');
const os   = require('os');
const { execFileSync, execSync, spawn } = require('child_process');

const ROOT     = path.join(__dirname, '..');
const BIN_KO   = path.join(ROOT, 'bin', 'stt', 'ko');
const CLIPS_DIR = path.join(os.tmpdir(), 'ct-test-ko');
const ARGS     = new Set(process.argv.slice(2));
const WITH_LC  = ARGS.has('--with-lc');
const REGEN    = ARGS.has('--regen');
const CLIP_N   = (() => { for (const a of ARGS) { const m = /^--clip=?(\d+)$/.exec(a); if (m) return parseInt(m[1]); } return null; })();

// ── Kịch bản test ──────────────────────────────────────────────────────────────────
// domain: 'meeting' | 'it' | 'complex'
// voice: 'ko-KR-InJoonNeural' (male) | 'ko-KR-SunHiNeural' (female) — đổi để test giọng đa dạng
const CLIPS = [
  // ── HỘI HỌP (MEETING) ──────────────────────────────────────────────────
  {
    id: 1, domain: 'meeting', voice: 'ko-KR-SunHiNeural',
    label: '회의 시작 — Meeting opener',
    text: '안녕하세요, 오늘 정기 회의를 시작하겠습니다. 오늘 논의할 주요 안건은 다음 분기 사업 계획과 예산 배정입니다.',
    note: '기본 회의 오프닝. 자연스러운 속도.',
  },
  {
    id: 2, domain: 'meeting', voice: 'ko-KR-InJoonNeural',
    label: '실적 발표 — Numbers in meeting',
    text: '이번 분기 매출이 이십오억 원으로 전년 동기 대비 십이 퍼센트 증가했습니다. 특히 온라인 채널의 성장이 두드러졌습니다.',
    note: '숫자+퍼센트 — Moonshine가 숫자를 어떻게 처리하는지 확인.',
  },
  {
    id: 3, domain: 'meeting', voice: 'ko-KR-SunHiNeural',
    label: '의사결정 — Decision + action items',
    text: '그렇다면 결론을 내리겠습니다. 첫째 마케팅 예산을 삼십 퍼센트 증액하고, 둘째 신규 채용은 내년 상반기로 연기합니다.',
    note: '열거형 문장 + 숫자. 첫째/둘째 구분 잘 되는지.',
  },
  {
    id: 4, domain: 'meeting', voice: 'ko-KR-InJoonNeural',
    label: '질문 — Q&A during meeting',
    text: '혹시 이 부분에 대해서 조금 더 설명해 주실 수 있으신가요? 특히 비용 대비 효과 측면에서 어떻게 계획하고 계신지 궁금합니다.',
    note: '의문문. 정중체.',
  },
  // ── IT 도메인 ────────────────────────────────────────────────────────────
  {
    id: 5, domain: 'it', voice: 'ko-KR-SunHiNeural',
    label: '배포 공지 — Deployment notice',
    text: '오늘 오후 여섯 시에 프로덕션 서버 배포를 진행하겠습니다. 배포 전 체크리스트를 다시 한번 확인해 주시기 바랍니다.',
    note: '한국어+영어 혼합 IT 어휘 (프로덕션, 체크리스트).',
  },
  {
    id: 6, domain: 'it', voice: 'ko-KR-InJoonNeural',
    label: '버그 리포트 — Bug report with error codes',
    text: '현재 API 서버에서 간헐적으로 오백 삼 에러가 발생하고 있습니다. 로그를 분석한 결과 데이터베이스 커넥션 풀이 고갈되는 것이 원인입니다.',
    note: 'API/에러코드/기술 용어. 503 → 오백 삼 인식 여부.',
  },
  {
    id: 7, domain: 'it', voice: 'ko-KR-SunHiNeural',
    label: '코드 리뷰 — Code review feedback',
    text: '풀 리퀘스트 검토 결과, 전반적인 코드 품질은 양호하지만 예외 처리 부분이 미흡합니다. 특히 네트워크 오류 발생 시 재시도 로직이 없습니다.',
    note: '풀 리퀘스트/예외 처리/재시도 로직 — SW 개발 어휘.',
  },
  {
    id: 8, domain: 'it', voice: 'ko-KR-InJoonNeural',
    label: '인프라 알람 — K8s incident',
    text: '쿠버네티스 클러스터의 노드 중 하나가 다운되었습니다. 자동으로 다른 노드로 페일오버가 완료되었으며, 서비스 중단 시간은 약 삼 초입니다.',
    note: '쿠버네티스/페일오버/클러스터 — 인프라 어휘.',
  },
  // ── 복잡/뉴스 도메인 ──────────────────────────────────────────────────────
  {
    id: 9, domain: 'complex', voice: 'ko-KR-SunHiNeural',
    label: '뉴스 스타일 — Fast news speech',
    text: '과학기술정보통신부는 오늘 인공지능 기술 개발에 이천억 원을 추가 투자하겠다고 발표했습니다. 이번 투자는 주로 대규모 언어 모델 연구와 반도체 에이아이 칩 개발에 집중될 예정입니다.',
    note: '기관명/기술 용어. 이천억 원, 에이아이. 빠른 뉴스 속도.',
  },
  {
    id: 10, domain: 'complex', voice: 'ko-KR-InJoonNeural',
    label: '긴 발언 — Long utterance (tests maxSpeech 8s boundary)',
    text: '지난 삼 년 동안 우리 회사는 디지털 전환을 위해 많은 노력을 기울여 왔습니다. 클라우드 마이그레이션을 완료하고, 마이크로서비스 아키텍처를 도입하며, 데브옵스 문화를 정착시켰습니다. 그 결과 개발 주기가 기존 삼 개월에서 이 주일로 단축되었고, 서비스 가용성도 구십구 점 구 퍼센트로 향상되었습니다.',
    note: '긴 문장 (~8-10s). VAD maxSpeech=8s boundary — completeness 확인.',
  },
];

// ── Helpers ────────────────────────────────────────────────────────────────────────
function hr(ch = '─', len = 72) { return ch.repeat(len); }
function pad(s, n) { return String(s).padEnd(n); }
function bold(s)  { return `\x1b[1m${s}\x1b[0m`; }
function green(s) { return `\x1b[32m${s}\x1b[0m`; }
function yellow(s){ return `\x1b[33m${s}\x1b[0m`; }
function red(s)   { return `\x1b[31m${s}\x1b[0m`; }
function cyan(s)  { return `\x1b[36m${s}\x1b[0m`; }

/** Sinh audio MP3 bằng edge-tts rồi convert sang WAV 16kHz mono bằng ffmpeg (hoặc Python fallback). */
async function generateWav(clip) {
  const mp3 = path.join(CLIPS_DIR, `ko_${clip.id}.mp3`);
  const wav = path.join(CLIPS_DIR, `ko_${clip.id}.wav`);
  if (!REGEN && fs.existsSync(wav)) return wav;
  // edge-tts → MP3
  const ttsArgs = ['--voice', clip.voice, '--text', clip.text, '--write-media', mp3];
  try { execFileSync('edge-tts', ttsArgs, { stdio: 'pipe' }); }
  catch (e) { throw new Error(`edge-tts lỗi (cần pip install edge-tts): ${e.message}`); }
  // ffmpeg → WAV 16kHz mono
  const ffmpegArgs = ['-y', '-i', mp3, '-ar', '16000', '-ac', '1', '-f', 'wav', wav];
  try {
    execFileSync('ffmpeg', ffmpegArgs, { stdio: 'pipe' });
  } catch {
    // fallback: Python scipy.io.wavfile + MP3 decode qua pydub
    const py = `
import sys, os
try:
    from pydub import AudioSegment
    seg = AudioSegment.from_mp3(sys.argv[1]).set_frame_rate(16000).set_channels(1)
    seg.export(sys.argv[2], format='wav')
except Exception as e:
    print('pydub lỗi:', e, file=sys.stderr)
    sys.exit(1)
`;
    try {
      execFileSync('python', ['-c', py, mp3, wav], { stdio: 'inherit' });
    } catch (e2) {
      throw new Error(`Convert MP3→WAV lỗi. Cài ffmpeg (winget install Gyan.FFmpeg): ${e2.message}`);
    }
  }
  try { fs.unlinkSync(mp3); } catch {}
  return wav;
}

/** Đọc WAV → Float32Array @16kHz. */
function readWav(wavPath) {
  const buf = fs.readFileSync(wavPath);
  // WAV header: 44 bytes chuẩn (PCM). Đọc số kênh, sample rate, bit depth.
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const numCh    = view.getUint16(22, true);
  const sr       = view.getUint32(24, true);
  const bitsPerSample = view.getUint16(34, true);
  // Tìm data chunk (có thể có LIST chunk trước)
  let dataOffset = 44;
  for (let i = 12; i < Math.min(buf.length - 8, 512); ) {
    const id = buf.toString('ascii', i, i + 4);
    const sz = view.getUint32(i + 4, true);
    if (id === 'data') { dataOffset = i + 8; break; }
    i += 8 + sz + (sz & 1);
  }
  const rawLen = (buf.length - dataOffset);
  const bytesPerSample = bitsPerSample / 8;
  const totalSamples = Math.floor(rawLen / bytesPerSample);
  const samplesPerCh = Math.floor(totalSamples / numCh);
  // Lấy kênh 1 (mono), convert về float32 [-1,1]
  const out = new Float32Array(samplesPerCh);
  const scale = bitsPerSample === 16 ? 32768 : (bitsPerSample === 32 ? 2147483648 : 1);
  for (let i = 0; i < samplesPerCh; i++) {
    const off = dataOffset + i * numCh * bytesPerSample;
    let v;
    if (bitsPerSample === 16) v = view.getInt16(off, true);
    else if (bitsPerSample === 32) v = view.getInt32(off, true);
    else v = view.getUint8(off) - 128;
    out[i] = v / scale;
  }
  if (sr !== 16000) console.warn(`[readWav] WAV sample rate ${sr} ≠ 16000 — Moonshine cần 16kHz`);
  return { samples: out, sampleRate: sr, durationSec: samplesPerCh / sr };
}

/** Đơn giản tính word-level accuracy: số token chung / max(ref,hyp). */
function roughAccuracy(ref, hyp) {
  if (!ref || !hyp) return 0;
  const rw = ref.replace(/[.,!?、。！？]/g, '').split(/\s+/).filter(Boolean);
  const hw = hyp.replace(/[.,!?、。！？]/g, '').split(/\s+/).filter(Boolean);
  if (!rw.length || !hw.length) return 0;
  // token-level set overlap (Korean: char-level would be more accurate, use chars)
  const rc = new Set([...ref.replace(/\s/g, '')]);
  const hc = new Set([...hyp.replace(/\s/g, '')]);
  let common = 0;
  for (const c of rc) if (hc.has(c)) common++;
  return common / Math.max(rc.size, hc.size);
}

// ── LC capture (chỉ dùng khi --with-lc) ──────────────────────────────────────────
// Minimal UI Automation để đọc Windows Live Captions (test-only, không phải app integration)
function makeLcCapture() {
  if (!WITH_LC) return null;
  // Dùng PowerShell UIAutomation để đọc CaptionsTextBlock
  const PS_SCRIPT = String.raw`
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
$root = [System.Windows.Automation.AutomationElement]::RootElement
$cond = New-Object System.Windows.Automation.PropertyCondition (
  [System.Windows.Automation.AutomationElement]::AutomationIdProperty, 'CaptionsTextBlock')
function Read-LC {
  $el = $root.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $cond)
  if ($el) { $el.GetCurrentPropertyValue([System.Windows.Automation.AutomationElement]::NameProperty) }
  else { '' }
}
`.trim();
  return {
    // Đọc text LC hiện tại (blocking shell call)
    read() {
      try {
        const out = execSync(`powershell -NoProfile -NonInteractive -Command "${PS_SCRIPT}\nRead-LC"`, { encoding: 'utf8', timeout: 3000 });
        return out.trim();
      } catch { return ''; }
    },
    // Poll LC trong N giây sau khi audio phát, gom text
    async poll(durationMs) {
      const seen = new Set(); const parts = [];
      const end = Date.now() + durationMs + 3000; // 3s buffer sau audio
      while (Date.now() < end) {
        await new Promise(r => setTimeout(r, 300));
        const t = this.read();
        if (t && !seen.has(t)) { seen.add(t); parts.push(t); }
      }
      return parts.join(' ').replace(/\s+/g, ' ').trim();
    },
  };
}

/** Phát WAV qua loa (PowerShell SoundPlayer). */
function playWav(wavPath) {
  const cmd = `$p=New-Object System.Media.SoundPlayer '${wavPath.replace(/\\/g,'\\\\')}';\$p.PlaySync()`;
  return new Promise((res, rej) => {
    const ps = spawn('powershell', ['-NoProfile', '-NonInteractive', '-Command', cmd], { stdio: 'inherit' });
    ps.on('close', c => c === 0 ? res() : rej(new Error('SoundPlayer exit ' + c)));
  });
}

// ── Main ─────────────────────────────────────────────────────────────────────────
async function main() {
  console.log(bold('\n' + hr('═') + '\n  Korean STT A/B Test — Moonshine base-ko vs Windows Live Captions\n' + hr('═')));

  // Kiểm tra model
  const moonshineFiles = ['encoder_model_int8.onnx','decoder_model_merged_int8.onnx','tokenizer.json','config.json'];
  const missing = moonshineFiles.filter(f => !fs.existsSync(path.join(BIN_KO, f)));
  if (missing.length) {
    console.error(red(`\n[ERROR] Thiếu model Moonshine ko: ${missing.join(', ')}\n  → Chạy: node scripts/fetch-stt-model.js\n`));
    process.exit(1);
  }

  // Load Moonshine
  process.stdout.write('Đang tải Moonshine base-ko... ');
  const t0load = Date.now();
  const { createMoonshine } = require('../src/stt-moonshine');
  const moonshine = await createMoonshine(BIN_KO, { threads: 2 });
  console.log(green(`OK (${Date.now()-t0load}ms)\n`));

  fs.mkdirSync(CLIPS_DIR, { recursive: true });
  const lc = makeLcCapture();
  if (WITH_LC) console.log(yellow('⚠  Chế độ --with-lc bật — đảm bảo Windows Live Captions đang chạy + model ko-KR đã cài!\n'));

  const clips = CLIPS_N !== null ? CLIPS.filter(c => c.id === CLIP_N) : CLIPS;
  const results = [];

  for (const clip of clips) {
    const domainTag = { meeting:'회의', it:'IT', complex:'복잡' }[clip.domain] || clip.domain;
    console.log(hr());
    console.log(bold(`[${pad(clip.id,2)}] ${clip.label}`) + cyan(` [${domainTag}]`));
    console.log(yellow('참고:'), clip.note);
    console.log(yellow('원문:'), clip.text);

    // Sinh audio
    let wavPath;
    try {
      process.stdout.write('→ 음성 합성 중... ');
      wavPath = await generateWav(clip);
      console.log(green('OK') + ` (${wavPath})`);
    } catch (e) {
      console.error(red('FAIL'), e.message); results.push({ id:clip.id, error:e.message }); continue;
    }

    // Đọc WAV
    const { samples, durationSec } = readWav(wavPath);
    console.log(`→ 길이: ${durationSec.toFixed(1)}s | 샘플: ${samples.length.toLocaleString()}`);

    // Moonshine transcribe
    let moonText = '', moonMs = 0;
    try {
      process.stdout.write('→ Moonshine 인식 중... ');
      const t1 = Date.now();
      moonText = await moonshine.transcribe(samples);
      moonMs = Date.now() - t1;
      const rtf = (moonMs / 1000 / durationSec).toFixed(3);
      console.log(green('OK') + ` (${moonMs}ms, RTF=${rtf})`);
    } catch (e) { console.error(red('Moonshine 오류:'), e.message); }

    // LC comparison (optional)
    let lcText = '';
    if (WITH_LC && lc) {
      console.log('→ LC 캡처 시작 (오디오 재생 중)...');
      const [lcResult] = await Promise.all([
        lc.poll(durationSec * 1000),
        playWav(wavPath),
      ]);
      lcText = lcResult;
    }

    const acc = moonText ? roughAccuracy(clip.text, moonText) : 0;
    const accBar = acc >= 0.80 ? green('●●●●') : acc >= 0.60 ? yellow('●●●○') : acc >= 0.40 ? yellow('●●○○') : red('●○○○');

    console.log('');
    console.log(bold('[ Moonshine ]'), `${accBar} (${Math.round(acc*100)}% char-overlap)`);
    console.log(' ', moonText || red('(인식 결과 없음)'));
    if (WITH_LC) {
      console.log(bold('[ Live Cap  ]'));
      console.log(' ', lcText || yellow('(LC 캡처 없음 — LC 켜져 있는지 확인)'));
    }

    results.push({ id: clip.id, label: clip.label, domain: clip.domain, durationSec, moonText, lcText, moonMs, acc });
  }

  // ── Summary ──────────────────────────────────────────────────────────────────
  console.log('\n' + hr('═'));
  console.log(bold('요약 (Summary)'));
  console.log(hr('─'));
  const header = pad('ID',3) + pad('Domain',10) + pad('Dur',6) + pad('RTF',7) + pad('Acc%',7) + (WITH_LC ? 'LC?' : '') + ' Label';
  console.log(cyan(header));
  for (const r of results) {
    if (r.error) { console.log(pad(r.id,3) + red('ERROR: ' + r.error)); continue; }
    const rtf = (r.moonMs/1000/r.durationSec).toFixed(2);
    const acc = Math.round((r.acc||0)*100);
    const accStr = acc >= 80 ? green(pad(acc+'%',7)) : acc >= 60 ? yellow(pad(acc+'%',7)) : red(pad(acc+'%',7));
    const lc_ok = WITH_LC ? (r.lcText ? green(' ✓ ') : red(' ✗ ')) : '';
    console.log(pad(r.id,3) + pad(r.domain,10) + pad(r.durationSec.toFixed(1)+'s',6) + pad(rtf,7) + accStr + lc_ok + r.label);
  }

  const avg_acc = results.filter(r=>r.acc!=null).reduce((s,r)=>s+r.acc,0) / results.filter(r=>r.acc!=null).length;
  const avg_rtf = results.filter(r=>r.moonMs).reduce((s,r)=>s+r.moonMs/1000/r.durationSec,0) / results.filter(r=>r.moonMs).length;
  console.log(hr('─'));
  console.log(`평균 char-overlap: ${bold(Math.round(avg_acc*100)+'%')} | 평균 RTF: ${bold(avg_rtf.toFixed(3))}`);
  console.log('\nClip WAV files: ' + CLIPS_DIR);
  console.log('');
}

const CLIPS_N = CLIP_N;
main().catch(e => { console.error(red('\n[FATAL]'), e.message, e.stack); process.exit(1); });
