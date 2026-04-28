// Chạy script này khi Teams đang có Live Captions bật
const puppeteer = require('puppeteer-core');

async function tryPort(port) {
  try {
    const b = await puppeteer.connect({ browserURL: `http://localhost:${port}`, defaultViewport: null });
    const pages = await b.pages().catch(() => []);
    for (const p of pages) {
      const t = await p.title().catch(() => '');
      if (/teams|meeting|call/i.test(t) || (await p.url().includes?.('teams'))) {
        return { b, p, port };
      }
    }
    await b.disconnect().catch(() => {});
  } catch {}
  return null;
}

async function main() {
  let res = null;
  for (let port = 9222; port <= 9235; port++) {
    res = await tryPort(port);
    if (res) break;
  }
  if (!res) { console.log('[!] Không tìm thấy Teams. Kill Widgets trước?'); return; }

  const { b, p: page, port } = res;
  console.log('>>> Teams port:', port, '| page:', await page.title());

  // 1. Tất cả data-tid chứa "caption"
  const capTids = await page.evaluate(() =>
    [...document.querySelectorAll('[data-tid]')]
      .map(e => e.getAttribute('data-tid'))
      .filter(t => /caption|closed|cc/i.test(t))
  );
  console.log('\n[caption data-tids]:', capTids);

  // 2. Tất cả aria-label chứa "caption"
  const capAria = await page.evaluate(() =>
    [...document.querySelectorAll('[aria-label]')]
      .map(e => ({ aria: e.getAttribute('aria-label'), tag: e.tagName, tid: e.getAttribute('data-tid') }))
      .filter(e => /caption/i.test(e.aria))
  );
  console.log('\n[caption aria-labels]:', capAria);

  // 3. Tất cả text nodes chứa nội dung caption (ví dụ tên người nói)
  const captionTexts = await page.evaluate(() => {
    const els = [...document.querySelectorAll('[class*="caption"], [class*="Caption"], [class*="transcript"]')];
    return els.map(e => ({ tag: e.tagName, cls: e.className.slice(0,60), text: (e.textContent||'').trim().slice(0,60) })).slice(0,15);
  });
  console.log('\n[caption class elements]:', captionTexts);

  // 4. Tìm panel/overlay wrapper nào đang hiển thị
  const visiblePanels = await page.evaluate(() =>
    [...document.querySelectorAll('[data-tid]')]
      .filter(e => {
        const s = window.getComputedStyle(e);
        return s.display !== 'none' && s.visibility !== 'hidden' && s.opacity !== '0';
      })
      .map(e => e.getAttribute('data-tid'))
      .filter(t => /panel|caption|sidebar|transcript/i.test(t))
  );
  console.log('\n[visible panel tids]:', visiblePanels);

  // 5. Các div có text trông như caption (ngắn, nhiều dòng)
  const liveText = await page.evaluate(() => {
    const spans = [...document.querySelectorAll('span, p, div')].filter(e => {
      const t = (e.textContent || '').trim();
      return t.length > 5 && t.length < 200 && e.children.length === 0;
    });
    // Lấy 10 span gần cuối body
    return spans.slice(-15).map(e => ({
      tag: e.tagName,
      tid: e.getAttribute('data-tid'),
      cls: (e.className||'').slice(0,50),
      text: (e.textContent||'').trim().slice(0,80),
    }));
  });
  console.log('\n[recent leaf text nodes]:', JSON.stringify(liveText, null, 2));

  await b.disconnect().catch(() => {});
}

main().catch(console.error);
