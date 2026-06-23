# Teams Caption Translator

Ứng dụng **desktop (Electron, Windows)** dịch hội thoại cuộc họp **theo thời gian thực**, hỗ trợ **3 nguồn đầu vào** (Teams Live Captions · âm thanh hệ thống · micro), **đọc to bản dịch (TTS)**, **tóm tắt cuộc họp realtime** và **xuất transcript**.

Toàn bộ nhận dạng giọng nói (STT), dịch và đọc to (TTS) chạy trên **Google Gemini Live** — chỉ cần **một Gemini API key**, không cài model cục bộ, không cần Python.

> Mặc định tối ưu cho meeting **Nhật ↔ Việt** (context IT / BrSE): prompt dịch được yêu cầu **giữ nguyên tên riêng, số liệu và thuật ngữ kỹ thuật**.

---

## Tính năng

### Nguồn đầu vào (3 chế độ)

| Chế độ | Mô tả |
|--------|-------|
| 💬 **Teams Live Captions** | Đọc subtitle trực tiếp từ **Microsoft Teams** (client mới) qua **Windows UI Automation (UIA)** — không cần mic, không cần CDP/debug port. App vẽ **bản dịch trong cửa sổ overlay trong suốt, đè ngay lên mỗi dòng caption gốc** trong Teams, đồng thời hiện trong danh sách của app. |
| 🔊 **Âm thanh hệ thống** | Thu loopback âm thanh hệ thống. Có thể thu **toàn hệ thống** hoặc **theo từng tiến trình** (chọn đúng app họp) để **tránh thu lại tiếng TTS của chính app** (chống vòng lặp vọng âm). |
| 🎤 **Micro** | Thu từ micro bất kỳ (chọn thiết bị). |

> Với chế độ **Âm thanh / Micro**, audio (PCM 16kHz mono) được stream thẳng lên Gemini Live Translate — model **tự nhận dạng ngôn ngữ nguồn**, trả về **caption gốc + bản dịch + giọng đọc bản dịch**.

### Engine dịch — Google Gemini Live (cloud, 1 API key)

| Module | Model | Vai trò |
|--------|-------|---------|
| `src/gemini-live.js` | `gemini-3.5-live-translate-preview` | **Audio mode** (hệ thống/mic): nghe PCM → STT + dịch + TTS, tự nhận ngôn ngữ nguồn. |
| `src/gemini-text-live.js` | `gemini-3.1-flash-live-preview` | **Teams mode**: dịch **text caption** → bản dịch + giọng đọc. |
| `src/gemini-text.js` | `gemini-3.1-flash-lite` → `gemma-4-31b` → `gemma-4-26b` (generateContent) | **Tóm tắt** cuộc họp (Markdown), chuỗi fallback theo RPD free-tier. |

- Phiên Live **tự reconnect** khi rớt/`goAway` (sliding-window context + session resumption) → chạy được phiên dài, không dính trần ~15 phút.
- Caption **mọc dần** theo thời gian thực rồi **chốt câu khi người nói nghỉ** (~1s im lặng); mỗi câu hiển thị **gốc + bản dịch cùng một lượt** (tránh lệch dòng gốc/dịch). Audio dịch phát **ngay, liền mạch** (không cắt đuôi khi model tự ngắt).
- `echoTargetLanguage:false` (audio mode) → khi tiếng nói đã đúng ngôn ngữ đích, model **giữ im lặng**, giảm vọng âm khi full-duplex.

### Đọc to bản dịch (TTS)

- Bản dịch được đọc to bằng giọng Gemini (PCM 24kHz, phát gapless với jitter-buffer ~180ms).
- **30 giọng dựng sẵn** (mặc định **Achernar**); bật/tắt nhanh bằng nút loa 🔊/🔇 trên thanh trạng thái.

### Tóm tắt realtime & xuất file

| Tính năng | Mô tả |
|-----------|-------|
| 📋 **Tóm tắt cuộc họp** | Panel tóm tắt cạnh bên (mở rộng cửa sổ thành 2 cột). Tự tổng hợp **cuốn chiếu**: mỗi ~45s, khi có ≥16 câu mới (hoặc ≥1 câu sau 240s), gửi *bản tóm tắt trước + tối đa 40 câu mới nhất* → Gemini → render **Markdown** (heading, list, **bảng** GFM). Xuất `.md` hoặc copy clipboard. |
| 💾 **Xuất transcript** | Xuất ra file `.txt` theo 3 chế độ: **Bản gốc**, **Cả hai (gốc + dịch)**, **Bản dịch** (kèm thời gian + người nói). |

### Ngôn ngữ

- **Ngôn ngữ đích (dịch):** 🇻🇳 Tiếng Việt · 🇺🇸 English · 🇯🇵 日本語 · 🇰🇷 한국어 · 🇨🇳 中文 *(5 ngôn ngữ)*.
- **Ngôn ngữ giao diện (UI):** vi · en · ja · ko · zh-CN.
- **Ngôn ngữ nguồn:** Teams mode = **tự nhận diện** (vì đây là cài đặt chung của meeting); Âm thanh/Mic = model Gemini tự nhận diện.

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

