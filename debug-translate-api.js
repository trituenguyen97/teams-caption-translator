/**
 * debug-translate-api.js - v4
 * 1. Dung puppeteer attach CDP vao tat ca pages (Network.enable chinh xac)
 * 2. Bat Bearer token tu worker requests
 * 3. Khi co token + chatId: thu goi translate API voi:
 *    a) Body text truc tiep { "text": "...", "targetLanguage": "vi" }
 *    b) Body nguyen ban [{ "id": "..." }] de xem format chuan
 *    c) Endpoint translate text khac: /api/mt/translate
 * 4. Ket luan co kha thi hay khong
 */

const http      = require('http');
const https     = require('https');
const { exec }  = require('child_process');
const WebSocket = require('ws');
const fs        = require('fs');
const LOG = require('path').join(__dirname, 'token-test-result.txt');

const C = {
  reset:'\x1b[0m', bold:'\x1b[1m', green:'\x1b[32m', yellow:'\x1b[33m',
  cyan:'\x1b[36m', red:'\x1b[31m', dim:'\x1b[2m', magenta:'\x1b[35m',
};

function log(line) {
  process.stdout.write(line + '\n');
  fs.appendFileSync(LOG, line.replace(/\x1b\[[0-9;]*m/g, '') + '\n', 'utf8');
}
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function httpGet(port, path) {
  return new Promise(resolve => {
    const req = http.get({ hostname: '127.0.0.1', port, path }, res => {
      let d = ''; res.on('data', c => d += c); res.on('end', () => resolve(d));
    });
    req.setTimeout(2000, () => { req.destroy(); resolve(null); });
    req.on('error', () => resolve(null));
  });
}

function httpsReq(method, hostname, path, headers, body) {
  return new Promise(resolve => {
    const buf = body ? Buffer.from(JSON.stringify(body)) : Buffer.alloc(0);
    const req = https.request({
      hostname, path, method,
      headers: { 'Content-Type': 'application/json', 'Content-Length': buf.length, 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36 Edg/147.0.0.0', ...headers }
    }, res => {
      let d = ''; res.on('data', c => d += c);
      res.on('end', () => resolve({ status: res.statusCode, body: d }));
    });
    req.setTimeout(10000, () => { req.destroy(); resolve({ status: 0, body: 'timeout' }); });
    req.on('error', e => resolve({ status: 0, body: e.message }));
    if (buf.length) req.write(buf);
    req.end();
  });
}

async function findTeamsCDPPort() {
  return new Promise(resolve => {
    const script = [
      '$pids = @(Get-Process ms-teams,MSTeams -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Id)',
      'if (!$pids) { Write-Output "9222"; exit }',
      '$ports = Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue | Where-Object { $_.OwningProcess -in $pids } | Select-Object -ExpandProperty LocalPort | Sort-Object -Unique',
      'Write-Output ($ports -join ",")',
    ].join('\n');
    const enc = Buffer.from(script, 'utf16le').toString('base64');
    exec(`powershell -NoProfile -NonInteractive -EncodedCommand ${enc}`, { timeout: 6000 }, (err, stdout) => {
      const ports = (stdout || '').trim().split(',').map(p => parseInt(p.trim())).filter(p => p > 1023);
      resolve(ports.length ? ports : [9222]);
    });
  });
}

// Tim tat ca Teams targets (pages + workers) tu /json/list, tra ve { cdpPort, teamsTargets[] }
// Tranh hoan toan puppeteer browser-level connect vi 2 WebView2 share port 9222
async function findTeamsTargets(ports) {
  const allTeams = [];
  let foundPort = null;

  for (const port of ports) {
    const raw = await httpGet(port, '/json/list');
    if (!raw) continue;
    let targets;
    try { targets = JSON.parse(raw); } catch { continue; }

    const teamsTargets = targets.filter(t =>
      /teams\.microsoft\.com/i.test(t.url || '') ||
      /teams|meeting|chat|calendar/i.test(t.title || '')
    );
    if (teamsTargets.length > 0) {
      if (!foundPort) foundPort = port;
      teamsTargets.forEach(t => {
        if (t.webSocketDebuggerUrl) allTeams.push({ ...t, _port: port });
      });
      log(`  port ${port}: ${teamsTargets.length} Teams targets`);
      teamsTargets.forEach(t => log(`    [${t.type}] ${(t.title||'').slice(0,40)} ${(t.url||'').slice(0,55)}`));
    } else {
      const titles = targets.map(t=>(t.title||t.url||'').slice(0,20)).join(', ');
      log(`  port ${port}: ${titles || 'empty'} — no Teams`);
    }
  }

  return allTeams.length ? { cdpPort: foundPort, teamsTargets: allTeams } : null;
}

// Retry findTeamsTargets (vi 2 WebView2 share port, doi khi Widgets tra loi)
async function findTeamsTargetsWithRetry(ports, maxRetries = 5) {
  for (let i = 0; i < maxRetries; i++) {
    if (i > 0) {
      process.stdout.write(`\r  Lan thu ${i+1}/${maxRetries}: cho 1.5s va thu lai...`);
      await sleep(1500);
      process.stdout.write('\n');
    }
    const result = await findTeamsTargets(ports);
    if (result) return result;
  }
  return null;
}

// Ket qua tich luy
let capturedToken = null;        // IC3 token (ic3.teams.office.com)
let capturedCsaToken = null;     // CSA token (chatsvcagg.teams.microsoft.com)
let capturedTokenTs = 0;
let capturedTranslateInfo = null; // { region, chatId, messageId? }

// WS handles cua page targets (de goi Runtime.evaluate)
const pageWSHandles = [];
// WS handles cua worker targets (de kick fetch tu worker)
const workerWSHandles = [];

// Goi Runtime.evaluate tren tat ca page WS handles, tra ve ket qua dau tien co gia tri
async function evalInPages(expression) {
  const results = await Promise.allSettled(
    pageWSHandles.map(ws => runtimeEval(ws, expression, expression.trim().startsWith('(async')))
  );
  for (const r of results) {
    if (r.status === 'fulfilled' && r.value != null && r.value !== '') return r.value;
  }
  return null;
}

function runtimeEval(ws, expression, awaitPromise = false) {
  return new Promise((resolve) => {
    if (ws.readyState !== 1) { resolve(null); return; }
    const id = Math.floor(Math.random() * 90000) + 10000;
    const handler = raw => {
      try {
        const msg = JSON.parse(raw);
        if (msg.id !== id) return;
        ws.off('message', handler);
        resolve(msg.result?.result?.value ?? null);
      } catch { ws.off('message', handler); resolve(null); }
    };
    ws.on('message', handler);
    ws.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression, returnByValue: true, awaitPromise } }));
    setTimeout(() => { ws.off('message', handler); resolve(null); }, awaitPromise ? 8000 : 2000);
  });
}

