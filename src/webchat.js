/**
 * webchat.js — Summary qua web chat UI (Copilot, duck.ai) trong BrowserWindow embedded.
 *
 * DEBUG mode: bật bằng env var WEBCHAT_DEBUG=1. MẶC ĐỊNH TẮT → summary chạy webchat ChatGPT ẩn.
 *   - Window hiển thị từ đầu
 *   - DevTools tự mở
 *   - Window không tự ẩn sau khi xong → user inspect được
 *   - Log chi tiết từng bước ra console
 */
const { BrowserWindow } = require('electron');
const path = require('path');
const state = require('./state');

// DEBUG mode: set env var WEBCHAT_DEBUG=1 trước khi npm start để bật window visible + DevTools + verbose log
const DEBUG = process.env.WEBCHAT_DEBUG === '1';

// User-Agent giả lập Edge thật trên Windows 11
const FAKE_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const log = (...a) => console.log('[webchat]', ...a);
const logErr = (...a) => console.warn('[webchat]', ...a);

// Patterns text của button cần auto-click để dismiss overlay (cookie banner, welcome modal)
const DISMISS_PATTERNS = {
  copilot: [
    /^accept all$/i, /^accept$/i, /^accept and continue$/i,
    /^got it$/i, /^let'?s go$/i, /^continue$/i, /^skip$/i,
    /^get started$/i, /^next$/i,
  ],
  duckai: [
    /^agree and continue$/i, /^agree$/i,
    /^accept all$/i, /^accept$/i,
    /^got it$/i, /^continue$/i, /^ok$/i,
  ],
  chatgpt: [
    /^stay logged out$/i,
    /^accept all$/i, /^accept$/i, /^reject all$/i,
    /^i agree$/i, /^agree$/i,
    /^got it$/i, /^continue$/i, /^skip$/i,
    /^okay,?\s*let'?s go$/i, /^let'?s go$/i,
    /^close$/i,
  ],
};

// NOTE: 'copilot' provider hiện DISABLED khỏi UI (app.html dropdown) vì
// Microsoft anti-bot (Cloudflare Turnstile + TLS fingerprint check) không qua được
// chỉ với Electron stealth. Giữ config ở đây phòng tương lai MS nới policy.
const PROVIDERS = {
  copilot: {
    label: 'Microsoft Copilot',
    url: 'https://copilot.microsoft.com',
    partition: 'persist:webchat-copilot',
    inputSelectors: [
      'textarea#userInput',
      'textarea[data-testid="composer-input"]',
      'textarea[placeholder*="Message"]',
      'textarea[placeholder*="Ask"]',
      'cib-text-input textarea',
      'div[contenteditable="true"][role="textbox"]',
      'div[contenteditable="true"]',
      'textarea',
    ],
    submitSelectors: [
      'button[data-testid="submit-button"]',
      'button[aria-label*="Submit"]',
      'button[aria-label*="Send"]',
      'button[title*="Submit"]',
      'button[type="submit"]',
    ],
    responseSelectors: [
      '[data-content="ai-message"]',
      '[data-author="bot"]',
      '[data-author="copilot"]',
      'cib-message[source="bot"]',
      'div[data-message-author-role="assistant"]',
      '[class*="ai-message"]',
      '[class*="copilot-message"]',
      'div[role="article"]',
      'main [class*="message"][class*="assistant"]',
      'main [class*="response"]',
    ],
    chatContainerSelectors: ['main', '[role="main"]', '#root', 'body'],
  },
  duckai: {
    label: 'DuckDuckGo AI',
    url: 'https://duckduckgo.com/?q=duckai&ia=chat',
    partition: 'persist:webchat-duckai',
    inputSelectors: [
      'textarea[name="user-prompt"]',
      'textarea[placeholder*="Ask"]',
      'textarea[placeholder*="Message"]',
      'div[contenteditable="true"][role="textbox"]',
      'div[contenteditable="true"]',
      'textarea',
    ],
    submitSelectors: [
      'button[aria-label*="Send"]',
      'button[type="submit"]',
      'form button[type="submit"]',
    ],
    // Selectors broad — lọc thêm bằng role/attribute sau
    responseSelectors: [
      '[data-message-author-role="assistant"]',
      '[data-role="assistant"]',
      'article[data-testid*="assistant"]',
      'div[data-testid*="assistant"]',
      '[class*="assistant"]',
      '[class*="ai-message"]',
      '[class*="bot-message"]',
      'article',
      'main [class*="message"]',
      '[class*="markdown"]',
    ],
    // Container chính chứa hội thoại — dùng cho fallback text-diff
    chatContainerSelectors: ['main', '[role="main"]', 'body'],
  },
  chatgpt: {
    label: 'ChatGPT',
    url: 'https://chatgpt.com/',
    partition: 'persist:webchat-chatgpt',
    inputSelectors: [
      'div#prompt-textarea',
      '#prompt-textarea',
      'div[contenteditable="true"][id="prompt-textarea"]',
      'textarea[data-id]',
      'textarea[placeholder*="Message"]',
      'textarea[placeholder*="ChatGPT"]',
      'div[contenteditable="true"][role="textbox"]',
      'div[contenteditable="true"]',
      'textarea',
    ],
    submitSelectors: [
      'button[data-testid="send-button"]',
      'button[data-testid="fruitjuice-send-button"]',
      'button[aria-label*="Send prompt"]',
      'button[aria-label*="Send message"]',
      'button[type="submit"]',
    ],
    // CHỈ selector trỏ ĐÚNG vào nội dung trợ lý. Bỏ 'conversation-turn' (khớp CẢ lượt user → kéo theo
    // echo prompt "You said:…") và nhãn sr-only. '.markdown' = thân câu trả lời (lượt user không có).
    responseSelectors: [
      '[data-message-author-role="assistant"]',
      'div[data-message-author-role="assistant"]',
      '[class*="markdown"]',
    ],
    chatContainerSelectors: ['main', '[role="main"]', '#__next', 'body'],
    // ChatGPT có selector trợ lý đáng tin → KHÔNG dùng fallback text-diff (vốn quét cả container, dễ
    // vớ nhầm prompt "You said:…" khi câu trả lời còn rỗng/đang nghĩ).
    noTextDiff: true,
  },
};

