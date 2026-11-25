# Changelog

Phiên bản theo dạng `x.y.z`: **z** = sửa lỗi · **y** = thay đổi vừa/nhỏ · **x** = thay đổi lớn.
Ghi thay đổi mới dưới mục `[Unreleased]`, rồi chạy `npm run release -- patch|minor|major` để chốt.

## [Unreleased]

## 1.1.2 — 2026-11-25

- Cài đặt: ô tick nằm đầu dòng, thẳng hàng với chữ (bấm cả dòng để tick)
- Cài đặt: menu không còn bị thanh dưới che mất phần cuối (mục Phiên bản)

## 1.1.1 — 2026-11-25

- Sửa lỗi nói cùng ngôn ngữ đích (vd chen câu tiếng Việt trong cuộc họp tiếng Nhật) bị mất hoặc không hiển thị: câu đó giờ hiện ngay ở cột dịch thành hàng riêng

## 1.1.0 — 2026-11-25

- Tự cập nhật: mở app sẽ kiểm tra phiên bản mới, Cài đặt hiện thông báo + ghi chú thay đổi + nút Cập nhật & khởi động lại
- Chọn model dịch: Gemini 3.5 Live Translate hoặc Gemini 3.8 Live
- Tóm tắt tổng bằng Gemini 4 Hydrogen: trang HTML trực quan (biểu đồ, sơ đồ) + biên bản Markdown, hiển thị lượt còn lại x/20
- Tóm tắt liên tục chỉ còn dạng Markdown
- Sửa lệch hàng câu gốc ↔ câu dịch khi nói dài: chốt hàng bằng Gemini Decision 1, gần realtime (~0.7s)

