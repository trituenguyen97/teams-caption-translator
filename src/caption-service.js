/**
 * caption-service.js — DOM injection + runService (Teams caption polling loop)
 */
const state = require('./state');
const { enqueueTranslate, preprocessText, storeTeamsToken, PROV_NAMES } = require('./translation');
const cdp = require('./cdp-browser');

const POLL_MS = 200;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const send = (ch, data) => state.win?.webContents?.send(ch, data);

function timestamp() {
  return new Date().toLocaleTimeString('vi-VN', { hour12: false });
}

// ── DOM Injection ─────────────────────────────────────

async function injectCaptionObserver(page) {
  if (!page) return;
  await page.evaluate(() => {
    if (window.__ctObserver) { window.__ctObserver.disconnect(); window.__ctObserver = null; }
    clearInterval(window.__ctInterval);
    window.__ctMap = window.__ctMap || {};

    const SPAN_STYLE = 'display:block;color:#ff6b6b;font-style:italic;font-size:0.88em;margin-top:2px;line-height:1.4;';
    const norm = s => s.replace(/[\u3002\u3001\uff01\uff1f!?.,\s]+$/, '').trim();

    window.__ctReapply = function () {
      let els = [...document.querySelectorAll('[data-tid="closed-caption-text"]')];
      if (!els.length) els = [...document.querySelectorAll('[data-tid="closed-caption-default-text"]')];
      for (const el of els) {
        if (el.querySelector('.__ct_trans')) continue;
        const clone = el.cloneNode(true);
        clone.querySelectorAll('.__ct_trans').forEach(s => s.remove());
        const trans = window.__ctMap[norm(clone.textContent.trim())];
        if (!trans) continue;
        const span = document.createElement('span');
        span.className = '__ct_trans';
        span.style.cssText = SPAN_STYLE;
        span.textContent = trans;
        el.appendChild(span);
      }
    };

    window.__ctSet = function (origNorm, trans) {
      window.__ctMap[origNorm] = trans;
      window.__ctReapply();
    };

    const obs = new MutationObserver(() => {
      clearTimeout(window.__ctDebounce);
      window.__ctDebounce = setTimeout(window.__ctReapply, 30);
    });
    obs.observe(document.body, { childList: true, subtree: true });
    window.__ctObserver = obs;
    window.__ctInterval = setInterval(window.__ctReapply, 800);
    window.__ctObserverActive = true;
  }).catch(() => {});
}

async function injectTranslationBelowCaption(page, originalText, translatedText) {
  if (!page || !translatedText) return;
  const normKey = originalText.replace(/[\u3002\u3001\uff01\uff1f!?.,\s]+$/, '').trim();
  await page.evaluate(({ key, trans }) => {
    if (window.__ctSet) window.__ctSet(key, trans);
  }, { key: normKey, trans: translatedText }).catch(() => {});
}

// ── runService — Core caption polling loop ────────────

