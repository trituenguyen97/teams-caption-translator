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

## Vì sao không dùng model streaming Nhật của bên thứ ba

Không có model streaming tiếng Nhật chính thức nào sherpa-onnx nạp được (tới 6/2026). Một model
cộng đồng đa ngữ (`sherpa-onnx-streaming-zipformer-ar_en_id_ja_ru_th_vi_zh-2025-02-10`) có chạy
streaming thật nhưng **kém chính xác hơn model offline + phun token latin rác** (`H`/`P` đầu câu) +
license/nguồn mirror không rõ → không chọn. Chi tiết: xem ghi chú nghiên cứu trong bộ nhớ dự án.
