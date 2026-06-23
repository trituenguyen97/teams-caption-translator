/**
 * test-gemini-live.cjs — Chẩn đoán: Gemini Live có TRẢ AUDIO khi gửi TEXT không?
 *
 * Dùng:  node scripts/test-gemini-live.cjs <API_KEY> ["câu tiếng Nhật"]
 *
 * Kết nối gemini-3.1-flash-live-preview (AUDIO + outputAudioTranscription + systemInstruction dịch sang VN),
 * gửi 1 câu text, log shape mọi message, gom audio → ghi gemini-test-output.wav (24kHz/16-bit/mono) để nghe.
 * → Nếu có .wav nghe được = API trả audio OK (lỗi ở renderer app). Nếu KHÔNG audio = lỗi model/config.
 */
const fs = require('fs');
const path = require('path');

function pcmToWav(pcm, sampleRate, channels, bits) {
  const byteRate = sampleRate * channels * bits / 8;
  const blockAlign = channels * bits / 8;
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + pcm.length, 4); h.write('WAVE', 8);
  h.write('fmt ', 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(channels, 22);
  h.writeUInt32LE(sampleRate, 24); h.writeUInt32LE(byteRate, 28); h.writeUInt16LE(blockAlign, 32); h.writeUInt16LE(bits, 34);
  h.write('data', 36); h.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([h, pcm]);
}
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

(async () => {
  const key = process.argv[2];
  const text = process.argv[3] || 'こんにちは、今日はいい天気ですね。会議を始めましょう。';
  if (!key) { console.error('Thiếu API key.\n  node scripts/test-gemini-live.cjs <API_KEY> ["text"]'); process.exit(1); }

  const { GoogleGenAI, Modality } = await import('@google/genai');
  const ai = new GoogleGenAI({ apiKey: key });
  const MODEL = 'gemini-3.1-flash-live-preview';

  const audioChunks = [];
  let otAcc = '', msgCount = 0, done = false;

  function onmessage(m) {
    msgCount++;
    const sc = m && m.serverContent;
    const parts = (sc && sc.modelTurn && sc.modelTurn.parts) || (sc && sc.parts);
    let audioB = 0;
    if (parts) for (const p of parts) {
      const id = p && (p.inlineData || p.inline_data);
      const d = id && id.data;
      if (d) { audioChunks.push(Buffer.from(d, 'base64')); audioB += d.length; }
    }
    if (!audioB && typeof m.data === 'string' && m.data) { audioChunks.push(Buffer.from(m.data, 'base64')); audioB = m.data.length; }
    const ot = sc && sc.outputTranscription && sc.outputTranscription.text;
    if (ot) otAcc += ot;
    console.log(`MSG#${msgCount} keys=[${Object.keys(m || {}).join(',')}] sc=[${sc ? Object.keys(sc).join(',') : '-'}] audioB64=${audioB} ot=${JSON.stringify(ot || '')} done=${!!(sc && sc.turnComplete)}`);
    if (sc && sc.turnComplete) done = true;
  }

  console.log('Kết nối', MODEL, '…');
  const session = await ai.live.connect({
    model: MODEL,
    config: {
      responseModalities: [Modality.AUDIO],
      outputAudioTranscription: {},
      systemInstruction: 'You are a translator. Translate the user message into Vietnamese and SPEAK the translation. Output only the translation.',
    },
    callbacks: {
      onopen: () => console.log('OPEN'),
      onmessage,
      onerror: (e) => console.error('ERROR', e && e.message),
      onclose: (e) => console.log('CLOSE', (e && e.reason) || ''),
    },
  });

  console.log('→ Gửi text qua sendClientContent(turnComplete:true):', text);
  try { session.sendClientContent({ turns: [{ role: 'user', parts: [{ text }] }], turnComplete: true }); } catch (e) { console.error('sendClientContent lỗi:', e.message); }

  let t0 = Date.now();
  while (!done && Date.now() - t0 < 25000) await sleep(200);

  if (!done && audioChunks.length === 0 && !otAcc) {
    console.log('… chưa có phản hồi → thử sendClientContent(turnComplete:true)');
    try { session.sendClientContent({ turns: [{ role: 'user', parts: [{ text }] }], turnComplete: true }); }
    catch (e) { console.error('sendClientContent lỗi:', e.message); }
    t0 = Date.now();
    while (!done && Date.now() - t0 < 25000) await sleep(200);
  }

  try { session.close(); } catch {}
  console.log('\n========== KẾT QUẢ ==========');
  console.log('Text dịch (outputTranscription):', otAcc || '(RỖNG)');
  const total = audioChunks.reduce((s, b) => s + b.length, 0);
  console.log('Audio: ' + audioChunks.length + ' chunk, ' + total + ' bytes');
  if (total) {
    const out = path.join(process.cwd(), 'gemini-test-output.wav');
    fs.writeFileSync(out, pcmToWav(Buffer.concat(audioChunks), 24000, 1, 16));
    console.log('✅ Ghi audio →', out, '— MỞ NGHE THỬ. (API trả audio OK → nếu app không kêu thì lỗi ở renderer)');
  } else {
    console.log('❌ KHÔNG có audio bytes từ API → vấn đề ở MODEL/CONFIG (không phải renderer).');
  }
  process.exit(0);
})().catch(e => { console.error('FATAL:', e && (e.stack || e.message)); process.exit(1); });