async function runService() {
  send('status', { type: 'connecting', msg: 'Đang kết nối CDP...' });

  const cdpEnvReady = await cdp.isCDPEnvSet();
  if (!cdpEnvReady) {
    await cdp.setCDPEnv();
  }

  await cdp.freePort9222IfNeeded();
  let browser = await cdp.connectToTeamsBrowser();
  if (!browser) {
    browser = await cdp.autoSetupCDP();
    if (!browser) return;
  }
  state.browser = browser;

  let page = await cdp.findMeetingPage();
  if (!page) {
    send('status', { type: 'waiting', msg: 'Chờ meeting Teams...' });
    while (!page) {
      await sleep(3000);
      if (state.captureSourceChanged) return;
      page = await cdp.findMeetingPage();
    }
  }
  if (state.browser && state.browser !== browser) browser = state.browser;
  state.meetingPage = page;

  if (!await cdp.checkCaptionsActive()) {
    send('status', { type: 'waiting-captions', msg: 'Bật Live Captions trong Teams để bắt đầu dịch' });
    let _ccTick = 0;
    while (!await cdp.checkCaptionsActive()) {
      if (state.captureSourceChanged) return;
      if (++_ccTick % 3 === 0) {
        const freshPage = await cdp.findMeetingPage();
        if (freshPage) { page = freshPage; state.meetingPage = freshPage; }
        if (state.browser && state.browser !== browser) browser = state.browser;
      }
      await sleep(2000);
    }
  }

  const provLabel = PROV_NAMES[state.provider] || state.provider;
  send('status', { type: 'running', msg: `Đang dịch sang ${state.targetLangLabel} bằng ${provLabel}` });

  const wsEndpoint = browser.wsEndpoint?.() || '';
  const portMatch = wsEndpoint.match(/:(\d+)\//);
  const cdpPort = portMatch ? parseInt(portMatch[1]) : 9222;
  cdp.startTeamsTokenCapture(cdpPort);

  try {
    const cdpSession = await page.createCDPSession();
    await cdpSession.send('Network.enable', { maxPostDataSize: 256 });
    cdpSession.on('Network.requestWillBeSent', (params) => {
      const auth = params.request?.headers?.authorization || params.request?.headers?.Authorization;
      if (!auth || !auth.startsWith('Bearer ')) return;
      const token = auth.slice(7);
      if (token.length > 100 && token.startsWith('eyJ') && token !== state.teamsToken) {
        storeTeamsToken(token, 'CDP session (meeting page)');
      }
    });
  } catch (e) { console.warn('[teams-token] CDP session error:', e.message); }

  const ccStateInterval = setInterval(async () => {
    send('cc-state', { active: await cdp.checkCaptionsActive() });
  }, 5000);

  const committed = new Map();
  const translationCache = new Map();
  let isInit = true, entryId = 0;
  let captionPage = page;
  let _lastPageCount = 0, _captionCheckTick = 0;
  // Theo dõi dòng cuối (dòng đang nói): chỉ dịch khi nó đứng yên ≥10s (người nói đã dừng)
  let _lastRowKey = '', _lastRowSince = 0;
  const LAST_ROW_SETTLE_MS = 10000;

  const toKey = (author, text) => `${author}::${text.replace(/[。、！？!?.,\s]+$/, '').trim()}`;

  await injectCaptionObserver(captionPage);

  async function findCaptionPage(allPages) {
    for (const p of allPages) {
      const has = await p.evaluate(() =>
        !!(document.querySelector('[data-tid="closed-caption-text"]') ||
           document.querySelector('[data-tid="closed-caption-default-text"]'))
      ).catch(() => false);
      if (has) return p;
    }
    return null;
  }

  // Polling loop
  while (true) {
    const pages = await browser.pages().catch(() => []);
    if (!pages.length) {
      send('status', { type: 'ended', msg: 'Meeting đã kết thúc' });
      clearInterval(ccStateInterval); break;
    }

    if (!pages.includes(page)) {
      const newPage = await cdp.findMeetingPage();
      if (newPage) { page = newPage; state.meetingPage = newPage; isInit = true; }
      else {
        send('status', { type: 'waiting', msg: 'Meeting kết thúc — chờ meeting mới...' });
        clearInterval(ccStateInterval); break;
      }
      await sleep(POLL_MS); continue;
    }

    const stillInMeeting = await page.evaluate(() =>
      !!(document.querySelector('[data-tid="ubar-toolbar-wrapper"]') ||
         document.querySelector('[data-tid="call-duration"]') ||
         document.querySelector('[data-tid="hangup-main-btn"]'))
    ).catch(() => false);
    if (!stillInMeeting) {
      send('status', { type: 'waiting', msg: 'Meeting kết thúc — chờ meeting mới...' });
      clearInterval(ccStateInterval); break;
    }

    _captionCheckTick++;
    let newCaptionPage = null;
    if (_captionCheckTick >= 10 || pages.length !== _lastPageCount) {
      _captionCheckTick = 0; _lastPageCount = pages.length;
      newCaptionPage = await findCaptionPage(pages);
    }
    if (newCaptionPage && newCaptionPage !== captionPage) {
      captionPage = newCaptionPage; isInit = true;
      await injectCaptionObserver(captionPage);
      if (translationCache.size > 0) {
        const entries = [...translationCache.entries()];
        captionPage.evaluate((map) => {
          window.__ctMap = window.__ctMap || {};
          for (const [k, v] of map) window.__ctMap[k] = v;
          if (window.__ctReapply) window.__ctReapply();
        }, entries).catch(() => {});
      }
    }

    const rows = await captionPage.evaluate(() => {
      let textEls = [...document.querySelectorAll('[data-tid="closed-caption-text"]')];
      if (!textEls.length) textEls = [...document.querySelectorAll('[data-tid="closed-caption-default-text"]')];
      let authorEls = [...document.querySelectorAll('[data-tid="author"]')];
      if (!authorEls.length) authorEls = [...document.querySelectorAll('[data-tid="closed-caption-speaker-name"]')];
      if (!authorEls.length) authorEls = [...document.querySelectorAll('[data-tid="closed-caption-displayname"]')];
      if (textEls.length) {
        return textEls.map((t, i) => {
          const clone = t.cloneNode(true);
          clone.querySelectorAll('.__ct_trans').forEach(s => s.remove());
          return { author: (authorEls[i]?.textContent || '').trim(), text: clone.textContent.trim() };
        });
      }
      return [];
    }).catch(() => []);

    if (isInit) {
      rows.forEach(r => committed.set(toKey(r.author, r.text), { id: 0, ts: Date.now() }));
      isInit = false; await sleep(POLL_MS); continue;
    }

    // ── Quy tắc dịch: chỉ dịch dòng ĐÃ CHỐT ──────────────────────────
    // Dòng cuối = dòng đang nói (text còn thay đổi) → KHÔNG dịch.
    // Trừ khi dòng cuối đứng yên ≥10s (người nói đã dừng) → coi như đã chốt → dịch nốt.
    const lastRow = rows[rows.length - 1];
    const lastRowKey = lastRow ? toKey(lastRow.author, lastRow.text) : '';
    if (lastRowKey !== _lastRowKey) { _lastRowKey = lastRowKey; _lastRowSince = Date.now(); }
    const lastRowSettled = !!lastRowKey && (Date.now() - _lastRowSince >= LAST_ROW_SETTLE_MS);

    // Mọi dòng trừ dòng cuối; thêm dòng cuối nếu đã đứng yên 10s.
    const completedRows = lastRowSettled ? rows.slice() : rows.slice(0, -1);
    const rowsToCommit = completedRows.filter(({ author, text }) => {
      if (!author || !text) return false;
      const normThis = toKey(author, text).slice(author.length + 2);
      if (!normThis) return false;
      return !completedRows.some(other =>
        other.author === author && other.text !== text &&
        toKey(other.author, other.text).slice(other.author.length + 2).startsWith(normThis) &&
        toKey(other.author, other.text).slice(other.author.length + 2).length > normThis.length);
    });

    for (const { author, text } of rowsToCommit) {
      if (!author) continue;
      const k = toKey(author, text);
      if (!committed.has(k) && text) {
        const normText = k.slice(author.length + 2);
        let reuseId = null;
        if (normText.length >= 3) {
          for (const [ck, cv] of committed) {
            if (cv.id === 0) continue;
            if (!ck.startsWith(author + '::')) continue;
            const cNorm = ck.slice(author.length + 2);
            if (cNorm.length >= 3 && normText.startsWith(cNorm) && normText.length > cNorm.length) {
              reuseId = cv.id; committed.delete(ck); break;
            }
          }
        }
        const id = reuseId !== null ? reuseId : ++entryId;
        committed.set(k, { id, ts: Date.now() });
        const ts = timestamp();
        const cleaned = preprocessText(text);

        // Mọi dòng tới đây đều ĐÃ CHỐT (dòng cuối đang đổi đã bị loại ở completedRows)
        // → dịch 1 LẦN, đẩy ĐỒNG BỘ vào app (send) + Teams (inject) trong cùng callback.
        {
          const tsMs = Date.now();
          send('caption-live', { id, author, original: text, translated: '…', ts, tsMs });
          enqueueTranslate(cleaned).then(translated => {
            const hasJapanese = /[\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FFF]/.test(translated);
            const isTranslated = translated !== cleaned && translated !== text && !hasJapanese;
            send('caption-live', { id, author, original: text, translated: isTranslated ? translated : null, ts: timestamp(), tsMs });
            if (isTranslated) {
              const normText = text.replace(/[\u3002\u3001\uff01\uff1f!?.,\s]+$/, '').trim();
              translationCache.set(normText, translated);
              injectTranslationBelowCaption(captionPage, text, translated).catch(() => {});
            }
          });
        }
      }
    }

    const currentKeys = new Set(rows.map(r => toKey(r.author, r.text)));
    const now = Date.now();
    for (const [k, cv] of committed) {
      if (currentKeys.has(k)) cv.ts = now;
      else if (now - cv.ts > 3000) committed.delete(k);
    }

    await sleep(POLL_MS);
    if (state.captureSourceChanged) { clearInterval(ccStateInterval); break; }

    if (!await cdp.checkCaptionsActive().catch(() => false)) {
      send('status', { type: 'waiting-captions', msg: 'Captions tắt — dùng nút ▶ hoặc Alt+Shift+C để bật lại' });
      send('cc-state', { active: false });
      while (!await cdp.checkCaptionsActive().catch(() => false)) {
        if (!browser.isConnected()) { clearInterval(ccStateInterval); return; }
        if (state.captureSourceChanged) { clearInterval(ccStateInterval); return; }
        await sleep(2000);
      }
      const provLabel2 = PROV_NAMES[state.provider] || state.provider;
      send('status', { type: 'running', msg: `Đang dịch sang ${state.targetLangLabel} bằng ${provLabel2}` });
      send('cc-state', { active: true });
    }
  }

  await browser.disconnect().catch(() => {});
}

module.exports = { runService, timestamp };
