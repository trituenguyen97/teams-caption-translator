# Tiếng Nhật: Pseudo-stream offline (ReazonSpeech) vs Windows Live Captions

Đánh giá A/B thực nghiệm giữa **nhánh STT tiếng Nhật pseudo-stream offline** của app
(sherpa-onnx + Zipformer ReazonSpeech + VAD, xem [`src/audio-stt.js`](../src/audio-stt.js))
và **Windows Live Captions** (model on-device của Microsoft) — chạy trên **cùng một đoạn audio thật**.

> TL;DR: Độ chính xác **âm thanh** hai bên ngang nhau (offline thậm chí thắng vài chỗ). Live
> Captions nhỉnh hơn rõ nhờ **hậu xử lý**: chuyển số sang chữ số (ITN), thêm dấu câu, caption
> liên tục nên đầy đủ hơn, và streaming mượt (tăng dần đều, không "rung"). → Khi máy có LC thì
> để LC lo tiếng Nhật (app đã ưu tiên vậy); **pseudo-stream offline là fallback tốt** khi không
> có LC / dùng mic / máy thiếu model — chạy offline, license Apache-2.0, không phụ thuộc Microsoft.

## Phương pháp

- **Audio**: 65s tin tài chính tiếng Nhật (giọng người thật, đọc tin về cổ phiếu 浜松ホトニクス).
- **Live Captions**: cài model `MicrosoftWindows.Speech.ja-JP`, phát audio ra loa → LC nghe (system
  audio) → đọc caption qua UI Automation (`CaptionsTextBlock`, helper [`scripts/livecaptions-helper.ps1`](../scripts/livecaptions-helper.ps1)).
- **Offline**: chép bằng `OfflineRecognizer` (Zipformer ReazonSpeech int8) + Silero VAD — đúng
  đường app commit câu trong pseudo-stream.
- Runtime: sherpa-onnx-node 1.13.2, CPU Intel Core Ultra 5 225H. Ngày đo: 2026-06-10.

## Bản chép cùng đoạn

**Live Captions (Windows):**

> そのような全面安の相場で浜松ホトニクスだけが大幅高になったわけですね**。**そうです**。**…制限値幅の上限いわゆるストップ高となる**。**前日比**500円**高の**2657円**で取引を終えました**。23.18%**という上昇率は**5月15日**の東証プライム市場…値上がり率第一位の記録です**。**急騰の直接的なきっかけは何でしょうか**。**…**2026年9月期**の通期業績予想の大幅な**情報修正**が発表された…**2220億円**から**2320億円**…**前期比9.4%**増…**28億円の上方修正**…**23.7%**増の見通しとなっています**。**

**Pseudo-stream offline (đang dùng trong app):**

> そうです浜松ホトニクスは制限値幅の上限いわゆるストップ高となる前日比**五百円**高の**二千六百五十七円**で取り引きを終えました / **パーセント**という上昇率は**五月十五日**の東証プライム市場…値上がり率第一位の記録です / …通期業績予想の大幅な**上方修正**が発表された / …従来の**二千二百二十億円**から**二千三百二十億円**へ**百億円**引き上げ**前期比九．四％**増… / 営業利益は…**二十八億円の上方修正**…**二十三．七％**増の見通しとなっています

## So sánh theo từng mặt

