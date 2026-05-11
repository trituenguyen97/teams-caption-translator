/**
 * cdp-browser.js — CDP connection, Teams browser detection, meeting page finder
 */
const { exec } = require('child_process');
const http = require('http');
const WebSocket = require('ws');
const puppeteer = require('puppeteer-core');
const { httpGetLocal } = require('./http-helpers');
const { storeTeamsToken } = require('./translation');
const state = require('./state');

const sleep = ms => new Promise(r => setTimeout(r, ms));
const send = (ch, data) => state.win?.webContents?.send(ch, data);

// ── CDP Port Detection ────────────────────────────────

async function isCDPPort(port) {
  const raw = await httpGetLocal(port, '/json/version');
  if (!raw) return false;
  try { const j = JSON.parse(raw); return !!(j.Browser || j.webSocketDebuggerUrl); } catch { return false; }
}

async function findTeamsCDPPorts() {
  return new Promise(resolve => {
    const script = [
      '$teamsPids = @(Get-Process ms-teams,MSTeams -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Id)',
      'if (!$teamsPids) { Write-Output ""; exit }',
      '$allPids = @($teamsPids)',
      'try {',
      '  $children = Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |',
      '    Where-Object { $_.ParentProcessId -in $teamsPids } |',
      '    Select-Object -ExpandProperty ProcessId',
      '  if ($children) { $allPids += @($children) }',
      '} catch {}',
      '$ports = Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue |',
      '  Where-Object { $_.OwningProcess -in $allPids } |',
      '  Select-Object -ExpandProperty LocalPort | Sort-Object -Unique',
      'Write-Output ($ports -join ",")',
    ].join('\n');
    const encoded = Buffer.from(script, 'utf16le').toString('base64');
    exec(`powershell -NoProfile -NonInteractive -EncodedCommand ${encoded}`,
      { timeout: 8000 }, (err, stdout) => {
        const ports = (stdout || '').trim().split(',')
          .map(p => parseInt(p.trim()))
          .filter(p => p > 1023 && p < 65536);
        resolve(ports);
      });
  });
}

async function isTeamsOnPort(port) {
  if (!await isCDPPort(port)) return false;
  try {
    const b = await puppeteer.connect({ browserURL: `http://localhost:${port}`, defaultViewport: null });
    const pages = await b.pages().catch(() => []);
    const titles = await Promise.all(pages.map(p => p.title().catch(() => '')));
    const urls = pages.map(p => { try { return p.url(); } catch { return ''; } });
    const hasTeams = titles.some(t => /teams|meeting|call/i.test(t)) ||
      urls.some(u => /teams\.microsoft/i.test(u));
    await b.disconnect().catch(() => {});
    return hasTeams;
  } catch { return false; }
}

async function freePort9222IfNeeded() {
  const raw = await httpGetLocal(9222, '/json/list');
  if (!raw) return;
  try {
    const targets = JSON.parse(raw);
    const hasWidgets = targets.some(t =>
      /widgets/i.test(t.title || '') || /windows\.msn\.com/i.test(t.url || ''));
    if (hasWidgets) {
      console.log('[CDP] Port 9222 có Widgets → kill Widgets...');
      send('status', { type: 'connecting', msg: 'Giải phóng CDP port (kill Widgets)...' });
      await new Promise(resolve =>
        exec('taskkill /F /IM widgets.exe /T 2>nul & taskkill /F /IM WidgetService.exe /T 2>nul', () => resolve()));
      await sleep(2500);
      return;
    }
    const hasTeams = targets.some(t =>
      /teams\.microsoft/i.test(t.url || '') || /microsoft teams/i.test(t.title || ''));
    if (hasTeams) console.log('[CDP] Port 9222 là Teams CDP → giữ nguyên');
    else console.log('[CDP] Port 9222 bị chiếm bởi app khác:', targets[0]?.title || 'unknown');
  } catch {}
}

