/**
 * bench-affinity-clean.cjs — encoder loop in THIS process; translation bursts measured via
 * llama-server's OWN server-side timings (timings.predicted_per_second), so JS event-loop
 * contention can't distort the translation number. We just keep the encoder busy at prod cadence
 * and read server tok/s. Alternates none<->ecore per phase, discards warmup phase.
 *
 * Usage: node scripts/bench-affinity-clean.cjs [phases=6] [port=8099]
 */
const path = require('path');
const http = require('http');
const ort = require('onnxruntime-node');
const PHASES = Number(process.argv[2] || 6);
const PORT = Number(process.argv[3] || 8099);
const ENC = path.join('e:', 'teams-caption-translator', 'bin', 'stt', 'nemotron-int4', 'encoder.onnx');
const ECORE_IDS = [3, 4, 5];
const GAP_MS = 560;
const PHASE_MS = 6000;

function soFor(mode) {
  const base = { intraOpNumThreads: 4, interOpNumThreads: 1, executionMode: 'sequential',
    extra: { session: { 'intra_op.allow_spinning': '0', 'inter_op.allow_spinning': '0' } } };
  if (mode === 'ecore') base.extra.session['intra_op_thread_affinities'] = ECORE_IDS.join(';');
  return base;
}
function zeroFor(meta) {
  const dims = (meta.shape || meta.dimensions || []).map(d => (typeof d === 'number' && d > 0) ? d : 1);
  const n = dims.reduce((a, b) => a * b, 1);
  const t = (meta.type || '').toLowerCase();
  if (t.includes('int64')) return new ort.Tensor('int64', new BigInt64Array(n), dims);
  return new ort.Tensor('float32', new Float32Array(n), dims);
}
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
function complete(prompt) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ prompt, n_predict: 96, temperature: 0, top_k: 1, cache_prompt: false, stream: false, stop: ['\n', 'Japanese:', 'Vietnamese:'] });
    const req = http.request({ host: '127.0.0.1', port: PORT, path: '/completion', method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } }, (res) => {
      const chunks = []; res.on('data', c => chunks.push(c));
      res.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString())); } catch (e) { reject(e); } });
    });
    req.on('error', reject); req.write(body); req.end();
  });
}
const mk = (ja) => `Translate this from Japanese to Vietnamese:\nJapanese: ${ja}\nVietnamese:`;
const prompts = [
  mk('今四半期の業績はすべての地域で私たちの予想を上回りました。'),
  mk('次のスプリントが終わる前に移行計画を確定する必要があります。'),
  mk('添付の資料をよく確認して金曜日までにフィードバックをください。'),
  mk('お客様は昨日の通話中に断続的な接続の問題を報告しました。'),
];
async function mkSession(mode) {
  const sess = await ort.InferenceSession.create(ENC, soFor(mode));
  const names = sess.inputNames; const metaArr = sess.inputMetadata; const feeds = {};
  for (let i = 0; i < names.length; i++) feeds[names[i]] = zeroFor(Array.isArray(metaArr) ? metaArr[i] : metaArr[names[i]]);
  for (let i = 0; i < 3; i++) await sess.run(feeds);
  return { sess, feeds };
}
(async () => {
  const sessions = { none: await mkSession('none'), ecore: await mkSession('ecore') };
  await complete(prompts[0]); await complete(prompts[1]); // warm
  const agg = { none: { tps: [], enc: [] }, ecore: { tps: [], enc: [] } };
  for (let phase = 0; phase < PHASES; phase++) {
    const mode = phase % 2 === 0 ? 'none' : 'ecore';
    const { sess, feeds } = sessions[mode];
    let stop = false; const serverTps = [];
    // translation burst worker: back-to-back, reads SERVER-side tok/s
    const worker = (async () => {
      let k = 0;
      while (!stop) {
        try { const r = await complete(prompts[k % prompts.length]); const t = r.timings; if (t && t.predicted_per_second) serverTps.push(t.predicted_per_second); }
        catch { await sleep(30); }
        k++;
      }
    })();
    // encoder loop at prod cadence
    const encMs = []; const end = Date.now() + PHASE_MS;
    while (Date.now() < end) { const r0 = Date.now(); await sess.run(feeds); encMs.push(Date.now() - r0); await sleep(GAP_MS); }
    stop = true; await worker;
    if (phase >= 2) { // discard first none+ecore warmup pair
      const med = (a) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)] || 0; };
      agg[mode].tps.push(med(serverTps));
      agg[mode].enc.push(med(encMs));
    }
  }
  for (const mode of ['none', 'ecore']) {
    const med = (a) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)] || 0; };
    console.log(`[${mode}] server-tok/s medians per phase: [${agg[mode].tps.map(x=>x.toFixed(1)).join(', ')}]  -> median ${med(agg[mode].tps).toFixed(1)} tok/s | enc-ms medians [${agg[mode].enc.map(x=>x.toFixed(0)).join(', ')}]`);
  }
})();
