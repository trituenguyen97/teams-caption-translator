# Teams Caption Translator

Ứng dụng desktop (Electron) dịch hội thoại meeting theo thời gian thực, hỗ trợ **3 nguồn đầu vào** và **5 provider dịch thuật** tùy chọn.

## Tính năng

### Nguồn đầu vào (3 chế độ)

| Chế độ | Mô tả |
|--------|-------|
| 📹 **Teams Live Captions** | Đọc subtitle trực tiếp từ Teams Web qua CDP (Chrome DevTools Protocol) — không cần mic, không delay |
| 🔊 **System Audio** | Ghi âm âm thanh hệ thống → nhận dạng giọng nói cục bộ bằng **SenseVoice-Small** (sherpa-onnx) |
| 🎤 **Microphone** | Ghi âm từ mic bất kỳ → nhận dạng giọng nói cục bộ bằng **SenseVoice-Small** (sherpa-onnx) |

> Chế độ System Audio / Microphone dùng **SenseVoice-Small** chạy hoàn toàn offline, tự tải model ~110MB lần đầu. Hỗ trợ: Tiếng Nhật, Trung, Anh, Hàn, Quảng Đông.

### Provider dịch thuật

| Provider | Loại | Yêu cầu |
|----------|------|---------|
| 🤖 **Groq** | LLM — tối ưu cho IT/BrSE | API key miễn phí (14.400 req/ngày) |
| 🤖 **OpenAI** | LLM | API key (trả phí) |
| 🌐 **Google Cloud Translate** | Neural MT | API key |
| 🌐 **DeepL** | Neural MT | API key |
| 🌐 **Azure Translator** | Neural MT | API key |

> Provider LLM (Groq, OpenAI) được tối ưu cho context IT/BrSE: giữ nguyên thuật ngữ kỹ thuật tiếng Anh (bug, deploy, PR, API…).

### Ngôn ngữ đích hỗ trợ

🇻🇳 Việt · 🇺🇸 English · 🇨🇳 中文 · 🇰🇷 한국어 · 🇯🇵 日本語 · 🇫🇷 Français · 🇩🇪 Deutsch · 🇪🇸 Español

---

## Yêu cầu hệ thống

- **Node.js** 18+
- **Microsoft Teams** bản desktop (New Teams — dùng WebView2) — chỉ cần cho chế độ Teams CDP

---

## Cài đặt

```bash
npm install
```

---

## Thiết lập CDP cho Teams (chỉ cần làm một lần)

> *Chỉ cần thiết nếu dùng chế độ **Teams Live Captions**.*

Mở **PowerShell** và chạy:

```powershell
[System.Environment]::SetEnvironmentVariable(
  "WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS",
  "--remote-debugging-port=9222",
  "User"
)
```

Sau đó **đóng Teams hoàn toàn** (kể cả system tray) và mở lại.

> Để tắt: chạy lại lệnh trên và đổi value thành `""`.

App tự quét các port CDP từ **9222–9240**, không xung đột nếu nhiều ứng dụng cùng mở.

---

## Cách dùng

### Chế độ Teams Live Captions

1. Vào meeting → **More (...)** → **Language and speech** → **Turn on live captions**
2. Chạy app: `npm start`

### Chế độ System Audio / Microphone

1. Vào **Settings** trong app → tab **Source** → chọn nguồn
2. Chạy app: `npm start` — model STT tự tải lần đầu (~110MB)

```bash
npm start
```

---

## Giao diện

Cửa sổ luôn hiển thị trên đầu màn hình (có thể tắt).

| Điều khiển | Chức năng |
|------------|-----------|
| Dropdown ngôn ngữ | Chọn ngôn ngữ dịch đích |
| ⚙️ Settings | Chọn provider, API key, nguồn đầu vào |
| 📌 | Bật/tắt luôn trên đầu màn hình |
| ↓ Auto | Bật/tắt tự cuộn xuống entry mới nhất |
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

File installer sẽ được tạo trong thư mục `dist/`.

---

## CLI thay thế (không cần Electron)

```bash
node caption-cdp.js vi     # dịch sang tiếng Việt
node caption-cdp.js en     # dịch sang tiếng Anh
```

---

## Công cụ chẩn đoán

```bash
npm run probe    # khám phá DOM meeting, tìm caption selectors khi Teams cập nhật
```

---

## Cách hoạt động

```
Teams (WebView2)
    └─ CDP port 9222  ←──  Electron main process (puppeteer-core)
                              ├─ poll [data-tid="closed-caption-text"] mỗi 800ms
                              ├─ chờ câu ổn định 2s rồi mới dịch
                              ├─ các provider dịch (Groq, OpenAI, Google, DeepL, Azure)
                              └─ IPC → Electron renderer (app.html)
```

1. `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS` khiến WebView2 mở debug port
2. Puppeteer kết nối WebSocket vào port này
3. Câu hoàn thành → dịch qua provider tùy chọn → hiển thị trong cửa sổ Electron

---

## Teams Tab App (ACS approach — tùy chọn)

Ngoài chế độ Electron, ứng dụng cũng hỗ trợ cài đặt như một **Tab App trong Teams** thông qua **Azure Communication Services**.

### Bước 1: Tạo ACS resource