Lần đầu chạy: mở **⋮ menu → mục Dịch thuật → dán Gemini API key** (`AIza…`). App tự kiểm tra key (✓ hợp lệ / ✕ không hợp lệ).

---

## Cách dùng

### 1) Chế độ Teams Live Captions

1. Mở **Microsoft Teams** và vào meeting.
2. Trong app: **⋮ menu → Nguồn** → chọn **💬 Teams Live Caption**.
3. Bấm **▶**. App sẽ **focus Teams và gửi `Alt+Shift+C`** để bật Live Captions, đọc caption qua UIA, dịch và **vẽ bản dịch đè lên Teams** (overlay trong suốt) + hiện trong danh sách.

> App **chỉ dịch dòng đã chốt** — dòng đang nói được bỏ qua cho tới khi đứng yên ≥10s hoặc kết thúc bằng dấu câu, tránh dịch lặp lúc câu còn mọc.

### 2) Chế độ Âm thanh hệ thống / Micro

1. **⋮ menu → Nguồn** → chọn **🔊 Audio hệ thống** (chọn *Toàn hệ thống* hoặc một **tiến trình** cụ thể) hoặc **🎤 Microphone** (chọn thiết bị).
2. Bấm **▶** để bắt đầu. Audio được stream lên Gemini 3.5 Live Translate; caption gốc + bản dịch hiện ngay, kèm đọc to (nếu bật TTS).

> Nếu nguồn = *Toàn hệ thống* và bật TTS, tiếng đọc của app có thể bị thu lại (vọng). **Chọn đúng tiến trình app họp** (per-process loopback) hoặc **tắt TTS** để tránh.

### Chọn ngôn ngữ đích / giọng đọc

- Cờ ngôn ngữ trên thanh trạng thái → chọn **ngôn ngữ dịch đích** (đổi nóng, phiên Live tự kết nối lại).
- Nút loa 🔊 → chọn **giọng đọc** (30 giọng) hoặc **Tắt đọc**.

---

## Giao diện

Cửa sổ **không khung (frameless)**, có thể **ghim luôn trên đầu màn hình** (📌). Hỗ trợ theme **auto / sáng / tối**.

| Điều khiển | Chức năng |
|------------|-----------|
| ▶ / ⏹ | Bật/tắt Live Captions (Teams) hoặc ghi âm (audio/mic) |
| Cờ ngôn ngữ | Chọn ngôn ngữ dịch đích |
| 🔊 / 🔇 | Chọn giọng đọc Gemini / bật–tắt đọc to |
| ☀️ / 🌙 | Đổi theme sáng/tối |
| 📌 | Ghim luôn trên đầu màn hình |
| ↓ Auto | Tự cuộn xuống caption mới nhất |
| 📋 Tóm tắt | Mở panel tóm tắt realtime (2 cột) |
| 💾 Xuất | Xuất transcript ra `.txt` (gốc / cả hai / dịch) |
| ⋮ | API key, ngôn ngữ giao diện, chọn nguồn âm thanh |

### Output mẫu

```
Nguyen Tri Tue                                     16:35:54
ニャン祭りをしたことがありませんね。
Tôi chưa bao giờ tham dự lễ hội Nyan.

Nguyen Tri Tue                                     16:36:03
普通の本当に普通のなんでもない白いご飯が美味しいですよね。
Cơm trắng bình thường, thực sự bình thường mà rất ngon phải không?
```

---

## Đóng gói thành file .exe

```bash
npm run build
```

Dùng `electron-builder` (target **NSIS**, asar, nén tối đa). Installer được tạo trong thư mục `dist/`.

> Build hiện tại **không tải asset nào** (không có hook `prebuild`); chỉ đóng gói `main.js`, `src/**`, `preload.js`, `app.html`, `scripts/*.ps1` và `node_modules`.

---

## Cấu trúc project

```
main.js                  # Entry Electron: lifecycle, tạo cửa sổ, vòng lặp service tự-restart (UIA ↔ audio)
preload.js               # contextBridge cho cửa sổ chính  (window.__caption)
overlay-preload.js       # contextBridge cho cửa sổ overlay (window.__overlay)
app.html                 # Toàn bộ UI renderer (header, danh sách caption, panel tóm tắt, settings)
overlay.html             # Renderer overlay trong suốt (vẽ bản dịch đè lên Teams)
package.json             # electron + @google/genai + application-loopback

src/
├── state.js             # State chia sẻ (singleton): nguồn, ngôn ngữ đích, cờ runtime, cấu hình Gemini
├── store.js             # Đọc/ghi settings.json trong userData
├── ipc-handlers.js      # Toàn bộ IPC main ↔ renderer
├── langs.js             # Bảng ngôn ngữ đích (tên / nhãn / mã BCP-47)
├── i18n.js              # Từ điển giao diện (5 locale)
│
├── gemini-live.js       # AUDIO mode: Gemini 3.5 Live Translate (STT + dịch + TTS); cũng chứa validateKey
├── gemini-text-live.js  # TEAMS mode: Gemini 3.1 Flash Live (dịch text + TTS)
├── gemini-text.js       # Tóm tắt cuốn chiếu (generateContent: 3.1-flash-lite → gemma-4-31b → 26b)
│
├── audio-stt.js         # Router audio mode: nhận PCM → geminiLive.pushAudio (STT local đã gỡ)
├── process-audio.js     # Thu âm hệ thống theo tiến trình (Windows Process Loopback) + resample 48k→16k
├── uia-captions.js      # Đọc caption Teams qua UIA helper + vòng chốt-câu/dịch + đẩy overlay
└── caption-overlay.js   # Cửa sổ overlay trong suốt, click-through, always-on-top trên Teams

scripts/
├── uia-captions-helper.ps1  # PowerShell đọc UIA (spawn lúc chạy, chế độ Teams)
└── uia-probe.ps1            # Script chẩn đoán UIA (chỉ dùng dev, app không spawn)
```

