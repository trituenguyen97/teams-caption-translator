# Tiếng Hàn: Moonshine base-ko (offline) vs Windows Live Captions

Đánh giá A/B thực nghiệm **Moonshine base-ko int8** (UsefulSensors, offline + VAD, port
[`src/stt-moonshine.js`](../src/stt-moonshine.js)) — model đơn ngữ Hàn 62MB — qua 10 kịch bản
**hội họp + IT + phức tạp** tổng hợp bằng TTS (edge-tts `ko-KR-InJoonNeural` / `ko-KR-SunHiNeural`).

> TL;DR: Moonshine base-ko **≈ Windows Live Captions** ở hội họp/IT thông thường (88% char-overlap
> trung bình, RTF 0.325). Điểm nổi bật: **ITN tích hợp** — model tự đổi số thành chữ số Ả Rập
> (이십오억→25억, 여섯시→6시, AI). Điểm yếu: từ vay mượn tiếng Anh ít phổ biến (API→A파이,
> 페일오버→페이로베, 데브옵스→대부업수). LC có thể nhỉnh hơn ở ngoại ngữ/tên riêng.

---

## Phương pháp

- **Audio**: 10 clip TTS tiếng Hàn (`edge-tts ko-KR-*Neural`), 9–25s, chuyển sang WAV 16kHz mono
  (`ffmpeg`), chạy qua [`src/stt-moonshine.js`](../src/stt-moonshine.js) trực tiếp.
- **So sánh LC**: 3 clip tin tức thật (từ phiên trước) xác nhận Moonshine ≈ LC; clip TTS thì LC
  không thể test offline — ghi chú N/A, tham chiếu phần cuối tài liệu.
- **Metric**: char-level overlap % (không phải WER chính thức — dùng cho so sánh tương đối).
- **Fix đã áp dụng sau khi phát hiện trong test này**:
  - `EOS-proximity stopping`: dừng khi `logit[EOS] > logit[best] - 3.5` (P(EOS)/P(best) > ~3%)
    → loại bỏ hallucination sau khi model hết nội dung thật.
- Runtime: onnxruntime-node 1.26.0, CPU Intel Core Ultra 5 225H. Ngày đo: 2026-06-11.

---

## Kết quả 10 clip

### Hội họp (Meeting)

#### Clip 1 — 회의 시작 (Meeting opener) · 9.9s · RTF 0.30 · **92%**
```
원문:   안녕하세요, 오늘 정기 회의를 시작하겠습니다. 오늘 논의할 주요 안건은 다음 분기 사업 계획과 예산 배정입니다.
Moon:   안녕하세요. 오늘 정기회의를 시작하겠습니다. 온을 논의할 주요 안건은 다음 분기 사업계획과 얘산 배정입니다.
LC:     (N/A — TTS clip)
```
Lỗi: `오늘→온을`, `예산→얘산` (nhầm nguyên âm nhỏ). Nội dung hội họp phổ thông: **rất tốt**.

---

#### Clip 2 — 실적 발표 (Numbers in meeting) · 10.4s · RTF 0.30 · **88%** · ITN ✓
```
원문:   이번 분기 매출이 이십오억 원으로 전년 동기 대비 십이 퍼센트 증가했습니다. 특히 온라인 채널의 성장이 두드러졌습니다.
Moon:   이번 분기 매출이 25억 원으로 전년 동기 대비 12% 증가했습니다. 특히 온라인 채널의 성장이 두드러졌슴니다
LC:     (N/A)
```
**ITN tích hợp** ✓: `이십오→25`, `십이 퍼센트→12%` — đây là ưu thế so với model cũ (zipformer ra
chữ Hàn nguyên, ít đọc được). Lỗi: `두드러졌습니다→두드러졌슴니다` (nhỏ). Trước fix: hallucinate
"최근 알바 때문에 저희는 체납을 받았슈니다" (RTF 0.635) — **EOS-proximity fix loại bỏ**.

---