async function connectToTeamsBrowser() {
  await freePort9222IfNeeded();

  const teamsPorts = await findTeamsCDPPorts();
  if (teamsPorts.length) {
    console.log('[CDP] Teams listen trên các port:', teamsPorts);
    for (const port of teamsPorts) {
      if (!await isCDPPort(port)) continue;
      try {
        const b = await puppeteer.connect({ browserURL: `http://localhost:${port}`, defaultViewport: null });
        const pages = await b.pages().catch(() => []);
        const titles = await Promise.all(pages.map(p => p.title().catch(() => '')));
        const hasTeamsPage = titles.some(t => /microsoft teams/i.test(t)) ||
          pages.some(p => { try { return /teams\.microsoft/i.test(p.url()); } catch { return false; } });
        if (hasTeamsPage) {
          console.log('[CDP] Kết nối thành công qua port', port, '(verified Teams)');
          return b;
        }
        const hasWidgets = titles.some(t => /widgets/i.test(t));
        console.log('[CDP] Port', port, 'thấy non-Teams pages:', titles.map(t => t.slice(0, 30)));
        await b.disconnect().catch(() => {});
        if (hasWidgets) {
          console.log('[CDP] Kill Widgets và thử lại...');
          await new Promise(resolve =>
            exec('taskkill /F /IM widgets.exe /T 2>nul & taskkill /F /IM WidgetService.exe /T 2>nul', () => resolve()));
          await sleep(2000);
          try {
            const b2 = await puppeteer.connect({ browserURL: `http://localhost:${port}`, defaultViewport: null });
            const pages2 = await b2.pages().catch(() => []);
            const titles2 = await Promise.all(pages2.map(p => p.title().catch(() => '')));
            const ok = titles2.some(t => /microsoft teams/i.test(t)) ||
              pages2.some(p => { try { return /teams\.microsoft/i.test(p.url()); } catch { return false; } });
            if (ok) { console.log('[CDP] Kết nối thành công sau kill Widgets, port', port); return b2; }
            await b2.disconnect().catch(() => {});
          } catch {}
        }
      } catch { continue; }
    }
  }

  console.log('[CDP] Không tìm thấy qua process, fallback scan 9222-9240...');
  for (let port = 9222; port <= 9240; port++) {
    if (await isTeamsOnPort(port)) {
      console.log('[CDP] Teams tìm thấy trên port', port, '(scan)');
      try { return await puppeteer.connect({ browserURL: `http://localhost:${port}`, defaultViewport: null }); }
      catch { continue; }
    }
  }
  return null;
}

// ── Meeting Page Finder ───────────────────────────────

async function findMeetingPage() { return _findMeetingPageInner(false); }

async function _findMeetingPageInner(isRetry) {
  if (!state.browser || !state.browser.isConnected()) {
    console.log('[findMeeting] browser stale/null → kết nối lại CDP...');
    state.browser = null; state.meetingPage = null;
    await freePort9222IfNeeded();
    state.browser = await connectToTeamsBrowser();
    if (!state.browser) { console.warn('[findMeeting] không tìm thấy Teams'); return null; }
  }

  const pages = await state.browser.pages().catch(async () => {
    console.warn('[findMeeting] browser.pages() failed → reset browser');
    state.browser = null; state.meetingPage = null; return [];
  });
  console.log('[findMeeting] total pages:', pages.length, isRetry ? '(retry)' : '');

  const titles = [];
  for (const p of pages) {
    const t = await p.title().catch(() => '');
    let u = ''; try { u = p.url(); } catch {}
    console.log('[findMeeting] title:', JSON.stringify(t), '| url:', u.slice(0, 80));
    titles.push({ p, t });
  }

  for (const { p, t } of titles) {
    if (/^Meeting[\s|]/i.test(t)) return p;
  }
  for (const { p, t } of titles) {
    if (/^Calendar\s*\|\s*Calendar\b/i.test(t)) continue;
    const isMeeting = await p.evaluate(() =>
      !!(document.querySelector('[data-tid="ubar-toolbar-wrapper"]') ||
         document.querySelector('[data-tid="call-duration"]') ||
         document.querySelector('[data-tid="hangup-main-btn"]'))
    ).catch(() => false);
    if (isMeeting) return p;
  }

  if (!isRetry) {
    console.log('[findMeeting] không thấy meeting → reconnect CDP...');
    try { await state.browser.disconnect().catch(() => {}); } catch {}
    state.browser = null; state.meetingPage = null;
    return _findMeetingPageInner(true);
  }

  for (const { p } of titles) {
    try { const u = p.url(); if (!u.startsWith('devtools') && u !== 'about:blank') return p; } catch {}
  }
  return null;
}