1. Vào [Azure Portal](https://portal.azure.com) → **Create a resource** → tìm "Communication Services"
2. Tạo resource (có free tier, không tốn phí nếu dùng ít)
3. Vào resource → **Keys** → copy **Connection String**

### Bước 2: Tạo file `.env`

```bash
cp .env.example .env
```

Sửa file `.env`:

```
ACS_CONNECTION_STRING=endpoint=https://YOUR_RESOURCE.communication.azure.com/;accesskey=YOUR_KEY
```

### Bước 3: Chạy dev server

```bash
npm install
npm start
```

Lệnh này chạy **song song** hai process:
- `node server.js` — Backend Express (port 3001) — cấp ACS tokens
- `webpack serve` — Frontend (port 53000, HTTPS)

Mở browser: `https://localhost:53000`

### Bước 4: Thêm vào Teams Meeting

1. Mở **Teams** → **Apps** (góc dưới trái)
2. Chọn **Manage your apps** → **Upload an app** → **Upload a custom app**
3. Chọn file `teams-caption-translator.zip` (sau khi chạy `npm run package`)
4. Vào meeting → Click **+** trên thanh tab → tìm "Caption Translator" → **Save**

---

## Cấu trúc project

```
server.js                      # Backend Express: cấp ACS tokens
.env                           # ACS_CONNECTION_STRING (không commit)
.env.example                   # Template cho .env
src/
├── App.tsx                    # Root component, khởi tạo Teams SDK + theme
├── index.tsx                  # Entry point (main panel)
├── config.tsx                 # Entry point (config page)
├── types.ts                   # Types + constants (ngôn ngữ, settings)
│
├── pages/
│   ├── MeetingSidePanel.tsx   # Trang chính: kết nối ACS + caption list
│   └── ConfigPage.tsx         # Trang config (Teams gọi khi thêm tab)
│
├── components/
│   ├── CaptionList.tsx        # Container danh sách captions + header
│   ├── CaptionEntryRow.tsx    # Một dòng: [Speaker] original | translated
│   ├── LanguageSelector.tsx   # Dropdown chọn ngôn ngữ
│   └── SettingsPanel.tsx      # Form cài đặt ngôn ngữ + display name
│
├── hooks/
│   ├── useAcsCaptions.ts      # ACS Calling SDK: join meeting + TeamsCaptions
│   └── useTranslation.ts      # Queue dịch tuần tự
│
└── services/
    ├── translationService.ts  # Gọi các provider dịch thuật
    ├── teamsService.ts        # Teams JS SDK init + getMeetingJoinUrl
    └── settingsService.ts     # Lưu/đọc settings từ localStorage
```

---

## Các con đường truy cập Live Captions của Teams

### 1. Teams JS SDK (Tab App / Side Panel) — ❌ KHÔNG CÓ CAPTION API

Đã kiểm tra SDK v2.52.0 (mới nhất tới 04/2026):
- Toàn bộ `meeting` module chỉ có: livestream, stage sharing, speaking state, reactions, mic control
- `registerSpeakingStateChangeHandler` → chỉ boolean (ai đang nói), **không có text**
- Tìm kiếm cả private/internal modules: **0 file chứa "caption"** hay "transcript"
- **Kết luận**: Teams JS SDK không expose caption text data cho tab apps

### 2. Azure Communication Services (ACS) — ✅ CÓ CAPTION API (REAL-TIME)

**Đây là con đường DUY NHẤT để nhận live captions programmatically + Teams interop.**

ACS Calling SDK cung cấp `CaptionsCallFeature` với:

```typescript
// Lấy caption feature từ call object
let captionsFeature = call.feature(SDK.Features.Captions);
let captions = captionsFeature.captions as SDK.TeamsCaptions;

// Bật captions
await captions.startCaptions({ spokenLanguage: 'en-us' });

// Nhận caption data real-time (cả interim + final)
captions.on('CaptionsReceived', (data: CaptionsInfo) => {
  // data.speaker — ai đang nói
  // data.spokenText — nội dung caption
  // data.resultType — 'Partial' hoặc 'Final'
  // data.timestamp
});
```

**Yêu cầu**:
- Azure Communication Services resource (có free tier)
- ACS user phải join Teams meeting qua ACS Calling SDK
- Kiến trúc phức tạp hơn: cần backend để tạo ACS identity + token
- Hỗ trợ dịch built-in với **Teams Premium license**

### 3. Microsoft Graph API — ⚠️ CHỈ SAU MEETING (KHÔNG REAL-TIME)

Graph API có `callTranscript` resource:
- Chỉ lấy được transcript **sau khi meeting kết thúc**
- Không phải real-time stream
- Cần bật "Transcription" trong meeting
- Phù hợp cho: post-meeting summary, review

### 4. Bot Framework + Real-time Media — ⚠️ PHỨC TẠP NHẤT

Teams Bot có thể subscribe vào audio stream của meeting:
- Cần: Azure Bot Service, Azure Speech Service, backend server
- Linh hoạt nhất nhưng phức tạp nhất

---

## So sánh các hướng tiếp cận

| Hướng tiếp cận | Real-time? | Tất cả speakers? | Độ phức tạp | Chi phí |
|---|---|---|---|---|
| **Teams Live Captions (CDP)** | ✅ | ❌ Chỉ Teams captions | Thấp | Free |
| **System/Mic Audio (STT)** | ✅ | ✅ | Thấp | Free |
| **ACS Calling SDK** | ✅ | ✅ | Trung bình-cao | ACS resource (có free tier) |
| **Graph Transcript API** | ❌ Sau meeting | ✅ | Thấp | M365 license |
| **Bot Media Platform** | ✅ | ✅ | Rất cao | Azure Bot + Speech Services |

---

## Lưu ý

- CDP port 9222 **không có xác thực** — chỉ mở khi đang dùng, tắt bằng cách xóa env var và restart Teams
- Google Translate unofficial API không có SLA, nhưng stable cho personal use
- `ACS_CONNECTION_STRING` không được commit lên git — đã thêm vào `.gitignore`
- ACS user join meeting với tên **"Caption Translator"** — sẽ xuất hiện trong participants list như một guest