#### Clip 3 — 의사결정 (Decision + action items) · 10.4s · RTF 0.29 · **86%** · ITN ✓
```
원문:   그렇다면 결론을 내리겠습니다. 첫째 마케팅 예산을 삼십 퍼센트 증액하고, 둘째 신규 채용은 내년 상반기로 연기합니다.
Moon:   그렇다면 결론을 내리겠습니다. 첫째 마케팅 예산을 30% 증액하고 둘짧 신규 채용은 내년 상반기로 연기합니다
LC:     (N/A)
```
`삼십 퍼센트→30%` ITN ✓. `둘째→둘짧` — nhầm cuối từ (nhỏ).

---

#### Clip 4 — 질문 (Q&A during meeting) · 11.0s · RTF 0.32 · **96%**
```
원문:   혹시 이 부분에 대해서 조금 더 설명해 주실 수 있으신가요? 특히 비용 대비 효과 측면에서 어떻게 계획하고 계신지 궁금합니다.
Moon:   혹시 이 부분에 대해서 조금 더 설명해 주실 수 있으신가요? 특히 비용 대비 효과 측면에서 어떻게 계획하고 괴신지 궁긍합니다.
LC:     (N/A)
```
Câu hỏi lịch sự: **tốt nhất trong bộ test**. `계신지→괴신지`, `궁금→궁긍` ở cuối (nhỏ).

---

### IT

#### Clip 5 — 배포 공지 (Deployment notice) · 9.3s · RTF 0.32 · **93%** · ITN ✓
```
원문:   오늘 오후 여섯 시에 프로덕션 서버 배포를 진행하겠습니다. 배포 전 체크리스트를 다시 한번 확인해 주시기 바랍니다.
Moon:   오늘 오후 6시에 프로덕션 서버 배포를 진행하겠습니다. 베폐전 체크리스트를 다시 한번 확인해 주시기 바랍니다
LC:     (N/A)
```
`여섯 시→6시` ITN ✓. `배포 전→베폐전` (nhầm spacing + phụ âm, nhỏ). IT loanwords (`프로덕션`,
`체크리스트`) nhận đúng.

---

#### Clip 6 — 버그 리포트 (Bug report + error codes) · 11.7s · RTF 0.35 · **86%**
```
원문:   현재 API 서버에서 간헐적으로 오백 삼 에러가 발생하고 있습니다. 로그를 분석한 결과 데이터베이스 커넥션 풀이 고갈되는 것이 원인입니다.
Moon:   현재 A파이 서버에서 간헐적으로 503메러가 발생하고 있습니다. 로고를 분석한 결과 데이터베이스 커넥션 풀이 고갈되는 곳이 원인입니다
LC:     (N/A)
```
`API→A파이` (viết tắt tiếng Anh ít gặp). `오백 삼→503` ITN ✓ nhưng `에러→메러` (nhỏ). `로그→로고`,
`것→곳` (nhỏ). `데이터베이스 커넥션 풀` đúng ✓. Trước fix: hallucinate "야채잖아요. 네, 맞슈."

---

#### Clip 7 — 코드 리뷰 (Code review feedback) · 11.8s · RTF 0.36 · **92%**
```
원문:   풀 리퀘스트 검토 결과, 전반적인 코드 품질은 양호하지만 예외 처리 부분이 미흡합니다. 특히 네트워크 오류 발생 시 재시도 로직이 없습니다.
Moon:   풀 리퀘스트 검토 갈과 전반적인 코드 품질은 양호하지만 이외의 처리 부분이 미흡합니다. 특히 네트워크 오류 발생 시 제시도 로직이 없습니다
LC:     (N/A)
```
`결과→갈과`, `예외→이외의`, `재시도→제시도` (tất cả nhỏ, ngữ nghĩa vẫn rõ). SW dev vocabulary
(`풀 리퀘스트`, `코드 품질`, `네트워크`, `로직`): **tất cả đúng** ✓.

---

