# Caption Translator — bản gộn tối giản (3 file)

Phiên bản extension **ít file nhất có thể**. Một extension Chrome **không thể chỉ 1 file** (Chrome bắt buộc `manifest.json` riêng, và MV3 cấm script inline trong HTML), nên tối thiểu là **3 file**:

```
manifest.json   # bắt buộc tách riêng
panel.html      # UI (CSS đã nhúng trong <style>)
app.js          # GỘP TẤT CẢ: SDK @google/genai (bundle, kèm p-retry) + toàn bộ code app (~885KB)
```

Khác bản `extension/` (nhiều file): toàn bộ JS + SDK nén vào **một `app.js`**, CSS nhúng vào HTML, và **bỏ service worker** (capture dùng `getDisplayMedia`/`getUserMedia` ngay trong panel).

## Đây là BUILD ARTIFACT — đừng sửa tay

`app.js` và `panel.html` được **sinh tự động** từ thư mục `extension/` (nguồn duy nhất) bằng esbuild:

```bash
npm i -D esbuild
node extension/build-single.mjs      # esbuild bundle extension/app.js → app.js; nhúng css → panel.html
```

Muốn đổi tính năng → sửa trong `extension/` rồi chạy lại lệnh trên.

## Cài & dùng

1. `chrome://extensions` → bật **Developer mode** → **Load unpacked** → chọn `extension-single/`.
2. **Chuột phải** icon extension → **Open side panel** (bản này không có service worker nên không tự mở khi bấm icon).
3. ⚙️ (góc phải) dán **Gemini API key** → chọn nguồn → ngôn ngữ → **▶ Bắt đầu**.

**Nguồn âm thanh:** 🎤 Micro, hoặc 🔊 Âm thanh → khi bấm Bắt đầu hiện **popup chọn của trình duyệt** (Tab / Cửa sổ app / Toàn màn hình). Chọn Tab hoặc Toàn màn hình + tick “Chia sẻ âm thanh” để có tiếng.

Chức năng giống bản nhiều file: 5 ngôn ngữ + 📝 Chép lời · TTS gapless (trần độ trễ) · tóm tắt cuốn chiếu + 📊 tổng thể · panel tóm tắt **kéo chỉnh chiều cao** · xuất `.txt`/`.md`.

## Hạn chế

- **Mở panel thủ công** (chuột phải icon). Muốn bấm-icon-mở-panel thì thêm 1 file service worker (`background.js`) gọi `setPanelBehavior` → khi đó là 4 file. (Bản `extension/` đã có sẵn.)
- `getDisplayMedia` chỉ desktop; cửa sổ một app có thể không kèm audio; đóng panel = dừng dịch; cần Internet + API key. Xem thêm `extension/README.md`.
