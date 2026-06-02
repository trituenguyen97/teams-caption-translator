/**
 * http-helpers.js — HTTP/HTTPS client helpers
 */
const http = require('http');
const https = require('https');

// Keep-alive agent dùng cho local LLM (giảm overhead bắt tay TCP mỗi câu)
const _localAgent = new http.Agent({ keepAlive: true, maxSockets: 4, keepAliveMsecs: 30000 });

function httpGetLocal(port, urlPath) {
  return new Promise((resolve) => {
    const req = http.get({ hostname: '127.0.0.1', port, path: urlPath }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => resolve(data));
    });
    req.setTimeout(800, () => { req.destroy(); resolve(null); });
    req.on('error', () => resolve(null));
  });
}

function parseLocalUrl(url) {
  try {
    const u = new URL(url);
    return {
      hostname: u.hostname || '127.0.0.1',
      port: Number(u.port) || (u.protocol === 'https:' ? 443 : 80),
      basePath: u.pathname.replace(/\/+$/, ''),
      isHttps: u.protocol === 'https:',
    };
  } catch {
    return { hostname: '127.0.0.1', port: 8080, basePath: '', isHttps: false };
  }
}

function httpPostLocal(url, path, headers, body, timeoutMs = 30000) {
  const { hostname, port, basePath, isHttps } = parseLocalUrl(url);
  return new Promise((resolve) => {
    const buf = Buffer.isBuffer(body) ? body : Buffer.from(body);
    const lib = isHttps ? https : http;
    const opts = {
      hostname, port, path: basePath + path, method: 'POST',
      headers: { ...headers, 'Content-Length': buf.length, 'Connection': 'keep-alive' },
    };
    if (!isHttps) opts.agent = _localAgent;
    const req = lib.request(opts, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString() }));
    });
    req.on('error', (e) => resolve({ status: 0, headers: {}, body: '', error: e.message }));
    req.setTimeout(timeoutMs, () => { req.destroy(); resolve({ status: 0, headers: {}, body: '', error: 'timeout' }); });
    req.write(buf);
    req.end();
  });
}

function httpGetLocalUrl(url, path, timeoutMs = 3000) {
  const { hostname, port, basePath, isHttps } = parseLocalUrl(url);
  return new Promise((resolve) => {
    const lib = isHttps ? https : http;
    const opts = { hostname, port, path: basePath + path, method: 'GET', headers: { 'Connection': 'keep-alive' } };
    if (!isHttps) opts.agent = _localAgent;
    const req = lib.request(opts, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString() }));
    });
    req.on('error', () => resolve({ status: 0, body: '' }));
    req.setTimeout(timeoutMs, () => { req.destroy(); resolve({ status: 0, body: '' }); });
    req.end();
  });
}

function httpsPost(hostname, path, headers, body, timeoutMs = 15000) {
  return new Promise((resolve) => {
    const buf = Buffer.isBuffer(body) ? body : Buffer.from(body);
    const req = https.request(
      { hostname, path, method: 'POST', headers: { ...headers, 'Content-Length': buf.length } },
      (res) => {
        const chunks = [];
        res.on('data', c => chunks.push(c));
        res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString() }));
      }
    );
    req.on('error', () => resolve({ status: 0, headers: {}, body: '' }));
    req.setTimeout(timeoutMs, () => { req.destroy(); resolve({ status: 0, headers: {}, body: '' }); });
    req.write(buf);
    req.end();
  });
}

function httpsGet(hostname, path, headers, timeoutMs = 15000) {
  return new Promise((resolve) => {
    const req = https.request(
      { hostname, path, method: 'GET', headers },
      (res) => {
        const chunks = [];
        res.on('data', c => chunks.push(c));
        res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString() }));
      }
    );
    req.on('error', () => resolve({ status: 0, headers: {}, body: '' }));
    req.setTimeout(timeoutMs, () => { req.destroy(); resolve({ status: 0, headers: {}, body: '' }); });
    req.end();
  });
}

async function scanBrowserTabs() {
  const tabs = [];
  for (let port = 9222; port <= 9240; port++) {
    const raw = await httpGetLocal(port, '/json/list');
    if (!raw) continue;
    try {
      const list = JSON.parse(raw);
      for (const t of list) {
        if (t.type === 'page') {
          tabs.push({
            port, id: t.id || '', title: t.title || '',
            url: t.url || '', favIconUrl: t.favIconUrl || '',
          });
        }
      }
    } catch {}
  }
  return tabs;
}

module.exports = {
  httpGetLocal, httpsPost, httpsGet, scanBrowserTabs,
  httpPostLocal, httpGetLocalUrl, parseLocalUrl,
};
