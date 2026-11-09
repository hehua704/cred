#!/usr/bin/env node
// 发布前检查：确认 tarball 里没有任何本机凭证或配置。
// 由 package.json 的 prepublishOnly 调用，也可单独运行（npm run check:leak）。
//
// 注意：不同 npm 大版本的 `npm pack --dry-run --json` 输出不一致
// （npm 12 在部分环境返回空数组），所以这里改为真实打包 + 解压列表，
// 再用 `npm pack --dry-run --json` 作为兜底。

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const SECRET_PATTERNS = [
  /(^|\/)\.cred(\/|$)/,
  /(^|\/)\.cred-[^/]+/,
  /(^|\/)\.dsh-publish(\/|$)/,
  /(^|\/)meta\.json$/,
  /(^|\/)config\.toml$/,
  /(^|\/)[^/]*-token$/,
  /(^|\/)\.env(\.|$)/,
  /\.pem$/,
  /\.key$/,
];

// 某些环境（如本机）默认 ~/.npm 缓存权限损坏，统一用临时缓存避免 EACCES
const NPM_CACHE = join(tmpdir(), 'cred-npm-cache');

function listViaTarball() {
  const dir = mkdtempSync(join(tmpdir(), 'cred-pack-'));
  try {
    const out = execFileSync(
      'npm',
      ['pack', '--pack-destination', dir, '--ignore-scripts', '--silent', '--cache', NPM_CACHE],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
    );
    const name = out.trim().split('\n').filter(Boolean).pop();
    const tgz = join(dir, name ?? readdirSync(dir)[0]);
    const listing = execFileSync('tar', ['-tzf', tgz], { encoding: 'utf8' });
    return listing
      .split('\n')
      .filter((l) => l && !l.endsWith('/'))
      .map((l) => l.replace(/^package\//, ''));
  } finally {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
}

function listViaJson() {
  const raw = execFileSync('npm', ['pack', '--dry-run', '--json', '--ignore-scripts', '--cache', NPM_CACHE], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const parsed = JSON.parse(raw);
  return (parsed[0]?.files ?? []).map((f) => f.path);
}

let files;
let method;
try {
  files = listViaTarball();
  method = 'tarball';
} catch {
  try {
    files = listViaJson();
    method = 'json';
  } catch (err) {
    console.error('✗ 无法生成打包清单:', err.message);
    process.exit(1);
  }
}

if (!files || files.length === 0) {
  console.error('✗ 打包结果为空，检查 package.json 的 files 字段');
  process.exit(1);
}

const leaks = files.filter((p) => SECRET_PATTERNS.some((re) => re.test(p)));

if (leaks.length > 0) {
  console.error('✗ 拒绝发布：tarball 里包含本机配置或凭证：');
  for (const f of leaks) console.error(`   - ${f}`);
  process.exit(1);
}

console.log(`✓ 发布检查通过：${files.length} 个文件（${method}），未发现本机凭证`);
for (const f of files.sort()) console.log(`   ${f}`);
