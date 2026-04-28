/**
 * probe-meeting-deep.js
 * Khám phá chi tiết DOM trang Meeting trong Teams để tìm caption selectors.
 * Chạy: node probe-meeting-deep.js
 * Yêu cầu: Đang trong meeting + đã bật Live Captions (More > Language and speech > Turn on live captions)
 */

const puppeteer = require('puppeteer-core');

const CDP_URL = 'http://localhost:9222';

(async () => {
  const browser = await puppeteer.connect({ browserURL: CDP_URL, defaultViewport: null });
  const pages = await browser.pages();

  // Tìm trang meeting
  let meetingPage = null;
  for (const p of pages) {
    const title = await p.title().catch(() => '');
    if (title.includes('Meeting') || title.includes('meeting') || title.includes('Call')) {
      meetingPage = p;
      console.log('Found meeting page:', title);
      break;
    }
  }

  if (!meetingPage) {
    console.log('Không tìm thấy trang meeting. Các trang hiện có:');
    for (const p of pages) console.log(' -', await p.title().catch(() => p.url().substring(0, 60)));
    await browser.disconnect();
    return;
  }

  // Probe toàn bộ data-tid trong trang meeting
  console.log('\n--- TẤT CẢ data-tid có trong meeting page ---');
  const allTids = await meetingPage.evaluate(() => {
    const els = document.querySelectorAll('[data-tid]');
    const map = {};
    for (const el of els) {
      const tid = el.getAttribute('data-tid');
      if (!map[tid]) map[tid] = { count: 0, text: '', tag: el.tagName };
      map[tid].count++;
      if (!map[tid].text) map[tid].text = (el.textContent || '').trim().substring(0, 60);
    }
    return map;
  });
  const tids = Object.entries(allTids).sort((a, b) => a[0].localeCompare(b[0]));
  tids.forEach(([tid, info]) => {
    const preview = info.text ? ` | text: "${info.text}"` : '';
    console.log(`  [${info.tag}] data-tid="${tid}" (x${info.count})${preview}`);
  });

  // Probe aria-labels
  console.log('\n--- aria-label elements (caption/subtitle/transcript keywords) ---');
  const ariaEls = await meetingPage.evaluate(() => {
    const els = document.querySelectorAll('[aria-label]');
    const results = [];
    for (const el of els) {
      const label = el.getAttribute('aria-label') || '';
      if (/caption|subtitle|transcript|speech/i.test(label)) {
        results.push({
          tag: el.tagName,
          label: label.substring(0, 100),
          class: typeof el.className === 'string' ? el.className.substring(0, 80) : '',
          text: (el.textContent || '').trim().substring(0, 80),
        });
      }
    }
    return results;
  });
  if (ariaEls.length) {
    ariaEls.forEach(e => console.log(`  [${e.tag}] aria-label="${e.label}" text="${e.text}"`));
  } else {
    console.log('  (không có) - Hãy bật Live Captions trong meeting trước');
  }

  // Probe class names có chứa caption/subtitle
  console.log('\n--- Classes chứa "caption"/"subtitle"/"transcript" ---');
  const captionClasses = await meetingPage.evaluate(() => {
    const all = document.querySelectorAll('*');
    const found = new Map();
    for (const el of all) {
      const cls = typeof el.className === 'string' ? el.className : '';
      if (/caption|subtitle|transcript/i.test(cls)) {
        const key = cls.substring(0, 80);
        if (!found.has(key)) {
          found.set(key, {
            tag: el.tagName,
            class: key,
            text: (el.textContent || '').trim().substring(0, 100),
            id: el.id || '',
            tid: el.getAttribute('data-tid') || '',
          });
        }
      }
    }
    return Array.from(found.values()).slice(0, 30);
  });
  if (captionClasses.length) {
    captionClasses.forEach(e => {
      console.log(`  [${e.tag}] class="${e.class}" | text="${e.text}"`);
    });
  } else {
    console.log('  (không có) - Hãy bật Live Captions trong meeting trước');
  }

  await browser.disconnect();
  console.log('\nDone.');
})();
