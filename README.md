# Teams Caption Translator

Ứng dụng **desktop (Electron)** dịch hội thoại meeting theo thời gian thực, hỗ trợ **3 nguồn đầu vào** và **4 provider dịch thuật** (gồm cả dịch **offline** bằng LLM cục bộ), kèm **tóm tắt cuộc họp bằng AI** và **xuất transcript**.

> Tối ưu cho context **IT / BrSE** (meeting Nhật ↔ Việt): giữ nguyên thuật ngữ kỹ thuật tiếng Anh (bug, deploy, PR, API, sprint…).

---

## Tính năng

### Nguồn đầu vào (3 chế độ)

| Chế độ | Mô tả |
|--------|-------|
| 📹 **Teams Live Captions** | Đọc subtitle trực tiếp từ Teams desktop (WebView2) qua CDP (Chrome DevTools Protocol) — không cần mic, không tốn tài nguyên nhận dạng. App còn **chèn bản dịch ngay dưới mỗi caption gốc** trong cửa sổ Teams. |
| 🔊 **System Audio** | Ghi âm âm thanh hệ thống (loopback) → nhận dạng giọng nói **cục bộ** bằng SenseVoice-Small (sherpa-onnx). |
| 🎤 **Microphone** | Ghi âm từ mic bất kỳ → nhận dạng giọng nói cục bộ bằng SenseVoice-Small. |

> Chế độ System Audio / Microphone dùng **SenseVoice-Small** chạy hoàn toàn offline (CPU), tự tải model ~110MB lần đầu. Hỗ trợ: Tiếng Nhật, Trung, Anh, Hàn, Quảng Đông. Tích hợp lọc im lặng (RMS gating) + lọc ảo giác (hallucination filter).

### Provider dịch thuật (4 lựa chọn, không cần API key)

| Provider | Loại | Yêu cầu |
|----------|------|---------|
| 🌐 **MS Translator** | Microsoft Edge / Teams translator API | Không cần key (token lấy tự động) |
| 🌐 **Google Translate** | Endpoint công khai (browser extension API) | Không cần key (có thể bị rate-limit) |
| 🌐 **DeepL** | Endpoint extension không chính thức | Không cần key |
| 🖥️ **LOCAL TRANSLATE** | LLM cục bộ — llama.cpp, chọn model **Qwen3** (đa ngôn ngữ) hoặc **MiLMMT** (JP→VI) | Tải model trong app (~1.22–1.78 GB), chạy offline |

> Cloud LLM (Groq / OpenAI / Gemini) **đã được loại bỏ** khỏi phần dịch thuật. Nếu cấu hình cũ còn lưu một trong các provider này, app sẽ tự migrate về `google-free`.

**LOCAL TRANSLATE** chạy llama.cpp server cục bộ (OpenAI-compatible) với **2 model preset** — chọn trong **⚙️ → 🌐 Dịch thuật → "Mô hình dịch"**:

| Preset | Model (Q4_K_M) | Dung lượng | Đặc điểm |
|--------|----------------|-----------|----------|
| **Qwen3 1.7B** *(mặc định)* | Qwen3-1.7B + Qwen3-0.6B (draft) | ~1.78 GB | Đa ngôn ngữ (cả 8 ngôn ngữ đích), kiểu chat. Kèm **speculative decoding** (draft model → tăng tốc). Tự offload GPU nếu có. |
| **MiLMMT 1B** | MiLMMT-46-1B-v0.1 (Xiaomi · nền Gemma3-1B · 46 ngôn ngữ) | ~1.22 GB | Model **dịch chuyên dụng** (đặc biệt JP→VI), nhẹ hơn, **không draft**. Ưu tiên chạy **CPU** (nhanh nhất theo benchmark). |

Cơ chế chung:
- **Tải sẵn nhiều binary 1 lần** từ GitHub Releases (`ggml-org/llama.cpp`): **cpu + vulkan** (luôn) và **cuda** (chỉ khi có GPU NVIDIA), mỗi backend ở `llama-server/{cpu,vulkan,cuda}/` — **không phải tải lại** khi đổi máy/GPU.
- **Tự chọn backend khi khởi động server** tùy preset:
  - **Qwen3** — theo GPU phát hiện được: NVIDIA → CUDA · AMD/Intel Arc/iGPU → Vulkan · không có → CPU. Số thread = P-core, ctx 4096, có flash-attention + KV q8_0 (CPU) và draft speculative.
  - **MiLMMT** — **ưu tiên CPU** (`-t 4 -c 2048 --poll 0 --mlock`, idle ~0% CPU), chỉ offload khi có **GPU NVIDIA rời (dGPU)**. *Lý do:* đo thực trên Core Ultra 5 225H, MiLMMT chạy CPU-4t (~533 ms/câu) **nhanh hơn ~25%** so với iGPU-Vulkan (~665 ms) — model 1 phần + vocab 262k khiến iGPU (chia sẻ RAM) bị nghẽn băng thông.
