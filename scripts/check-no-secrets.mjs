#!/usr/bin/env node
// 发布前检查：确认 tarball 里没有任何本机凭证或配置。
// 由 package.json 的 prepublishOnly 调用，也可单独运行。

import { execFileSync } from 'node:child_process';
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

function pack(cacheArgs) {
  return execFileSync('npm', ['pack', '--dry-run', '--json', '--ignore-scripts', ...cacheArgs], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

let raw;
try {
  raw = pack([]);
} catch (err) {
  // 某些环境的 ~/.npm 缓存权限损坏（EACCES），退回临时缓存重试
  try {
    raw = pack(['--cache', join(tmpdir(), 'cred-pack-cache')]);
  } catch (err2) {
    console.error('✗ 无法运行 npm pack --dry-run:', err2.message);
    process.exit(1);
  }
}

const parsed = JSON.parse(raw);
const files = (parsed[0]?.files ?? []).map((f) => f.path);

if (files.length === 0) {
  console.error('✗ 打包结果为空，检查 package.json 的 files 字段');
  process.exit(1);
}

const leaks = files.filter((p) => SECRET_PATTERNS.some((re) => re.test(p)));

if (leaks.length > 0) {
  console.error('✗ 拒绝发布：tarball 里包含本机配置或凭证：');
  for (const f of leaks) console.error(`   - ${f}`);
  process.exit(1);
}

console.log(`✓ 发布检查通过：${files.length} 个文件，未发现本机凭证`);
for (const f of files) console.log(`   ${f}`);