const _windows = new Map();

function getWindow(provider) {
  const config = PROVIDERS[provider];
  if (!config) throw new Error(`Unknown provider: ${provider}`);

  let win = _windows.get(provider);
  if (win && !win.isDestroyed()) return win;

  win = new BrowserWindow({
    width: 1200,
    height: 850,
    show: DEBUG,
    title: `Web Chat: ${config.label}${DEBUG ? ' [DEBUG]' : ''}`,
    backgroundColor: '#1b1b1b',
    parent: state.win || undefined,
    webPreferences: {
      partition: config.partition,
      preload: path.join(__dirname, 'webchat-preload.js'),
      contextIsolation: false,  // preload cần access window/navigator
      nodeIntegration: false,
      sandbox: false,           // preload không chạy được trong sandbox
    },
  });

  // Stealth: User-Agent giống Edge thật, không có "Electron"
  win.webContents.setUserAgent(FAKE_UA);
  win.webContents.session.setUserAgent(FAKE_UA, 'en-US');

  // Override Sec-CH-UA headers để giống Edge (Microsoft check những header này)
  win.webContents.session.webRequest.onBeforeSendHeaders((details, callback) => {
    const h = details.requestHeaders;
    h['sec-ch-ua'] = '"Microsoft Edge";v="131", "Chromium";v="131", "Not_A Brand";v="24"';
    h['sec-ch-ua-mobile'] = '?0';
    h['sec-ch-ua-platform'] = '"Windows"';
    delete h['X-Electron-App']; // nếu Electron set
    callback({ requestHeaders: h });
  });

  win.on('closed', () => { _windows.delete(provider); });
  win.on('close', (e) => {
    if (!win._allowClose) { e.preventDefault(); win.hide(); }
  });

  if (DEBUG) {
    win.webContents.openDevTools({ mode: 'right' });
  }

  _windows.set(provider, win);
  return win;
}

// ── Lifecycle: mỗi lần tóm tắt MỞ CỬA SỔ MỚI → load chatgpt.com → xử lý → (thành công) DESTROY.
// KHÔNG prewarm, KHÔNG giữ cửa sổ sống: giữ 1 session sống lâu làm ChatGPT bắt đăng nhập ở lần hỏi
// thứ 2. Mở lại sạch mỗi lần → mỗi yêu cầu độc lập. (Session/login vẫn lưu đĩa qua partition persist.)

