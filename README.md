# Teams Caption Translator

Đọc **Live Captions từ Microsoft Teams** qua CDP (Chrome DevTools Protocol) và dịch sang ngôn ngữ tùy chọn bằng Google Translate miễn phí.

Giao diện desktop (Electron) hiển thị captions theo thời gian thực, hỗ trợ đóng gói thành file `.exe`.

## Yêu cầu

- Node.js 18+
- Microsoft Teams (bản desktop — New Teams, dùng WebView2)
- Đang trong meeting và đã bật Live Captions

---

## Cài đặt một lần: Bật CDP cho Teams WebView2

Mở **PowerShell** và chạy lệnh sau (chỉ cần làm một lần):

```powershell
[System.Environment]::SetEnvironmentVariable(
  "WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS",
  "--remote-debugging-port=9222",
  "User"
)
```

Sau đó **đóng Teams hoàn toàn** (kể cả system tray) và mở lại.

> Để tắt sau này: chạy lại và đổi value thành `""`.

---

## Cài dependencies

```bash
npm install
```

---

## Cách dùng

### 1. Vào meeting Teams và bật Live Captions

Trong meeting → nhấn **More (...)** → **Language and speech** → **Turn on live captions**

### 2. Chạy app

```bash
npm start
```

Cửa sổ **Caption Translator** sẽ hiện lên (luôn trên đầu màn hình theo mặc định).

### Tính năng trong app

| Nút | Chức năng |
|-----|-----------|
| Dropdown ngôn ngữ | Chọn ngôn ngữ dịch (Việt, EN, 中文, 한국어, 日本語, ...) |
| 📌 | Bật/tắt "luôn trên đầu" |
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
                              ├─ @vitalets/google-translate-api (free, no key)
                              └─ IPC → Electron renderer (app.html)
```

1. `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS` khiến WebView2 mở debug port
2. Puppeteer kết nối WebSocket vào port này
3. Câu hoàn thành → Google Translate → hiển thị trong cửa sổ Electron


Đọc **Live Captions từ Microsoft Teams** qua CDP (Chrome DevTools Protocol) và dịch sang ngôn ngữ tùy chọn bằng Google Translate miễn phí.

## Yêu cầu

- Node.js 18+
- Microsoft Teams (bản desktop — New Teams, dùng WebView2)
- Đang trong meeting và đã bật Live Captions

---

## Cài đặt một lần: Bật CDP cho Teams WebView2

Mở **PowerShell** và chạy lệnh sau (chỉ cần làm một lần):

```powershell
[System.Environment]::SetEnvironmentVariable(
  "WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS",
  "--remote-debugging-port=9222",
  "User"
)
```

Sau đó **đóng Teams hoàn toàn** (kể cả system tray) và mở lại.

> Lệnh này thêm debug port vào tất cả ứng dụng WebView2 của user hiện tại.
> Để tắt sau này: chạy lại và đổi `"--remote-debugging-port=9222"` thành `""`.

---

## Cài dependencies

```bash
npm install
```

---

## Cách dùng

### 1. Vào meeting Teams và bật Live Captions

Trong meeting → nhấn **More (...)** → **Language and speech** → **Turn on live captions**

### 2. Chạy script

```bash
npm run caption              # dịch sang tiếng Việt (mặc định)
node caption-cdp.js en       # dịch sang tiếng Anh
node caption-cdp.js ja       # dịch sang tiếng Nhật
node caption-cdp.js zh-CN    # dịch sang tiếng Trung
```

Script sẽ tự động:
- Kết nối CDP vào Teams
- Tìm trang meeting đang mở
- Chờ cho đến khi captions được bật
- Poll mỗi 800ms, chờ 2s câu ổn định rồi mới dịch (không dịch câu đang nói dở)

### Output mẫu

```
[16:35:54] Nguyen Tri Tue
  原: ニャン祭りをしたことがありませんね。
  VI: Tôi chưa bao giờ tham dự lễ hội Nyan.

[16:36:03] Nguyen Tri Tue
  原: 普通の本当に普通のなんでもない白いご飯が美味しいですよね。
  VI: Cơm trắng bình thường, thực sự bình thường mà rất ngon phải không?
```

---

## Công cụ chẩn đoán

```bash
npm run probe    # khám phá DOM trang meeting, liệt kê tất cả data-tid elements
```

Hữu ích khi Teams cập nhật thay đổi selector.

---

## Cách hoạt động

```
Teams (WebView2)
    └─ CDP port 9222  ←──  puppeteer-core
                              └─ poll [data-tid="closed-caption-text"]
                                   └─ @vitalets/google-translate-api
                                        └─ stdout
