/**
 * cdp-test.js - Monitor toan bo network traffic tu Teams pages
 * De tim CSA/CHATSVCAGG token, capture full token, va test translate API
 */
const WebSocket = require('ws');
const http = require('http');
const https = require('https');
const fs = require('fs');

const LOG = 'cdp-test-tokens.json';
console.log('=== Teams CDP Network Monitor + Token Capture ===');
console.log('Dang ky listen tren tat ca page/worker targets...');
console.log('');

let capturedCSA = null;
let capturedIC3 = null;
let capturedChatId = null;

function httpsReq(method, hostname, path, headers, body) {
  return new Promise(resolve => {
    const buf = body ? Buffer.from(JSON.stringify(body)) : Buffer.alloc(0);
    const req = https.request({
      hostname, path, method,
      headers: { 'Content-Type': 'application/json', 'Content-Length': buf.length, ...headers }
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

async function testTranslate(csaToken, chatId) {
  console.log('\n=== TESTING TRANSLATE API WITH CHATSVCAGG TOKEN ===');
  const auth = 'Bearer ' + csaToken;
  const text = 'お疲れ様でした。本日はよろしくお願いいたします。';
  
  // Lay chatId @thread.v2 tu IDB hoac fallback
  const chatIds = [
    chatId,
    '19:05378bd68a94467e97d7e6ed7c4c92f2@thread.v2',  // group chat tu IDB
  ];
  
  for (const cid of chatIds) {
    const cidEnc = encodeURIComponent(cid);
    console.log('\n--- Testing chatId:', cid.slice(0, 55), '---');
    
    // Test GET messages dau de xem chatId hop le
    console.log('[GET /messages]');
    const rGet = await httpsReq('GET', 'teams.microsoft.com',
      `/api/csa/apac/api/v1/chats/${cidEnc}/messages?pageSize=3`,
      { 'Authorization': auth, 'Origin': 'https://teams.microsoft.com' },
      null
    );
    console.log(`  Status: ${rGet.status}, Body: ${rGet.body.slice(0, 200)}`);
    
    let realMsgId = null;
    let fullMsgData = null;
    let fromOtherMsg = null;
    if (rGet.status === 200) {
      try {
        const body = JSON.parse(rGet.body);
        const msgs = body?.value || body?.messages || body;
        if (Array.isArray(msgs) && msgs.length > 0) {
          // In ra tat ca messages de xem
          msgs.slice(0, 5).forEach((m, i) => {
            console.log(`  msg[${i}]: id=${m.id} from=${m.from?.slice(0,30)} type=${m.messageType} content=${(m.content||'').slice(0,50)}`);
          });
          // Tim message co noi dung tu nguoi khac
          const myUserId = 'c89bc863-0bf9-422b-b74d-4d4d3349250c';
          fromOtherMsg = msgs.find(m => m.messageType === 'Text' && m.content && !m.from?.includes(myUserId));
          const textMsg = fromOtherMsg || msgs.find(m => m.messageType === 'Text' && m.content);
          realMsgId = textMsg?.id;
          fullMsgData = textMsg;
          console.log(`  Using: id=${realMsgId} sequenceId=${textMsg?.sequenceId} from=${textMsg?.from?.slice(0,40)}`);
        }
      } catch(e) { console.log('  Parse error:', e.message); }
    }
    
    // Test POST translate body format 1: [{text, targetLanguage}]
    console.log('[POST translate text]');
    const r1 = await httpsReq('POST', 'teams.microsoft.com',
      `/api/csa/apac/api/v1/chats/${cidEnc}/messages/translate`,
      { 'Authorization': auth, 'Origin': 'https://teams.microsoft.com', 'Referer': 'https://teams.microsoft.com/v2/' },
      [{ text, targetLanguage: 'vi' }]
    );
    console.log(`  Status: ${r1.status}, Body: ${r1.body.slice(0, 300)}`);
    
    // Test POST translate body format 2: [{id}] with fake ID
    console.log('[POST translate fake msgId]');
    const r2 = await httpsReq('POST', 'teams.microsoft.com',
      `/api/csa/apac/api/v1/chats/${cidEnc}/messages/translate`,
      { 'Authorization': auth, 'Origin': 'https://teams.microsoft.com', 'Referer': 'https://teams.microsoft.com/v2/' },
      [{ id: '1746350000000001', targetLanguage: 'vi' }]
    );
    console.log(`  Status: ${r2.status}, Body: ${r2.body.slice(0, 300)}`);
    
    if (realMsgId) {
      console.log('[POST translate REAL msgId:', realMsgId, ']');
      const r3 = await httpsReq('POST', 'teams.microsoft.com',
        `/api/csa/apac/api/v1/chats/${cidEnc}/messages/translate`,
        { 'Authorization': auth, 'Origin': 'https://teams.microsoft.com', 'Referer': 'https://teams.microsoft.com/v2/' },
        [{ id: String(realMsgId), targetLanguage: 'vi' }]
      );
      console.log(`  Status: ${r3.status}, Body: ${r3.body.slice(0, 500)}`);
    }
    
    // Test PUT object format (vi error noí "requires JSON object not array")
    console.log('[PUT translate object {text}]');
    const r7 = await httpsReq('PUT', 'teams.microsoft.com',
      `/api/csa/apac/api/v1/chats/${cidEnc}/messages/translate`,
      { 'Authorization': auth, 'Origin': 'https://teams.microsoft.com' },
      { text, targetLanguage: 'vi' }  // object, not array
    );
    console.log(`  Status: ${r7.status}, Body: ${r7.body.slice(0, 400)}`);
    
    // Test PUT voi messageId dung
    if (realMsgId) {
      const seqId = fullMsgData?.sequenceId;
      const clientId = fullMsgData?.clientMessageId;
      
      console.log(`[Real IDs: id=${realMsgId}, seqId=${seqId}, clientId=${clientId}]`);
      
      // PUT {id} - da thu, 400 "Invalid message id"
      // Thu voi sequenceId
      if (seqId) {
        console.log('[PUT {id: sequenceId}]');
        const rS = await httpsReq('PUT', 'teams.microsoft.com',
          `/api/csa/apac/api/v1/chats/${cidEnc}/messages/translate`,
          { 'Authorization': auth, 'Origin': 'https://teams.microsoft.com' },
          { id: String(seqId), targetLanguage: 'vi' }
        );
        console.log(`  Status: ${rS.status}, Body: ${rS.body.slice(0, 400)}`);
      }
      
      // Thu PUT array [{id: sequenceId}]
      if (seqId) {
        console.log('[PUT [{id: sequenceId}]]');
        const rS2 = await httpsReq('PUT', 'teams.microsoft.com',
          `/api/csa/apac/api/v1/chats/${cidEnc}/messages/translate`,
          { 'Authorization': auth, 'Origin': 'https://teams.microsoft.com' },
          [{ id: String(seqId), targetLanguage: 'vi' }]
        );
        console.log(`  Status: ${rS2.status}, Body: ${rS2.body.slice(0, 400)}`);
      }
      
      // Thu PUT voi text (text translate, khong can msgId)
      // Va query param cho targetLanguage
      console.log('[PUT /translate?to=vi body=[{Text}] (MT format)]');
      const rM = await httpsReq('PUT', 'teams.microsoft.com',
        `/api/csa/apac/api/v1/chats/${cidEnc}/messages/translate?to=vi`,
        { 'Authorization': auth, 'Origin': 'https://teams.microsoft.com' },
        [{ Text: 'お疲れ様でした。' }]
      );
      console.log(`  Status: ${rM.status}, Body: ${rM.body.slice(0, 400)}`);
      
      // Thu POST /translate?to=vi body=[{Text}] (MT format)
      console.log('[POST translate?to=vi [{Text}] (MT format)]');
      const rN = await httpsReq('POST', 'teams.microsoft.com',
        `/api/csa/apac/api/v1/chats/${cidEnc}/messages/translate?to=vi&api-version=3.0`,
        { 'Authorization': auth, 'Origin': 'https://teams.microsoft.com' },
        [{ Text: 'お疲れ様でした。' }]
      );
      console.log(`  Status: ${rN.status}, Body: ${rN.body.slice(0, 400)}`);
      
      // Thu endpoint translate voi messageId as Path param
      console.log('[PUT /{msgId}/translate (PUT)]');
      const r9b = await httpsReq('PUT', 'teams.microsoft.com',
        `/api/csa/apac/api/v1/chats/${cidEnc}/messages/${realMsgId}/translate`,
        { 'Authorization': auth, 'Origin': 'https://teams.microsoft.com' },
        null
      );
      console.log(`  Status: ${r9b.status}, Body: ${r9b.body.slice(0, 400)}`);
      
      // V2 endpoint
      console.log('[POST v3 translate]');
      const rV3 = await httpsReq('POST', 'teams.microsoft.com',
        `/api/csa/apac/api/v3/chats/${cidEnc}/messages/translate`,
        { 'Authorization': auth, 'Origin': 'https://teams.microsoft.com' },
        [{ id: String(realMsgId), targetLanguage: 'vi' }]
      );
      console.log(`  Status: ${rV3.status}, Body: ${rV3.body.slice(0, 400)}`);
    }
    
    if (r1.status === 200 || r2.status === 200) {
      console.log('SUCCESS!');
      break;
    }
    
    // Neu 405, thi endpoint ton tai - tim method dung
    if (r1.status === 405) {
      console.log('*** 405 = Endpoint ton tai, sai method! ***');
    }
  }
  
  console.log('\n=== PHASE 2: WAITING FOR USER TO CLICK TRANSLATE IN TEAMS UI ===');
  console.log('>>> Please click "Translate" on any message in Teams now <<<');
  console.log('>>> Script will capture the exact request format <<<');
  // Script tiep tuc chay (timeout 180s), capture translate request tu Teams UI
}

http.get({ hostname: '127.0.0.1', port: 9222, path: '/json/list' }, res => {
  let d = ''; res.on('data', c => d += c); res.on('end', () => {
    const ts = JSON.parse(d).filter(t => (t.type === 'page' || t.type === 'service_worker' || t.type === 'worker') && t.webSocketDebuggerUrl);
    if (!ts.length) { console.log('No page targets'); return; }
    console.log('Targets found:', ts.length);
    ts.forEach(t => console.log(' -', t.type, t.title.slice(0,40), t.url.slice(0,60)));
    
    const reqIdToUrl = {};
    let totalMsgs = 0;
    
    ts.forEach((target, idx) => {
      const label = `[${target.type.slice(0,4)}_${idx}]`;
      const ws = new WebSocket(target.webSocketDebuggerUrl);
      ws.on('open', () => {
        ws.send(JSON.stringify({ id: 1, method: 'Network.enable', params: { maxPostDataSize: 4096 } }));
        ws.send(JSON.stringify({ id: 2, method: 'Runtime.enable' }));
        console.log('CONNECTED', label, target.type, (target.title || target.url || '').slice(0, 50));
        
        // Worker: inject fetch den CSA endpoint de trigger CHATSVCAGG token
        if (target.type === 'worker') {
          setTimeout(() => {
            console.log(label, 'Injecting CSA fetch to get CHATSVCAGG token...');
            ws.send(JSON.stringify({ id: 50, method: 'Runtime.evaluate', params: {
              expression: `(async()=>{
                try {
                  const r = await fetch('https://teams.microsoft.com/api/csa/apac/api/v3/teams/users/me/updates?isPrefetch=false&enableExperimentalEvents=true&_=' + Date.now());
                  return 'csa_updates:' + r.status;
                } catch(e) { return 'err:'+e.message; }
              })()`,
              awaitPromise: true, returnByValue: true
            }}));
          }, 2000);
        }
      });
      
      ws.on('message', raw => {
        totalMsgs++;
        try {
          const msg = JSON.parse(raw);
          if (!msg.method) return;
          
          if (msg.method === 'Network.requestWillBeSent') {
            const reqId = msg.params?.requestId;
            const url = msg.params?.request?.url || '';
            const headers = msg.params?.request?.headers || {};
            const auth = headers.authorization || headers.Authorization || '';
            if (reqId && url) reqIdToUrl[reqId] = url;
            
            // Workers gui request truc tiep co auth (khong qua SW)
            if (auth.startsWith('Bearer eyJ') && auth.length > 100) {
              const tok = auth.slice(7);
              let aud = '?';
              try { aud = JSON.parse(Buffer.from(tok.split('.')[1], 'base64url').toString()).aud; } catch {}
              const isCSA = String(aud).includes('chatsvcagg');
              console.log(`${label} REQ url=${url.slice(0,80)} aud=${aud}`);
              if (isCSA && !capturedCSA) {
                capturedCSA = tok;
                console.log('  *** REQ CAPTURED CHATSVCAGG TOKEN! len=' + tok.length + ' ***');
                const m = url.match(/\/chats\/([^/?]+)/);
                if (m && !capturedChatId) capturedChatId = decodeURIComponent(m[1]);
                fs.writeFileSync(LOG, JSON.stringify({ csaToken: tok, ic3Token: capturedIC3, chatId: capturedChatId, capturedAt: new Date().toISOString() }, null, 2));
                if (capturedChatId) testTranslate(capturedCSA, capturedChatId);
              }
            }
          }
          
          if (msg.method === 'Network.requestWillBeSentExtraInfo') {
            const reqId = msg.params?.requestId;
            const headers = msg.params?.headers || {};
            const auth = headers.authorization || headers.Authorization || '';
            const url = reqIdToUrl[reqId] || '';
            
            if (auth.startsWith('Bearer eyJ') && auth.length > 100) {
              const tok = auth.slice(7);
              let aud = '?';
              try { aud = JSON.parse(Buffer.from(tok.split('.')[1], 'base64url').toString()).aud; } catch {}
              
              const isCSA = String(aud).includes('chatsvcagg');
              const isIC3 = String(aud).includes('ic3.teams');
              
              console.log(`${label} EXTRA url=${url.slice(0,80)}`);
              console.log(`  aud=${aud} len=${auth.length}`);
              
              if (isCSA && !capturedCSA) {
                capturedCSA = tok;
                console.log('  *** CAPTURED CHATSVCAGG TOKEN! len=' + tok.length + ' ***');
                // Lay chatId tu URL
                const m = url.match(/\/chats\/([^/?]+)/);
                if (m) capturedChatId = decodeURIComponent(m[1]);
                // Save token
                fs.writeFileSync(LOG, JSON.stringify({ csaToken: tok, ic3Token: capturedIC3, chatId: capturedChatId, capturedAt: new Date().toISOString() }, null, 2));
                console.log('  Saved to', LOG);
                // Test ngay once both tokens captured
                if (capturedChatId) testTranslate(capturedCSA, capturedChatId);
              }
              if (isIC3 && !capturedIC3) {
                capturedIC3 = tok;
                console.log('  *** CAPTURED IC3 TOKEN! len=' + tok.length + ' ***');
              }
              
              // Bat chatId tu URL
              const m = url.match(/\/api\/csa\/\w+\/api\/v\d+\/chats\/([^/?]+)/);
              if (m && !capturedChatId) {
                capturedChatId = decodeURIComponent(m[1]);
                console.log('  ChatId from URL:', capturedChatId.slice(0,60));
                if (capturedCSA) testTranslate(capturedCSA, capturedChatId);
              }
              
              // Bat translate request body (neu co)  
              if (url.includes('/translate') && msg.params?.requestBodySize > 0) {
                console.log('  *** TRANSLATE REQUEST FOUND! url=' + url + ' ***');
              }
            }
          }
          
          // Network.requestServedFromCache - skip
          // Capture requestWillBeSent postData for /translate requests
          if (msg.method === 'Network.requestWillBeSent') {
            const url = msg.params?.request?.url || '';
            if (url.includes('/translate')) {
              const method = msg.params?.request?.method || '';
              const body = msg.params?.request?.postData || '';
              console.log(`\n*** TRANSLATE REQUEST CAPTURED ***`);
              console.log(`  Method: ${method}`);
              console.log(`  URL: ${url.slice(0, 120)}`);
              console.log(`  Body: ${body.slice(0, 500)}`);
            }
          }
        } catch {}
      });
      ws.on('error', () => {});
    });
    
    const start = Date.now();
    const interval = setInterval(() => {
      const elapsed = Math.floor((Date.now() - start) / 1000);
      process.stdout.write(`\r[${elapsed}s] Total msgs: ${totalMsgs} | CSA=${capturedCSA ? 'YES' : 'no'} IC3=${capturedIC3 ? 'YES' : 'no'} | Click vao Teams...   `);
    }, 3000);
    
    setTimeout(() => {
      clearInterval(interval);
      console.log('\n\nTimeout 120s. CSA token:', capturedCSA ? 'CAPTURED (len=' + capturedCSA.length + ')' : 'NOT captured');
      if (!capturedCSA) console.log('Teams khong tra ve CHATSVCAGG token trong 120s - can user tuong tac nhieu hon.');
      process.exit(0);
    }, 180000);
  });
}).on('error', e => console.error('HTTP error:', e.message));