// ── Caption Control ───────────────────────────────────

async function tryToggleCaptionsViaDOM() {
  if (!state.meetingPage) state.meetingPage = await findMeetingPage();
  if (!state.meetingPage) { console.warn('[toggleDOM] không có meetingPage'); return false; }
  try {
    const moreClicked = await state.meetingPage.evaluate(() => {
      const btn = [...document.querySelectorAll('button, [role="button"]')]
        .find(e => /^More$/i.test((e.getAttribute('aria-label') || '').trim()) ||
                   /^More$/i.test((e.textContent || '').trim()));
      if (btn) { btn.click(); return true; } return false;
    });
    if (!moreClicked) return false;
    await sleep(800);
    const langClicked = await state.meetingPage.evaluate(() => {
      const el = [...document.querySelectorAll('[role="menuitem"]')]
        .find(e => /language.*speech|speech.*language/i.test((e.textContent || '')));
      if (el) { el.click(); return true; } return false;
    });
    if (!langClicked) { await state.meetingPage.keyboard.press('Escape').catch(() => {}); return false; }
    await sleep(800);
    const captionClicked = await state.meetingPage.evaluate(() => {
      const el = [...document.querySelectorAll('[role="menuitemcheckbox"], [role="menuitem"]')]
        .find(e => /show live caption|live caption|show caption/i.test(
          (e.getAttribute('aria-label') || '') + (e.textContent || '')));
      if (el) { el.click(); return { clicked: true }; }
      return { clicked: false };
    });
    if (!captionClicked?.clicked) {
      await state.meetingPage.keyboard.press('Escape').catch(() => {});
      await state.meetingPage.keyboard.press('Escape').catch(() => {});
      return false;
    }
    return true;
  } catch (e) { console.warn('[toggleDOM] error:', e.message); return false; }
}

async function injectToggleCaptionsKey() {
  if (!state.meetingPage) state.meetingPage = await findMeetingPage();
  if (!state.meetingPage) return false;
  try {
    await state.meetingPage.bringToFront();
    await state.meetingPage.keyboard.down('Alt');
    await state.meetingPage.keyboard.down('Shift');
    await state.meetingPage.keyboard.press('c');
    await state.meetingPage.keyboard.up('Shift');
    await state.meetingPage.keyboard.up('Alt');
    return true;
  } catch (e) { console.warn('[injectKey] error:', e.message); return false; }
}

let _lastCaptionReconnect = 0;
const CAPTION_RECONNECT_INTERVAL = 15000;

async function checkCaptionsActive() {
  if (!state.meetingPage) state.meetingPage = await findMeetingPage();

  const CAPTION_EVAL = () =>
    !!(document.querySelector('[data-tid="closed-caption-renderer-wrapper"]') ||
       document.querySelector('[data-tid="closed-caption-v2-window-wrapper"]') ||
       document.querySelector('[data-tid="captions-panel-dismiss-button"]') ||
       document.querySelector('[data-tid="closed-caption-default-text"]') ||
       document.querySelector('[data-tid="closed-caption-text"]'));

  let result = { found: false, tids: [] };
  if (state.meetingPage) {
    result = await state.meetingPage.evaluate(() => {
      const tids = [...document.querySelectorAll('[data-tid]')]
        .map(el => el.getAttribute('data-tid'))
        .filter(t => /caption|closed|cc/i.test(t));
      return {
        found: !!(document.querySelector('[data-tid="closed-caption-renderer-wrapper"]') ||
                  document.querySelector('[data-tid="closed-caption-v2-window-wrapper"]') ||
                  document.querySelector('[data-tid="captions-panel-dismiss-button"]') ||
                  document.querySelector('[data-tid="closed-caption-default-text"]') ||
                  document.querySelector('[data-tid="closed-caption-text"]')),
        tids,
      };
    }).catch(async (e) => {
      console.warn('[checkCaptions] page stale:', e.message);
      state.meetingPage = await findMeetingPage();
      return { found: false, tids: [] };
    });
  }
  if (result.found) return true;

  if (state.browser?.isConnected()) {
    const allPages = await state.browser.pages().catch(() => []);
    for (const p of allPages) {
      if (p === state.meetingPage) continue;
      const found = await p.evaluate(CAPTION_EVAL).catch(() => false);
      if (found) { state.meetingPage = p; return true; }
    }
  }

  const now = Date.now();
  if (now - _lastCaptionReconnect >= CAPTION_RECONNECT_INTERVAL) {
    _lastCaptionReconnect = now;
    try { await state.browser?.disconnect().catch(() => {}); } catch {}
    state.browser = null; state.meetingPage = null;
    state.browser = await connectToTeamsBrowser();
    if (state.browser) {
      const freshPages = await state.browser.pages().catch(() => []);
      for (const p of freshPages) {
        const found = await p.evaluate(CAPTION_EVAL).catch(() => false);
        if (found) { state.meetingPage = p; return true; }
      }
    }
  }
  return false;
}

