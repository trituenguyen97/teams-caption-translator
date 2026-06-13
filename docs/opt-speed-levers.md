# Tối ưu tốc độ & tài nguyên — STT (Nemotron int4) + dịch (MiLMMT-46-1B)

Cập nhật: 2026-06-13. Nhánh `research/nemotron-asr`.
Nghiên cứu 6 lever (workflow `opt-speed-research`, 13 agent, agent CHẠY THẬT trên máy), verify đối kháng từng cái
trên đúng stack: **llama.cpp prebuilt + onnxruntime-node 1.26.0, CPU-only, Windows, Core Ultra 5 225H**.

## Máy (đã xác minh WMI)
- CPU: **Core Ultra 5 225H** (Arrow Lake-H, Family 6 Model 197), **14 core / 14 thread (NO HT)** = 4 P + 8 E + 2 LP-E,
  AVX2 + AVX-VNNI, **không AVX-512**. ggml chọn `ggml-cpu-alderlake.dll` tự động.
- RAM: **16GB (Controller0) + 32GB (Controller1)**, cả hai DDR5-5600 64-bit → **Flex Mode**: chỉ 16+16=32GB chạy
  dual-channel interleaved, 16GB dư chạy **single-channel** (~½ băng thông). MiLMMT memory-bound nên đây là 1 phần
  của trần ~50GB/s. `--mlock` ghim nhưng KHÔNG chọn vùng channel.

## Bảng xếp hạng (gain thực × khả thi ÷ chi phí+rủi ro)

| # | Lever | Gain thực (đo trên máy) | Khả thi prebuilt | Verdict |
|---|---|---|---|---|
| **5** | **TẮT ORT thread spinning** | **2.10→0.40 core idle (−1.7 core)**, latency +16% (RTF 0.20) | 2 dòng, 0 tải | ✅ **ĐÃ LÀM** |
| **4** | **Continuous batching `-np 2`** | **46→70 tok/s burst (~1.5×)**; burst 2 câu 0.60s vs 0.90s | flag + sửa app + fix race | ⏳ **NÊN LÀM** |
| 1 | Quant nhỏ hơn MiLMMT | ~0% (A) / +12% Q4_0 kèm rủi ro chất lượng | không có đường sạch | ❌ skip |
| 2 | Speculative decoding | NET ÂM (~25% chậm hơn) trên CPU | không | ❌ skip |
| 3 | DirectML offload STT lên iGPU | NET ÂM (DML không load nổi; WebGPU chậm hơn) | không khả thi | ❌ skip |
| 6 | OS knobs (priority/large-page/ISA) | ~0% (memory-bound, software không phân xử băng thông) | có nhưng vô ích | ❌ skip (ghi HW note) |

## ✅ Lever 5 — TẮT spinning (ĐÃ ÁP DỤNG, `src/stt-nemotron.js`)
ORT mặc định `allow_spinning=1`: thread intra/inter-op **busy-wait** giữa các lần inference để giảm latency. Trong
vòng STT chunk-560ms, encoder chạy ~once/560ms rồi NGHỈ → spinner đốt core suốt khoảng trống, tranh CPU với dịch
MiLMMT (memory-bound) chạy cùng cores.
- **Đo A/B** (`scripts/bench-ort-spinning.cjs`, encoder thật, cadence 560ms × 18 vòng):
  spinning **ON = 2.10 core** trung bình (210%/1-core) · **OFF = 0.40 core** (40%) → **giải phóng ~1.7 core**.
  Giá: encoder run 94→109ms (+16%) nhưng RTF 0.168→0.195, budget 560ms dư sức.
