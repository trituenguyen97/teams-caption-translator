/**
 * mel-nemotron.js — Tiền xử lý log-mel cho Nemotron-3.5-ASR, thuần Node (thay onnxruntime-genai processor).
 * Khớp NeMo FilterbankFeatures (params từ genai_config/audio_processor_config):
 *   n_fft=512, hop=160, win=400 (hann), n_mels=128, fmin=0, fmax=8000, sr=16000,
 *   preemph=0.97, mag_power=2.0, log(x + 5.96046448e-08), normalize=NONE, mel slaney (librosa htk=False).
 * Khung streaming Nemotron: mỗi chunk 8960 mẫu → 56 frame mới; encoder nhận [65,128] = [9 carryover] + [56].
 */
'use strict';
const NFFT = 512, HOP = 160, WIN = 400, NMEL = 128, SR = 16000, FMIN = 0, FMAX = 8000;
const PREEMPH = 0.97, LOG_EPS = 5.96046448e-08, FRAMES_PER_CHUNK = 56;
const NBIN = NFFT / 2 + 1; // 257

// ── Hann window (chu kỳ, periodic — librosa/torch dùng periodic), đặt giữa trong NFFT (pad (NFFT-WIN)/2) ──
const _win = (() => {
  const w = new Float64Array(NFFT);
  const off = (NFFT - WIN) >> 1; // 56
  for (let i = 0; i < WIN; i++) w[off + i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / WIN); // periodic hann
  return w;
})();

// ── Mel filterbank slaney (librosa.filters.mel htk=False, norm='slaney') [NMEL x NBIN] ──
function _hzToMel(f) { // slaney
  const fmin = 0, fsp = 200 / 3, minLogHz = 1000, minLogMel = (minLogHz - fmin) / fsp, logstep = Math.log(6.4) / 27;
  return f >= minLogHz ? minLogMel + Math.log(f / minLogHz) / logstep : (f - fmin) / fsp;
}
function _melToHz(m) {
  const fmin = 0, fsp = 200 / 3, minLogHz = 1000, minLogMel = (minLogHz - fmin) / fsp, logstep = Math.log(6.4) / 27;
  return m >= minLogMel ? minLogHz * Math.exp(logstep * (m - minLogMel)) : fmin + fsp * m;
}
const _melFb = (() => {
  const fb = []; for (let i = 0; i < NMEL; i++) fb.push(new Float64Array(NBIN));
  const fftFreqs = new Float64Array(NBIN);
  for (let k = 0; k < NBIN; k++) fftFreqs[k] = (SR / 2) * k / (NBIN - 1); // = k*SR/NFFT
  const mMin = _hzToMel(FMIN), mMax = _hzToMel(FMAX);
  const melPts = new Float64Array(NMEL + 2);
  for (let i = 0; i < NMEL + 2; i++) melPts[i] = _melToHz(mMin + (mMax - mMin) * i / (NMEL + 1));
  for (let m = 0; m < NMEL; m++) {
    const lo = melPts[m], ctr = melPts[m + 1], hi = melPts[m + 2];
    const enorm = 2.0 / (hi - lo); // slaney norm
    for (let k = 0; k < NBIN; k++) {
      const f = fftFreqs[k];
      const lower = (f - lo) / (ctr - lo), upper = (hi - f) / (hi - ctr);
      const v = Math.max(0, Math.min(lower, upper));
      fb[m][k] = v * enorm;
    }
  }
  return fb;
})();