// Loại noise UI của trang chat lọt vào response: nhãn screen-reader đầu message + disclaimer cuối trang.
// (Khi extraction over-capture qua text-diff fallback, các đoạn này dính vào báo cáo.)
function stripChatUiNoise(text) {
  if (!text) return text;
  const cleaned = text
    // Nhãn sr-only đầu message: "ChatGPT said:" / "You said:" / "Assistant said:"
    .replace(/^\s*(?:ChatGPT|Copilot|Assistant)\s+said:\s*/i, '')
    .replace(/^\s*You said:\s*/i, '')
    // Disclaimer cuối trang (các biến thể): "ChatGPT can make mistakes…",
    // "ChatGPT is AI and can make mistakes." — kèm "Check important info." nếu có.
    .replace(/\s*(?:ChatGPT|Copilot)?\s*(?:is AI and\s+)?can make mistakes\.?(?:\s*Check important info\.?)?\s*$/i, '')
    // Nhãn sr-only sót ở cuối khi over-capture
    .replace(/\s*(?:ChatGPT|Copilot|Assistant)\s+said:\s*$/i, '')
    .trim();
  return cleaned || text;   // nếu lọc ra rỗng (bất thường) → giữ nguyên bản gốc
}

// B: ChatGPT đang sinh thì hiện nút "Stop"; nút biến mất = sinh xong → thoát sớm khỏi waitResponseStable.
async function isGenerating(win) {
  return await exec(win, `(() => !!document.querySelector('button[data-testid="stop-button"], button[aria-label*="Stop"], button[aria-label*="stop"]'))()`);
}

async function exec(win, code) {
  try { return await win.webContents.executeJavaScript(code, true); }
  catch (e) { logErr('exec error:', e.message); return null; }
}

/** DOM probe — log input/button + những element có thể là response container. */
async function probeDom(win, label) {
  const info = await exec(win, `
    (() => {
      const txt = (el) => (el.textContent || '').slice(0, 60).replace(/\\s+/g, ' ').trim();
      const textareas = [...document.querySelectorAll('textarea')].map(el => ({
        tag: 'textarea',
        id: el.id || '', name: el.name || '',
        placeholder: el.placeholder || '',
        testid: el.getAttribute('data-testid') || '',
        visible: el.offsetWidth > 0 && el.offsetHeight > 0,
      }));
      const ceds = [...document.querySelectorAll('[contenteditable="true"]')].map(el => ({
        tag: el.tagName.toLowerCase() + '[contenteditable]',
        role: el.getAttribute('role') || '',
        testid: el.getAttribute('data-testid') || '',
        ariaLabel: el.getAttribute('aria-label') || '',
        visible: el.offsetWidth > 0 && el.offsetHeight > 0,
      }));
      const buttons = [...document.querySelectorAll('button')].filter(b => b.offsetWidth > 0).slice(0, 12).map(el => ({
        text: txt(el),
        testid: el.getAttribute('data-testid') || '',
        ariaLabel: el.getAttribute('aria-label') || '',
        type: el.type || '',
      }));
      // Tìm các element có text dài (>60 chars) — có thể là message/response
      const candidates = [];
      const seen = new Set();
      for (const el of document.querySelectorAll('article, [role="article"], [class*="message"], [class*="response"], [class*="markdown"], [data-author], [data-role], [data-message-author-role], main > div > div, main > section > div')) {
        if (el.offsetWidth === 0 || el.offsetHeight === 0) continue;
        const t = (el.innerText || '').trim();
        if (t.length < 60) continue;
        const sig = el.tagName + '|' + (el.className || '').slice(0, 50);
        if (seen.has(sig)) continue;
        seen.add(sig);
        candidates.push({
          tag: el.tagName.toLowerCase(),
          cls: (el.className || '').toString().slice(0, 80),
          role: el.getAttribute('role') || '',
          author: el.getAttribute('data-author') || el.getAttribute('data-role') || el.getAttribute('data-message-author-role') || '',
          testid: el.getAttribute('data-testid') || '',
          textLen: t.length,
          textHead: t.slice(0, 80),
        });
        if (candidates.length >= 10) break;
      }
      return {
        url: location.href, title: document.title,
        textareas, ceds, buttons, candidates,
      };
    })();
  `);
  log(`---- DOM PROBE @ ${label} ----`);
  if (!info) { logErr('probe trả về null'); return; }
  log(`URL: ${info.url}`);
  log(`Title: ${info.title}`);
  log(`Textareas (${info.textareas.length}):`);
  info.textareas.forEach((t, i) => log(`  [${i}] ${JSON.stringify(t)}`));
  log(`ContentEditable (${info.ceds.length}):`);
  info.ceds.forEach((t, i) => log(`  [${i}] ${JSON.stringify(t)}`));
  log(`Buttons (${info.buttons.length}):`);
  info.buttons.forEach((b, i) => log(`  [${i}] ${JSON.stringify(b)}`));
  log(`Message-candidates (${info.candidates.length}):`);
  info.candidates.forEach((c, i) => log(`  [${i}] ${JSON.stringify(c)}`));
  log(`---- END PROBE ----`);
}