- **⚠ Cạm bẫy:** onnxruntime-node IM LẶNG bỏ qua key `extra` sai → `create()` chạy được KHÔNG chứng minh flag có
  hiệu lực. Bằng chứng DUY NHẤT = delta CPU. Key LÁ nằm dưới `extra.session` (binding tự thêm tiền tố `session.`):
  viết `{ extra: { session: { 'intra_op.allow_spinning':'0', 'inter_op.allow_spinning':'0' } } }`. Viết đủ
  `'session.intra_op...'` → thành `session.session...` = no-op thầm lặng.
- int8-vs-int4: encoder có 219 op `MatMulNBits` bits=4 **accuracy_level=4** → weight int4 (nhẹ băng thông) NHƯNG
  matmul đã chạy kernel int8/VNNI nhanh. Model int8-weight = GẤP ĐÔI byte/token trên tường băng thông, 0 lợi compute
  → **KHÔNG đổi int8 vì tốc độ** (chỉ cân nhắc nếu cần sửa bug đọc-sai-số, là vấn đề độ chính xác riêng).

## ⏳ Lever 4 — Continuous batching `-np 2` (CHƯA LÀM, cần duyệt)
MiLMMT batch=1 = GEMV, mỗi byte trọng số đọc về chỉ nhân 1 activation → đói băng thông. Batch K câu → GEMM, CÙNG
lần đọc trọng số phục vụ K câu → leo khỏi tường băng thông mà KHÔNG cần RAM nhanh hơn (thứ PIM/iGPU/thread-sweep
không làm được).
- **Đo trên máy** (agent chạy llama-server `-np 2 -cb` + 2 curl song song, MiLMMT Q4_K_M thật): single 46 tok/s →
  2-way **70 tok/s (~1.5×)**. Burst 2 câu drain 0.60s vs 0.90s serial; 3 câu ~0.80s vs ~1.30s.
- **`-np 3` TỤT** xuống 66 tok/s (chỉ 4 P-core) → **cap ở `-np 2`**.
- Chỉ lợi BURST (người nói nhanh/tồn đọng); câu lẻ (giữa các lần ngắt) KHÔNG lợi, vẫn ~0.48s. KHÔNG giảm CPU (đổi
  latency lấy compute) — bổ trợ lever 5 chứ không thay.
- **Cần (KHÔNG chỉ flag):**
  1. `src/local-llm.js`: thêm `-np 2 -cb`, nâng `-c` 2048→4096 (slot chia ctx; KV nhỏ so với 1GB trọng số).
  2. `src/translation.js` `getMaxConcurrent()`: local `1→2`; `drainQueue` đã dispatch song song khi cap mở.
  3. **BẮT BUỘC fix race `_lastMilmmtQE`** (biến module-global, dòng ~175/666/727): `translateLocalMiLMMT` ghi nó,
     `_translateUncached` đọc sau `await` → 2 call local song song ĐÈ QE của nhau → quyết định fallback-Google sai.
     Phải trả QE per-request. Comment "concurrency=1 → safe" giờ SAI.

## ❌ Dead-ends (có bằng chứng, đừng làm lại)
- **Lever 1 (quant):** GGUF thật: embed đã Q5_0/198MB + `output.weight` RIÊNG Q8_0/306MB (KHÔNG tied như giả định);
  `--token-embedding-type q4_k/q3_k` fallback về q5_0 (hidden=1152 ∤ 256) → A tiết kiệm ~0 byte. Whole-model Q4_0 chỉ
  nhỏ ~12% (842MB) kèm rủi ro chất lượng đa ngữ JA/KO/ZH→VI (đúng chỗ app đang vá tay). IQ4_XS NET ÂM trên AVX2-no-512
  (dequant codebook đắt). Không có đường prebuilt sạch (cần toolchain convert HF).
- **Lever 2 (spec-decode):** draft duy nhất vocab-khớp = Gemma3-270M (MiLMMT = continual-pretrain Gemma3-1B) — không
  có kỹ năng dịch → acceptance thấp; draft + target CHIA cùng bus LPDDR5 (không VRAM giấu) → ~25% CHẬM hơn + ăn core
  STT. Net âm cả 2 mục tiêu. (Build llama-server 9585 CÓ `-md` nhưng `llama-speculative-simple` KHÔNG có trong zip.)