- **Endpoint/giải mã khác nhau:** MiLMMT dùng `/completion` với prompt `Translate this from <nguồn> to <đích>:` + giải mã **greedy** (temperature 0) và **tự nhận dạng ngôn ngữ nguồn** (Nhật cho kana/kanji · Hàn cho hangul · còn lại tiếng Anh); Qwen3 dùng `/v1/chat/completions`.
- Tự khởi động server khi bấm ▶. Nếu LLM cục bộ lỗi/chưa sẵn sàng → tự **fallback sang Google Translate (free)**.

### Tóm tắt & xuất file

| Tính năng | Mô tả |
|-----------|-------|
| 📋 **Tóm tắt cuộc họp** | Tổng hợp transcript thành báo cáo Markdown (Tổng quan, Chủ đề, Vấn đề, Quyết định/Hành động) qua **ChatGPT** chạy trong cửa sổ ẩn — **không cần API key**. Xuất `.md` hoặc copy. |
| 💾 **Xuất bản gốc** | Lưu transcript gốc (thời gian + người nói + nội dung) ra file `.txt`. |

### Ngôn ngữ đích hỗ trợ

🇻🇳 Việt · 🇺🇸 English · 🇨🇳 中文 · 🇰🇷 한국어 · 🇯🇵 日本語 · 🇫🇷 Français · 🇩🇪 Deutsch · 🇪🇸 Español

---

## Yêu cầu hệ thống

- **Windows 10/11** (auto-setup CDP, GPU detect, loopback audio dùng API Windows)
- **Node.js** 18+ (để dev / build)
- **Microsoft Teams** bản desktop (New Teams — dùng WebView2) — chỉ cần cho chế độ **Teams Live Captions**
- **Python 3** + `pip install sherpa-onnx av` — chỉ cần cho chế độ **System Audio / Microphone** (chạy `stt-server.py`)

> Chế độ **LOCAL TRANSLATE** và **Tóm tắt** không cần cài thêm gì — model LLM tải trong app, ChatGPT chạy qua cửa sổ embedded.

---

## Cài đặt

```bash
npm install
npm start
```

---

## Cách dùng

### Chế độ Teams Live Captions

1. Mở **Microsoft Teams desktop** và vào meeting.
2. Chạy app: `npm start`.
3. Bấm nút **▶** ở thanh trạng thái (hoặc bật thủ công trong Teams: **More (...)** → **Language and speech** → **Turn on live captions**, hoặc phím tắt <kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>C</kbd>).

App sẽ tự kết nối CDP, phát hiện meeting, theo dõi caption và hiển thị bản dịch (đồng thời chèn ngay dưới caption gốc trong Teams).

### Chế độ System Audio / Microphone

1. Cài Python deps: `pip install sherpa-onnx av`.
2. Trong app → **⚙️ Cài đặt** → tab **🎙 Nguồn dịch** → chọn **Audio System** hoặc **Microphone** (chọn thiết bị mic nếu cần) → **Lưu**.
3. Bấm **▶** để bắt đầu ghi âm. Lần đầu tự tải model SenseVoice (~110MB).

### Chọn provider dịch / ngôn ngữ

- Dropdown ngôn ngữ ở header chọn ngôn ngữ đích.
- **⚙️ Cài đặt** → tab **🌐 Dịch thuật** → chọn provider. Với **LOCAL TRANSLATE**: chọn **Mô hình dịch** (Qwen3 đa ngôn ngữ *hoặc* MiLMMT JP→VI) rồi bấm **📥 Tải Local Translate** để tải binary + model — chỉ 1 lần (Qwen3 kèm draft ~1.78 GB; MiLMMT không draft ~1.22 GB).

---

## Thiết lập CDP cho Teams (tự động)

> *Chỉ liên quan tới chế độ **Teams Live Captions**.*

App **tự động** thiết lập debug port khi chạy lần đầu:
1. Ghi biến môi trường `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222` + registry key tương ứng.
2. Tự **restart Teams** nếu cần để debug port có hiệu lực.
3. Tự quét CDP port theo PID của process Teams (và fallback scan **9222–9240**), tránh xung đột với app khác (vd: Widgets).

### Thiết lập thủ công (nếu auto-setup thất bại)

Mở **PowerShell** và chạy:

```powershell
[System.Environment]::SetEnvironmentVariable(
  "WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS",
  "--remote-debugging-port=9222",
  "User"
)
```

Sau đó **đóng Teams hoàn toàn** (kể cả system tray) rồi mở lại.

> Để tắt: chạy lại lệnh trên với value `""` và restart Teams.

---

## Giao diện

Cửa sổ có thể ghim luôn trên đầu màn hình (📌).

