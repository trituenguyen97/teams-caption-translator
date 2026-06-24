# Teams Caption Translator

Ứng dụng **desktop (Electron, Windows)** dịch hội thoại cuộc họp **theo thời gian thực**, hỗ trợ **3 nguồn đầu vào** (Teams Live Captions · âm thanh hệ thống · micro), **đọc to bản dịch (TTS)**, **tóm tắt cuộc họp realtime** và **xuất transcript**.

Toàn bộ nhận dạng giọng nói (STT), dịch và đọc to (TTS) chạy trên **Google Gemini Live** — chỉ cần **một Gemini API key**, không cài model cục bộ, không cần Python.

> Mặc định tối ưu cho meeting **Nhật ↔ Việt** (context IT / BrSE): prompt dịch được yêu cầu **giữ nguyên tên riêng, số liệu và thuật ngữ kỹ thuật** (giữ từ ngoại lai katakana ở dạng tiếng Anh gốc).

---

## Tính năng

### Nguồn đầu vào (3 chế độ)

| Chế độ | Mô tả |
|--------|-------|
| 💬 **Teams Live Captions** | Đọc subtitle trực tiếp từ **Microsoft Teams** (client mới) qua **Windows UI Automation (UIA)** — không cần mic, không cần CDP/debug port. App vẽ **bản dịch trong cửa sổ overlay trong suốt, đè ngay lên mỗi dòng caption gốc** trong Teams, đồng thời hiện trong danh sách của app. |
| 🔊 **Âm thanh hệ thống** | Thu loopback âm thanh hệ thống. Có thể thu **toàn hệ thống** hoặc **theo từng tiến trình** (chọn đúng app họp) để **tránh thu lại tiếng TTS của chính app** (chống vòng lặp vọng âm) và **gom trọn app đa-tiến-trình** (Chrome, Teams + WebView2). |
| 🎤 **Micro** | Thu từ micro bất kỳ (chọn thiết bị). |

> Với chế độ **Âm thanh / Micro**, audio (PCM 16kHz mono) được stream thẳng lên Gemini Live Translate — model **tự nhận dạng ngôn ngữ nguồn**, trả về **caption dịch + giọng đọc bản dịch**. Danh sách trong app **chỉ hiển thị bản dịch** (ngôn ngữ đích); muốn xem lời gốc, dùng chế độ **Chép lời** (xem dưới).

### Engine dịch — Google Gemini Live (cloud, 1 API key)

| Module | Model | Vai trò |
|--------|-------|---------|
| `src/gemini-live.js` | `gemini-3.5-live-translate-preview` | **Audio mode** (hệ thống/mic): nghe PCM 16kHz → STT + dịch + TTS, tự nhận ngôn ngữ nguồn. Cũng chứa `validateKey`. |
| `src/gemini-text-live.js` | `gemini-3.1-flash-live-preview` | **Teams mode**: dịch **text caption** → bản dịch (streaming) + giọng đọc. |
| `src/gemini-text.js` | `gemini-3.1-flash-lite` → `gemma-4-31b-it` → `gemma-4-26b-it` (`generateContent`) | **Tóm tắt** cuộc họp (Markdown), chuỗi fallback theo RPD free-tier. |

- Phiên Live **tự reconnect** khi rớt/`goAway` (sliding-window context + session resumption) → chạy được phiên dài, không dính trần ~15 phút. (Audio mode: reconnect sau 1.5s; Teams mode: tự xoay phiên mỗi ~90s hoặc sau 8 lượt.)
- **Audio mode**: caption dịch **mọc dần** rồi **chốt câu** khi bản dịch kết câu (`. ? ! 。．！？`) kèm ngừng ~0.45s (`SETTLE_MS`), hoặc khi đang dở thì chỉ chốt sau khi ngừng hẳn ~2.5s (`LONG_IDLE_MS`). Mỗi dòng chỉ hiện **bản dịch** (lời gốc không hiển thị live).
- `echoTargetLanguage:false` (audio mode) → khi tiếng nói đã đúng ngôn ngữ đích, model **giữ im lặng**, giảm vọng âm khi full-duplex. (Chế độ **Chép lời** đặt `echoTargetLanguage:true` để không mất lời gốc.)

### Đọc to bản dịch (TTS)