/** Auto-click button có text khớp pattern để dismiss overlay/modal/banner. Loop vì có thể nhiều layer. */
async function dismissOverlays(win, provider) {
  const patterns = DISMISS_PATTERNS[provider] || [];
  if (!patterns.length) return 0;

  let dismissed = 0;
  // Loop tối đa 4 lần (đa số trường hợp 1-2 modal liên tiếp)
  for (let i = 0; i < 4; i++) {
    let clickedThisRound = false;
    for (const pat of patterns) {
      const r = await exec(win, `
        (() => {
          const re = ${pat.toString()};
          // Tìm button (hoặc role=button) hiển thị, có text khớp
          const candidates = [
            ...document.querySelectorAll('button, [role="button"], a[role="button"]')
          ].filter(b => {
            if (b.offsetWidth === 0 || b.offsetHeight === 0) return false;
            const t = (b.textContent || '').trim();
            return re.test(t);
          });
          if (!candidates.length) return null;
          const el = candidates[0];
          const text = (el.textContent || '').trim().slice(0, 50);
          el.click();
          return { text };
        })();
      `);
      if (r) {
        log(`dismissed overlay: "${r.text}" (pattern ${pat})`);
        dismissed++;
        clickedThisRound = true;
        await sleep(700);
        break; // restart loop
      }
    }
    if (!clickedThisRound) break;
  }
  return dismissed;
}

async function waitForAnySelector(win, selectors, timeoutMs) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    for (const sel of selectors) {
      const found = await exec(win, `
        (() => {
          const el = document.querySelector(${JSON.stringify(sel)});
          if (!el) return false;
          // Phải visible
          return el.offsetWidth > 0 && el.offsetHeight > 0;
        })();
      `);
      if (found) return sel;
    }
    await sleep(500);
  }
  return null;
}

async function setInputValue(win, selector, value) {
  return await exec(win, `
    (() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return { ok: false, reason: 'element not found' };
      el.focus();
      const v = ${JSON.stringify(value)};
      if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') {
        const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
        const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
        setter.call(el, v);
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        return { ok: true, type: 'textarea', length: el.value.length };
      }
      if (el.isContentEditable) {
        el.textContent = v;
        el.dispatchEvent(new InputEvent('input', { bubbles: true, data: v, inputType: 'insertText' }));
        return { ok: true, type: 'contenteditable', length: el.textContent.length };
      }
      return { ok: false, reason: 'unsupported element type: ' + el.tagName };
    })();
  `);
}

async function clickSubmit(win, selectors) {
  for (const sel of selectors) {
    const r = await exec(win, `
      (() => {
        const el = document.querySelector(${JSON.stringify(sel)});
        if (!el) return { ok: false, reason: 'not found' };
        if (el.disabled) return { ok: false, reason: 'disabled' };
        if (el.offsetWidth === 0) return { ok: false, reason: 'not visible' };
        el.click();
        return { ok: true, selector: ${JSON.stringify(sel)} };
      })();
    `);
    if (r && r.ok) { log('submit clicked via:', sel); return true; }
    log('submit try', sel, '→', r ? r.reason : 'exec failed');
  }
  log('không click được button → fallback Enter key');
  await win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Return' });
  await win.webContents.sendInputEvent({ type: 'char', keyCode: '\r' });
  await win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Return' });
  return true;
}

