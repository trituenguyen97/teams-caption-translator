# Known issues — STT (Nemotron 5-in-1) + dịch

Cập nhật: 2026-06-13. Nhánh `research/nemotron-asr`.

## 1. Đọc SAI số phức tạp tiếng Nhật (chưa giải quyết triệt để)

**Hiện tượng:** với số dài/đọc nhanh, Nemotron int4 thỉnh thoảng **rớt chữ số đầu**:
- `9.2%` (九点二パーセント) → ra `2%` (二, mất 九点)
- `11.8%` (十一点八パーセント) → ra `1.8%` (一点八, mất 十)
- số có `兆/億` lồng nhau (vd `1兆1319億円`) cũng dễ rớt thành phần.

**Bản chất:** đây là **STT nghe sai từ gốc** (model accuracy), KHÔNG phải lỗi ITN/dịch.
Đã kiểm chứng: `ja-itn` chuyển đúng (`九点二パーセント`→`9.2%`); chỉ là model xuất ra `二パーセント`.
→ **Không vá được ở hậu xử lý** (không có chữ số để mà sửa). Khác với bug "11/8" (đã sửa: STT đúng,
chỉ MiLMMT hiểu nhầm dấu `点` → vá bằng ITN-trước-dịch).

**Đã giảm thiểu phần nào:**
- `fixNumberScale` (translation.js) — vá lệch bậc 万/億/兆 khi STT đúng nhưng dịch sai bậc.
- `fixYear` — vá năm số-chữ-Hán bị rớt chữ số (二千二十六年→2006 → sửa thành 2026) khi STT đúng.
- `ja-itn` đổi số kanji→chữ số TRƯỚC dịch → MiLMMT đọc số chuẩn hơn.
  (Các vá này chỉ cứu được khi STT phiên âm ĐÚNG; rớt-chữ-số-từ-STT thì chịu.)

**Hướng cải thiện (chưa làm):** A/B **Nemotron int8 cho ja** (research: int4 hại CJK mạnh, int8 gần
lossless) — kỳ vọng đỡ rớt chữ số. Đánh đổi: +~280MB (model ~1.3GB), phải tải + benchmark lại.

## 2. Tua/seek audio nguồn → STT ngừng chạy (ĐÃ THÊM TỰ-LÀNH 2026-06-13)

**Hiện tượng (báo cáo):** đang transcribe, tua lại audio nguồn → STT "đọc lại" rồi **ngừng hẳn**,
phải ⏹ rồi ▶ mới chạy lại. (Chưa reproduce được trong dev → fix theo hướng phòng thủ.)

**Nguyên nhân khả dĩ + tự-lành đã thêm:**
- **Main (audio-stt.js `_pumpNemo`):** audio bất thường khi tua có thể làm hỏng state session
  (encoder cache) → mọi accept/decode sau đó lỗi → STT chết tới khi ⏹▶ (resetSegmentation tạo session mới).
  → Bọc TOÀN BỘ thân pump trong try-catch: **bất kỳ lỗi nào → `_nemo=null` + reset state → frame sau
  `_ensureNemo` tạo session sạch** → tự phục hồi, khỏi ⏹▶. (Verify bằng mock: ném lỗi → tái tạo → STT chạy lại.)
- **Renderer (app.html):** `AudioContext` bị suspend ngầm (đổi thiết bị/tua) → `onaudioprocess` ngừng bắn
  → hết PCM → STT chết thầm. → (a) `onstatechange` → resume khi rời 'running'; (b) **watchdog**: >3s không
  có khung PCM → `resume()` (an toàn, KHÔNG re-prompt getDisplayMedia).

**Nếu vẫn tái diễn:** xem console log —
- `[audio-stt] nemo pump lỗi → tái tạo session: ...` = main path (session hỏng, đã tự tái tạo).
- `[audio] PCM ngừng >3s → resume AudioContext` = renderer path (ctx kẹt, đã resume).
- Nếu KHÔNG có log nào mà STT vẫn chết → khả năng track audio `ended` (nguồn share dừng) → cần ▶ lại
  (không auto-restart capture để tránh popup chọn màn hình).
