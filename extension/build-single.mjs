// build-single.mjs — sinh bản gộn `extension-single/` TỪ `extension/` (1 nguồn duy nhất).
//   • app.js  : esbuild bundle entry `app.js` (kéo theo lib/*.js + SDK genai.mjs) → 1 file IIFE.
//   • panel.html : nhúng sidepanel.css vào <style>, đổi <script type=module> → script thường.
// Chạy:  npm i -D esbuild   &&   node extension/build-single.mjs
import esbuild from 'esbuild';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = dirname(fileURLToPath(import.meta.url));               // .../extension
const OUT = resolve(SRC, '..', 'extension-single');
mkdirSync(OUT, { recursive: true });

await esbuild.build({
  entryPoints: [resolve(SRC, 'app.js')],
  bundle: true, format: 'iife', platform: 'browser', conditions: ['browser'],
  legalComments: 'none', outfile: resolve(OUT, 'app.js'),
});

let html = readFileSync(resolve(SRC, 'sidepanel.html'), 'utf8');
const css = readFileSync(resolve(SRC, 'sidepanel.css'), 'utf8');
html = html
  .replace('<link rel="stylesheet" href="sidepanel.css" />', `<style>\n${css}\n</style>`)
  .replace('<script type="module" src="app.js"></script>', '<script src="app.js"></script>');
writeFileSync(resolve(OUT, 'panel.html'), html);

// manifest.json: SINH từ manifest nguồn → version + permissions + host_permissions LUÔN đồng bộ (tránh drift kiểu quên desktopCapture).
// Chỉ override phần đặc thù bản single (tên/mô tả + panel.html). ID/version/quyền lấy nguyên từ extension/manifest.json.
const srcManifest = JSON.parse(readFileSync(resolve(SRC, 'manifest.json'), 'utf8'));
const singleManifest = {
  ...srcManifest,
  name: 'Caption Translator (single-file)',
  description: 'Bản gộn tối giản: dịch hội thoại realtime qua Gemini Live. 3 file: manifest + panel.html + app.js (đã nhúng SDK).',
  action: { default_title: 'Caption Translator — chuột phải icon → Open side panel' },
  side_panel: { default_path: 'panel.html' },
};
delete singleManifest.background;   // bản single KHÔNG có background.js (mở panel bằng chuột-phải icon) → bỏ để khỏi lỗi "SW không tìm thấy"
writeFileSync(resolve(OUT, 'manifest.json'), JSON.stringify(singleManifest, null, 2) + '\n');

console.log(`extension-single/ built (manifest v${srcManifest.version} + app.js + panel.html) from extension/.`);