async function main() {
  fs.writeFileSync(LOG, `Teams Translate API Deep Test - ${new Date().toISOString()}\n\n`, 'utf8');
  log(`${C.bold}${C.cyan}=== Teams Translate Text API Test ===${C.reset}\n`);

  // ----- BUOC 1: Tim Teams targets -----
  const ports = await findTeamsCDPPort();
  log(`CDP ports tu Teams process: ${JSON.stringify(ports)}`);

  let conn = await findTeamsTargetsWithRetry(ports, 5);
  if (!conn) {
    log(`Scan 9222-9250...`);
    const scanPorts = Array.from({length: 29}, (_, i) => 9222 + i);
    conn = await findTeamsTargetsWithRetry(scanPorts, 3);
    if (!conn) {
      log(`${C.red}Khong tim thay Teams CDP targets.${C.reset}`);
      log(`Kiem tra registry: HKCU\\Software\\Policies\\Microsoft\\Edge\\WebView2\\AdditionalBrowserArguments`);
      process.exit(1);
    }
  }
  const cdpPort = conn.cdpPort;
  log(`${C.green}Tim thay ${conn.teamsTargets.length} Teams targets tren port ${cdpPort}${C.reset}`);

  // ----- BUOC 2: Attach raw WS vao tat ca Teams targets -----
  log(`\nAttach raw WebSocket vao ${conn.teamsTargets.length} targets...`);
  for (const t of conn.teamsTargets) {
    const isPage = t.type === 'page';
    attachRawWS(t.webSocketDebuggerUrl, `${t.type}:${(t.title||t.url||'').slice(0,35)}`, isPage);
  }

  // Cho WS ket noi o dinh
  await sleep(800);

  // Thu doc token tu MSAL localStorage ngay sau khi connect
  async function tryReadTokenFromStorage() {
    // Teams dung key pattern: tmp.auth.v1.{userId}.Token.HTTPS://IC3... hoac CHATSVCAGG...
    const expr = `(function() {
      const keys = Object.keys(localStorage);
      const result = {};
      // Lay tat ca tokens Teams (IC3, CHATSVCAGG, UIS)
      for (const k of keys) {
        if (!k.includes('Token.HTTPS://')) continue;
        try {
          const raw = localStorage.getItem(k);
          const obj = JSON.parse(raw);
          // Token co the nam trong item.token hoac item.value
          const tokenData = obj?.item;
          const tok = tokenData?.token || obj?.token || obj?.value;
          // Token duoc encrypt - chi lay metadata
          if (tokenData && tokenData.expires) {
            const audience = k.split('Token.HTTPS://').pop();
            result[audience] = { expires: tokenData.expires, hasToken: !!tok && tok.length > 10 };
          }
        } catch {}
      }
      return JSON.stringify(result);
    })()`;
    const info = await evalInPages(expr);
    if (info) log(`  Token storage: ${info}`);
  }

  // Lay token ngay neu co
  log(`pageWSHandles sau 800ms: ${pageWSHandles.length} handles`);
  if (pageWSHandles.length > 0) {
    // Doc tu Teams:auth IDB store auth-cache-cdl
    const idbToken = await evalInPages(`(async () => {
      try {
        const dbs = await indexedDB.databases();
        const authDb = dbs.find(d => d.name && d.name.includes(':auth:'));
        if (!authDb) return 'no-auth-db';
        const db = await new Promise((res, rej) => {
          const r = indexedDB.open(authDb.name);
          r.onsuccess = e => res(e.target.result);
          r.onerror = e => rej(e);
        });
        // Doc toan bo tu auth-cache-cdl store
        const tx = db.transaction('auth-cache-cdl', 'readonly');
        const s = tx.objectStore('auth-cache-cdl');
        const keys = await new Promise((res,rej)=>{const r=s.getAllKeys();r.onsuccess=e=>res(e.target.result);r.onerror=rej;});
        const vals = await new Promise((res,rej)=>{const r=s.getAll();r.onsuccess=e=>res(e.target.result);r.onerror=rej;});
        const result = {};
        keys.forEach((k,i) => { result[String(k)] = String(vals[i]).slice(0,300); });
        db.close();
        return JSON.stringify(result);
      } catch (e) { return 'err:' + e.message; }
    })()`);
    log(`  auth-cache-cdl: ${typeof idbToken === 'string' ? idbToken.slice(0,600) : 'null'}`);
    if (typeof idbToken === 'string' && idbToken.startsWith('eyJ')) {
      capturedToken = idbToken;
      process.stdout.write(`\n${C.green}[TOKEN via IDB]${C.reset} len=${idbToken.length}\n`);
    }

    // Doc chatId tu conversation-manager IDB
    const convInfo = await evalInPages(`(async () => {
      try {
        const dbs = await indexedDB.databases();
        const convDb = dbs.find(d => d.name && d.name.includes(':conversation-manager:') && !d.name.includes('folder'));
        if (!convDb) return 'no-conv-db';
        const db = await new Promise((res, rej) => {
          const r = indexedDB.open(convDb.name);
          r.onsuccess = e => res(e.target.result);
          r.onerror = e => rej(e);
        });
        const stores = [...db.objectStoreNames];
        // Tim store co du lieu chat
        for (const store of stores) {
          try {
            const tx = db.transaction(store, 'readonly');
            const s = tx.objectStore(store);
            const keys = await new Promise((res,rej)=>{const r=s.getAllKeys();r.onsuccess=e=>res(e.target.result);r.onerror=rej;});
            if (keys.length === 0) continue;
            // Lay 3 key dau de xem format
            const sampleVals = await Promise.all(keys.slice(0,3).map(k => new Promise((res,rej)=>{
              const r=tx.objectStore ? s.get(k) : null;
              if (!r) { res(null); return; }
              r.onsuccess=e=>res(e.target.result); r.onerror=()=>res(null);
            })));
            const keyInfo = keys.slice(0,3).map((k,i) => { 
              const v = sampleVals[i];
              return k + '=' + (v ? JSON.stringify(v).slice(0,80) : 'null');
            });
            db.close();
            return JSON.stringify({ store, count: keys.length, samples: keyInfo });
          } catch(e) { continue; }
        }
        db.close();
        return 'stores: ' + stores.join(',');
      } catch(e) { return 'err:'+e.message; }
    })()`);
    log(`  Conversation IDB: ${typeof convInfo === 'string' ? convInfo.slice(0,500) : 'null'}`);

    // Lay chatId truc tiep tu conversation IDB (khong can user click!)
    const chatId = await evalInPages(`(async () => {
      try {
        const dbs = await indexedDB.databases();
        const convDb = dbs.find(d => d.name && d.name.includes(':conversation-manager:') && !d.name.includes('folder'));
        if (!convDb) return null;
        const db = await new Promise((res, rej) => {
          const r = indexedDB.open(convDb.name);
          r.onsuccess = e => res(e.target.result);
          r.onerror = e => rej(e);
        });
        const tx = db.transaction('conversations', 'readonly');
        const s = tx.objectStore('conversations');
        const keys = await new Promise((res,rej)=>{const r=s.getAllKeys();r.onsuccess=e=>res(e.target.result);r.onerror=rej;});
        // Tim group chat @thread.v2 truoc (CSA phan nhom khac 1:1)
        // Va loc bo calendar/meeting thread (tacv2)
        const threadV2 = keys.filter(k => String(k).includes('@thread.v2'));
        const chatKey = threadV2[0] || keys.find(k => String(k).includes('@unq.gbl.spaces')) || keys[0];
        db.close();
        return chatKey ? String(chatKey) : null;
      } catch(e) { return null; }
    })()`);
    if (chatId) {
      log(`  DEBUG: Danh sach cac chat IDs dau tien:`);
      const allChatIds = await evalInPages(`(async () => {
        try {
          const dbs = await indexedDB.databases();
          const convDb = dbs.find(d => d.name && d.name.includes(':conversation-manager:') && !d.name.includes('folder'));
          const db = await new Promise((res, rej) => {
            const r = indexedDB.open(convDb.name);
            r.onsuccess = e => res(e.target.result);
            r.onerror = e => rej(e);
          });
          const tx = db.transaction('conversations', 'readonly');
          const s = tx.objectStore('conversations');
          const keys = await new Promise((res,rej)=>{const r=s.getAllKeys();r.onsuccess=e=>res(e.target.result);r.onerror=rej;});
          db.close();
          return JSON.stringify(keys.slice(0,6).map(k => String(k).slice(0,60)));
        } catch(e) { return 'err:'+e.message; }
      })()`);
      log(`  ${allChatIds}`);
      capturedTranslateInfo = { region: 'apac', chatId, fromIDB: true };
      process.stdout.write(`\n${C.magenta}[CHAT FROM IDB]${C.reset} chatId=${chatId.slice(0,55)}\n`);

      // Lay region tu localStorage
      const regionRaw = await evalInPages(`(function(){
        const k = Object.keys(localStorage).find(k => k.includes('Discover.DISCOVER-REGION'));
        return k ? localStorage.getItem(k) : null;
      })()`);
      if (typeof regionRaw === 'string' && regionRaw.includes('region')) {
        try {
          const rObj = JSON.parse(regionRaw);
          const r = rObj?.regionGtm || rObj?.region || rObj?.value || 'apac';
          capturedTranslateInfo.region = r.toLowerCase();
          process.stdout.write(`\n${C.magenta}[REGION]${C.reset} ${capturedTranslateInfo.region}\n`);
        } catch {}
      }
    }

    // Kick: trigger page navigation thuc su de trigger CSA requests co auth headers that
    if (chatId) {
      process.stdout.write(`\n${C.cyan}[KICK]${C.reset} Navigate Teams SPA den chat de trigger CSA requests co token that...\n`);
      // Dung history.pushState + Teams SPA router (khong reload page, khong mat CDP connection)
      // Teams doc hash/path va load conversation, SW inject token vao fetch
      const triggerNav = `(function() {
        try {
          // Cach 1: Teams SPA deeplink qua hash
          const chatId = '${chatId.replace(/'/g,"\\'")}';
          // Teams dung format: /v2/#/conversations/{chatId}
          // Thay doi hash se trigger Teams router load conversation  
          window.location.hash = '/conversations/' + encodeURIComponent(chatId);
        } catch(e) {}
      })()`;
      // Chi navigate 1 page (tranh navigate all)
      for (const ws of pageWSHandles.slice(0, 1)) {
        runtimeEval(ws, triggerNav, false);
      }
      await sleep(500);
    }
  }
  await tryReadTokenFromStorage();

  // ----- BUOC 3: Cho token (60s) -----
  log(`\n${C.yellow}Giai doan 1/2: Cho token (60s)...${C.reset}`);
  log(`${C.cyan}>>> NGAY BAY GIO: Chuyen sang Teams, click vao chat (trang da tu dong chuyen) <<<${C.reset}`);
  log(`${C.cyan}>>> Neu khong thay chat load, bam vao bat ky doan chat nao trong Teams <<<${C.reset}`);
  for (let i = 60; i > 0; i--) {
    process.stdout.write(`\r  Con ${i}s... token=${capturedToken ? C.green + 'CO (len=' + capturedToken.length + ')' + C.reset : C.dim + 'CHUA' + C.reset}   `);
    await sleep(1000);
    if (capturedToken) break;
    if (i % 10 === 0) await tryReadTokenFromStorage();
  }
  process.stdout.write('\n\n');

  if (!capturedToken) {
    log(`${C.yellow}Khong bat duoc token tu mang. Thu doc tu Teams app state...${C.reset}`);
    // Thu doc token tu page context (Teams co the expose qua global)
    const pageToken = await evalInPages(`(function() {
      // Thu cac cach Teams co the luu token trong page context
      try {
        // Cach 1: skypeAuthService hoac authentication module
        const moduleExports = [...Object.entries(window)].find(([k,v]) => v && v.getToken && typeof v.getToken === 'function');
        if (moduleExports) return 'moduleExports: ' + moduleExports[0];
      } catch {}
      // Cach 2: MSAL instance
      try {
        const msal = window.__msal__ || window.msal;
        if (msal) {
          const accounts = msal.getAllAccounts ? msal.getAllAccounts() : [];
          return 'msal accounts: ' + accounts.length;
        }
      } catch {}
      // Cach 3: Tim token trong window properties (flat search)
      const keys = Object.keys(window).filter(k => k.toLowerCase().includes('auth') || k.toLowerCase().includes('token'));
      return 'auth keys: ' + keys.slice(0,10).join(',');
    })()`);
    log(`  Page state: ${pageToken}`);

    capturedToken = 'IN_PAGE_ONLY';
  }

  // Kiem tra token expired chua
  let tokenExpired = false;
  if (capturedToken !== 'IN_PAGE_ONLY') {
    try {
      const parts = capturedToken.split('.');
      const p = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
      const expMs = (p.exp || 0) * 1000;
      if (expMs < Date.now() - 300000) { // 5 phut bufer
        log(`${C.yellow}Token DA HET HAN (${new Date(expMs).toISOString()}) - luu y API co the tra 401.${C.reset}`);
        tokenExpired = true;
      } else {
        log(`Token con hieu luc den: ${new Date(expMs).toISOString()}`);
      }
    } catch {}
  } else {
    log(`${C.yellow}Dung in-page fetch mode (khong co external token).${C.reset}`);
  }

  // Giai ma JWT
  log(`${C.bold}Token:${C.reset} len=${capturedToken.length}`);
  try {
    const parts = capturedToken.split('.');
    const p = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    log(`  aud: ${JSON.stringify(p.aud)}`);
    log(`  scp: ${JSON.stringify(p.scp || p.scope || 'N/A')}`);
    log(`  exp: ${new Date((p.exp || 0) * 1000).toISOString()}`);
  } catch (e) { log(`  (JWT decode error: ${e.message})`); }

  // ----- BUOC 3b: Cho chatId (bat tu bat ky request chat hoac URL hash) -----
  log(`\n${C.yellow}Giai doan 2/2: Cho chatId (40s)...${C.reset}`);
  log(`${C.cyan}>>> Click vao bat ky tin nhan trong Teams chat (khong can Translate) <<<${C.reset}\n`);
  for (let i = 40; i > 0; i--) {
    process.stdout.write(`\r  Con ${i}s... chatId=${capturedTranslateInfo ? C.green + 'CO' + C.reset : C.dim + 'CHUA' + C.reset}   `);
    await sleep(1000);
    if (capturedTranslateInfo) { await sleep(300); break; }

    // Thu doc chatId tu URL hash cua Teams page
    if (!capturedTranslateInfo && i % 3 === 0) {
      const hash = await evalInPages('window.location.hash');
      if (hash) {
        // Teams deeplink format: #/conversations/19:xxx@thread.v2 hoac /conversations/1:xxx@unq.xxx
        const m = hash.match(/\/conversations\/([\w.:@-]{10,})/);
        if (m) {
          const rawId = decodeURIComponent(m[1]);
          capturedTranslateInfo = { region: 'apac', chatId: rawId, fromHash: true };
          process.stdout.write(`\n${C.magenta}[CHAT FROM HASH]${C.reset} chatId=${rawId.slice(0,50)}\n`);
        }
      }
    }
  }
  process.stdout.write('\n\n');

  // ----- BUOC 4: Thu cac bien the translate API -----
  log(`\n${C.bold}=== THU CAC ENDPOINT TRANSLATE ===${C.reset}\n`);

  const auth = `Bearer ${capturedToken}`;
  const csaAuth = capturedCsaToken ? `Bearer ${capturedCsaToken}` : auth;
  const testText = 'お疲れ様でした。本日はよろしくお願いいたします。';
  const { region, chatId } = capturedTranslateInfo;
  const host = 'teams.microsoft.com';

  log(`IC3 token len=${capturedToken?.length || 0}, CSA token len=${capturedCsaToken?.length || 0}`);
  if (capturedCsaToken) {
    try {
      const parts = capturedCsaToken.split('.');
      const p = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
      log(`CSA JWT: aud=${JSON.stringify(p.aud)}, scp=${JSON.stringify(p.scp||p.scope||'N/A')}`);
    } catch {}
  }
  log(`chatId: ${chatId?.slice(0,50)}, region: ${region}`);
  log('');

  // --- Test quan trong nhat: Goi tu TRONG Teams page (page context co token dung) ---
  log('--- [IN-PAGE] Teams CSA translate tu page context (text, targetLanguage) ---');
  const inPageResult = await evalInPages(`(async () => {
    try {
      const chatId = '${chatId}';
      const url = 'https://teams.microsoft.com/api/csa/apac/api/v1/chats/' + encodeURIComponent(chatId) + '/messages/translate';
      const res = await fetch(url, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify([{ text: '${testText}', targetLanguage: 'vi' }])
      });
      const text = await res.text();
      return JSON.stringify({ status: res.status, body: text.slice(0, 500) });
    } catch(e) { return JSON.stringify({ error: e.message }); }
  })()`);
  log(`  In-page result: ${inPageResult}`);
  log('');

  // --- Test B: Goi tu TRONG page voi format { id: ... } (fake msgId) ---
  {
    log('--- [IN-PAGE] Teams CSA translate (message ID fake) ---');
    const inPageMsg = await evalInPages(`(async () => {
      try {
        const chatId = '${chatId}';
        const url = 'https://teams.microsoft.com/api/csa/apac/api/v1/chats/' + encodeURIComponent(chatId) + '/messages/translate';
        const res = await fetch(url, {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify([{ id: '1746350000000001' }])
        });
        const text = await res.text();
        return JSON.stringify({ status: res.status, body: text.slice(0, 500) });
      } catch(e) { return JSON.stringify({ error: e.message }); }
    })()`);
    log(`  In-page fake msgId: ${inPageMsg}`);
    log('');
  }

  // --- Test C: GET danh sach messages (xem co chatId nay co dung khong) ---
  {
    log('--- [IN-PAGE] Teams CSA GET messages (kiem tra chatId) ---');
    const msgList = await evalInPages(`(async () => {
      try {
        const chatId = '${chatId}';
        const url = 'https://teams.microsoft.com/api/csa/apac/api/v1/chats/' + encodeURIComponent(chatId) + '/messages?pageSize=3';
        const res = await fetch(url, { method: 'GET', credentials: 'include' });
        const text = await res.text();
        return JSON.stringify({ status: res.status, body: text.slice(0, 300) });
      } catch(e) { return JSON.stringify({ error: e.message }); }
    })()`);
    log(`  In-page message list: ${msgList}`);
    log('');
  }

  // --- Test D: Debug auth headers que Teams page dung ---
  {
    log('--- [IN-PAGE] Debug: xem request headers Teams dung (Skypetoken?) ---');
    const headers = await evalInPages(`(async () => {
      try {
        // Thu lam CORS-same-origin request de xem headers nao duoc set tu SW
        const chatId = '${chatId}';
        const url = 'https://teams.microsoft.com/api/csa/apac/api/v1/chats/' + encodeURIComponent(chatId) + '/messages?pageSize=1';
        // Spy on fetch headers via Request
        const req = new Request(url, { method: 'GET', credentials: 'include' });
        // Check request headers truoc khi gui
        const h = {};
        req.headers.forEach((v,k) => { h[k] = v.slice(0,50); });
        return JSON.stringify(h);
      } catch(e) { return 'err: ' + e.message; }
    })()`);
    log(`  Request headers (before SW): ${headers}`);
    log('');

    // Xem config cua Teams (skypetoken, tenantId)
    const teamsConfig = await evalInPages(`(function() {
      try {
        // Teams co the luu config trong window
        const cfg = window.__TEAMS_CONFIG__ || window.TS_CONTEXT || window.__msft || window._teamsContext;
        if (cfg) return JSON.stringify(typeof cfg === 'object' ? Object.keys(cfg).slice(0,10) : String(cfg).slice(0,100));
        // Tim trong module registry
        const w = {};
        ['SkypeToken','skypeToken','Skypetoken','bearerToken','accessToken'].forEach(k => {
          if (window[k]) w[k] = String(window[k]).slice(0,30);
        });
        return JSON.stringify(Object.keys(w).length ? w : 'no-config');
      } catch(e) { return 'err: ' + e.message; }
    })()`);
    log(`  Teams config: ${teamsConfig}`);
    log('');
  }
  const inPageMT = await evalInPages(`(async () => {
    try {
      const res = await fetch('https://teams.microsoft.com/api/mt/amer/translate?to=vi&api-version=2', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([{ Text: '${testText}' }])
      });
      const text = await res.text();
      return JSON.stringify({ status: res.status, body: text.slice(0, 500) });
    } catch(e) { return JSON.stringify({ error: e.message }); }
  })()`);
  log(`  In-page MT result: ${inPageMT}`);
  log('');

  // --- Fallback: External HTTP tests voi token ---
  log(`\n${C.dim}--- Fallback external tests (co the 401 neu wrong token) ---${C.reset}`);

  // --- 4a: MS Translator Text API v3 (Azure Cognitive) ---
  await testEndpoint('MS Translator (Azure Cognitive)', async () => {
    return httpsReq('POST', 'api.cognitive.microsofttranslator.com',
      `/translate?api-version=3.0&to=vi&textType=plain`,
      { 'Authorization': auth },
      [{ Text: testText }]
    );
  });

  // --- 4b: Teams Internal CSA - external tests ---
  {
    // Body chuan: [{ id: messageId }]
    if (capturedTranslateInfo.messageId) {
      await testEndpoint('Teams CSA translate (message ID, IC3 token)', async () => {
        return httpsReq('POST', host,
          `/api/csa/${region}/api/v1/chats/${encodeURIComponent(chatId)}/messages/translate`,
          { 'Authorization': auth, 'Origin': 'https://teams.microsoft.com', 'Referer': 'https://teams.microsoft.com/v2/' },
          [{ id: capturedTranslateInfo.messageId }]
        );
      });
    }

    await testEndpoint('Teams CSA translate (text, IC3+Origin)', async () => {
      return httpsReq('POST', host,
        `/api/csa/${region}/api/v1/chats/${encodeURIComponent(chatId)}/messages/translate`,
        { 'Authorization': auth, 'Origin': 'https://teams.microsoft.com', 'Referer': 'https://teams.microsoft.com/v2/' },
        [{ text: testText, targetLanguage: 'vi' }]
      );
    });

    await testEndpoint('Teams MT translate /api/mt/translate', async () => {
      return httpsReq('POST', host,
        `/api/mt/translate?to=vi`,
        { 'Authorization': auth },
        [{ Text: testText }]
      );
    });

    await testEndpoint('Teams chatsvc translate /v1/translate', async () => {
      return httpsReq('POST', host,
        `/api/chatsvc/${region}/v1/translate`,
        { 'Authorization': auth, 'Origin': 'https://teams.microsoft.com' },
        { text: testText, targetLanguage: 'vi' }
      );
    });

    await testEndpoint('Teams chatsvc threads translate', async () => {
      return httpsReq('POST', host,
        `/api/chatsvc/${region}/v1/threads/${encodeURIComponent(chatId)}/messages/translate`,
        { 'Authorization': auth, 'Origin': 'https://teams.microsoft.com' },
        { text: testText, targetLanguage: 'vi' }
      );
    });
  }

  // ----- BUOC 5: Ket luan -----
  log(`\n${C.bold}=== KET LUAN ===${C.reset}`);
  log(`Xem file log day du: ${LOG}`);
  process.exit(0);
}