| Tiêu chí | Live Captions | Pseudo-stream offline |
|---|---|---|
| Độ chính xác âm | Tốt — ngang nhau | Tốt — ngang nhau |
| Số → chữ số (ITN) | ✅ `2657円`, `23.7%`, `2026年` (dễ đọc) | ❌ `二千六百五十七円`, `二十三．七％` (kanji, khó đọc) |
| Dấu câu | ✅ có 。 tách câu | ❌ không, tách theo VAD |
| Đầy đủ | ✅ bắt cả câu hỏi MC "急騰の…何でしょうか", và `23.18%` | ❌ rớt câu hỏi MC + mất số "23.18" (chỉ còn `パーセント`) — VAD cắt làm rơi |
| Lỗi đồng âm | ⚠ `情報修正` (SAI, đáng lẽ `上方修正`) 1 chỗ | ✅ `上方修正` đúng cả 2 chỗ |
| Tên riêng | ⚠ lúc `ホトニクス` lúc `ホトニックス` | ✅ `ホトニクス` nhất quán |
| Streaming | ✅ thật, tăng dần đều (monotonic), không rung, latency thấp, native | ~ mọc dần nhưng **rung** (re-decode đổi giả thuyết), chốt khi VAD lặng |
| Offline / license | Cần Win11 + tải model MS (license đóng, Limited Access) | ✅ chạy mọi nơi, Apache-2.0, bundle sẵn |
| Tốc độ CPU | Native (NPU/CPU của Windows) | Re-decode 10s buffer ~138ms (4 luồng) / 197ms (2 luồng), tải ~18–22% |

## Kết luận

Trên đoạn này, **Live Captions nhỉnh hơn rõ** — không phải vì nghe chính xác hơn (âm thanh hai
bên ngang nhau, offline còn thắng ở `上方修正` và tên riêng), mà nhờ **hậu xử lý**:

- **ITN** (số → chữ số) + **dấu câu** → caption dễ đọc hơn hẳn cho nội dung số/tài chính/họp.
- **Đầy đủ hơn** — LC caption liên tục nên không rơi nội dung ở ranh giới câu; pseudo-stream bị
  VAD cắt làm **mất vài đoạn** (câu hỏi MC, số "23.18").
- **Streaming mượt hơn** — LC tăng dần đều, không rung; pseudo-stream re-decode lại buffer nên từ
  đầu câu "nhảy" trước khi hội tụ.

→ **Khi máy có LC → để LC lo tiếng Nhật** (app đã ưu tiên: nguồn System + model ja-JP đã cài →
dùng LC). **Pseudo-stream offline là fallback tốt** (mic / không có LC / máy thiếu model): độ chính
xác âm tương đương, chạy offline + license sạch, nhưng thua ở ITN + dấu câu + độ đầy đủ.

Lưu ý sản phẩm: người dùng đọc **bản dịch** (sang tiếng Việt) là chính — MT engine xử lý số kanji
ổn, nên khoảng cách ITN ảnh hưởng ít hơn ở bản dịch, rõ nhất ở phần hiển thị nguyên văn tiếng Nhật.

## Hướng thu hẹp khoảng cách cho nhánh fallback (chưa làm)

1. **VAD ít cắt rơi hơn**: tăng `minSilenceDuration`/`maxSpeechDuration` hoặc cho partial buffer
   overlap để không mất từ ở ranh giới → khắc phục điểm yếu "rớt đoạn".
2. **ITN nhẹ**: bảng/regex chuyển số kanji → chữ số Ả Rập cho phần hiển thị (số là thứ LC hơn rõ nhất).
3. **Giảm rung partial**: chỉ cập nhật phần prefix ổn định giữa các lần re-decode.

## Cập nhật 2026-06-11 — đã thu hẹp gần hết khoảng cách

Các điểm yếu ở bảng trên (ITN, dấu câu, đầy đủ, rung) **đã xử lý** trong nhánh offline:

- **ITN** ([`src/ja-itn.js`](../src/ja-itn.js)) — số kanji → Ả Rập, GIỮ đơn vị `億/万` như LC (`二千二百二十億→2220億`),
  xử lý thập phân `九．四％→9.4%`. Guard không phá kanji trong từ (`九州`, `第一四半期` giữ nguyên).
- **Dấu câu 、。** ([`src/punctuate-ja.js`](../src/punctuate-ja.js)) — model char-BERT `bobfromjapan/bert_japanese_punctuation`
  export ONNX **int4** (~78MB, ~50ms/câu) chạy offline qua onnxruntime-node. Chèn căn 1:1 GIỮ ký tự gốc (không rớt `％．・`).
  `？` thêm bằng heuristic đuôi nghi vấn (`〜か→〜か？`; `でしょう/だろう` + từ hỏi).