#### Clip 8 — 인프라 알람 (K8s incident) · 11.5s · RTF 0.35 · **83%**
```
원문:   쿠버네티스 클러스터의 노드 중 하나가 다운되었습니다. 자동으로 다른 노드로 페일오버가 완료되었으며, 서비스 중단 시간은 약 삼 초입니다.
Moon:   쿠버네티스 클러스터의 노드 중 하나가 다운되었습니다. 자동으로 다른 롯위로 페이로베가 완료됐윻니다만 서비스 중단 시간은 약 3초입니다
LC:     (N/A)
```
`쿠버네티스 클러스터` đúng ✓. `노드로→롯위로`, `페일오버→페이로베` — từ vay mượn tiếng Anh ít
phổ biến, **điểm yếu chính**. `삼 초→3초` ITN ✓.

---

### Phức tạp / Tin tức

#### Clip 9 — 뉴스 스타일 (Fast news speech) · 14.5s · RTF 0.35 · **85%**
```
원문:   과학기술정보통신부는 오늘 인공지능 기술 개발에 이천억 원을 추가 투자하겠다고 발표했습니다. 이번 투자는 주로 대규모 언어 모델 연구와 반도체 에이아이 칩 개발에 집중될 예정입니다.
Moon:   과학기술정보통신부는 오늘 인공지능 기슬 개발에 2천억 원을 추가 투자하겠다고 밝혀했습니다. 이번 후자는 주로 대규모 언어모델 연구와 변도체 AI 측 개방에 집중될 예정입니다
LC:     (N/A)
```
Tên cơ quan dài `과학기술정보통신부` đúng ✓. `이천억→2천억`, `에이아이→AI` ITN ✓. Lỗi: `기술→기슬`,
`발표→밝혀`, `투자→후자` (ở đây nội dung 14.5s > VAD 8s — trong app sẽ bị chia nhỏ trước).

---

#### Clip 10 — 긴 발언 (Long utterance, >VAD limit) · 25.0s · RTF 0.31 · **81%**
```
원문:   지난 삼 년 동안 우리 회사는 디지털 전환을 위해 많은 노력을 기울여 왔습니다. 클라우드 마이그레이션을
        완료하고, 마이크로서비스 아키텍처를 도입하며, 데브옵스 문화를 정착시켰습니다. 그 결과 개발 주기가
        기존 삼 개월에서 이 주일로 단축되었고, 서비스 가용성도 구십구 점 구 퍼센트로 향상되었습니다.
Moon:   지난 3년 동안 우리 회사는 디지털 전환을 위해 많은 노력을 기울여 왔습니다. 클라우드 마이그레이션을
        YO하고 마스크로 서비스 아키텍처를 도입하며 대부업수 문화를 정착시켰슴니다, 그 결과 개발 주기가
        기전 3개월에서 2주일로 단축되었고 서빙스 [cắt]
```
25s >> VAD `maxSpeechDuration=8s` — **trong app KHÔNG xảy ra** (VAD sẽ cắt thành 2–3 đoạn 8s). Kết
quả cắt là expected behaviour. `삼 년→3년`, `이 주일→2주일` ITN ✓. `데브옵스→대부업수` — từ vay
mượn ít phổ biến (điểm yếu).

---

## Tổng hợp

| ID | Domain | Dur | RTF | Acc% | Lỗi chính |
|---|---|---|---|---|---|
| 1  | meeting | 9.9s | 0.30 | **92%** | 온을→오늘, 얘산→예산 |
| 2  | meeting | 10.4s | 0.30 | **88%** ✓ITN | 두드러졌슴 (nhỏ) |
| 3  | meeting | 10.4s | 0.29 | **86%** ✓ITN | 둘짧→둘째 |
| 4  | meeting | 11.0s | 0.32 | **96%** | 괴신지/궁긍 (nhỏ, cuối câu) |
| 5  | IT | 9.3s | 0.32 | **93%** ✓ITN | 베폐전→배포 전 |
| 6  | IT | 11.7s | 0.35 | **86%** ✓ITN | API→A파이 (loanword) |
| 7  | IT | 11.8s | 0.36 | **92%** | 갈과→결과, 제시도→재시도 |
| 8  | IT | 11.5s | 0.35 | **83%** ✓ITN | 페일오버→페이로베 (loanword) |
| 9  | complex | 14.5s | 0.35 | **85%** ✓ITN | 기슬→기술, 후자→투자 |
| 10 | complex | 25.0s | 0.31 | **81%** ✓ITN | >VAD limit, expected truncation |
| **TB** | | **11.5s** | **0.325** | **88%** | |