/**
 * DOM walker thay vì regex stripping — robust với HTML có attribute chứa '>'
 * (như Tailwind class "[&>p]:inline" duck.ai dùng). Trả về function (root) => markdown.
 */
function htmlToMarkdownInjection() {
  return `
    (root) => {
      const TICK = String.fromCharCode(96);
      const SKIP_TAGS = new Set(['button', 'svg', 'script', 'style', 'noscript', 'iframe']);
      const SKIP_CLASS_PATTERNS = [/copy/i, /\\baction\\b/i, /icon-only/i];
      function shouldSkip(el) {
        const tag = el.tagName ? el.tagName.toLowerCase() : '';
        if (SKIP_TAGS.has(tag)) return true;
        if (el.getAttribute && el.getAttribute('aria-hidden') === 'true') return true;
        const cls = (el.className && typeof el.className === 'string') ? el.className : '';
        return SKIP_CLASS_PATTERNS.some(p => p.test(cls));
      }
      function walk(node) {
        if (node.nodeType === 3) return node.textContent;
        if (node.nodeType !== 1) return '';
        if (shouldSkip(node)) return '';
        const tag = node.tagName.toLowerCase();
        const kids = [...node.childNodes].map(walk).join('');
        switch (tag) {
          case 'h1': return '\\n\\n# '   + kids.trim() + '\\n';
          case 'h2': return '\\n\\n## '  + kids.trim() + '\\n';
          case 'h3': return '\\n\\n### ' + kids.trim() + '\\n';
          case 'h4': return '\\n\\n#### '+ kids.trim() + '\\n';
          case 'h5': return '\\n\\n##### '+ kids.trim() + '\\n';
          case 'h6': return '\\n\\n######'+ kids.trim() + '\\n';
          case 'strong': case 'b': return '**' + kids + '**';
          case 'em': case 'i': return '*' + kids + '*';
          case 'code':
            if (node.parentElement && node.parentElement.tagName === 'PRE') return kids;
            return TICK + kids + TICK;
          case 'pre':
            return '\\n\\n' + TICK + TICK + TICK + '\\n' + kids.trim() + '\\n' + TICK + TICK + TICK + '\\n\\n';
          case 'li':  return '\\n- ' + kids.trim();
          case 'ul': case 'ol': return '\\n' + kids + '\\n';
          case 'br':  return '\\n';
          case 'p':   return '\\n\\n' + kids.trim();
          case 'div': return kids + '\\n';
          case 'a': {
            const href = node.getAttribute('href');
            return href ? '[' + kids + '](' + href + ')' : kids;
          }
          case 'blockquote': return '\\n> ' + kids.trim() + '\\n';
          case 'hr':  return '\\n\\n---\\n\\n';
          case 'table': {
            const rows = [...node.querySelectorAll('tr')];
            if (!rows.length) return kids;
            const cell = c => walk(c).replace(/\\s+/g, ' ').split('|').join(' ').trim();
            const toRow = tr => '| ' + [...tr.children].map(cell).join(' | ') + ' |';
            const out = [];
            rows.forEach((tr, ri) => {
              out.push(toRow(tr));
              if (ri === 0) out.push('| ' + [...tr.children].map(() => '---').join(' | ') + ' |');
            });
            return '\\n\\n' + out.join('\\n') + '\\n\\n';
          }
          default: return kids;
        }
      }
      return walk(root).replace(/\\n{3,}/g, '\\n\\n').trim();
    }
  `;
}

