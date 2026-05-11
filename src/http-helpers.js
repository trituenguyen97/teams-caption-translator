/**
 * http-helpers.js — HTTP/HTTPS client helpers
 */
const http = require('http');
const https = require('https');

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

function httpsPost(hostname, path, headers, body) {
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
    req.setTimeout(15000, () => { req.destroy(); resolve({ status: 0, headers: {}, body: '' }); });
    req.write(buf);
    req.end();
  });
}

function httpsGet(hostname, path, headers) {
  return new Promise((resolve) => {
    const req = https.request(
      { hostname, path, method: 'GET', headers },
      (res) => {
        const chunks = [];
        res.on('data', c => chunks.push(c));
        res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString() }));
      }
    );
    req.on('error', () => resolve({ status: 0, body: '' }));
    req.setTimeout(15000, () => { req.destroy(); resolve({ status: 0, body: '' }); });
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

module.exports = { httpGetLocal, httpsPost, httpsGet, scanBrowserTabs };
