/**
 * webchat-preload.js — Anti-detection cho BrowserWindow webchat
 *
 * Chạy TRƯỚC khi page JS load. Override các signal mà bot-detection check.
 * Không phải bulletproof — chỉ qua được basic Cloudflare/MS challenges.
 */

// 1. Xóa flag navigator.webdriver (Selenium/Puppeteer default = true)
try {
  Object.defineProperty(navigator, 'webdriver', {
    get: () => undefined,
    configurable: true,
  });
} catch {}

// 2. Đảm bảo navigator.plugins không rỗng (Electron mặc định rỗng)
try {
  if (!navigator.plugins || navigator.plugins.length === 0) {
    Object.defineProperty(navigator, 'plugins', {
      get: () => [
        { name: 'PDF Viewer', filename: 'internal-pdf-viewer', description: 'Portable Document Format' },
        { name: 'Chrome PDF Viewer', filename: 'internal-pdf-viewer', description: 'Portable Document Format' },
        { name: 'Chromium PDF Viewer', filename: 'internal-pdf-viewer', description: 'Portable Document Format' },
        { name: 'Microsoft Edge PDF Viewer', filename: 'internal-pdf-viewer', description: 'Portable Document Format' },
        { name: 'WebKit built-in PDF', filename: 'internal-pdf-viewer', description: 'Portable Document Format' },
      ],
      configurable: true,
    });
  }
} catch {}

// 3. navigator.languages: 'en-US' + 'en' đủ giống real browser
try {
  Object.defineProperty(navigator, 'languages', {
    get: () => ['en-US', 'en', 'vi'],
    configurable: true,
  });
} catch {}

// 4. window.chrome — phải có (Electron không có by default)
try {
  if (!window.chrome) {
    window.chrome = {
      runtime: {}, app: {}, csi: () => {}, loadTimes: () => {},
    };
  }
} catch {}

// 5. permissions API quirk — Notification.permission phải khớp với permissions.query
try {
  const origQuery = navigator.permissions && navigator.permissions.query;
  if (origQuery) {
    navigator.permissions.query = (params) => {
      if (params && params.name === 'notifications') {
        return Promise.resolve({ state: Notification.permission });
      }
      return origQuery.call(navigator.permissions, params);
    };
  }
} catch {}

// 6. Ẩn dấu vết Electron trong process info (renderer side)
try { delete window.process; } catch {}
try { delete window.require; } catch {}
try { delete window.electron; } catch {}

// 7. WebGL vendor/renderer giả lập Intel/AMD GPU thật (Electron thường lộ "SwiftShader")
try {
  const getParam = WebGLRenderingContext.prototype.getParameter;
  WebGLRenderingContext.prototype.getParameter = function (p) {
    if (p === 37445) return 'Intel Inc.';        // UNMASKED_VENDOR_WEBGL
    if (p === 37446) return 'Intel Iris OpenGL Engine'; // UNMASKED_RENDERER_WEBGL
    return getParam.call(this, p);
  };
} catch {}

console.log('[webchat-preload] stealth overrides applied');
