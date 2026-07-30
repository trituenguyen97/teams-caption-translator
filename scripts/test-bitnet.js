#!/usr/bin/env node
/**
 * test-bitnet.js — Kiểm thử đường dịch offline BitNet v7a (JA→VI) qua đúng pipeline app:
 * translateText → translateLocalBitNet (sidecar :8790) → QE gate → postprocess.
 * Cần sidecar đang chạy (app đang mở, hoặc: python bitnet/bitnet_sidecar.py).
 *
 * Dùng:  node scripts/test-bitnet.js
 */
const state = require('../src/state');
const T = require('../src/translation');

state.provider = 'local';
state.targetLang = 'Vietnamese';

const SAMPLES = [
  '面接は来週の水曜日に決まった。',
  'お疲れ様です。今日の会議は3時からです。資料を確認してください。',
  'サーバーの負荷が急に跳ね上がったので、原因を調査しています。',
  '移行作業は深夜に行われ、旧システムと新システムを並行稼働させながら、データの不整合がないか一件ずつ検証した。',
  'こんにちは',                       // phrase map (không gọi model)
  'Hello everyone, how are you?',      // nguồn EN → BitNet trả null → MiLMMT/Google
];

(async () => {
  for (const s of SAMPLES) {
    const t0 = Date.now();
    const out = await T.translateText(s);
    console.log(`${String(Date.now() - t0).padStart(5)}ms | ${s.slice(0, 36)}`);
    console.log(`        → ${out}`);
  }
  process.exit(0);
})();