- Bản dịch được đọc to bằng giọng Gemini (PCM 24kHz, phát **gapless** qua jitter-buffer mục tiêu ~180ms).
- **Trần độ trễ tự-điều-chỉnh** (mới): nếu hàng đợi TTS phình (model trả audio dài/nhanh hơn realtime) — vượt ~0.6s thì **tăng nhẹ tốc độ** chunk mới (≤1.12×) để rút cạn dần; vượt ~1.8s thì **bỏ phần đuôi đã xếp** và kéo độ trễ về mục tiêu → tiếng không còn tụt xa khỏi text rồi “như tắt”.
- **30 giọng dựng sẵn** (mặc định **Achernar**); chọn giọng / tắt đọc bằng nút loa 🔊/🔇 trên thanh trạng thái.

### Chép lời (transcribe mode)

- Tùy chọn **📝 Chép lời** nằm cuối danh sách cờ ngôn ngữ. Khi bật: hiển thị **lời nói gốc** (mọi ngôn ngữ, không qua dịch), **không phát TTS**. Dùng để ghi biên bản nguyên văn. Áp dụng cho cả Teams / Âm thanh / Mic.

### Tóm tắt realtime & xuất file

| Tính năng | Mô tả |
|-----------|-------|
| 📋 **Tóm tắt cuốn chiếu** | Panel tóm tắt cạnh bên (mở rộng cửa sổ thêm 380px thành 2 cột). Tự tổng hợp **cuốn chiếu**: kích hoạt khi có **≥24 câu dịch mới** (~2 phút hội thoại) **hoặc** lần đầu mở panel mà đã có nội dung; có thêm backstop quét lại mỗi **12s** phòng lỡ nhịp. Mỗi lượt gửi *bản tóm tắt trước (≤6000 ký tự) + tối đa **25 câu mới nhất*** → Gemini → render **Markdown** (heading, list, **bảng** GFM). |
| 📊 **Báo cáo tổng thể** | Nút *Tổng thể* (chỉ hiện khi đã dừng ghi và có caption) gửi **toàn bộ** transcript để tạo báo cáo chi tiết, dùng riêng chuỗi **gemma** (`gemma-4-31b-it` → `gemma-4-26b-it`, output tối đa 8192 token). |
| 💾 **Xuất transcript** | Xuất ra file `.txt` theo 3 chế độ: **Bản gốc**, **Cả hai (gốc + dịch)**, **Bản dịch** (kèm thời gian + người nói). Xuất tóm tắt ra `.md` hoặc copy clipboard. |

> ⚠️ App chỉ lưu **bản dịch** theo từng dòng. Vì vậy chế độ xuất **Bản gốc** / **Cả hai** sẽ **fallback về bản dịch** nếu dòng đó không có sẵn lời gốc (thường gặp ở audio mode). Muốn có lời gốc đầy đủ, bật **Chép lời** trước khi ghi.

### Ngôn ngữ

- **Ngôn ngữ đích (dịch):** 🇻🇳 Tiếng Việt · 🇺🇸 English · 🇯🇵 日本語 · 🇰🇷 한국어 · 🇨🇳 中文 *(5 ngôn ngữ)* + tùy chọn **📝 Chép lời**.
- **Ngôn ngữ giao diện (UI):** vi · en · ja · ko · zh-CN *(5 locale)*.
- **Ngôn ngữ nguồn:** **tự nhận diện** — cờ nguồn được ẩn ở mọi chế độ (Gemini auto language-ID).
- *(Lưu ý kỹ thuật: tiếng Trung gửi cho Gemini dưới mã BCP-47 `zh-Hans`.)*

---

## Yêu cầu hệ thống