- **Đầy đủ** — feed VAD theo **cửa sổ 512** (= windowSize Silero) thay vì khung 4000 (đo thực: 4000 GỘP đoạn → mất câu;
  512 cho 8/8 đoạn) + **hàng đợi finalize tuần tự** (mỗi đoạn VAD = đúng 1 caption, không gộp/rớt).
- **Giảm rung** — **LocalAgreement-2** (chỉ hiện prefix mà 2 lần re-decode đồng ý) + pre-roll ring giữ onset.
- **Làm mượt ngắt câu** — KHÔNG ép `。` sau trợ từ nối (`は/を/に/で/から`…), và bỏ `。` model lỡ đặt ở biên VAD
  (`そうです。浜松ホトニクスは。`→`…は`) → đoạn kế nối tiếp như LC thay vì hard-stop sai sau trợ từ.

→ Trên nhiều đoạn (4 clip × 44s từ cùng nguồn) nhánh offline giờ **≈ LC về độ chính xác + đầy đủ**, ITN/dấu câu tương đương.
Vẫn còn: streaming của LC là native nên latency thấp hơn (offline re-decode), và LC chạy NPU.

### Hotwords / contextual biasing — ĐÃ THỬ, KHÔNG DÙNG (2026-06-11)

Thử bias thuật ngữ/tên riêng (`浜松ホトニクス`, `制限値幅`, `上方修正`) trên transducer offline ReazonSpeech qua
`OfflineRecognizer` + `decodingMethod:'modified_beam_search'` + `hotwordsFile` + `hotwordsScore` (cả char tách-cách lẫn
`modelingUnit:'cjkchar'` đều chạy, không lỗi). **Kết luận: phản tác dụng → không nối vào:**

- **Lợi ích = 0**: greedy đã bắt đúng các thuật ngữ này (cả đoạn 4s lẫn 14s).
- **Beam chậm 3×** (4s: 73→229ms; 14s: 438→739ms) và **ra tệ hơn** (đoạn 14s beam rớt sạch phần số `…円です`).
- **Hotwords làm HỎNG output ở mọi score** (1.0/1.5/2.5): chèn lố/lặp (`浜松ホトニクスだけが浜松ホトニクス…`), hỏng đuôi (`多い→を`).

→ Giữ **greedy** (nhanh + chính xác hơn). Nếu sau này một deployment có jargon model nghe sai thật, cân nhắc lại với score
rất thấp + đo kỹ; mặc định KHÔNG bật.

### A/B 5 clip MỚI vs Live Captions (2026-06-11) — đa dạng domain + giọng nhanh + clip dài

Bắt LC THẬT (chạy `livecaptions-helper.ps1` ja-JP ẩn, phát audio ra loa, đọc `CaptionsTextBlock`) + offline trung thực
(cùng audio), trên 5 clip: thời tiết giàu số/địa danh (news1, tbs, wx), talk-show hội thoại nhanh (talk), và **clip dài
~130s** hội thoại trượt băng (talklong). Phân tích có verify đối kháng (mỗi diff bị 1 agent soi overclaim).

**Bảng tổng kết theo chiều:**

