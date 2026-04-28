/**
 * probe-teams-dom.js
 * Kết nối CDP vào Teams WebView2, khám phá DOM để tìm caption elements.
 * Chạy: node probe-teams-dom.js
 */

const puppeteer = require('puppeteer-core');

const CDP_URL = 'http://localhost:9222';

async function probePage(page) {
  const title = await page.title().catch(() => '(no title)');
  const url = page.url();

  console.log(`\n${'='.repeat(70)}`);
  console.log(`PAGE: ${title.substring(0, 60)}`);
  console.log(`URL:  ${url.substring(0, 80)}`);

  try {
    const result = await page.evaluate(() => {
      const selectors = [
        '[data-tid="caption-text"]',
        '[class*="caption"]',
        '[class*="Caption"]',
        '[data-tid*="caption"]',
        '[aria-label*="caption"]',
        '[aria-label*="Caption"]',
        '[class*="transcript"]',
        '[data-tid*="transcript"]',
        '[id*="caption"]',
        '[id*="Caption"]',
        '[role="log"]',
        '[data-tid*="meeting"]',
      ];
      const found = {};
      for (const sel of selectors) {
        try {
          const els = document.querySelectorAll(sel);
          if (els.length) {
            const texts = Array.from(els).slice(0, 3).map(el => {
              const t = (el.textContent || '').trim().substring(0, 100);
              const cls = el.className && typeof el.className === 'string' ? el.className.substring(0, 60) : '';
              const tid = el.getAttribute('data-tid') || '';
              return `text="${t}" class="${cls}" tid="${tid}"`;
            });
            found[sel] = { count: els.length, samples: texts };
          }
        } catch (e) { /* selector not valid */ }
      }
      return found;
    });

    if (Object.keys(result).length === 0) {
      console.log('  -> Không tìm thấy caption elements (chưa vào meeting hoặc chưa bật captions)');
    } else {
      for (const [sel, info] of Object.entries(result)) {
        console.log(`\n  SELECTOR: ${sel}  (${info.count} elements)`);
        info.samples.forEach((s, i) => console.log(`    [${i}] ${s}`));
      }
    }

    // Lấy thêm: tất cả data-tid values trong DOM
    const dataTids = await page.evaluate(() => {
      const els = document.querySelectorAll('[data-tid]');
      const tids = new Set();
      for (const el of els) {
        const tid = el.getAttribute('data-tid');
        if (tid && (tid.includes('caption') || tid.includes('transcript') || tid.includes('meeting-stage') || tid.includes('subtitle'))) {
          tids.add(tid);
        }
      }
      return Array.from(tids).slice(0, 20);
    });

    if (dataTids.length) {
      console.log('\n  CAPTION/MEETING data-tid values found:');
      dataTids.forEach(t => console.log('    -', t));
    }

  } catch (err) {
    console.log('  ERROR:', err.message.substring(0, 100));
  }
}

(async () => {
  console.log(`Connecting to CDP at ${CDP_URL}...`);
  let browser;
  try {
    browser = await puppeteer.connect({
      browserURL: CDP_URL,
      defaultViewport: null,
    });
  } catch (err) {
    console.error('Không thể kết nối CDP:', err.message);
    console.error('-> Đảm bảo đã set WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS và restart Teams');
    process.exit(1);
  }

  const pages = await browser.pages();
  console.log(`Connected! ${pages.length} page(s) found.`);

  for (const page of pages) {
    await probePage(page);
  }

  await browser.disconnect();
  console.log('\nDone.');
})();
