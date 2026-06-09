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

### Provider dịch thuật (2 lựa chọn, không cần API key)

| Provider | Loại | Yêu cầu |
|----------|------|---------|
| 🌐 **Online (auto)** | Cascade Google Translate → MS (Edge/Teams) translator API | Không cần key (token lấy tự động, có thể bị rate-limit) |
| 🖥️ **LOCAL TRANSLATE** | LLM cục bộ — llama.cpp + **MiLMMT-46-1B** (model dịch JP→VI chuyên dụng) | Tải model trong app (~1.22 GB), chạy offline |

**LOCAL TRANSLATE** chạy llama.cpp server cục bộ (OpenAI-compatible) với **một model dịch chuyên dụng — MiLMMT-46-1B**:

| Model (Q4_K_M) | Dung lượng | Đặc điểm |
|----------------|-----------|----------|
| **MiLMMT-46-1B-v0.1** (Xiaomi · nền Gemma3-1B · 46 ngôn ngữ) | ~1.22 GB | Model **dịch máy chuyên dụng** (đặc biệt mạnh JP→VI, **phiên âm tên riêng chuẩn**), nhẹ, **không draft**. Ưu tiên chạy **CPU** (nhanh nhất theo benchmark). |

Cơ chế:
- **Tải sẵn nhiều binary 1 lần** từ GitHub Releases (`ggml-org/llama.cpp`): **cpu + vulkan** (luôn) và **cuda** (chỉ khi có GPU NVIDIA), mỗi backend ở `llama-server/{cpu,vulkan,cuda}/` — **không phải tải lại** khi đổi máy/GPU.
- **Tự chọn backend khi khởi động server:** **ưu tiên CPU** (`-t 4 -c 2048 --poll 0 --mlock`, idle ~0% CPU), chỉ offload khi có **GPU NVIDIA rời (dGPU)**. *Lý do:* đo thực trên Core Ultra 5 225H, MiLMMT chạy CPU-4t (~533 ms/câu) **nhanh hơn ~25%** so với iGPU-Vulkan (~665 ms) — model 1 phần + vocab 262k khiến iGPU (chia sẻ RAM) bị nghẽn băng thông.
- **Endpoint/giải mã:** `/completion` với prompt `Translate this from <nguồn> to <đích>:` + giải mã **greedy** (temperature 0, top_k 1) và **tự nhận dạng ngôn ngữ nguồn** (Nhật cho kana/kanji · Hàn cho hangul · còn lại tiếng Anh).
- Tự khởi động server khi bấm ▶. Nếu LLM cục bộ lỗi/chưa sẵn sàng → tự **fallback sang Google Translate (free)**.

### Pipeline xử lý câu dịch (tăng độ chính xác & tự nhiên)

Mỗi câu caption đi qua các bước sau (chủ yếu cho LOCAL/MiLMMT; phrase map & glossary áp cho mọi provider):

1. **Từ điển câu cố định (phrase map)** — câu xã giao/họp hay gặp (`よろしくお願いします`, `お疲れ様です`, `承知しました`, `画面共有します`…) dịch **tức thì, chính xác**, bỏ qua model. Khớp linh hoạt: bỏ tiền tố thời gian/đệm (`今日は`, `では`…) và bắt biến thể ASR (vd rớt chữ `お`).
2. **Glossary thuật ngữ IT** — katakana kỹ thuật (`デプロイ`, `スプリント`, `バックエンド`, `コードレビュー`…) được thay sang tiếng Anh **ngay trong câu nguồn** để giữ thuật ngữ (ra "sprint" thay vì "cú nhảy"). Phần tiếng Nhật hiển thị vẫn nguyên gốc.
3. **Dịch** qua MiLMMT (greedy); nếu lỗi/đáng ngờ → fallback Google.
4. **QE routing — chấm "độ ngờ"** *(chỉ MiLMMT)*: chấm nhanh chất lượng bằng tín hiệu chuỗi/độ dài (sót ký tự Nhật, không có dấu Việt, lặp, tỉ lệ độ dài bất thường) **+ độ tự tin token (logprob)**. Ngờ cao (vd bịa tên) → **fallback Google**; ngược lại giữ MiLMMT (offline). Ngưỡng tinh chỉnh được; log mỗi câu in `| QE=0.xx`.
5. **Hậu xử lý** — chuẩn dấu câu (full-width → ASCII), khử lặp artifact, khôi phục cụm thuật ngữ bị dịch một phần khi còn neo tiếng Anh (vd "xem xét code" → "review code").
6. **Bộ nhớ dịch (cache LRU)** — câu trùng/giống nhau trả tức thì, đảm bảo nhất quán.

> Giữ được tiếng Anh: `sprint, backend, frontend, refactoring, code, review code, API`… Vài từ tần suất cao (`deploy`, `release`, `database`) MiLMMT vẫn dịch — đây là **trần của model MT 1B**, đã được giảm thiểu bằng glossary + QE→Google cho các ca khó (tên riêng, số liệu).

### Tóm tắt & xuất file

| Tính năng | Mô tả |
|-----------|-------|
| 📋 **Tóm tắt cuộc họp** | Tổng hợp transcript (theo **tiếng Nhật gốc**) thành báo cáo Markdown (Tổng quan, Chủ đề, Vấn đề, Quyết định/Hành động) qua **ChatGPT** chạy trong cửa sổ ẩn — **không cần API key**. Prompt yêu cầu **giữ nguyên thuật ngữ IT/tiếng Anh/katakana + tên riêng** và **tự lập bảng** khi có số liệu/so sánh. Render đầy đủ heading (h1–h4), list, **bảng**. Xuất `.md` hoặc copy (clipboard native). |
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
- **⚙️ Cài đặt** → tab **🌐 Dịch thuật** → chọn provider. Với **LOCAL TRANSLATE**: bấm **📥 Tải Local Translate** để tải binary + model **MiLMMT** — chỉ 1 lần (~1.22 GB, không draft).

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

> Popup **Cài đặt / Tóm tắt** chỉ đóng bằng nút **Hủy / Lưu / ✕** (không đóng khi click ra ngoài → tránh mất thao tác). Popup Tóm tắt **co giãn theo cỡ cửa sổ** (~70–80%). Nút ▶/⏹ tự đồng bộ icon theo trạng thái đang dịch.

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
├── translation.js            # Provider dịch + orchestrator + queue + phrase map + glossary IT
│                             #   + QE routing (chấm độ ngờ → fallback) + hậu xử lý + cache câu (TM)
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
                              ├─ chốt câu khi gặp dấu kết câu (。！？) — dịch câu trọn vẹn (#B)
                              ├─ phrase map → glossary IT → dịch → QE routing → hậu xử lý → cache
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
- **Google Translate** dùng endpoint công khai (browser-extension style), không có SLA nhưng ổn định cho cá nhân; có thể bị rate-limit (429/403) nếu dùng quá nhiều.
- **MS Translator** dùng token lấy tự động từ Edge translator API hoặc capture từ phiên Teams; token có TTL nên app tự refresh.
- **LOCAL TRANSLATE** chạy hoàn toàn offline sau khi tải model — phù hợp khi cần bảo mật nội dung hoặc không có mạng ổn định.
- **Tóm tắt qua ChatGPT** dùng chế độ logged-out trong cửa sổ ẩn; lần đầu có thể hiện cửa sổ để dismiss "Stay logged out"/cookie banner, sau đó chạy ngầm.
- STT chạy trên CPU; câu được dịch tuần tự qua hàng đợi (cloud tối đa 3 song song, local LLM giới hạn 1 để tránh nghẽn RAM bandwidth).
