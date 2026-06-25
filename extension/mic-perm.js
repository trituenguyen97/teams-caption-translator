// Trang xin quyền micro — chạy trong TAB thật (có thanh địa chỉ) để Chrome hiện được hộp thoại quyền.
// Tách khỏi HTML vì MV3 CSP (script-src 'self') chặn inline <script>.
const m = document.getElementById('m');
const btn = document.getElementById('ask');

async function ask() {
  m.className = ''; m.textContent = 'Đang xin quyền… · Requesting…';
  try {
    const s = await navigator.mediaDevices.getUserMedia({ audio: true });
    s.getTracks().forEach(t => t.stop());
    m.className = 'ok';
    m.textContent = '✅ Đã cấp quyền micro! Đang tự bắt đầu trong panel… · Granted — auto-starting in the panel…';
    btn.style.display = 'none';
    // Báo về side panel → panel tự đóng tab này + tự Bắt đầu (nếu nguồn đang là Micro).
    try { chrome.runtime.sendMessage({ type: 'mic-granted' }); } catch (_) {}
  } catch (e) {
    m.className = 'err';
    m.textContent = '❌ Chưa cấp được (' + (e && e.name) + '). Bấm lại nút và chọn “Cho phép”. · Not granted — click again and choose “Allow”.';
  }
}

btn.addEventListener('click', ask);
