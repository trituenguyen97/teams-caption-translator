// Bench encoder inference latency on OpenVINO GPU + NPU with real static shapes.
const { addon: ov } = require('openvino-node');
const path = require('path');

function f32(dims){ const n=dims.reduce((a,b)=>a*b,1); return new ov.Tensor('f32', dims, new Float32Array(n)); }
function i64(dims, fill=0){ const n=dims.reduce((a,b)=>a*b,1); const a=new BigInt64Array(n); a.fill(BigInt(fill)); return new ov.Tensor('i64', dims, a); }

(async () => {
  const core = new ov.Core();
  try { core.setProperty({ 'CACHE_DIR': path.resolve('bin/stt/nemotron-int4/.ovcache') }); } catch(e){ console.log('cache set err', e.message); }
  const enc = path.resolve('bin/stt/nemotron-int4/encoder.onnx');
  const model = await core.readModel(enc);

  // Build inputs matching node static shapes
  const feeds = {
    audio_signal: f32([1,65,128]),
    length: i64([1], 65),
    cache_last_channel: f32([1,24,56,1024]),
    cache_last_time: f32([1,24,1024,8]),
    cache_last_channel_len: i64([1], 0),
    lang_id: i64([1], 10),
  };

  for (const dev of ['GPU','NPU']) {
    try {
      const t0 = Date.now();
      const cm = await core.compileModel(model, dev);
      const ir = cm.createInferRequest();
      console.log(`${dev} compile(+cache) ${Date.now()-t0}ms`);
      // warmup
      for (let i=0;i<3;i++){ await ir.inferAsync(feeds); }
      const N=20; const t1=Date.now();
      for (let i=0;i<N;i++){ await ir.inferAsync(feeds); }
      const per=(Date.now()-t1)/N;
      console.log(`${dev} INFER ${per.toFixed(1)} ms/chunk  RTF=${(per/560).toFixed(3)}  (budget 560ms/chunk)`);
    } catch(e){ console.log(`${dev} ERR:`, String(e.message||e).slice(0,400)); }
  }
})();