// Đọc TRỰC TIẾP message trợ lý MỚI NHẤT (markdown). Chỉ trả khi đã có message MỚI so với trước submit
// (els.length > priorCount) → không đọc nhầm answer cũ (nếu trang chưa kịp sạch) và không bao giờ chốt
// trước khi câu trả lời thật xuất hiện. KHÔNG đọc cả container → loại echo prompt ("You said:…") và
// disclaimer cuối trang. Trả text KỂ CẢ KHI RỖNG ('') để caller phân biệt "chưa có" (null) vs "rỗng".
async function getNewAssistantText(win, selectors, priorCount = 0) {
  for (const sel of selectors) {
    const r = await exec(win, `
      (() => {
        const els = [...document.querySelectorAll(${JSON.stringify(sel)})]
          .filter(el => el.offsetWidth > 0 && el.offsetHeight > 0);
        if (els.length <= ${priorCount}) return null;   // chưa có message trợ lý MỚI
        const last = els[els.length - 1];
        const toMarkdown = ${htmlToMarkdownInjection()};
        return { count: els.length, text: toMarkdown(last), selector: ${JSON.stringify(sel)} };
      })();
    `);
    if (r) return r;
  }
  return null;
}

/** Lấy innerText của container chính (dùng cho text-diff fallback). */
async function getChatContainerText(win, containerSelectors) {
  for (const sel of containerSelectors || ['main', 'body']) {
    const text = await exec(win, `
      (() => {
        const el = document.querySelector(${JSON.stringify(sel)});
        return el ? el.innerText : null;
      })();
    `);
    if (text && text.length > 50) return text;
  }
  return '';
}

/**
 * Fallback: diff text container trước/sau submit. Phần text mới = response.
 * Loại bỏ phần prompt user (đã có trước) + UI noise ("Stop", "Regenerate", etc).
 */
function extractNewContent(beforeText, afterText, promptText) {
  if (!afterText) return null;
  if (afterText.startsWith(beforeText)) {
    let newPart = afterText.slice(beforeText.length).trim();
    const promptHead = promptText.slice(0, Math.min(80, promptText.length)).trim();
    const promptIdx = newPart.indexOf(promptHead);
    if (promptIdx !== -1 && promptIdx < 200) {
      newPart = newPart.slice(promptIdx + promptText.length).trim();
    }
    return newPart || null;
  }
  const promptHead = promptText.slice(0, Math.min(80, promptText.length)).trim();
  const idx = afterText.lastIndexOf(promptHead);
  if (idx !== -1) {
    return afterText.slice(idx + promptText.length).trim() || null;
  }
  return null;
}

/**
 * Sau khi xác định được "new content" qua text-diff, tìm element DOM nhỏ nhất
 * chứa text đó và extract Markdown từ HTML — giữ được heading/list/bold.
 *
 * Lý do: text-diff chỉ trả innerText (plain), mất hết markdown. Element-walking
 * này tìm container thực sự để dùng htmlToMarkdownInjection().
 */
async function extractMarkdownForText(win, snippetText) {
  if (!snippetText || snippetText.length < 30) return null;
  // Lấy đoạn signature 40-60 chars để tìm
  const sig = snippetText.slice(0, 60).trim();
  return await exec(win, `
    (() => {
      const sig = ${JSON.stringify(sig)};
      // BFS tìm element nhỏ nhất chứa signature
      let best = null;
      let bestSize = Infinity;
      const queue = [document.body];
      while (queue.length) {
        const el = queue.shift();
        if (!el || !el.innerText) continue;
        if (!el.innerText.includes(sig)) continue;
        const size = el.innerText.length;
        if (size < bestSize) { best = el; bestSize = size; }
        for (const child of el.children) queue.push(child);
      }
      if (!best) return null;
      const toMarkdown = ${htmlToMarkdownInjection()};
      return toMarkdown(best);
    })();
  `);
}

