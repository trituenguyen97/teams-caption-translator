#!/usr/bin/env node
// Chốt phiên bản x.y.z rồi đẩy tag → GitHub Actions build bản cài Windows + đưa lên VPS (update.gin.info.vn).
//
//   npm run release -- patch            # z+1: sửa lỗi
//   npm run release -- minor            # y+1: thay đổi vừa/nhỏ
//   npm run release -- major            # x+1: thay đổi lớn
//   npm run release -- patch "Sửa A" "Thêm B"   # ghi chú truyền thẳng (bỏ qua mục [Unreleased])
//   thêm --dry để xem trước, không commit/tag/push.
//
// Ghi chú thay đổi: lấy từ mục "## [Unreleased]" trong CHANGELOG.md (gạch đầu dòng), hoặc từ tham số.
// Ghi chú này hiện trong app (Cài đặt → Phiên bản) khi người dùng có bản mới.
import fs from 'node:fs';
import { execSync } from 'node:child_process';

const args = process.argv.slice(2);
const dry = args.includes('--dry');
const rest = args.filter(a => a !== '--dry');
const kind = rest.shift();
if (!['patch', 'minor', 'major'].includes(kind)) {
  console.error('Dùng: npm run release -- <patch|minor|major> ["ghi chú 1" "ghi chú 2" ...] [--dry]');
  process.exit(1);
}
const sh = (c, o = {}) => execSync(c, { stdio: o.quiet ? 'pipe' : 'inherit', encoding: 'utf8' });
const out = c => execSync(c, { encoding: 'utf8' }).trim();

if (!dry && out('git status --porcelain')) { console.error('✖ Working tree chưa sạch — commit/stash trước khi release.'); process.exit(1); }

const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
const [M, m, p] = pkg.version.split('.').map(n => parseInt(n, 10) || 0);
const next = kind === 'major' ? `${M + 1}.0.0` : kind === 'minor' ? `${M}.${m + 1}.0` : `${M}.${m}.${p + 1}`;
if (out(`git tag -l v${next}`)) { console.error(`✖ Tag v${next} đã tồn tại.`); process.exit(1); }

// ── Ghi chú thay đổi ──
const CL = 'CHANGELOG.md';
let cl = fs.existsSync(CL) ? fs.readFileSync(CL, 'utf8') : '# Changelog\n\n## [Unreleased]\n';
const UNREL = /^## \[Unreleased\][^\n]*\n([\s\S]*?)(?=^## |\s*$(?![\s\S]))/m;
let notes;
if (rest.length) notes = rest.map(s => `- ${s.replace(/^-\s*/, '')}`).join('\n');
else { const mm = cl.match(UNREL); notes = mm ? mm[1].trim() : ''; }
if (!notes) { console.error('✖ Chưa có ghi chú thay đổi: thêm gạch đầu dòng dưới "## [Unreleased]" trong CHANGELOG.md hoặc truyền làm tham số.'); process.exit(1); }

const date = new Date().toISOString().slice(0, 10);
const section = `## ${next} — ${date}\n\n${notes}\n`;
if (UNREL.test(cl)) cl = cl.replace(UNREL, `## [Unreleased]\n\n${section}\n`);
else cl = cl.replace(/^(# [^\n]*\n)/, `$1\n## [Unreleased]\n\n${section}\n`);

console.log(`\n${pkg.version} → ${next} (${kind})\n\n${notes}\n`);
if (dry) { console.log('(--dry: không ghi gì)'); process.exit(0); }

fs.writeFileSync(CL, cl.replace(/\n{3,}/g, '\n\n'));
sh(`npm version ${next} --no-git-tag-version`, { quiet: true });   // package.json + package-lock.json
sh(`git add package.json package-lock.json ${CL}`);
sh(`git commit -q -m "release: v${next}"`);
sh(`git tag -a v${next} -m "v${next}"`);
const branch = out('git rev-parse --abbrev-ref HEAD');
sh(`git push origin ${branch}`);
sh(`git push origin v${next}`);
console.log(`\n✓ Đã đẩy tag v${next} — GitHub Actions sẽ build và đưa lên VPS (tab Actions trên GitHub).`);