// ----------- helpers -----------

function attachRawWS(wsUrl, label, isPage = false) {
  try {
    const ws = new WebSocket(wsUrl);
    let msgId = 0;
    let anyEvent = false;
    ws.on('open', () => {
      ws.send(JSON.stringify({ id: ++msgId, method: 'Network.enable', params: { maxPostDataSize: 4096 } }));
      if (isPage) {
        ws.send(JSON.stringify({ id: ++msgId, method: 'Runtime.enable' }));
        pageWSHandles.push(ws);
      } else {
        // Enable Runtime on workers too (de co the eval fetch tu worker)
        ws.send(JSON.stringify({ id: ++msgId, method: 'Runtime.enable' }));
        workerWSHandles.push(ws);
      }
    });
    // Map requestId -> url (cho requestWillBeSentExtraInfo)
    const reqIdToUrl = {};

    ws.on('message', raw => {
      if (!anyEvent) { anyEvent = true; process.stdout.write(`\n${C.dim}[WS-OK] ${label}${C.reset}\n`); }
      try {
        const msg = JSON.parse(raw);

        // Ghi nho URL khi request bat dau
        if (msg.method === 'Network.requestWillBeSent') {
          const reqId = msg.params?.requestId;
          const url = msg.params?.request?.url || '';
          if (reqId && url) reqIdToUrl[reqId] = url;
          // Kiem tra headers trong requestWillBeSent cung (truoc SW)
          const headers = msg.params?.request?.headers || {};
          const auth = headers['authorization'] || headers['Authorization'] || '';
          if (auth.startsWith('Bearer eyJ') && auth.length > 110) {
            const token = auth.slice(7);
            const isCsaUrl = /chatsvcagg\.teams\.microsoft\.com|\/api\/csa\//i.test(url);
            if (isCsaUrl && (!capturedCsaToken || token.length > capturedCsaToken.length)) {
              capturedCsaToken = token;
              process.stdout.write(`\n${C.green}[CSA TOKEN requestWillBeSent]${C.reset} ${label} | len=${token.length} | url=${url.slice(0,80)}\n`);
            }
          }
        }

        // requestWillBeSentExtraInfo: co headers SAU KHI Service Worker xu ly
        // Day la noi token that duoc inject
        if (msg.method === 'Network.requestWillBeSentExtraInfo') {
          const reqId = msg.params?.requestId;
          const headers = msg.params?.headers || {};
          const auth = headers['authorization'] || headers['Authorization'] || '';
          const url = reqIdToUrl[reqId] || '';
          if (auth && auth.length > 10) {
            process.stdout.write(`\n${C.cyan}[EXTRA]${C.reset} auth.len=${auth.length} url=${url.slice(0,80)}\n`);
          }
          if (auth.startsWith('Bearer eyJ') && auth.length > 110) {
            const token = auth.slice(7);
            const isCsaUrl = /chatsvcagg\.teams\.microsoft\.com|\/api\/csa\//i.test(url);
            const isTranslateUrl = /\/translate/i.test(url);
            if ((isCsaUrl || isTranslateUrl) && (!capturedCsaToken || token.length > capturedCsaToken.length)) {
              capturedCsaToken = token;
              process.stdout.write(`\n${C.green}[CSA TOKEN via ExtraInfo]${C.reset} ${label} | len=${token.length} | url=${url.slice(0,80)}\n`);
            }
            if (!capturedToken || token.length > capturedToken.length) {
              capturedToken = token;
              process.stdout.write(`\n${C.yellow}[TOKEN via ExtraInfo]${C.reset} ${label} | len=${token.length}\n`);
            }
          }
          return;
        }

        if (msg.method !== 'Network.requestWillBeSent') return;
        const url = reqIdToUrl[msg.params?.requestId] || msg.params?.request?.url || '';
        const headers = msg.params?.request?.headers || {};
        const auth = headers['authorization'] || headers['Authorization'] || '';

        // Debug: print tat ca URL co auth header
        if (auth.startsWith('Bearer ') && url.includes('teams.microsoft.com')) {
          process.stdout.write(`\n${C.dim}[NET ${label.slice(0,20)}] ${url.slice(0,80)} auth.len=${auth.length}${C.reset}\n`);
        }

        if (!auth.startsWith('Bearer eyJ') || auth.length < 110) return;
        const token = auth.slice(7);
        // Phan loai token theo URL de xac dinh audience
        const isCsa = /chatsvcagg\.teams\.microsoft\.com|\/api\/csa\//i.test(url);
        if (isCsa) {
          if (!capturedCsaToken || token.length > capturedCsaToken.length) {
            capturedCsaToken = token;
            process.stdout.write(`\n${C.green}[CSA TOKEN via rawWS]${C.reset} ${label} | len=${token.length}\n`);
          }
        }
        if (!capturedToken || token.length > capturedToken.length) {
          capturedToken = token;
          capturedTokenTs = Date.now();
          process.stdout.write(`\n${C.green}[TOKEN via rawWS]${C.reset} ${label} | len=${token.length}${isCsa?' (CSA)':''}\n`);
        }
        // Bat translate request hoac bat cuu chatId tu bat ky request /chats/
        const chatMatch = url.match(/\/api\/csa\/(\w+)\/api\/v\d+\/chats\/([^/?]+)/);
        if (chatMatch) {
          if (!capturedTranslateInfo) {
            capturedTranslateInfo = { region: chatMatch[1], chatId: decodeURIComponent(chatMatch[2]) };
            process.stdout.write(`\n${C.magenta}[CHAT ID]${C.reset} region=${capturedTranslateInfo.region} chatId=${capturedTranslateInfo.chatId.slice(0,45)}\n`);
          }
          // Neu la request translate thi lay them messageId
          if (url.includes('/messages/translate') && msg.params?.request?.method === 'POST' && !capturedTranslateInfo.messageId) {
            try {
              const body = JSON.parse(msg.params.request.postData || '[]');
              capturedTranslateInfo.messageId = body[0]?.id;
              if (capturedTranslateInfo.messageId) {
                process.stdout.write(`\n${C.magenta}[TRANSLATE REQ]${C.reset} msgId=${capturedTranslateInfo.messageId}\n`);
              }
            } catch {}
          }
        }
      } catch {}
    });
    ws.on('error', () => {});
  } catch {}
}

async function testEndpoint(name, fn) {
  log(`--- ${name} ---`);
  let res;
  try { res = await fn(); } catch (e) { log(`  ${C.red}Loi: ${e.message}${C.reset}\n`); return; }

  if (res.status === 200) {
    log(`  ${C.bold}${C.green}✓ HTTP 200 THANH CONG!${C.reset}`);
    try {
      const parsed = JSON.parse(res.body);
      log(`  Response: ${JSON.stringify(parsed, null, 2).slice(0, 800)}`);
    } catch { log(`  Response: ${res.body.slice(0, 400)}`); }
  } else {
    const color = res.status === 401 ? C.yellow : res.status === 404 ? C.dim : C.red;
    log(`  ${color}✗ HTTP ${res.status}${C.reset}`);
    // Show full error body for debugging
    try {
      const parsed = JSON.parse(res.body);
      log(`  ${JSON.stringify(parsed).slice(0, 300)}`);
    } catch { log(`  ${res.body.slice(0, 300)}`); }
  }
  log('');
}

main().catch(err => { console.error('ERROR:', err.message || err); process.exit(1); });