async function waitResponseStable(win, config, prompt, baselineText, {
  totalTimeoutMs = 180000, stableMs = 2500, pollMs = 700, minChars = 80, stopIdleMs = 1200,
  priorCount = 0,
} = {}) {
  const t0 = Date.now();
  let last = { text: '', count: 0, selector: null, source: 'none' };
  let lastChangeTs = Date.now();
  let probeCount = 0;
  let sawStop = false;       // B: đã từng thấy nút "Stop" (đang sinh)
  let sawAssistant = false;  // đã thấy element message trợ lý MỚI xuất hiện chưa (kể cả còn rỗng)

  while (Date.now() - t0 < totalTimeoutMs) {
    // Method 1 (chính): đọc TRỰC TIẾP message trợ lý mới — không bao giờ lấy cả container.
    let cur = await getNewAssistantText(win, config.responseSelectors, priorCount);
    let source = cur ? 'selector' : 'none';
    if (cur) sawAssistant = true;

    // Method 2 (fallback text-diff): CHỈ cho provider không có selector trợ lý đáng tin (vd duck.ai),
    // và CHỈ khi chưa thấy element trợ lý nào. ChatGPT đặt noTextDiff → bỏ qua hẳn (tránh vớ echo prompt).
    if (!cur && !config.noTextDiff) {
      const containerText = await getChatContainerText(win, config.chatContainerSelectors);
      const newContent = extractNewContent(baselineText, containerText, prompt);
      if (newContent && newContent.length > 20) {
        const markdown = await extractMarkdownForText(win, newContent);
        cur = {
          text: markdown && markdown.length > newContent.length * 0.8 ? markdown : newContent,
          count: 1,
          selector: markdown ? 'text-diff+markdown' : 'text-diff',
        };
        source = cur.selector;
      }
    }

    const curText = cur ? stripChatUiNoise(cur.text) : last.text;   // luôn lọc nhãn/disclaimer trước khi so

    if (cur && curText !== last.text) {
      const delta = curText.length - last.text.length;
      last = { text: curText, count: cur.count, selector: cur.selector, source };
      lastChangeTs = Date.now();
      if (probeCount++ % 4 === 0) {
        log(`response growing… +${delta} chars (total ${curText.length}) via [${source}] "${cur.selector}"`);
      }
    }

    // B: nút "Stop" biến mất sau khi từng xuất hiện = sinh xong. Nếu selector nút Stop sai (sawStop luôn
    //    false) → tự fallback về text-stability (stableMs) bên dưới.
    const gen = await isGenerating(win);
    if (gen) sawStop = true;
    const idle = Date.now() - lastChangeTs;
    const generationDone = sawStop && !gen;

    // Hoàn tất: có đủ chữ (>= minChars) VÀ (sinh-xong-lặng | lặng đủ lâu). KHÔNG bao giờ chốt khi text
    // còn ngắn hơn minChars → không chốt nhầm lúc câu trả lời còn rỗng / đang "nghĩ".
    if (last.text.length >= minChars && ((generationDone && idle >= stopIdleMs) || idle >= stableMs)) {
      log(`response done @ ${last.text.length} chars [${last.source}] via ${generationDone ? 'stop-button' : 'text-stable'}`);
      return last.text;
    }

    // Sinh XONG nhưng message trợ lý vẫn RỖNG/quá ngắn → câu trả lời rỗng thật (rate-limit / chưa đăng
    // nhập / bị chặn) → thoát sớm trả null để caller báo lỗi rõ ràng, KHÔNG trả rác.
    if (generationDone && sawAssistant && idle >= stopIdleMs && last.text.length < minChars) {
      logErr(`generation xong nhưng response rỗng (${last.text.length} chars) → coi như rỗng`);
      return null;
    }

    await sleep(pollMs);
  }
  logErr(`timeout sau ${totalTimeoutMs}ms, last text len=${last.text.length} [${last.source}]`);
  return last.text.length >= minChars ? last.text : null;
}