// ── Teams Token Capture via WebSocket ─────────────────

function _monitorWorkerForToken(wsUrl, label) {
  try {
    const ws = new WebSocket(wsUrl);
    let msgId = 0, reqCount = 0;
    ws.on('open', () => {
      ws.send(JSON.stringify({ id: ++msgId, method: 'Network.enable', params: { maxPostDataSize: 256 } }));
      console.log('[teams-token] WS connected:', label);
    });
    ws.on('message', raw => {
      try {
        const msg = JSON.parse(raw);
        if (msg.method !== 'Network.requestWillBeSent') return;
        reqCount++;
        if (reqCount <= 3 || reqCount % 20 === 0) {
          console.log(`[teams-token] req #${reqCount} from ${label}: ${(msg.params?.request?.url || '').slice(0, 80)}`);
        }
        const auth = msg.params?.request?.headers?.authorization || msg.params?.request?.headers?.Authorization;
        if (!auth || !auth.startsWith('Bearer ')) return;
        const token = auth.slice(7);
        if (token.length > 100 && token.startsWith('eyJ') && token !== state.teamsToken) {
          storeTeamsToken(token, label);
        }
      } catch {}
    });
    ws.on('error', (e) => console.warn('[teams-token] WS error:', label, e.message));
    ws.on('close', () => {
      console.log('[teams-token] WS closed:', label, '| reqs:', reqCount);
      setTimeout(() => _monitorWorkerForToken(wsUrl, label), 5000);
    });
  } catch {}
}

async function startTeamsTokenCapture(cdpPort) {
  if (!cdpPort) return;
  try {
    const raw = await new Promise(resolve => {
      const req = http.get({ hostname: '127.0.0.1', port: cdpPort, path: '/json/list' }, res => {
        let d = ''; res.on('data', c => d += c); res.on('end', () => resolve(d));
      });
      req.setTimeout(1500, () => { req.destroy(); resolve('[]'); });
      req.on('error', () => resolve('[]'));
    });
    const targets = JSON.parse(raw);
    let count = 0;
    for (const t of targets) {
      if (t.webSocketDebuggerUrl) { _monitorWorkerForToken(t.webSocketDebuggerUrl, `[${t.type}] ${(t.title||t.url||'').slice(0,50)}`); count++; }
    }
    console.log(`[teams-token] Đang monitor ${count} targets trên port ${cdpPort}`);
  } catch (e) { console.warn('[teams-token] Lỗi startTeamsTokenCapture:', e.message); }
}

// ── CDP Auto-Setup ────────────────────────────────────

function psExec(script, timeoutMs = 8000) {
  return new Promise(resolve => {
    const encoded = Buffer.from(script, 'utf16le').toString('base64');
    exec(`powershell -NoProfile -NonInteractive -EncodedCommand ${encoded}`,
      { timeout: timeoutMs }, (err, stdout) => resolve((stdout || '').trim()));
  });
}