```

1. `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS` khiến WebView2 mở debug port 9222
2. Puppeteer kết nối WebSocket vào port này
3. Script query DOM `[data-tid="closed-caption-text"]` và `[data-tid="author"]` mỗi 800ms
4. Câu nào đã hoàn thành (không còn là entry cuối, hoặc entry cuối ổn định ≥ 2s) → gửi đến Google Translate
5. Kết quả in ra terminal

---

## Lưu ý

- Google Translate free có giới hạn rate — nếu gặp `Too Many Requests` hãy giảm số lượng câu được dịch hoặc thêm delay
- CDP port 9222 **không có xác thực** — chỉ mở khi đang dùng, tắt bằng cách xóa env var và restart Teams
- Hoạt động với Teams phiên bản mới (New Teams / WebView2); Teams cũ dùng Electron sẽ cần `--remote-debugging-port` khác

| | `npm run caption` (local-watcher) | Teams Tab App (ACS) |
|---|---|---|
| Cách chạy | `node local-watcher.js` | Teams tab + ACS backend |
| STT | Whisper.js (local, miễn phí) | ACS TeamsCaptions (Teams server) |
| Dịch | Google Translate free | Google Translate free |
| Đăng ký | ❌ Không cần | Azure ACS resource |
| Tất cả speakers | ✅ (qua system audio) | ✅ |
| Realtime | ⚠️ Mỗi 8–20 giây | ✅ Streaming |

---

## 🚀 Cách dùng nhanh (không cần đăng ký)

```bash
npm run caption
# Mở: http://localhost:7777
```

1. Vào meeting Teams → bật Live Captions của Teams (tùy chọn)
2. Mở `http://localhost:7777` trong **Chrome** hoặc **Edge**
3. Nhấn **Bắt đầu** → share màn hình cửa sổ Teams + bật **"Share system audio"**
4. Whisper.js nhận dạng giọng của **tất cả participants** từ loa → dịch qua Google Translate

> **Lần đầu chạy**: model Whisper Base (~144MB) sẽ được tải và lưu vào browser cache. Từ lần sau sẽ load ngay.

### Không cần gì thêm:
- ✅ Không cần API key
- ✅ Không cần Azure / M365 account  
- ✅ Chỉ cần Node.js + internet (lần đầu tải model)
- ✅ Nhận diện hoàn chỉnh câu đã nói (không phải interim)

---

## Teams Tab App (ACS approach — cần đăng ký)

```bash
npm install
```

## Cấu hình Azure Communication Services

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

## Chạy dev server

```bash
npm start
```

Lệnh này chạy **song song** hai process:
- `node server.js` — Backend Express (port 3001) — cấp ACS tokens
- `webpack serve` — Frontend (port 53000, HTTPS)

Mở browser: `https://localhost:53000`

---

## Thêm vào Teams Meeting

### Bước 1: Đóng gói manifest
```bash
npm run package
# Tạo ra file: teams-caption-translator.zip
```

### Bước 2: Upload lên Teams
1. Mở Microsoft Teams → **Apps** (góc dưới trái)
2. Chọn **Manage your apps** → **Upload an app** → **Upload a custom app**
3. Chọn file `teams-caption-translator.zip`
4. Cài xong → app xuất hiện trong Teams

### Bước 3: Thêm vào Meeting
1. Vào meeting đang diễn ra (hoặc tạo meeting test)
2. Click **+** trên thanh tab của meeting → tìm "Caption Translator"
3. Cấu hình (nhập Azure key nếu chưa có) → **Save**
4. Tab mới xuất hiện trong meeting sidebar!

---

## Chạy thử không cần Teams (standalone)

Chỉ cần mở `https://localhost:53000` trong Edge/Chrome — hoạt động đầy đủ như một web app thông thường.

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
    ├── translationService.ts  # Google Translate free API
    ├── teamsService.ts        # Teams JS SDK init + getMeetingJoinUrl
    └── settingsService.ts     # Lưu/đọc settings từ localStorage
