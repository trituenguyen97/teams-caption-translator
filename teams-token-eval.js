/**
 * teams-token-eval.js
 * Tim token CHATSVCAGG tu Teams page internals 
 */
const WebSocket = require('ws');
const http = require('http');

http.get({ hostname: '127.0.0.1', port: 9222, path: '/json/list' }, res => {
  let d = ''; res.on('data', c => d += c); res.on('end', () => {
    const ts = JSON.parse(d).filter(t => t.type === 'page' && t.webSocketDebuggerUrl);
    if (!ts.length) { console.log('No page'); process.exit(1); }
    console.log('Connecting to:', ts[0].title, ts[0].url.slice(0, 60));
    
    const ws = new WebSocket(ts[0].webSocketDebuggerUrl);
    ws.on('open', () => {
      ws.send(JSON.stringify({ id: 1, method: 'Runtime.enable' }));
      setTimeout(() => {
        // Tiem 1: Xem Teams globals chua auth
        ws.send(JSON.stringify({ id: 100, method: 'Runtime.evaluate', params: {
          expression: `(function() {
            const keys = Object.keys(window);
            const authKeys = keys.filter(k => /auth|token|msal|skype|bearer/i.test(k));
            // Tim webpack module registry
            const chunkKey = keys.find(k => k.startsWith('webpackChunk'));
            // Tim truc tiep
            const checks = {};
            ['skypeToken', 'SkypeToken', 'accessToken', '__TEAMS_TOKEN__', '__authToken__'].forEach(k => {
              if (window[k]) checks[k] = String(window[k]).slice(0, 50);
            });
            // Tim MSAL
            let msalInfo = 'no-msal';
            if (window?.__msal__) msalInfo = 'window.__msal__ found';
            if (window?.msal) msalInfo = 'window.msal found';
            // Tim trong window.module
            const moduleInfo = typeof window.require !== 'undefined' ? 'has-require' : 'no-require';
            return JSON.stringify({ authKeys: authKeys.slice(0, 20), chunkKey, checks, msalInfo, moduleInfo });
          })()`,
          returnByValue: true
        }}));
        
        // Tiem 2: Xem co the goi truc tiep qua module system
        ws.send(JSON.stringify({ id: 101, method: 'Runtime.evaluate', params: {
          expression: `(async function() {
            // Thu find authentication service qua Teams internals
            const result = {};
            
            // Method 1: window.__TEAMS_CONFIG__
            if (window.__TEAMS_CONFIG__) {
              result.teamsConfig = JSON.stringify(Object.keys(window.__TEAMS_CONFIG__)).slice(0, 100);
            }
            
            // Method 2: Dan truoc dom  
            const metaToken = document.querySelector('meta[name="token"]');
            if (metaToken) result.metaToken = metaToken.content?.slice(0, 50);
            
            // Method 3: Cookie
            result.cookies = document.cookie.slice(0, 200);
            
            // Method 4: Tim qua JS scope chain (risky)
            // Teams co the bind auth functions vao Object.prototype
            
            // Method 5: Check window.performance (timing)
            const navEntries = performance.getEntriesByType('resource')
              .filter(e => e.name.includes('/api/csa/'))
              .slice(0, 3)
              .map(e => e.name.slice(0, 80));
            result.csaRequests = navEntries;
            
            return JSON.stringify(result);
          })()`,
          awaitPromise: true,
          returnByValue: true
        }}));
      }, 500);
    });
    
    ws.on('message', raw => {
      const msg = JSON.parse(raw);
      if (msg.id === 100) {
        console.log('\n--- Window globals ---');
        try { console.log(JSON.stringify(JSON.parse(msg.result?.result?.value), null, 2)); }
        catch { console.log(msg.result?.result?.value); }
      }
      if (msg.id === 101) {
        console.log('\n--- Teams internals ---');
        try { console.log(JSON.stringify(JSON.parse(msg.result?.result?.value), null, 2)); }
        catch { console.log(msg.result?.result?.value); }
        ws.close();
        process.exit(0);
      }
    });
    
    ws.on('error', e => { console.error(e.message); process.exit(1); });
    setTimeout(() => { ws.close(); process.exit(0); }, 8000);
  });
}).on('error', e => console.error(e.message));