| Điều khiển | Chức năng |
|------------|-----------|
| Dropdown ngôn ngữ | Chọn ngôn ngữ dịch đích (8 ngôn ngữ) |
| ⚙️ Settings | Provider dịch + tải Local Translate + nguồn âm thanh |
| 📌 Pin | Bật/tắt luôn trên đầu màn hình |
| ▶ / ⏹ | Bật/tắt Live Captions (Teams) hoặc ghi âm (audio/mic) |
| 💾 Export | Xuất transcript gốc ra `.txt` |
| ↓ Auto | Bật/tắt tự cuộn xuống entry mới nhất |
| 📋 Tóm tắt | Tổng hợp cuộc họp bằng AI |
| Xóa | Xóa danh sách captions |

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

Dùng `electron-builder` (target NSIS). File installer được tạo trong thư mục `dist/`. `stt-server.py` được đóng gói kèm và unpack ra ngoài asar.

---

## Cấu trúc project

```
main.js                       # Entry point: Electron lifecycle, createWindow, vòng lặp service tự-restart
app.html                      # Toàn bộ UI renderer (header, caption list, settings, summary modal)
preload.js                    # contextBridge: cầu nối an toàn renderer ↔ main (window.__caption)
stt-server.py                 # STT server Python (SenseVoice-Small qua sherpa-onnx)
package.json                  # electron + puppeteer-core; scripts: start / build

src/
├── state.js                  # State chia sẻ (singleton): provider, nguồn, config local LLM…
├── store.js                  # Đọc/ghi settings.json trong userData
├── ipc-handlers.js           # Toàn bộ IPC main ↔ renderer
│
├── caption-service.js        # runService(): vòng lặp poll caption Teams + chèn bản dịch vào DOM
├── cdp-browser.js            # Kết nối CDP, tìm Teams/meeting, toggle caption, auto-setup CDP,
│                             #   capture Teams token (WebSocket), tự động đổi ngôn ngữ STT
│
├── translation.js            # Các provider dịch + orchestrator + queue + phrase map + tiền xử lý
├── local-llm.js              # llama.cpp: tải binary, GPU detect, tải model GGUF, vòng đời server
├── audio-stt.js              # Quản lý stt-server.py + xử lý audio chunk
│
├── summary.js                # Tóm tắt cuộc họp (ChatGPT) + xuất file
├── webchat.js                # BrowserWindow embedded điều khiển ChatGPT/Copilot/DuckAI (no key)
├── webchat-preload.js        # Override anti-bot-detection cho webchat
│
└── http-helpers.js           # HTTP/HTTPS client helpers (cloud + local LLM keep-alive)
```

---

## Cách hoạt động

### Chế độ Teams (CDP)

```
Teams (WebView2)
    └─ CDP port 9222  ←──  Electron main (puppeteer-core)
                              ├─ poll [data-tid="closed-caption-text"] mỗi 200ms
                              ├─ chờ câu hoàn chỉnh (kết câu) rồi mới dịch
                              ├─ dịch qua provider (MS / Google / DeepL / Local LLM)
                              ├─ chèn bản dịch dưới caption gốc trong Teams (MutationObserver)
                              └─ IPC → renderer (app.html) hiển thị danh sách
```

### Chế độ Audio / Mic (STT)

```
getDisplayMedia (loopback) / getUserMedia (mic)
    └─ MediaRecorder cycle 4s → WebM chunk
            └─ IPC → main → POST → stt-server.py (SenseVoice-Small)
                                        ├─ decode WebM → PCM 16kHz (PyAV)
                                        ├─ RMS gating + hallucination filter
                                        └─ trả text → dịch → IPC → renderer
```

### Tóm tắt cuộc họp

```
captions → prompt Markdown → webchat.js mở BrowserWindow ẩn (ChatGPT)
                                ├─ stealth UA + override navigator (webchat-preload.js)
                                ├─ tự dismiss cookie/popup
                                ├─ inject prompt → submit → chờ response ổn định
                                └─ trích Markdown → hiển thị + xuất .md
```

> Debug webchat: chạy với biến môi trường `WEBCHAT_DEBUG=1` để hiện cửa sổ + DevTools + log chi tiết.

---

## Lưu ý

- **CDP port 9222 không có xác thực** — chỉ mở khi đang dùng; tắt bằng cách xóa env var/registry và restart Teams.
- **Google Translate / DeepL** dùng endpoint công khai (browser-extension style), không có SLA nhưng ổn định cho cá nhân; có thể bị rate-limit (429/403) nếu dùng quá nhiều.
- **MS Translator** dùng token lấy tự động từ Edge translator API hoặc capture từ phiên Teams; token có TTL nên app tự refresh.
- **LOCAL TRANSLATE** chạy hoàn toàn offline sau khi tải model — phù hợp khi cần bảo mật nội dung hoặc không có mạng ổn định.
- **Tóm tắt qua ChatGPT** dùng chế độ logged-out trong cửa sổ ẩn; lần đầu có thể hiện cửa sổ để dismiss "Stay logged out"/cookie banner, sau đó chạy ngầm.
- STT chạy trên CPU; câu được dịch tuần tự qua hàng đợi (cloud tối đa 3 song song, local LLM giới hạn 1 để tránh nghẽn RAM bandwidth).