function isTeamsRunning() {
  const script = [
    '$found = @()',
    'if (Get-Process ms-teams  -ErrorAction SilentlyContinue) { $found += "ms-teams" }',
    'if (Get-Process MSTeams   -ErrorAction SilentlyContinue) { $found += "MSTeams" }',
    'Write-Output ($found -join ",")',
  ].join('\n');
  return psExec(script).then(out => out.trim().length > 0);
}

function isCDPEnvSet() {
  const script = [
    '$envVar = [System.Environment]::GetEnvironmentVariable("WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS","User")',
    '$regPath = "HKCU:\\Software\\Policies\\Microsoft\\Edge\\WebView2\\AdditionalBrowserArguments"',
    '$regVal = if (Test-Path $regPath) { (Get-ItemProperty -Path $regPath -Name "*" -ErrorAction SilentlyContinue)."*" } else { "" }',
    'Write-Output (($envVar -like "*9222*") -and ($regVal -like "*9222*"))',
  ].join('\n');
  return psExec(script).then(out => out.trim().toLowerCase() === 'true');
}

function setCDPEnv() {
  const script = [
    '[System.Environment]::SetEnvironmentVariable("WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS","--remote-debugging-port=9222","User")',
    '$regPath = "HKCU:\\Software\\Policies\\Microsoft\\Edge\\WebView2\\AdditionalBrowserArguments"',
    'if (!(Test-Path $regPath)) { New-Item -Path $regPath -Force | Out-Null }',
    'Set-ItemProperty -Path $regPath -Name "*" -Value "--remote-debugging-port=9222" -Type String',
  ].join('\n');
  return psExec(script);
}

function restartTeams() {
  const script = [
    'Stop-Process -Name ms-teams  -Force -ErrorAction SilentlyContinue',
    'Stop-Process -Name MSTeams   -Force -ErrorAction SilentlyContinue',
    'Start-Sleep -Milliseconds 2500',
    'try { Start-Process "ms-teams:" } catch {',
    '    $p = "$env:LOCALAPPDATA\\Microsoft\\WindowsApps\\ms-teams.exe"',
    '    if (Test-Path $p) { Start-Process $p }',
    '}',
  ].join('\n');
  return psExec(script, 15000);
}

async function autoSetupCDP() {
  const cdpSet = await isCDPEnvSet();
  if (!cdpSet) {
    send('status', { type: 'connecting', msg: '⚙️ Ghi debug port vào registry (1 lần duy nhất)...' });
    await setCDPEnv();
  }

  const running = await isTeamsRunning();
  if (!running) {
    send('status', { type: 'waiting', msg: 'Mở Teams rồi vào meeting để bắt đầu' });
    for (let i = 0; i < 300; i++) {
      await sleep(1000);
      if (state.captureSourceChanged) return null;
      if (await isTeamsRunning()) break;
      if (i === 299) { send('status', { type: 'error', msg: 'Không tìm thấy Teams' }); return null; }
    }
  }

  send('status', { type: 'connecting', msg: '⏳ Chờ Teams CDP sẵn sàng...' });
  for (let i = 0; i < 15; i++) {
    await sleep(1000);
    if (state.captureSourceChanged) return null;
    await freePort9222IfNeeded();
    const b = await connectToTeamsBrowser();
    if (b) return b;
  }

  send('status', { type: 'connecting', msg: '🔄 Restart Teams để bật debug port 9222...' });
  await restartTeams();

  send('status', { type: 'connecting', msg: '⏳ Chờ Teams khởi động...' });
  for (let i = 0; i < 90; i++) {
    await sleep(1000);
    if (state.captureSourceChanged) return null;
    await freePort9222IfNeeded();
    const b = await connectToTeamsBrowser();
    if (b) return b;
    if ((i + 1) % 10 === 0) send('status', { type: 'connecting', msg: `⏳ Chờ Teams... (${i + 1}s)` });
  }
  send('status', { type: 'error', msg: 'Không kết nối được debug port. Thử tắt/mở Teams thủ công.' });
  return null;
}

// ── PowerShell SendKeys Fallback ──────────────────────