// ── FFT radix-2 (512) — in-place, real input via complex buffers ──
const _rev = (() => { const r = new Int32Array(NFFT); let j = 0; for (let i = 1; i < NFFT; i++) { let bit = NFFT >> 1; for (; j & bit; bit >>= 1) j ^= bit; j ^= bit; r[i] = j; } return r; })();
const _cos = new Float64Array(NFFT / 2), _sin = new Float64Array(NFFT / 2);
for (let i = 0; i < NFFT / 2; i++) { _cos[i] = Math.cos(-2 * Math.PI * i / NFFT); _sin[i] = Math.sin(-2 * Math.PI * i / NFFT); }
function _fftPower(re, im, outPow) {
  for (let i = 0; i < NFFT; i++) { const j = _rev[i]; if (j > i) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; } }
  for (let len = 2; len <= NFFT; len <<= 1) {
    const half = len >> 1, step = NFFT / len;
    for (let i = 0; i < NFFT; i += len) {
      for (let k = 0, idx = 0; k < half; k++, idx += step) {
        const wr = _cos[idx], wi = _sin[idx];
        const ur = re[i + k], ui = im[i + k];
        const vr = re[i + k + half] * wr - im[i + k + half] * wi;
        const vi = re[i + k + half] * wi + im[i + k + half] * wr;
        re[i + k] = ur + vr; im[i + k] = ui + vi;
        re[i + k + half] = ur - vr; im[i + k + half] = ui - vi;
      }
    }
  }
  for (let k = 0; k < NBIN; k++) outPow[k] = re[k] * re[k] + im[k] * im[k]; // power (mag_power=2)
}

/**
 * melChunk(samples8960) -> Float32Array [56*128] (row-major: frame*128 + mel).
 * frame i = samples[i*160 : i*160+512] (zero-pad đuôi), preemph áp toàn chunk trước.
 */
const PAD = NFFT >> 1; // 256 — center padding (NeMo center=True)
// prevTail: PAD mẫu audio THẬT cuối chunk trước (left-context streaming). null → reflect (chunk đầu).
function melChunk(samples, prevTail) {
  const n = samples.length;
  // preemph liên tục: mẫu đầu dùng mẫu cuối prevTail (nếu có) để khớp streaming.
  const pre = new Float64Array(n);
  pre[0] = prevTail ? samples[0] - PREEMPH * prevTail[prevTail.length - 1] : samples[0];
  for (let i = 1; i < n; i++) pre[i] = samples[i] - PREEMPH * samples[i - 1];
  const padded = new Float64Array(n + 2 * PAD);
  if (prevTail && prevTail.length >= PAD + 1) {
    // left-context = preemph của PAD mẫu cuối chunk trước (cần thêm 1 mẫu trước để tính preemph)
    const L = prevTail.length;
    for (let i = 0; i < PAD; i++) { const idx = L - PAD + i; padded[i] = prevTail[idx] - PREEMPH * prevTail[idx - 1]; }
  } else {
    for (let i = 0; i < PAD; i++) padded[PAD - 1 - i] = pre[Math.min(i + 1, n - 1)]; // reflect
  }
  for (let i = 0; i < PAD; i++) padded[PAD + n + i] = pre[Math.max(n - 2 - i, 0)]; // right reflect (xấp xỉ lookahead)
  for (let i = 0; i < n; i++) padded[PAD + i] = pre[i];
  const N2 = padded.length;
  const out = new Float32Array(FRAMES_PER_CHUNK * NMEL);
  const re = new Float64Array(NFFT), im = new Float64Array(NFFT), pow = new Float64Array(NBIN);
  for (let f = 0; f < FRAMES_PER_CHUNK; f++) {
    const start = f * HOP;
    im.fill(0);
    for (let k = 0; k < NFFT; k++) { const s = start + k; re[k] = s < N2 ? padded[s] * _win[k] : 0; }
    _fftPower(re, im, pow);
    for (let m = 0; m < NMEL; m++) {
      const fbm = _melFb[m]; let acc = 0;
      for (let k = 0; k < NBIN; k++) acc += fbm[k] * pow[k];
      out[f * NMEL + m] = Math.log(acc + LOG_EPS);
    }
  }
  return out;
}

module.exports = { melChunk, FRAMES_PER_CHUNK, NMEL, NFFT, HOP };