- **Windows 10/11 (x64)** — chế độ Teams (UIA) và thu âm theo tiến trình (Process Loopback) chỉ chạy trên Windows x64.
- **Google Gemini API key** (bắt buộc — dùng chung cho dịch + tóm tắt). Lấy tại [Google AI Studio](https://aistudio.google.com/apikey).
- **Kết nối Internet** (mọi suy luận chạy trên cloud Gemini).
- **Microsoft Teams** (client mới — process `ms-teams`) — chỉ cần cho chế độ **Teams Live Captions**.
- **Node.js 18+** — chỉ cần để dev / build.

> Không cần Python, không cần tải model — kiến trúc local cũ (STT/dịch/TTS offline) đã được gỡ.

---

## Cài đặt & chạy

```bash
npm install
npm start
```

Lần đầu chạy: mở **⋮ menu → mục Dịch thuật → dán Gemini API key** (`AIza…`). App tự kiểm tra key (✓ hợp lệ / ✕ không hợp lệ) bằng một lệnh `models.list()` không tốn quota.

---

## Cách dùng

### 1) Chế độ Teams Live Captions

1. Mở **Microsoft Teams** và vào meeting.
2. Trong app: **⋮ menu → Nguồn** → chọn **💬 Teams Live Caption**.
3. Bấm **▶**. App sẽ **focus Teams và gửi `Alt+Shift+C`** để bật Live Captions, đọc caption qua UIA (poll ~40ms), dịch và **vẽ bản dịch đè lên Teams** (overlay trong suốt, click-through) + hiện trong danh sách.

> App **chỉ dịch dòng đã chốt** — dòng đang nói được bỏ qua cho tới khi đứng yên **~2.5s** (`LAST_ROW_SETTLE_MS`) hoặc kết thúc bằng dấu câu, tránh dịch lặp lúc câu còn mọc.

### 2) Chế độ Âm thanh hệ thống / Micro

1. **⋮ menu → Nguồn** → chọn **🔊 Audio hệ thống** (chọn *Toàn hệ thống* hoặc một **tiến trình** cụ thể) hoặc **🎤 Microphone** (chọn thiết bị).
2. Bấm **▶** để bắt đầu. Audio được stream lên Gemini Live Translate; caption dịch hiện ngay, kèm đọc to (nếu bật TTS).

> Nếu nguồn = *Toàn hệ thống* và bật TTS, tiếng đọc của app có thể bị thu lại (vọng). **Chọn đúng tiến trình app họp** (per-process loopback) hoặc **tắt TTS** để tránh.

### Chọn ngôn ngữ đích / giọng đọc

- Cờ ngôn ngữ trên thanh trạng thái → chọn **ngôn ngữ dịch đích** hoặc **📝 Chép lời** (đổi nóng, phiên Live tự kết nối lại).
- Nút loa 🔊 → chọn **giọng đọc** (30 giọng) hoặc **Tắt đọc**.

---

## Giao diện

Cửa sổ **không khung (frameless)** (500×720, tối thiểu 520×500), có thể **ghim luôn trên đầu màn hình** (📌). Theme là **công tắc sáng ↔ tối**; giá trị `auto` chỉ áp dụng lúc khởi động (theo `prefers-color-scheme`), không có nút chọn lại `auto` trên UI.

| Vị trí | Điều khiển | Chức năng |
|--------|------------|-----------|
| **Header** | 📌 | Ghim luôn trên đầu màn hình |
| | ▭ ✕ … | Phóng to / thu nhỏ / đóng cửa sổ |
| **Thanh trạng thái** | ▶ / ⏹ / ⏳ | Bật/tắt Live Captions (Teams) hoặc ghi âm (audio/mic) |
| | Cờ ngôn ngữ | Chọn ngôn ngữ dịch đích hoặc 📝 Chép lời |
| | 🔊 / 🔇 | Chọn giọng đọc Gemini / bật–tắt đọc to |
| | ☀️ / 🌙 | Đổi theme sáng ↔ tối |
| | ⋮ | Chọn nguồn (Teams/hệ thống/mic), thiết bị mic, tiến trình loopback, API key, ngôn ngữ giao diện |
| **Footer** | ↓ Auto | Tự cuộn xuống caption mới nhất |
| | 💾 | Xuất transcript ra `.txt` (gốc / cả hai / dịch) |
| | 🗑 | Xoá danh sách |
| | 📋 Tóm tắt | Mở panel tóm tắt realtime (2 cột) |

### Output mẫu

Danh sách live (chỉ hiện **bản dịch**):

```
Nguyen Tri Tue                                     16:35:54
Tôi chưa bao giờ tham dự lễ hội Nyan.

Nguyen Tri Tue                                     16:36:03
Cơm trắng bình thường, thực sự bình thường mà rất ngon phải không?
```

File xuất chế độ **Cả hai (gốc + dịch)** (khi có lời gốc):

```
[16:35:54] Nguyen Tri Tue:
  • ニャン祭りをしたことがありませんね。
  → Tôi chưa bao giờ tham dự lễ hội Nyan.
```

---

## Đóng gói thành file .exe

```bash
npm run build
```

Dùng `electron-builder` (target **NSIS**, `asar`, nén tối đa). Installer được tạo trong thư mục `dist/`.

> Build hiện tại **không tải asset nào** (không có hook `prebuild`); `files[]` đóng gói `main.js`, `src/**`, `preload.js`, `overlay-preload.js`, `app.html`, `overlay.html`, `scripts/*.ps1` và `node_modules`. `application-loopback` và `@google/genai` được `asarUnpack` (cần file thật ngoài asar để spawn exe loopback / nạp SDK).

---

## Cấu trúc project

```
main.js                  # Entry Electron: lifecycle, tạo cửa sổ, vòng lặp service tự-restart (UIA ↔ audio)
preload.js               # contextBridge cho cửa sổ chính  (window.__caption — ~30 kênh IPC)
overlay-preload.js       # contextBridge cho cửa sổ overlay (window.__overlay.onRows)
app.html                 # Toàn bộ UI renderer (header, danh sách caption, panel tóm tắt, settings, phát TTS)
overlay.html             # Renderer overlay trong suốt (vẽ bản dịch đè lên Teams)
package.json             # electron + @google/genai (^2.9.0) + application-loopback (1.2.7, pin)

src/
├── state.js             # State chia sẻ (singleton): nguồn, ngôn ngữ đích, cờ runtime, cấu hình Gemini
├── store.js             # Đọc/ghi settings.json trong userData (cache RAM + write-through)
├── ipc-handlers.js      # Toàn bộ IPC main ↔ renderer
├── langs.js             # Bảng ngôn ngữ đích (tên / nhãn / mã BCP-47; Trung → zh-Hans)
├── i18n.js              # Từ điển giao diện (5 locale)
│
├── gemini-live.js       # AUDIO mode: Gemini 3.5 Live Translate (STT + dịch + TTS); cũng chứa validateKey
├── gemini-text-live.js  # TEAMS mode: Gemini 3.1 Flash Live (dịch text + TTS)
├── gemini-text.js       # Tóm tắt cuốn chiếu + báo cáo tổng thể (generateContent: 3.1-flash-lite → gemma-4-31b-it → gemma-4-26b-it)
│
├── audio-stt.js         # Router audio mode: nhận PCM → geminiLive.pushAudio (STT local đã gỡ, các hàm cũ là no-op)
├── process-audio.js     # Thu âm theo tiến trình (Windows Process Loopback): 48k/stereo/s16 → 16k/mono/f32 ở MAIN
├── uia-captions.js      # Đọc caption Teams qua UIA helper + vòng chốt-câu/dịch + đẩy overlay
└── caption-overlay.js   # Cửa sổ overlay trong suốt, click-through, always-on-top trên Teams

scripts/
├── uia-captions-helper.ps1  # PowerShell đọc UIA (app ghi ra file tạm rồi spawn bằng -File khi chạy chế độ Teams)
└── uia-probe.ps1            # Script chẩn đoán UIA (chỉ dùng dev, app KHÔNG spawn)
```

---

## Cách hoạt động

### Chế độ Teams (UIA + overlay)

```
Microsoft Teams (panel "Live Captions")
   └─ scripts/uia-captions-helper.ps1  (UI Automation, poll ~40ms, NDJSON)
        └─ {t:"rows", box, vis, bg, btn, rows:[{spk,txt,x,y,w,h}]} → src/uia-captions.js (loop ~150ms)
             ├─ chỉ dịch dòng ĐÃ chốt (bỏ dòng đang nói trừ khi yên ~2.5s / kết câu); bỏ dòng còn "mọc" (prefix)
             ├─ src/gemini-text-live.js → Gemini 3.1 Flash Live (dịch text streaming + TTS)
             ├─ vẽ bản dịch ĐÈ lên Teams qua overlay trong suốt (src/caption-overlay.js, toạ độ UIA→DIP)
             └─ IPC caption-live → app.html (danh sách)
```

### Chế độ Âm thanh / Micro (Gemini Live Translate)

```
Mic/loopback (renderer Web Audio @16k)  HOẶC  per-process loopback (process-audio.js @main, 48k→16k)
   └─ PCM Float32 16kHz mono → handlePcm → src/gemini-live.js
        └─ Gemini 3.5 Live Translate (STT + dịch + TTS, tự nhận ngôn ngữ nguồn)
             ├─ outputTranscription (dịch) → IPC caption-live   [chỉ hiện bản dịch]
             │    (transcribeMode: thay bằng inputTranscription = lời gốc, không TTS)
             └─ audio TTS 24kHz → IPC gemini-audio → phát gapless (có trần độ trễ) trong app
```

### Tóm tắt cuộc họp (cuốn chiếu)

```
captions tích luỹ → khi ≥24 câu mới (~2 phút) HOẶC lần đầu mở panel có nội dung; backstop quét mỗi 12s
   └─ src/gemini-text.js: prevSummary (≤6000 ký tự) + ≤25 câu mới → generateContent (temp 0.3)
        gemini-3.1-flash-lite (500 RPD) → 429 → gemma-4-31b-it (1500) → 429 → gemma-4-26b-it (1500)
        (429 theo NGÀY → nghỉ 4h; theo PHÚT → nghỉ 90s; 404/không hỗ trợ → rớt xuống model kế)
        └─ Markdown → render panel tóm tắt → xuất .md / copy

Khi DỪNG ghi: nút 📊 "Tổng thể" → toàn bộ transcript → chuỗi gemma-only → báo cáo chi tiết (≤8192 token)
```

---

## Cấu hình (settings.json trong userData)

| Key | Mặc định | Ý nghĩa |
|-----|----------|---------|
| `apiKey` | `""` | Google Gemini API key (dịch + tóm tắt) |
| `lang` | `vi` | Ngôn ngữ đích (`vi`/`en`/`ja`/`ko`/`zh-CN`) |
| `transcribeMode` | `false` | Chép lời (hiện lời gốc, không dịch, không TTS) |
| `captureSource` | `system` | Nguồn: `teams` (UIA) · `system` (loopback) · `mic` |
| `micDeviceId` | `""` | Thiết bị micro (khi nguồn = mic) |
| `audioProcessName` | `""` | Tên tiến trình cho per-process loopback (khi nguồn = system) |
| `audioProcessApp` | `""` | Nhãn app hiển thị của tiến trình loopback |
| `geminiAudioOn` | `true` | Bật/tắt đọc to bản dịch (TTS) |
| `geminiVoice` | `Achernar` | Giọng đọc Gemini (30 giọng) |
| `summaryExtra` | `""` | Chỉ dẫn thêm cho prompt tóm tắt (tuỳ chọn) |
| `theme` | `auto` | Theme lưu trữ: `auto` / `light` / `dark` (UI chỉ bật/tắt light↔dark) |
| `uiLang` | `vi` | Ngôn ngữ giao diện |

---

## Lưu ý & hạn chế

- **Cloud:** cần mạng ổn định và **Gemini API key**; nội dung cuộc họp được gửi tới Google để xử lý.
- **Model `*-preview`:** `gemini-3.5-live-translate-preview` và `gemini-3.1-flash-live-preview` là hằng số `MODEL` trong `src/gemini-live.js` / `src/gemini-text-live.js` — đổi model thì sửa hằng số đó. Riêng **tóm tắt** dùng `SUMMARY_CHAIN` (chuỗi fallback + dò qua `ListModels` lúc chạy) trong `src/gemini-text.js`, không phải một hằng số đơn.
- **Teams mode chỉ Windows:** cần Teams client mới (`ms-teams`) đang mở meeting và bật được Live Captions (`Alt+Shift+C`). Khi bật caption, app **tạm ghim** cửa sổ ~8s để thao tác focus không che app.
- **Per-process loopback & UIA** chỉ chạy trên **Windows x64**. Loopback gom theo **cây tiến trình** (root-PID) nên thu trọn app đa-tiến-trình và không thu lại TTS của chính app; exe loopback **bỏ khung im lặng (−70dB)** nên dùng đồng hồ thực để đóng khúc.
- **Ngôn ngữ nguồn** do Gemini tự nhận diện — nên kiểm chứng theo từng cặp ngôn ngữ.
- **Vọng âm (system + TTS):** thu *toàn hệ thống* + bật đọc to có thể khiến app nghe lại chính nó. Dùng **per-process loopback** (chọn đúng app họp) hoặc **tắt TTS**.
