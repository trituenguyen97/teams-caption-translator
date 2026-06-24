// Service worker (MV3). Vai trò DUY NHẤT: mở Side Panel khi bấm icon extension.
// Việc thu/dịch/phát nằm hết trong side panel; capture dùng getDisplayMedia/getUserMedia
// (không cần tabCapture/tabs nữa) nên SW không còn xử lý message.

chrome.runtime.onInstalled.addListener(() => {
  try { chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }); } catch (e) {}
});
chrome.runtime.onStartup?.addListener?.(() => {
  try { chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }); } catch (e) {}
});