| Chiều | Bên thắng | Bằng chứng |
|---|---|---|
| **Completeness** | **LC** (5/5) | Offline rớt trọn câu/lượt ở đoạn dài + hội thoại nhanh. news1 rớt cả `洗濯日和` + toàn bộ "điểm thứ ba" Okinawa/Amami; talk rớt cả turn hỏi-đáp; talklong = bản tóm tắt. |
| **Accuracy** (nơi cả hai bắt được) | **Offline** | LC VỠ thành nonsense ở giọng nhanh: `敵機`←お天気, `アルミ通し`←ある見通し (tbs); `山具`←雨具, `積もり`←曇り (wx); `凄く食べます`←nonsense, `北朝鮮`←? (talklong). Offline mạch lạc. |
| **ITN-số** | Hòa | 10時間/9日/11日 khớp cả hai. |
| **Punctuation** | Hỗn hợp | Offline `。` cấp câu sạch hơn (char-BERT); LC giàu `、` + bắt `？` câu hỏi (`じゃないですか？`). Cả hai yếu `、` nội câu. |
| **Proper nouns** | **Offline** (tên người) | Offline ra kanji đúng tên VĐV `璃来/隆一`; LC katakana lộn xộn `リキ/リク`. Địa danh khớp 100%. |

**Một dòng:** LC phủ đủ nhưng vỡ ở giọng nhanh; offline chính xác + sạch `。` + tên kanji đẹp Ở ĐOẠN nó bắt được, NHƯNG
rớt nội dung đoạn dài. **Hai bản bổ sung nhau; lỗi chính của offline là COVERAGE, không phải nghe nhầm.**

**Root-cause completeness (chẩn đoán + verify):** đoạn VAD `>~10s` → transducer ReazonSpeech mất phần giữa/đuôi (train trên
utterance ngắn). VD news1 seg dài 13.7s chỉ phun ~5s text, rớt ~8s. **Hạ `maxSpeechDuration` ja 12→6/7/8s thu hồi phần lớn**
(verified: @6 phủ 8/8 câu news1; @7 talk/talklong đầy đủ hơn hẳn, chưa thấy giảm chính xác) — nhưng KHÔNG triệt để 100% vì
turn cực ngắn vẫn lọt khe VAD. Tradeoff cần đo khi áp: cắt ngắn hơn có thể phân mảnh câu → ảnh hưởng `。` char-BERT.

**Gap còn lại + hướng fix (ưu tiên):** ① hạ `maxSpeechDuration` ja ([src/stt.js:164](../src/stt.js#L164)) 12→7, A/B đo CẢ
completeness + accuracy/punctuation. ② thêm `？` cho câu hỏi gián tiếp (`…じゃないですか/…ですかね/…んですか`) + cân nhắc `、` nội câu.
③ ITN `レベル＋số` ([src/ja-itn.js:50](../src/ja-itn.js#L50), hiếm, rủi ro regression `二三/九州`). **KHÔNG đụng:** accuracy giọng
nhanh + `。` + tên kanji (offline đang thắng).

> **Đính chính (2026-06-11, sau khi phát hiện xung đột DLL):** nhận xét "offline thưa `、` nội câu" ở trên bị PHÓNG ĐẠI
> bởi 1 bug harness: sherpa-onnx-node load TRƯỚC onnxruntime-node trong cùng process làm model punctuation CHẾT LẶNG LẼ
> (dlopen "cannot run %1") → các transcript offline trong A/B này hầu hết KHÔNG qua model 、。 (chỉ có `。` ép cuối đoạn).
> App thật cũng dính (warm sherpa trước punctuate) — đã fix bằng `require('onnxruntime-node')` ĐẦU TIÊN ở `main.js`.
> Sau fix, `、` nội câu của char-BERT hoạt động đúng (`…広がりまして、特に…`) → gap punctuation thực tế NHỎ hơn bảng trên.

## Vì sao không dùng model streaming Nhật của bên thứ ba

Không có model streaming tiếng Nhật chính thức nào sherpa-onnx nạp được (tới 6/2026). Một model
cộng đồng đa ngữ (`sherpa-onnx-streaming-zipformer-ar_en_id_ja_ru_th_vi_zh-2025-02-10`) có chạy
streaming thật nhưng **kém chính xác hơn model offline + phun token latin rác** (`H`/`P` đầu câu) +
license/nguồn mirror không rõ → không chọn. Chi tiết: xem ghi chú nghiên cứu trong bộ nhớ dự án.