- **Lever 3 (DirectML STT):** đã REPRODUCE `E_INVALIDARG` (MLOperatorAuthorImpl.cpp:2879) — DML không cài nổi 219 op
  `MatMulNBits` int4 của encoder (decoder/joint không-NBits load OK → cô lập đúng nguyên nhân). WebGPU (route iGPU duy
  nhất load được) chậm hơn ~22% (103 vs 84ms/chunk) + ngốn CPU ~2.5× (Dawn busy-poll + node fallback CPU). Âm cả 2
  mục tiêu. (DirectML.dll CÓ sẵn trong onnxruntime-node 1.26.0 nhưng vô dụng cho model này.)
- **Lever 6 (OS knobs):** workload nghẽn IMC băng thông; KHÔNG có Windows priority class / large-page / VNNI kernel
  nào phân xử băng thông (chỉ phân xử thời-gian-CPU, mà CPU KHÔNG khan — 9.25/14 thread dùng, t8+STT=47.8 tok/s chứng
  minh 2 model không đua CPU). `os.setPriority(BELOW_NORMAL)` chạy được nhưng ~0 lợi. Lever DUY NHẤT chạm bottleneck
  thật = **PHẦN CỨNG**: DIMM dual-channel KHỚP dung lượng (tránh vùng single-channel Flex Mode, vực ~2× băng thông) +
  LPDDR5X-8400 thay 5600 (~48→~60 tok/s, ∝ băng thông). → ghi vào **spec phần cứng triển khai**; dev box có thể hàn
  chết LPDDR5X → không sửa được.

---

# Vòng 2 — tối ưu TÀI NGUYÊN (CPU/RAM/điện), 2026-06-13

Workflow `opt-resource-round2` (13 agent chạy thật + verify đối kháng), tập trung footprint chứ không phải latency.
Bench mới (agent viết): `scripts/bench-ort-threads2.cjs`, `bench-vad-marginal.cjs`, `bench-vad-gate.cjs`.

| # | Lever | Tiết kiệm thực (đo) | Chi phí | Verdict |
|---|---|---|---|---|
| R2-2 | **encoder threads 4→2** | ~1.0 core PEAK lúc encoder chạy; −38% CPU-ms/run; ~0.15 core sustained | 0 (token y hệt, RTF 0.28) | ✅ **FREE, nên làm** |
| R2-1 | **bỏ `--mlock`** | WorkingSet −160MB + 960MB thành reclaimable | ~0 (rủi ro re-fault 0.65s khi RAM ép) | ◐ optional, marginal trên 48GB |
| R2-3 | **VAD-gate encoder lúc im lặng** | ~0.24–0.35 core TB (40–60% im) + điện/nhiệt | ✅ ĐÃ LÀM; còn A/B Electron | ✅ **implement + test logic PASS** |
| R2-4 | idle-unload llama-server | ~292MB (chỉ marginal sau khi bỏ mlock) | stall ~2s/lần wake + race cooldown | ❌ skip (48GB) |
| R2-5a | RNN-T reuse buffer/IO-binding | <0.001 core | IO-binding KHÔNG có trong ORT-node 1.26 | ❌ skip |
| R2-5b | mel filterbank thưa | ~0.001 core | rủi ro sai số front-end | ❌ skip |
| R2-5c | pin encoder vào E-core | **ÂM**: +44% CPU-ms, +0.2 core | regression thuần | ❌ skip |