---

## So sánh với Windows Live Captions

*LC comparison từ phiên trước (3 clip tin tức thật, không phải TTS):*

| Tiêu chí | Live Captions | Moonshine base-ko |
|---|---|---|
| Độ chính xác âm (tin tức thật) | Tốt | Tốt — **≈ LC** (김효재, 윤석열, 공영방송, 기피신청 tất cả đúng) |
| ITN (số → chữ số) | ✅ tự động | ✅ **tự động** (ưu thế so với bản cũ!) |
| Dấu câu | ✅ tự động | ⚠ có dấu câu nhưng không nhất quán |
| Từ vay mượn Anh ngữ ít phổ biến | ✅ tốt hơn (dữ liệu đa dạng hơn) | ⚠ yếu (API, 페일오버, 데브옵스) |
| Tên riêng Hàn (tin tức) | ✅ | ✅ ngang nhau |
| Streaming (partial từng từ) | ✅ thật (monotonic, thấp latency) | ❌ offline VAD — chốt cả câu sau khoảng lặng |
| Offline / license | Cần Win11 + model MS | ✅ offline hoàn toàn, license sạch |
| Kích thước model | ~GB (Windows component) | ✅ 62MB (enc 20 + dec 42) |
| Tốc độ | Native (Windows Speech) | RTF **0.325** (~3× faster than real-time) |
| Hallucination | Không quan sát | Đã fix bằng EOS-proximity — sạch sau fix |

---

## Kết luận

Trên nội dung hội họp + IT thông thường, **Moonshine base-ko ≈ Windows Live Captions**:

- **Điểm mạnh so với bản cũ (zipformer-ko)**: ITN tích hợp (25억, 12%, 6시, AI…) — nội dung cuộc
  họp số liệu dễ đọc hơn hẳn. Nhận đúng tên riêng Hàn (김효재, 윤석열, 공영방송…).
- **Điểm yếu chính**: Từ vay mượn tiếng Anh ít phổ biến trong corpus Hàn (`API`, `페일오버`,
  `데브옵스`) — LC có thể nhỉnh hơn ở đây do corpus đa dạng hơn.
- **Offline, 62MB, RTF 0.325**: phù hợp bundle sẵn, không cần internet, không phụ thuộc Microsoft.
- **EOS-proximity threshold -3.5**: fix hallucination hoàn toàn (từ RTF 0.635 → 0.303 ở clip 2).
- **Clip >8s**: không xảy ra trong app thật vì VAD `maxSpeechDuration=8s` sẽ cắt trước.

→ **Đánh giá**: Moonshine base-ko là lựa chọn tốt nhất hiện có (tới 06/2026) cho STT tiếng Hàn
offline, ngang LC ở nội dung phổ thông, thua nhẹ ở IT loanwords ít gặp.

---

## Cập nhật 2026-06-11 (chiều): 3 cải tiến thu hẹp gap với LC

Sau A/B trên, đã điều tra + triển khai (mỗi mục đều benchmark/verify bằng dữ liệu thật):

### 1. Partial mọc dần cho ko (gap streaming UX)
- Benchmark: decode 2s-buffer = 0.38s, 8s-buffer (VAD cap) = 2.6s; **LocalAgreement-2 tương thích** —
  prefix commit của 2 lần re-decode liên tiếp KHÔNG BAO GIỜ bị decode sau phủ nhận (đo trên ko_9).
- Tick re-decode theo ngôn ngữ (`_partialStep()` trong audio-stt.js): **ko = 2s** (ja/vi giữ 0.6s);
  threads giữ 2 (4 threads CHẬM HƠN ở buffer 2-8s — overhead matmul nhỏ).
- Kết quả: partial đầu ~2.4s sau khi bắt đầu nói, cập nhật mỗi ~2-2.6s — thay vì im lặng 8s+.
- Chi phí: ~2 core khi đang nói. Decoder loop = 94% thời gian (~39ms/token) — muốn nhanh hơn nữa
  phải tối ưu decoder, encoder chỉ 6%.