async function tryPowerShellSendKeys() {
  const script = [
    "$w = New-Object -com WScript.Shell",
    "$p = Get-Process | Where-Object {$_.Name -match 'Teams' -and $_.MainWindowHandle -ne 0} | Select-Object -First 1",
    "if ($p) {",
    "  $ok = $w.AppActivate($p.Id)",
    "  Start-Sleep -Milliseconds 600",
    "  $w.SendKeys('%+c')",
    "} else { Write-Host '[PS] Teams process not found' }",
  ].join('\n');
  const encoded = Buffer.from(script, 'utf16le').toString('base64');
  return new Promise(resolve =>
    exec(`powershell -NoProfile -EncodedCommand ${encoded}`, { timeout: 8000 }, (err, stdout, stderr) => {
      if (stdout) console.log('[PS out]', stdout.trim());
      if (stderr) console.warn('[PS err]', stderr.trim());
      resolve();
    })
  );
}

// ── STT Language DOM Automation ───────────────────────

async function waitForTid(tid, timeoutMs = 3000, intervalMs = 200) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const found = await state.meetingPage.evaluate((t) =>
      !!document.querySelector(`[data-tid="${t}"]`), tid).catch(() => false);
    if (found) return true;
    await sleep(intervalMs);
  }
  return false;
}

async function getSttLanguage() {
  if (!state.meetingPage) return null;
  return state.meetingPage.evaluate(() => {
    const combo = document.querySelector('[data-tid="callingCaptions-spokenLanguages"]');
    return combo ? (combo.textContent || '').trim() : null;
  }).catch(() => null);
}

async function setSttLanguage(langText) {
  if (!state.meetingPage) state.meetingPage = await findMeetingPage();
  if (!state.meetingPage) return false;
  try {
    await state.meetingPage.bringToFront();
    const step1 = await state.meetingPage.evaluate(() => {
      const btn = document.querySelector('[data-tid="closed-captions-settings-menu-trigger-button"]');
      if (btn) { btn.click(); return true; } return false;
    });
    if (!step1) return false;
    const appeared = await waitForTid('closed-captions-settings-submenu-language-settings-button', 2000);
    if (!appeared) { await state.meetingPage.keyboard.press('Escape').catch(() => {}); return false; }
    const step2 = await state.meetingPage.evaluate(() => {
      const btn = document.querySelector('[data-tid="closed-captions-settings-submenu-language-settings-button"]');
      if (btn) { btn.click(); return true; } return false;
    });
    if (!step2) { await state.meetingPage.keyboard.press('Escape').catch(() => {}); return false; }
    const comboAppeared = await waitForTid('callingCaptions-spokenLanguages', 3000);
    if (!comboAppeared) { await state.meetingPage.keyboard.press('Escape').catch(() => {}); return false; }
    await state.meetingPage.evaluate(() =>
      document.querySelector('[data-tid="callingCaptions-spokenLanguages"]')?.click());
    await sleep(600);
    const result = await state.meetingPage.evaluate((target) => {
      const opts = [...document.querySelectorAll('[role="option"]')];
      const exact = opts.find(e => (e.textContent || '').trim() === target);
      if (exact) { exact.click(); return { ok: true }; }
      const partial = opts.find(e => (e.textContent || '').trim().startsWith(target));
      if (partial) { partial.click(); return { ok: true }; }
      return { ok: false };
    }, langText);
    if (!result.ok) {
      await state.meetingPage.keyboard.press('Escape').catch(() => {});
      await state.meetingPage.keyboard.press('Escape').catch(() => {});
    }
    return result.ok;
  } catch (e) { console.warn('[setSttLang] error:', e.message); return false; }
}

module.exports = {
  connectToTeamsBrowser, findMeetingPage,
  tryToggleCaptionsViaDOM, injectToggleCaptionsKey,
  checkCaptionsActive,
  startTeamsTokenCapture,
  autoSetupCDP, isCDPEnvSet, setCDPEnv,
  freePort9222IfNeeded,
  tryPowerShellSendKeys,
  getSttLanguage, setSttLanguage,
};