## ✅ R2-2 — encoder threads 4→2 (FREE, đã verify 2 lần)
Encoder int4 (MatMulNBits) **nghẽn băng thông DDR5 → latency PHẲNG từ 2→4 thread** (~157–162ms run; tự đo: 112–130ms).
Thread 3-4 chỉ thêm core đọc bus đã bão hoà = lãng phí. Đo (bench-ort-threads2 + bench-ort-threads tôi tự chạy,
khớp nhau):
- t4: 2.69–2.82 core active, 367–436 cpu-ms/run, RTF 0.23–0.29
- **t2: 1.71–1.75 core active, 219–269 cpu-ms/run (−38%), RTF 0.22–0.28** ← sweet spot
- t3 bị t2 trội hẳn (cùng latency, +0.55 core). t1 loại (RTF 0.39, ít margin; burst 5.4-core llama → 0.59).
- t2 chịu được burst llama 5.4-core mà RTF vẫn ≤0.86 « 1.
→ Sửa: `src/stt.js:109` `{threads:4}`→`{threads:2}` (và có thể default `src/stt-nemotron.js` `||4`→`||2`).
Token Y HỆT (thread không đổi numeric) → 0 rủi ro chất lượng. **Lưu ý:** t2 lý tưởng cho 225H; máy yếu hơn nhiều
nên để 3 cho an toàn.

## ◐ R2-1 — bỏ `--mlock` (marginal trên 48GB)
Đo: private RAM Y HỆT (~292MB) có/không mlock — mlock chỉ biến 960MB weight mmap thành pin CỨNG không-evict.
Bỏ → WorkingSet −160MB + OS được phép reclaim khi RAM ép (worst case re-fault ~0.65s, decode nghẽn-BW không
nghẽn-fault nên ~vô hại). Trên 48GB (28GB trống) thực tế không evict gì → lợi ~160MB WorkingSet + reclaimable.
KHÔNG thêm `--no-mmap` (đo +888MB private). Sửa `src/local-llm.js:569`. Giá trị thực thấp; làm nếu quan tâm RAM.

## ✅ R2-3 — VAD-gate encoder lúc im lặng (ĐÃ LÀM 2026-06-13, còn A/B Electron)
**Đã implement** trong `src/audio-stt.js` (`_pumpNemo` + `_nemoVadProb`/`_ensureNemoVad`/`_resetNemoVad`) + helper
`stt.nemotronDir()`. Tham số: `_NEMO_VAD_THRESH=0.35`, `_NEMO_VAD_HANG=1.15s`, pre-roll 1 frame, toggle
`_NEMO_VAD_GATE=true` (đặt false để tắt khi A/B). VAD lỗi/chưa nạp → **fail-open** (coi như speech, không gate).
Test logic `scripts/test-vad-gate-logic.cjs` **PASS** (silero thật): im đầu→gate, nói→chạy+pre-roll, hangover phủ
trọn cửa sổ 1.0s, đuôi im→gate. **Còn lại: A/B Electron** (clip có khoảng lặng → CPU tụt lúc lặng, từ đầu sau khi
nói lại KHÔNG rớt onset). Chi tiết thiết kế bên dưới.
Pump hiện chạy encoder MỌI chunk 560ms kể cả im lặng. Có sẵn `bin/stt/nemotron-int4/silero_vad.onnx` (v5, 2.24MB,
chưa dùng). Đo: encoder ~0.59 core/chunk vs VAD ~0.015 core → **tiết kiệm ~0.52–0.67 core/chunk-im**; TB phiên
40–60% im = ~0.24–0.35 core + điện/nhiệt. RAM 0 (encoder vẫn resident). **Caveat thật:** core được giải phóng CHỦ
YẾU lúc im lặng — khi MiLMMT cũng đang rảnh → đây là **win pin/nhiệt/duty-cycle hơn là tăng throughput**. Lúc nói
liên tục: 0 lợi (+0.014 core VAD).
**Rào an toàn BẮT BUỘC khi làm** (trong `src/audio-stt.js` `_pumpNemo`, trước `sess.accept`):
- Gate: chạy encoder nếu `prob≥0.35` HOẶC `_nemoGrew` (đang trong câu) HOẶC trong hangover ~2 chunk; nếu không →
  bỏ qua `accept`, chỉ tăng `_nemoNoGrow`/`_nemoUttLen` để endpoint 1.0s (`_NEMO_NOGROW=16000`) vẫn commit+`reset()`.
