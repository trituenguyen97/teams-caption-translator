/**
 * caption-cdp.js
 * Đọc Live Captions từ Microsoft Teams qua CDP (Chrome DevTools Protocol),
 * sau đó dịch sang tiếng Việt bằng Google Translate free.
 *
 * Yêu cầu:
 *  1. Đã set env var WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222
 *     và restart Teams ít nhất 1 lần.
 *  2. Đang trong meeting và đã bật Live Captions
 *     (More > Language and speech > Turn on live captions)
 *
 * Chạy: node caption-cdp.js [target_lang]
 *   target_lang mặc định là "vi" (tiếng Việt). Ví dụ: node caption-cdp.js en
 */

const puppeteer = require('puppeteer-core');

const CDP_URL = 'http://localhost:9222';
const TARGET_LANG = process.argv[2] || 'vi';
const POLL_MS = 800;       // poll DOM mỗi 800ms
const SETTLE_MS = 2000;    // chờ 2s ổn định trước khi dịch entry cuối

// ---- Google Translate (ESM, cần dynamic import) ----
let translateFn = null;
async function loadTranslate() {
  const mod = await import('@vitalets/google-translate-api');
  translateFn = mod.translate;
}

async function translate(text, to) {
  if (!translateFn) return text;
  try {
    const res = await translateFn(text, { to });
    return res.text;
  } catch (e) {
    // Rate limit hoặc lỗi mạng – trả về bản gốc
    return `[${e.message.substring(0, 40)}] ${text}`;
  }
}

// ---- State ----
// Map: key → { author, original, translated, done }
// key = `${author}::${original}` để tránh trùng
const seen = new Map();

let lastActiveKey = null;
let lastActiveText = '';
let lastActiveTime = 0;

// ---- Polling ----
async function poll(page) {
  const entries = await page.evaluate(() => {
    // Ghép author[i] và closed-caption-text[i]
    const authors = Array.from(document.querySelectorAll('[data-tid="author"]'));
    const texts   = Array.from(document.querySelectorAll('[data-tid="closed-caption-text"]'));
    const len = Math.min(authors.length, texts.length);
    const result = [];
    for (let i = 0; i < len; i++) {
      result.push({
        author: (authors[i].textContent || '').trim(),
        text:   (texts[i].textContent  || '').trim(),
      });
    }
    return result;
  }).catch(() => []);

  if (entries.length === 0) return;

  const now = Date.now();

  // Các entry 0..N-2 là đã hoàn thành
  for (let i = 0; i < entries.length - 1; i++) {
    const { author, text } = entries[i];
    const key = `${author}::${text}`;
    if (!seen.has(key) && text.length > 0) {
      seen.set(key, { author, original: text, translated: null, done: false });
      processEntry(key, author, text);
    }
  }

  // Entry cuối cùng có thể đang được nói (in-progress)
  const last = entries[entries.length - 1];
  const lastKey = `${last.author}::${last.text}`;

  if (last.text !== lastActiveText || lastKey !== lastActiveKey) {
    // Text thay đổi – reset timer
    lastActiveKey  = lastKey;
    lastActiveText = last.text;
    lastActiveTime = now;
  } else if (now - lastActiveTime >= SETTLE_MS && !seen.has(lastKey) && last.text.length > 0) {
    // Đã ổn định >= SETTLE_MS và chưa dịch
    seen.set(lastKey, { author: last.author, original: last.text, translated: null, done: false });
    processEntry(lastKey, last.author, last.text);
    lastActiveKey = null;
    lastActiveText = '';
  }
}

async function processEntry(key, author, text) {
  const translated = await translate(text, TARGET_LANG);
  const entry = seen.get(key);
  if (entry) {
    entry.translated = translated;
    entry.done = true;
  }
  printEntry(author, text, translated);
}

function printEntry(author, original, translated) {
  const ts = new Date().toLocaleTimeString('vi-VN', { hour12: false });
  console.log(`\n[${ts}] ${author}`);
  console.log(`  原: ${original}`);
  console.log(`  VI: ${translated}`);
}

// ---- Main ----
(async () => {
  console.log('Loading Google Translate...');
  await loadTranslate();
  console.log('OK');

  console.log(`\nConnecting to Teams CDP at ${CDP_URL}...`);
  let browser;
  try {
    browser = await puppeteer.connect({ browserURL: CDP_URL, defaultViewport: null });
  } catch (err) {
    console.error('\nKhông thể kết nối CDP:', err.message);
    console.error('\nHướng dẫn bật CDP:');
    console.error('  1. Mở PowerShell và chạy:');
    console.error('     [System.Environment]::SetEnvironmentVariable("WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS", "--remote-debugging-port=9222", "User")');
    console.error('  2. Đóng Teams hoàn toàn (kể cả system tray)');
    console.error('  3. Mở lại Teams rồi chạy lại lệnh này');
    process.exit(1);
  }

  // Tìm trang meeting
  let meetingPage = null;
  const findMeetingPage = async () => {
    const pages = await browser.pages();
    for (const p of pages) {
      const title = await p.title().catch(() => '');
      if (/meeting|call/i.test(title) && !/calendar/i.test(title)) {
        return p;
      }
    }
    return null;
  };

  meetingPage = await findMeetingPage();

  if (!meetingPage) {
    console.log('\nChưa tìm thấy trang meeting. Đang chờ...');
    console.log('→ Hãy vào meeting và bật Live Captions');
    // Chờ meeting mở
    while (!meetingPage) {
      await sleep(3000);
      meetingPage = await findMeetingPage();
      if (meetingPage) {
        const t = await meetingPage.title().catch(() => 'Meeting');
        console.log('Đã tìm thấy meeting:', t);
      }
    }
  } else {
    const t = await meetingPage.title().catch(() => 'Meeting');
    console.log(`Đã kết nối meeting: "${t}"`);
  }

  // Kiểm tra captions đã bật chưa
  const checkCaptions = async () => {
    const count = await meetingPage.evaluate(() =>
      document.querySelectorAll('[data-tid="closed-caption-text"]').length
    ).catch(() => 0);
    return count > 0;
  };

  let captionsOn = await checkCaptions();
  if (!captionsOn) {
    console.log('\nLive Captions chưa được bật.');
    console.log('→ Trong meeting, nhấn More (...) > Language and speech > Turn on live captions');
    console.log('Đang chờ captions...\n');
    while (!captionsOn) {
      await sleep(2000);
      captionsOn = await checkCaptions();
    }
    console.log('Captions đã bật! Bắt đầu theo dõi...');
  } else {
    console.log(`Captions đang bật. Target lang: ${TARGET_LANG}`);
    console.log('━'.repeat(70));
  }

  console.log('\nĐang theo dõi captions (Ctrl+C để dừng)...\n');

  // Poll liên tục
  while (true) {
    // Kiểm tra meeting vẫn còn
    const pages = await browser.pages().catch(() => []);
    const stillInMeeting = pages.some(p => {
      try { return p === meetingPage; } catch { return false; }
    });
    if (!stillInMeeting || pages.length === 0) {
      console.log('\nMeeting đã kết thúc hoặc mất kết nối CDP.');
      break;
    }

    await poll(meetingPage);
    await sleep(POLL_MS);
  }

  await browser.disconnect().catch(() => {});
  process.exit(0);
})();

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