async function summarizeViaWebChat(provider, prompt) {
  const config = PROVIDERS[provider];
  if (!config) return { ok: false, error: `Provider không hỗ trợ: ${provider}` };

  log(`==== START ${provider} ====`);
  log(`prompt length: ${prompt.length} chars`);
  log(`URL: ${config.url}`);
  log(`partition: ${config.partition}`);
  log(`DEBUG mode: ${DEBUG}`);

  const win = getWindow(provider);
  const t0 = Date.now();

  try {
    log('loading URL...');
    await win.loadURL(config.url);   // luôn mở trang sạch mỗi lần tóm tắt (cửa sổ mới hoặc reuse-rồi-reload)
    log(`URL loaded in ${Date.now() - t0}ms`);
    await sleep(2000);

    if (DEBUG) await probeDom(win, 'after load');

    // Auto-dismiss welcome modal, cookie banner, etc.
    log('auto-dismiss overlays...');
    const dismissed = await dismissOverlays(win, provider);
    if (dismissed > 0) {
      log(`đã dismiss ${dismissed} overlay, chờ UI redraw...`);
      await sleep(1500);
      if (DEBUG) await probeDom(win, 'after dismiss');
    }

    log('tìm textarea/input...');
    let inputSel = await waitForAnySelector(win, config.inputSelectors, 8000);
    if (!inputSel) {
      // Thử dismiss lần nữa (đôi khi modal xuất hiện sau)
      const more = await dismissOverlays(win, provider);
      if (more > 0) { log(`dismiss thêm ${more} overlay`); await sleep(1200); }
      inputSel = await waitForAnySelector(win, config.inputSelectors, 5000);
    }
    if (!inputSel) {
      logErr('vẫn không tìm thấy input — show window + đợi 60s cho user thao tác thủ công');
      win.show(); win.focus();
      await probeDom(win, 'no input found');
      inputSel = await waitForAnySelector(win, config.inputSelectors, 60000);
    }
    if (!inputSel) {
      await probeDom(win, 'still no input after 60s');
      return { ok: false, error: `Không tìm thấy ô nhập trên ${config.label}. Xem console log cho DOM probe.` };
    }
    log('input selector:', inputSel);

    log('inject prompt...');
    const setR = await setInputValue(win, inputSel, prompt);
    log('setInputValue:', JSON.stringify(setR));
    if (!setR || !setR.ok) {
      return { ok: false, error: `Không inject được prompt: ${setR ? setR.reason : 'null'}` };
    }
    await sleep(500);

    // Snapshot text trước khi submit cho fallback diff (provider không có selector trợ lý đáng tin)
    log('snapshot text trước submit...');
    const baselineText = await getChatContainerText(win, config.chatContainerSelectors);
    log(`baseline text length: ${baselineText.length}`);

    // Đếm message trợ lý ĐANG CÓ (trước submit) → waitResponseStable chỉ nhận message MỚI sinh ra,
    // không đọc nhầm answer của lần tóm tắt trước nếu trang chưa kịp sạch.
    const priorCount = await exec(win, `(() => [...document.querySelectorAll(${JSON.stringify(config.responseSelectors[0])})].filter(el => el.offsetWidth > 0 && el.offsetHeight > 0).length)()`) || 0;
    log('prior assistant messages:', priorCount);

    log('click submit...');
    await clickSubmit(win, config.submitSelectors);

    await sleep(1500); // C: chờ response container xuất hiện (giảm từ 2500)
    if (DEBUG) await probeDom(win, 'after submit');

    log('chờ response stable...');
    let text = await waitResponseStable(win, config, prompt, baselineText, { priorCount });

    if (!text) {
      win.show(); win.focus();
      await probeDom(win, 'no response');
      return { ok: false, error: `${config.label} không trả lời (rỗng hoặc quá lâu). Có thể do giới hạn khi chưa đăng nhập — thử lại, hoặc đăng nhập ChatGPT trong cửa sổ vừa hiện.` };
    }

    text = stripChatUiNoise(text);   // loại nhãn "ChatGPT said:" + disclaimer cuối trang nếu lọt vào

    log(`==== DONE ${provider} in ${Date.now() - t0}ms, ${text.length} chars ====`);
    // Tóm tắt xong (CÓ output) → DESTROY cửa sổ: giải phóng renderer (~100-200MB) và để lần sau mở lại
    // trình duyệt SẠCH từ đầu (tránh ChatGPT bắt đăng nhập do session sống lâu). Session/login vẫn lưu
    // trên đĩa qua partition 'persist:…'. DEBUG hoặc lỗi (nhánh dưới) cố tình GIỮ window để inspect/login.
    if (!DEBUG) destroyWindow(provider);

    return { ok: true, text, model: config.label, elapsedMs: Date.now() - t0 };
  } catch (e) {
    logErr('EXCEPTION:', e.message, e.stack);
    win.show(); win.focus();
    return { ok: false, error: e.message };
  }
}

function destroyWindow(provider) {
  const win = _windows.get(provider);
  if (!win) return;
  try { win._allowClose = true; win.destroy(); } catch {}
  _windows.delete(provider);   // belt-and-suspenders (win.on('closed') cũng tự xóa)
}

function destroyAllWindows() {
  for (const w of _windows.values()) {
    try { w._allowClose = true; w.close(); } catch {}
  }
  _windows.clear();
}

module.exports = { summarizeViaWebChat, PROVIDERS, destroyWindow, destroyAllWindows };