- **KHÔNG BAO GIỜ gate giữa câu** (clause `_nemoGrew`). Im lặng = ranh câu sẵn có (app đã `reset()` ở mốc 1.0s) →
  bỏ chunk im sau reset không hỏng cache.
- Pre-roll 1 chunk (như `_offRing`/`_PREROLL` nhánh offline) chống cắt onset. Threshold 0.35 (verify: giọng nhỏ
  amp0.03 = 0.92 prob qua được; noise trắng amp0.3 = 0.11 bị chặn → qua giọng nhỏ, chặn hiss quạt/AC).
- **A/B Electron thật BẮT BUỘC trước merge:** clip họp có khoảng lặng dài → CPU phải tụt lúc lặng, từ đầu sau khi
  nói lại phải hiện trong ~1 chunk KHÔNG rớt onset.

---

# Vòng 3 — tối ưu QUY TRÌNH stt→dịch→tts (nhanh/nhẹ/mượt), 2026-06-13

Workflow `opt-pipeline-stt-mt-tts` (13 agent, đo on-box + verify). Cấp ORCHESTRATION (không phải linh kiện).
Đo latency thật: caption giữa-câu ~0.7-1.3s sau âm; đuôi câu +1.0-1.8s (endpoint); MiLMMT ~450-990ms/câu
(~26 tok/s ngắn, KHÔNG phải 46); TTS synth 71-780ms (RTF 0.12-0.16), playback là nút thắt thật.

## ✅ ĐÃ ÁP + tự verify (4 lever an toàn, output không đổi trừ TTS-policy)
- **M1+M2 TTS queue cap + split câu dài** (`app.html` `ttsEnqueue`/`ttsPump`): `_ttsQueue` TRƯỚC không trần →
  họp dày dịch ra nhanh hơn Piper đọc → audio TRÔI HẬU vô hạn (đọc câu cách đó vài phút). Nay: budget 6s audio chờ,
  vượt → bỏ câu CŨ nhất (drop-oldest, giữ `_ttsSpoken` để không sống lại); trần cứng 12s → chỉ giữ mới nhất; câu
  >120 ký tự tách theo dấu câu (đọc sớm + drop hạt mịn). Test `scripts/test-tts-queue.cjs` PASS. ĐÂY LÀ WIN MƯỢT #1.
- **N1 per-request QE** (`translation.js`): `_lastMilmmtQE` biến module → 2 call song song (np=2) đè QE của nhau →
  fallback-Google sai ~½. Đổi: `translateLocalMiLMMT(text,tgt,qeOut)` ghi `qeOut.qe` per-request (caller ngoài
  không truyền qeOut vẫn nhận string — tương thích ngược). FIX correctness + GỠ CHẶN cho np=2.
- **M5 `UV_THREADPOOL_SIZE=8`** (`main.js`, trước require onnxruntime): STT(onnxruntime)+VAD+TTS(sherpa) chung pool
  libuv mặc định 4 → TTS synth giữ slot ~0.5s chèn trước Run() ngắn của RNN-T → jank. Nâng 8 (≤14 core).
- **L1 Piper 1 thread** (`tts.js` `_numThreads`→1): non-autoregressive RTF«1 ở 1 luồng → bỏ burst ~1-2 core chồng
  STT+llama lúc nói; user không thấy chậm (synth « playback).