```

---

## Các con đường truy cập Live Captions của Teams

Sau khi nghiên cứu kỹ tất cả SDK/API của Microsoft, dưới đây là **tổng hợp 4 hướng tiếp cận** để truy cập caption data, xếp theo mức độ khả thi:

### 1. Teams JS SDK (Tab App / Side Panel) — ❌ KHÔNG CÓ CAPTION API

Đã kiểm tra SDK v2.52.0 (mới nhất tới 04/2026):
- Toàn bộ `meeting` module chỉ có: livestream, stage sharing, speaking state, reactions, mic control
- `registerSpeakingStateChangeHandler` → chỉ boolean (ai đang nói), **không có text**
- Tìm kiếm cả private/internal modules: **0 file chứa "caption"** hay "transcript" (ngoại trừ `meetingRoom.d.ts` chỉ có `toggleCaptions` — bật/tắt captions cho meeting room device)
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
- ACS user phải join Teams meeting qua ACS Calling SDK (không phải qua Teams JS SDK)
- Kiến trúc phức tạp hơn: cần backend để tạo ACS identity + token
- Hỗ trợ dịch built-in với **Teams Premium license** (one spoken language + per-user translation)

**Hạn chế**: ACS user join meeting với tư cách *external participant* (không phải Teams tab app), nên không thể dùng song song với Teams JS SDK side panel

### 3. Microsoft Graph API — ⚠️ CHỈ SAU MEETING (KHÔNG REAL-TIME)

Graph API có `callTranscript` resource:
```
GET /me/onlineMeetings/{meetingId}/transcripts/{transcriptId}/content
```
- Chỉ lấy được transcript **sau khi meeting kết thúc** (hoặc recording stops)
- Không phải real-time stream
- Cần bật "Transcription" trong meeting (organizer permission)
- Phù hợp cho: post-meeting summary, review, không phải live translation

### 4. Bot Framework + Real-time Media (Bot with Audio) — ⚠️ PHỨC TẠP NHẤT

Teams Bot có thể subscribe vào audio stream của meeting:
- Bot Media Platform cho phép nhận raw audio
- Sau đó tự chạy Azure Speech-to-Text (server side)
- Cần: Azure Bot Service, Azure Speech Service, backend server xử lý audio
- Phức tạp nhất nhưng linh hoạt nhất

---

### Tóm tắt so sánh

| Hướng tiếp cận | Real-time? | Tất cả speakers? | Độ phức tạp | Chi phí |
|---|---|---|---|---|
| **Web Speech API** (hiện tại) | ✅ | ❌ Chỉ bạn | Thấp | Free |
| **ACS Calling SDK** | ✅ | ✅ | Trung bình-cao | ACS resource (có free tier) |
| **Graph Transcript API** | ❌ Sau meeting | ✅ | Thấp | M365 license |
| **Bot Media Platform** | ✅ | ✅ | Rất cao | Azure Bot + Speech Services |

### Đề xuất hướng phát triển

Nếu muốn **live captions từ tất cả speakers trong Teams meeting**, hướng **ACS Calling SDK** là khả thi nhất:
1. Backend: tạo ACS resource + identity service
2. Frontend: dùng ACS Calling SDK join Teams meeting (thay vì Teams JS SDK)
3. Bật `TeamsCaptions` feature → nhận `CaptionsReceived` event real-time
4. Dịch text nhận được qua Azure Translator (giữ nguyên logic hiện tại)

Tham khảo:
- [ACS Closed Captions Quickstart](https://learn.microsoft.com/en-us/azure/communication-services/quickstarts/voice-video-calling/get-started-with-closed-captions)
- [ACS + Teams Interop Captions](https://learn.microsoft.com/en-us/azure/communication-services/concepts/interop/enable-closed-captions)

---

## Giải thích flow hoạt động

```
Microphone của user hiện tại
    │
    ▼
Web Speech API (browser built-in, chạy local)
    │  interim results → hiển thị ngay (chữ mờ)
    │  final results   → thêm vào danh sách
    ▼
CaptionEntry (status: 'pending')
    │
    ▼
Translation Queue (tuần tự, 100ms delay)
    │  onStart  → status: 'translating' (spinner)
    │  onDone   → status: 'done' (hiển thị bản dịch)
    │  onError  → status: 'error' (hiển thị lỗi)
    ▼
Azure Translator API
    │
    ▼
Hiển thị 2 cột song song trong UI
```

---

## Lưu ý

- ACS user join meeting với tên **"Caption Translator"** (tuỳ chỉnh được) — sẽ xuất hiện trong participants list như một guest bình thường
- Nếu meeting có **lobby**, organizer cần admit ACS user vào. Bạn có thể tắt lobby trong meeting settings
- Google Translate unofficial API không có SLA, nhưng stable cho personal use
- `ACS_CONNECTION_STRING` không được commit lên git — đã thêm vào `.gitignore`