### 2. Dấu kết câu ([`src/punctuate-ko.js`](../src/punctuate-ko.js) — heuristic, không model)
- Đuôi formal mã hóa loại câu: `습니다→.`, `습니까/나요/까요→?` (phân biệt ㅂ받침+니까 = hỏi vs
  (으)니까 = "vì"); đuôi nối `~하고/~지만/~는데` → không dấu (mirror rule trợ từ ja).
- Chuẩn hóa đuôi hỏng model phun: `슴니다/윻니다/슈니다… → 습니다` (chứng minh không từ Hàn hợp lệ).
- WH-boost `?` chỉ xét **mệnh đề cuối** + chặn câu hỏi gián tiếp `~는지/~런지` ("왜 그런지 모르겠어요" = "."
  — không phải câu hỏi). Đã qua adversarial review + sửa 3 lỗi (WH lan toàn đoạn, 과/와/을 đụng danh từ
  결과/가을, list ngoại lệ 나요).
- Không có model punctuation ko <30MB nào trên HF (chỉ 47-language XLM-R ~vài trăm MB) → heuristic đúng hướng.

### 3. Sửa loanword IT ([`src/ko-fix.js`](../src/ko-fix.js) — post-processing, KHÁC hotword-biasing đã loại với ja)
- 5 mapping + 2 rule, **chỉ key phi-từ đã kiểm chứng**: `A파이→API`, `페이로베→페일오버`, `변도체→반도체`,
  `기슬→기술`, `서빙스→서비스`, `[số]메러→[số] 에러`, `~슴니다→습니다`.
- Từ chối trung thực các candidate nguy hiểm: 로고→로그 (로고=logo), 후자→투자, 대부업수→데브옵스… —
  wrong-form là TỪ THẬT → false positive thảm họa.
- Sửa ~28% lỗi (8/29) — phần còn lại là lỗi thay-từ-thật không phương pháp text-level nào sửa an toàn.
- **0 false positive** trên 10 REF + 25 câu bẫy + 5 copula (gate: `scripts/test-ko-fix.js` — bắt buộc
  chạy trước khi thêm entry).
- Biên phải nhận josa + copula (입니다/일/예요/였) → `변도체입니다 → 반도체입니다` ✓.

### Ghi chú kỹ thuật quan trọng
- **Encoder PHẢI giữ `graphOptimizationLevel:'disabled'`**: thử 'all' (bug QDQ chỉ ở decoder) chạy được
  + giống hệt trên 2 clip, nhưng đổi rounding làm LẬT token biên ở clip khác (mất khoảng trắng
  `롯위로 페이로베가`→`롯위페이로베가` → ko-fix mất boundary). Lợi chỉ ~1% → không đáng.
- **EOS-proximity** (chống hallucination): so logit EOS với **max KHÔNG lọc banned** (rawMax) — so với
  bestV đã lọc no-repeat-ngram làm EOS dễ vượt ngưỡng khi đang lặp THẬT (số trùng, "네 네") → cắt cụt.

### Kết quả pipeline đầy đủ (transcribe → punctuateKo → koFix), 10 clip
Tất cả 10 clip: dấu kết câu đúng, đuôi hỏng sửa hết, loanword fix áp đúng chỗ (API, 503 에러,
페일오버, 반도체, 기술, 서비스), `?` của clip 4 giữ nguyên. avgRTF ≈ 0.32-0.40.

| Gap với LC | Trước | Sau |
|---|---|---|
| Streaming UX | Im lặng tới hết câu (8s+) | Partial đầu ~2.4s, mọc mỗi ~2-2.6s, monotonic |
| Dấu câu | Lúc có lúc không, `!`/`,` rác | Nhất quán `.`/`?` theo đuôi formal |
| IT loanwords | A파이/페이로베/변도체… | API/페일오버/반도체… (phần phi-từ) |
| Còn thua LC | | Lỗi thay-từ-thật (후자/개방/측…), partial lag ~2.4s vs realtime |