---

## Cách hoạt động

### Chế độ Teams (UIA + overlay)

```
Microsoft Teams (panel "Live Captions")
   └─ scripts/uia-captions-helper.ps1  (UI Automation, poll ~40ms)
        └─ NDJSON {người nói, text, toạ độ, màu nền} → src/uia-captions.js
             ├─ chỉ dịch dòng ĐÃ chốt (bỏ dòng đang nói trừ khi yên ≥10s / kết câu)
             ├─ src/gemini-text-live.js → Gemini 3.1 Flash Live (dịch text + TTS)
             ├─ vẽ bản dịch ĐÈ lên Teams qua overlay trong suốt (src/caption-overlay.js, toạ độ UIA)
             └─ IPC caption-live → app.html (danh sách)
```

### Chế độ Âm thanh / Micro (Gemini Live Translate)

```
getDisplayMedia(loopback) / getUserMedia(mic)   [hoặc per-process loopback qua application-loopback]
   └─ Web Audio → PCM Float32 16kHz mono → IPC audio-pcm
        └─ src/audio-stt.js → src/gemini-live.js
             └─ Gemini 3.5 Live Translate (STT + dịch + TTS, tự nhận ngôn ngữ nguồn)
                  ├─ inputTranscription (gốc) + outputTranscription (dịch) → IPC caption-live
                  └─ audio TTS 24kHz → IPC gemini-audio → phát gapless trong app
```

### Tóm tắt cuộc họp (cuốn chiếu)

```
captions tích luỹ → mỗi ~45s (≥16 câu mới, hoặc ≥1 câu sau 240s)
   └─ src/gemini-text.js: prevSummary + ≤25 câu mới → generateContent
        gemini-3.1-flash-lite (500 RPD) → 429 → gemma-4-31b (1500) → 429 → gemma-4-26b (1500)
        └─ Markdown → render panel tóm tắt → xuất .md / copy
```

---

## Cấu hình (settings.json trong userData)

| Key | Mặc định | Ý nghĩa |
|-----|----------|---------|
| `apiKey` | `""` | Google Gemini API key (dịch + tóm tắt) |
| `lang` | `vi` | Ngôn ngữ đích (`vi`/`en`/`ja`/`ko`/`zh-CN`) |
| `captureSource` | `system` | Nguồn: `teams` (UIA) · `system` (loopback) · `mic` |
| `micDeviceId` | `""` | Thiết bị micro (khi nguồn = mic) |
| `audioProcessPid` / `audioProcessTitle` | `""` | Tiến trình cho per-process loopback (khi nguồn = system) |
| `geminiAudioOn` | `true` | Bật/tắt đọc to bản dịch (TTS) |
| `geminiVoice` | `Achernar` | Giọng đọc Gemini (30 giọng) |
| `theme` | `auto` | Theme: `auto` / `light` / `dark` |
| `uiLang` | `vi` | Ngôn ngữ giao diện |

---

## Lưu ý & hạn chế

- **Cloud:** cần mạng ổn định và **Gemini API key**; nội dung cuộc họp được gửi tới Google để xử lý.
- **Model `*-preview`:** model id được hard-code trong source (`gemini-3.5-live-translate-preview`, `gemini-3.1-flash-live-preview`); Google có thể đổi/giới hạn — đổi model phải sửa hằng số trong `src/gemini-*.js`.
- **Teams mode chỉ Windows:** cần Teams client mới (`ms-teams`) đang mở meeting và bật được Live Captions (`Alt+Shift+C`). Khi bật caption, app **tạm ghim** cửa sổ ~8s để thao tác focus không che app.
- **Per-process loopback & UIA** chỉ chạy trên **Windows x64**.
- **Ngôn ngữ nguồn** do Gemini tự nhận diện — nên kiểm chứng theo từng cặp ngôn ngữ.
- **Vọng âm (system + TTS):** thu *toàn hệ thống* + bật đọc to có thể khiến app nghe lại chính nó. Dùng **per-process loopback** (chọn đúng app họp) hoặc **tắt TTS**.