## ⏳ CHƯA ÁP — cần anh quyết (đánh đổi UX / cần A/B)
- **M3 half-duplex gate** (correctness): nguồn=system + TTS bật → TTS tiếng Việt phát ra loa → capture loopback thu
  lại → STT phiên âm chính TTS → dịch vi→vi → VÒNG LẶP tự khuếch đại. Fix: bỏ frame capture khi `_ttsAudible`. NHƯNG
  = bán song công (đang đọc thì BỎ tiếng người nói). CHỈ ảnh hưởng nguồn=system (teams=UIA không có audio; mic có AEC).
  Cần M1 trước (giới hạn cửa sổ gate). → hỏi user.
- **N3 graded endpoint** (`audio-stt.js`): clause đuôi ≥12 ký tự chốt ở 640ms thay 1000ms (−360ms). Rủi ro tái over-split
  (user nhạy vụ này) → cần A/B.
- **N2 `-np 2` batching** (đã gỡ chặn nhờ N1): ~1.5× burst (8.3s→5.5s câu cuối burst-8). Cần A/B + +RAM KV.
- **M4 synth prefetch** (`app.html`): synth N+1 trong lúc phát N → bỏ khe im 34-780ms giữa câu. Low-risk, làm sau.

## ❌ KILLED (workflow loại)
- Speculative-commit đuôi câu vào dịch: chiếm slot dịch serial; nếu câu có-dấu-câu chốt trong cửa sổ đó → trễ caption
  thật 500-1000ms. Net âm + về phía "dịch hypothesis chưa chốt" (đã loại).
- Newest-first/LIFO drain: dịch về sai thứ tự → TTS đọc câu 8 trước 3-7 = lộn xộn audio không đảo lại được. Giữ FIFO.

---

# Vòng 4 — chạy 3 model trên 1 CPU không GPU: MƯỢT + NHẸ, 2026-06-13

Workflow `opt-coexec-3models-cpu` (đo on-box). **Kết luận lớn nhất: MƯỢT GẦN NHƯ ĐÃ XONG.**
- Triple-burst (STT+MT+TTS cùng chạy) đỉnh CPU chỉ **9.9/14 core** (4 P-core còn rảnh) → thread KHÔNG phải nút thắt.
- STT real-time **KHÔNG bị đói**: chunk-time lúc MT burst max **227ms « budget 560ms** (59% headroom). "Giật" chỉ là
  partial cadence wobble +45-50ms (cosmetic). → KHÔNG cần scheduler nặng. Nút thắt thật vẫn là **băng thông DDR5**
  (Flex Mode) — cắt thread/pin core vô ích (đã chứng minh).
- **Hợp nhất model = DEAD**: speech-translation 1-model to hơn tổng 2 model + mất streaming + mất QE/glossary. Giữ 3
  model rời. onnxruntime ở mức runtime hiệu dụng ~1 (không có gì gộp).
- → **Lever lớn nhất = DỌN DUNG LƯỢNG ĐĨA ~3.1GB**, không phải scheduling.

## ✅ ĐÃ ÁP (build-only, 0 rủi ro runtime, dev không đổi)
- **C1** `package.json` extraResources: `!llama-server/cuda/**` + `!**/.cache/**` → **−1.19GB** (máy không-NVIDIA,
  cuda vô dụng; cpu fallback vẫn bundle, cuda tự tải vào userData nếu có NVIDIA online).
- **C4a** `package.json` files: `!onnxruntime-node/bin/napi-v6/{darwin,linux}/**` → **−133MB** (app Windows-only).

## ✅ ĐÃ ÁP (đợt 2, user chọn 2026-06-13)
NHẸ-ĐĨA:
- **C2** ✅ Xoá Qwen GGUF mồ côi userData → **−1.67GB** (chỉ còn MiLMMT). app `_isRemovedModel` đã chặn dùng qwen.
- **C3** ✅ Xoá `bin/punc/` → **−74MB** (Nemotron ra dấu câu native; GIỮ `ja-itn.js`).
- **C4b** ✅ `package.json` files bỏ `onnxruntime-node/bin/napi-v6/win32/arm64` (build x64). **GIỮ DirectML DLL** (đường iGPU
  của onnxruntime — user cần linh hoạt GPU/iGPU, không đóng cửa dù int4 hiện chưa chạy DML được).
