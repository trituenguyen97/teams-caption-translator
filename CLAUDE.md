# CLAUDE.md — Caption Translator (Electron, desktop)

## Quy trình "sửa → commit → push → ra bản mới"

Khi người dùng nói kiểu **"sửa X rồi release"**, **"ra bản patch/minor/major"**, **"deploy bản mới"**, **"chốt version"**:

1. Sửa code. Kiểm tra tối thiểu: `node --check` các file JS đã sửa. Với `app.html`, parse các `<script>` inline bằng `new Function`.
2. Ghi 1–3 gạch đầu dòng **tiếng Việt, ngắn, hướng người dùng** dưới `## [Unreleased]` trong `CHANGELOG.md`. Nội dung này hiện trong app ở mục Cài đặt → Phiên bản.
3. Commit thay đổi code, message dạng `fix(...)` / `feat(...)`.
4. Chọn mức version, nếu người dùng không nói rõ thì tự quyết:
   - `patch` (x.y.**z**): chỉ sửa lỗi.
   - `minor` (x.**y**.0): tính năng hoặc thay đổi vừa/nhỏ.
   - `major` (**x**.0.0): thay đổi lớn, phá vỡ cách dùng cũ. Nên hỏi lại người dùng trước khi chọn mức này.
5. Chạy `npm run release -- <patch|minor|major>`. Script yêu cầu working tree sạch. Nó tự bump `package.json` và lock, chuyển mục `[Unreleased]` thành mục version, commit `release: vX.Y.Z`, tạo tag rồi push cả branch lẫn tag.
6. Push tag sẽ kích hoạt `.github/workflows/release.yml`: runner Windows build NSIS, scp lên VPS, rồi tạo GitHub Release.
   - Theo dõi: `gh run watch -R trituenguyen97/teams-caption-translator`, hoặc `gh run list --workflow release.yml`.
   - Xác nhận đã lên: `curl -s https://update.gin.info.vn/latest.yml` phải thấy version mới.
7. Báo lại cho người dùng: version, ghi chú, trạng thái run. Nếu run fail, đọc log bằng `gh run view --log-failed` và sửa.

**Lưu ý:**
- **GitHub có 2 tài khoản trong gh**. Repo thuộc `trituenguyen97`. Nếu push bị 403, chạy `gh auth switch -u trituenguyen97 && gh auth setup-git`, push xong thì switch lại tài khoản cũ nếu cần.
- Không cần build local để release, CI tự build. Muốn thử local: `npx electron-builder --win --publish never`.
- Xem trước bản release mà không ghi gì: `npm run release -- patch --dry`.

## Hạ tầng cập nhật (đã dựng 2026-11-25)

- App: `src/updater.js` dùng electron-updater, provider generic `https://update.gin.info.vn/` (cấu hình ở `build.publish` trong package.json). App không tự tải: người dùng bấm "Cập nhật & khởi động lại".
- VPS `163.192.37.48` (ARM, **đang chạy server game PTV + video-crawler — tuyệt đối không đụng các service đó**):
  - Thư mục file update: `/srv/ctupdate`, user `ctdeploy` (chỉ ghi thư mục này, không có sudo).
  - nginx `127.0.0.1:8130` (site `ctupdate`), tunnel `cloudflared-ctupdate` (token nằm trong `/etc/cloudflared/ctupdate.env`).
- GitHub Secrets: `VPS_SSH_KEY` (private key của ctdeploy), `VPS_KNOWN_HOSTS`. Nếu mất key: tạo keypair mới, ghi vào `/home/ctdeploy/.ssh/authorized_keys` (prefix `restrict `), rồi `gh secret set` lại.

## Model AI đang dùng (Gemini API, key người dùng nhập trong app)

- Dịch: `gemini-3.5-live-translate-preview` (mặc định) hoặc `gemini-3.8-live`, chọn trong Cài đặt (`src/gemini-live.js`).
- Chốt hàng gốc↔dịch: `gemini-decision-1` qua `POST v1beta/decisions` (API chưa có docs; schema xem comment trong `gemini-live.js`).
- Tóm tắt liên tục: flash-lite → gemma (Markdown). Tóm tắt tổng: `gemini-4-hydrogen` (20 lượt/ngày, tự sinh HTML + MD) (`src/gemini-text.js`).
- Các model Live chỉ trả AUDIO, không trả text → không dùng được cho tóm tắt hay căn câu.
