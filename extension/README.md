# Caption Translator — bản Chrome Extension (POC)

Bản extension của Caption Translator: dịch hội thoại realtime qua **Gemini Live** ngay trong trình duyệt, hiển thị trong **Side Panel**. Dùng lại nguyên engine của bản desktop (Gemini 3.5 Live Translate audio mode + tóm tắt cuốn chiếu), **bỏ phần Teams Live Caption** (UIA/overlay native không khả dụng trong trình duyệt).

> ⚠️ POC để kiểm chứng tính khả thi. Cần **Internet** (Gemini là cloud) và một **Gemini API key**.

## Chức năng

- **Nguồn âm thanh:**
  - 🎤 **Micro**.
  - 🔊 **Âm thanh (tab / màn hình / cửa sổ)** — khi bấm **▶ Bắt đầu** sẽ hiện **popup chọn của trình duyệt** (`getDisplayMedia`): chọn **Tab trình duyệt**, **Cửa sổ một app**, hoặc **Toàn màn hình**. Lấy audio của nguồn đã chọn (video bị bỏ ngay).
- **Dịch realtime:** STT + dịch + (tuỳ chọn) đọc to TTS, model tự nhận ngôn ngữ nguồn.
- **5 ngôn ngữ đích** (vi/en/ja/ko/zh-CN) + **📝 Chép lời** (hiện lời gốc, không dịch, không TTS).
- **TTS gapless** kèm trần độ trễ tự-điều-chỉnh (port từ bản desktop đã vá).
- **Tóm tắt cuốn chiếu** (≥24 câu mới hoặc lần đầu mở; backstop 12s; gửi ≤25 câu mới) + **📊 Báo cáo tổng thể** (khi đã dừng). Panel tóm tắt **kéo chỉnh chiều cao** được (thanh resize giữa list dịch và tóm tắt).
- **Xuất transcript** `.txt`, **xuất tóm tắt** `.md`, copy clipboard.
- Cài đặt lưu bằng `chrome.storage.local`.

## Cài đặt (load unpacked)

1. Mở `chrome://extensions` → bật **Developer mode**.
2. **Load unpacked** → chọn thư mục `extension/` này.
3. Bấm icon extension → **Side Panel** mở ra (icon ⚙️ ở góc phải header).
4. ⚙️ → dán **Gemini API key** (`AIza…`) — tự kiểm tra hợp lệ.
5. Chọn nguồn, ngôn ngữ đích, giọng đọc → **▶ Bắt đầu**.

> Nguồn **🔊 Âm thanh**: để bắt được tiếng, chọn **Tab** (luôn có audio) hoặc **Toàn màn hình + tick “Chia sẻ âm thanh hệ thống”**. Chọn **một cửa sổ app** thường **không kèm audio** (giới hạn của Chrome) → app sẽ báo lỗi “nguồn không có audio”.

## Kiến trúc

```
manifest.json        # MV3: permissions sidePanel + storage; host gemini API
background.js        # service worker: chỉ mở side panel khi bấm icon (setPanelBehavior)
sidepanel.html/.css  # UI (list + tóm tắt + điều khiển + resizer)
app.js               # controller: capture (getUserMedia/getDisplayMedia) → live → list + TTS + tóm tắt + export
build-single.mjs     # sinh bản gộn extension-single/ từ thư mục này (esbuild)
lib/
├── genai.mjs        # @google/genai bản web đã bundle TỰ CHỨA (kèm p-retry) — esbuild
├── gemini-live.js   # port src/gemini-live.js (audio Live Translate → callbacks)
├── gemini-text.js   # port src/gemini-text.js (tóm tắt rolling + tổng thể)
├── langs.js         # ngôn ngữ đích (Trung → zh-Hans)
└── voices.js        # 30 giọng (mặc định Achernar)
```

Tất cả chạy trong **một context (Side Panel)**: nó giữ WebSocket Gemini Live, AudioContext thu (16k) và phát (24k gapless). Capture dùng `getUserMedia`/`getDisplayMedia` **ngay trong panel** nên **không cần** `tabCapture`/`tabs` và service worker không xử lý message nữa.

## Bản gộn tối giản

Thư mục `extension-single/` là bản **3 file** (`manifest.json` + `panel.html` + `app.js` đã nhúng SDK), **sinh tự động** từ thư mục này:

```bash
npm i -D esbuild
node extension/build-single.mjs
```

Sửa code thì sửa ở `extension/` rồi build lại — `extension-single/` là build artifact, đừng sửa tay.

## Hạn chế đã biết

- **Đóng Side Panel = dừng dịch** (capture + WebSocket sống trong trang side panel). Mở lại là chạy tiếp (state nạp từ storage). Muốn chạy nền khi đóng panel → chuyển sang **offscreen document**.
- **`getDisplayMedia` chỉ trên desktop** — trình duyệt mobile không hỗ trợ chia sẻ tab/màn hình (mobile chỉ còn mic). Audio theo **một cửa sổ app** có thể không có track audio (giới hạn Chrome).
- **Chọn giọng trong audio mode gần như không đổi giọng TTS**: model `gemini-3.5-live-translate-preview` không nhận `speechConfig` (giống bản desktop). Nút giọng vẫn bật/tắt đọc to được; tên giọng hiện chỉ lưu lại.
- **API key nằm ở client** (giống bản desktop) — chỉ dùng riêng, đừng publish kèm key.
- Tóm tắt/validate key gọi REST `generativelanguage.googleapis.com` (cần CORS cho API-key request — hiện Google cho phép).