NHẸ-RAM:
- **B2** ✅ Unload Piper khi tắt loa (`tts.js unload()` + `_inflight` guard chống drop giữa synth + `ipc-handlers` nhánh
  `else`) → nhả ~100-170MB. ĐÃ verify: unload() chạy được, export OK.
- **B3** ✅ Reaper llama-server mồ côi lúc `startServer` (`local-llm.js reapOrphans` — match basename model qua CommandLine,
  chỉ giết process khớp ĐÚNG model app, KHÔNG đụng llama-server khác). ĐÃ verify PS + **diệt 1 orphan THẬT 1,145MB đang chạy**.

## ⏳ Còn lại — KHÔNG làm (marginal, user bỏ qua)
- **A1** anti-overlap TTS↔MT: MARGINAL vì STT vốn không đói. **B1** bỏ `--mlock`: marginal trên 48GB.

## ⚠️ GHI NHỚ GPU (user yêu cầu): auto-detect cuda/amd/cpu PHẢI giữ
Máy đích = CPU + iGPU + NPU (KHÔNG CUDA). C1 chỉ bỏ *binary* cuda khỏi bundle, KHÔNG đụng logic dò GPU
(`local-llm.js` detectGpu/selectVariantForPreset/downloadAllBinaries nguyên vẹn): vulkan vẫn bundle (iGPU/AMD offline OK),
cpu luôn bundle, cuda tự tải userData khi gặp NVIDIA+online. Nếu cần NVIDIA-offline-ngay → bỏ `!llama-server/cuda/**`
trong package.json (revert 1 dòng). NPU: llama.cpp + onnxruntime-node KHÔNG dùng được Intel NPU lúc này.

---

# Vòng 5 — mượt cảm nhận + offload NPU, 2026-06-13

Sau khi đo: "mượt" ở tầng tính toán đã xong → ý tưởng mới chia (A) mượt cảm nhận render-side, (B) offload CPU.

## ✅ A1 — lộ dần text nguồn partial (ĐÃ LÀM, test PASS)
`app.html`: partial nguồn Nemotron mọc đơn điệu nhưng nhảy cục mỗi chunk ~560ms. Thêm rAF reveal (`_revealing`/
`_revealTick`, ease-out 10%/frame, min 1 ký tự) → chữ "chảy" mượt ~350-450ms; câu CHỐT snap đủ ngay; partial reset
ngắn hơn snap. **0 CPU inference** (thuần render). Test `scripts/test-reveal-smooth.cjs` PASS (9/9: đơn điệu, đuổi
chunk mới, snap chốt, hội tụ). Bản dịch vẫn hiện-cả-câu khi chốt (KHÔNG stream — đã loại partial-translation).

## ⏳ #5 — offload STT encoder lên NPU/iGPU qua OpenVINO EP (đang research feasibility)
RÀNG BUỘC CỨNG (user): tầng tăng tốc TÙY CHỌN, **máy không NPU/iGPU PHẢI vẫn chạy CPU như cũ** (detect→NPU→GPU→CPU
fallback, không bao giờ thay đường CPU). Máy đích có Intel NPU (AI Boost) + iGPU. Nghi vấn chính (giống DirectML):
int4 MatMulNBits (com.microsoft contrib op) có chạy được OpenVINO NPU không, hay phải re-export. Đang chạy workflow.

## ❌ DEAD vòng 4
- Hạ -t6 (mất 13-15% tok/s, 0 payback mượt), pin affinity (đã âm), `disable_prepacking` encoder (×12.9 chậm),
  llama BelowNormal priority (A/B mơ hồ: during −6% nhưng đuôi tệ hơn, băng thông chỉ dời chỗ → opt-in OFF mặc định).
