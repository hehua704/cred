#!/usr/bin/env node
import React from 'react';
import { render } from 'ink';
import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync, cpSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';

import { createStore } from './store.js';
import { createT, resolveLocale, AVAILABLE, SUPPORTED } from './i18n.js';
import { readConfig, writeConfig } from './config.js';
import { findPlatform, PLATFORMS } from './platforms.js';
import type { Platform } from './types.js';
import { verify } from './verify.js';
import { Screen, statusView, theme, ago, expiryText } from './ui/Screen.js';
import { App } from './ui/App.js';
import { pad } from './width.js';
import type { ScreenState } from './types.js';

// 版本号从 package.json 读取，避免与 dist 里的常量不一致
const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
  version: string;
};
const VERSION = pkg.version;
const ENV_PREFIX = 'CRED_';

// 平台 -> 环境变量名（给 cred env 用）
const ENV_VARS: Record<string, string> = {
  github: 'GITHUB_TOKEN',
  npm: 'NPM_TOKEN',
  pypi: 'PYPI_TOKEN',
  crates: 'CARGO_REGISTRY_TOKEN',
};

const FLAGS_WITH_VALUE = new Set(['--dir', '--lang', '--width', '--from', '--field', '--format']);

interface Parsed {
  flags: Map<string, string | true>;
  pos: string[];
}

function parseArgs(input: string[]): Parsed {
  const flags = new Map<string, string | true>();
  const pos: string[] = [];
  for (let i = 0; i < input.length; i++) {
    const a = input[i];
    if (a.startsWith('--')) {
      if (FLAGS_WITH_VALUE.has(a)) {
        flags.set(a, input[++i] ?? '');
      } else {
        flags.set(a, true);
      }
    } else if (a.startsWith('-') && a.length === 2) {
      flags.set(a, true);
    } else {
      pos.push(a);
    }
  }
  return { flags, pos };
}

const { flags, pos: positionals } = parseArgs(process.argv.slice(2));
const has = (n: string) => flags.has(n);
const val = (n: string) => {
  const v = flags.get(n);
  return typeof v === 'string' ? v : null;
};

// 全局默认目录（不在任何项目里时使用）
const CONFIG_HOME = process.env.XDG_CONFIG_HOME || join(homedir(), '.config');
const GLOBAL_CFG = join(CONFIG_HOME, 'cred', 'config.json');

function readGlobalConfig(): { defaultDir?: string } {
  try {
    return JSON.parse(readFileSync(GLOBAL_CFG, 'utf8')) as { defaultDir?: string };
  } catch {
    return {};
  }
}

function writeGlobalConfig(cfg: { defaultDir?: string }): boolean {
  try {
    mkdirSync(join(CONFIG_HOME, 'cred'), { recursive: true, mode: 0o700 });
    writeFileSync(GLOBAL_CFG, JSON.stringify(cfg, null, 2) + '\n', { mode: 0o600 });
    return true;
  } catch {
    return false;
  }
}

// 数据目录解析顺序：
//   1. --dir
//   2. CRED_DIR
//   3. 当前目录的 ./.cred（项目内配置）
//   4. cred use 设置的全局默认目录
//   5. ~/.cred（存在时）
//   6. 回退到 ./.cred（由 cred init 创建）
function resolveDir(): string {
  const explicit = val('--dir') ?? process.env[`${ENV_PREFIX}DIR`];
  if (explicit) return resolve(expandHome(explicit));

  const local = join(process.cwd(), '.cred');
  if (existsSync(local)) return local;

  const fallback = readGlobalConfig().defaultDir;
  if (fallback) {
    const p = resolve(expandHome(fallback));
    if (existsSync(p)) return p;
  }

  const globalDir = join(homedir(), '.cred');
  if (existsSync(globalDir)) return globalDir;
  return local;
}

const DIR = resolveDir();
const CONFIG_PATH = join(DIR, 'config.toml');
const config = readConfig(CONFIG_PATH);

const locale = resolveLocale({
  flag: val('--lang'),
  env: process.env[`${ENV_PREFIX}LANG`] ?? process.env.DSH_LANG,
  config,
  sys: process.env.LC_ALL || process.env.LANG,
});

const envLang = `${process.env.LC_ALL ?? ''} ${process.env.LANG ?? ''}`.trim();
const autoAscii = envLang.length > 0 && !/utf-?8/i.test(envLang);
const ascii = has('--ascii') || autoAscii;

const t = createT(locale, config.fallback ?? 'en');

function usage(): string {
  return `${t('app.brand')} ${VERSION} — ${t('app.title')}

  cred                        ${t('app.title')}
  cred init                   create ./.cred (mode 700) and config.toml
  cred init --from <dir>      import tokens from another directory
  cred use [dir]              set/show the default store (works from anywhere)
  cred use --unset            clear the default store

  cred list [platform...]     list credentials (--json for machine output)
  cred get <platform...>      print token(s); "all" = every configured one
  cred get <p> --json         single object, or array when multiple targets
  cred get <p...> --format    plain | env | json   (default plain, tab-separated)
  cred get <p> --field        token | expiresAt | user
  cred has <platform...>      exit 0 only if every target exists
  cred env [platform...]      print GITHUB_TOKEN=... lines (--export for eval)
  cred recheck                verify all and write meta.json

  cred copy <platform>        copy token via OSC 52
  cred show <platform>        print token (same as get)
  echo '...' | cred set <platform>

  cred --lang <locale>        ${SUPPORTED.join(' | ')} | auto
  cred --dir <path>           data directory (default ./.cred)
  cred --width <cols>         override width (preview)
  cred --ascii                force ASCII box drawing
  cred -h, --help             this help
  cred -v, --version          version

data dir: ${DIR}   (${ENV_PREFIX}DIR=${process.env[`${ENV_PREFIX}DIR`] ?? '-'})
platforms: ${PLATFORMS.map((p) => p.key).join(' | ')}
locales:   ${AVAILABLE.map((e) => e.code).join(' | ')}
`;
}

function columns(): number {
  const w = val('--width');
  return w ? Number(w) : process.stdout.columns ?? 80;
}

// Windows 上用户常写 ~/x 或 ~\\x，统一展开
function expandHome(p: string): string {
  if (p === '~') return homedir();
  if (p.startsWith('~/') || p.startsWith('~\\')) return join(homedir(), p.slice(2));
  return p;
}

function resolveTargets(names: string[]): Platform[] {
  if (names.length === 0) return [];
  if (names.length === 1 && names[0].toLowerCase() === 'all') return PLATFORMS;
  const out: Platform[] = [];
  for (const n of names) {
    const p = findPlatform(n);
    if (!p) fail(`unknown platform: ${n}`, 2);
    out.push(p);
  }
  return out;
}

// 当前目录没配置时，找找附近有没有别的 .cred，避免用户以为 token 丢了
function suggestOtherStores(): void {
  const found: string[] = [];
  const roots = [process.cwd()];
  try {
    for (const ent of readdirSync(process.cwd(), { withFileTypes: true })) {
      if (ent.isDirectory() && !ent.name.startsWith('.') && ent.name !== 'node_modules') {
        roots.push(join(process.cwd(), ent.name));
      }
    }
  } catch {
    /* ignore */
  }
  for (const root of roots) {
    const d = join(root, '.cred');
    if (resolve(d) === resolve(DIR)) continue;
    if (!existsSync(d)) continue;
    const n = PLATFORMS.filter((pl) => existsSync(join(d, pl.file))).length;
    if (n > 0) found.push(`${d}  (${n} 个 token)`);
  }
  if (found.length > 0) {
    console.error(`\n提示：当前目录没有配置，但发现了其他凭证目录：`);
    for (const f of found) console.error(`  ${f}`);
    console.error(`用 --dir <path> 或 export CRED_DIR=<path> 指定。`);
  }
}

function fail(msg: string, code = 1): never {
  console.error(msg);
  process.exit(code);
}

function initDir(): string {
  const explicit = val('--dir') ?? process.env[`${ENV_PREFIX}DIR`];
  if (explicit) return resolve(expandHome(explicit));
  // init 的语义就是“在当前项目建一个”，绝不回退到全局默认目录，
  // 否则在空目录里 init 会误改其他项目的凭证库。
  return join(process.cwd(), '.cred');
}

function cmdInit(): void {
  const from = val('--from');
  const DIR = initDir();
  mkdirSync(DIR, { recursive: true, mode: 0o700 });
  try {
    chmodSync(DIR, 0o700);
  } catch {
    /* ignore */
  }
  // 防止 token 被提交：目录内自带 .gitignore
  const gitignore = join(DIR, '.gitignore');
  if (!existsSync(gitignore)) writeFileSync(gitignore, '*\n!.gitignore\n', { mode: 0o600 });
  if (!existsSync(CONFIG_PATH)) writeConfig(CONFIG_PATH, { locale: 'auto', fallback: 'en' });

  if (from) {
    const src = resolve(expandHome(from));
    if (!existsSync(src)) fail(`source not found: ${src}`);
    let n = 0;
    for (const p of PLATFORMS) {
      const f = join(src, p.file);
      if (existsSync(f)) {
        cpSync(f, join(DIR, p.file));
        try {
          chmodSync(join(DIR, p.file), 0o600);
        } catch {
          /* ignore */
        }
        n++;
      }
    }
    const metaSrc = join(src, 'meta.json');
    if (existsSync(metaSrc) && !existsSync(join(DIR, 'meta.json'))) {
      cpSync(metaSrc, join(DIR, 'meta.json'));
      try {
        chmodSync(join(DIR, 'meta.json'), 0o600);
      } catch {
        /* ignore */
      }
    }
    console.log(`${DIR} ready, imported ${n} token(s) from ${src}`);
  } else {
    console.log(`${DIR} ready`);
  }
}

function cmdUse(): void {
  const arg = positionals[1];
  if (!arg) {
    const cfg = readGlobalConfig();
    console.log(`默认目录: ${cfg.defaultDir ?? '(未设置)'}`);
    console.log(`本次解析: ${DIR}`);
    console.log(`配置文件: ${GLOBAL_CFG}`);
    return;
  }
  if (arg === '--unset' || arg === 'unset') {
    const ok = writeGlobalConfig({});
    console.log(ok ? '已清除默认目录' : `写入失败: ${GLOBAL_CFG}`);
    return;
  }
  const target = resolve(expandHome(arg));
  if (!existsSync(target)) fail(`目录不存在: ${target}`);
  if (!writeGlobalConfig({ defaultDir: target })) fail(`写入失败: ${GLOBAL_CFG}`);
  console.log(`默认目录已设为: ${target}`);
  console.log('现在从任何目录运行 cred 都会用它。');
}

function cmdGet(): void {
  const targets = resolveTargets(positionals.slice(1));
  if (targets.length === 0) fail('usage: cred get <platform...>  (支持 all)', 2);

  const store = createStore(DIR);
  const meta = store.readMeta();
  const found: Array<{ platform: string; token: string; expiresAt: string | null; updatedAt: string | null; user: string | null }> = [];
  const missing: string[] = [];

  for (const p of targets) {
    const tok = store.readToken(p.file);
    if (!tok) {
      missing.push(p.key);
      continue;
    }
    const m = meta[p.file] ?? {};
    found.push({
      platform: p.key,
      token: tok,
      expiresAt: m.expiresAt ?? null,
      updatedAt: m.updatedAt ?? null,
      user: m.lastStatus?.user ?? null,
    });
  }

  if (found.length === 0) {
    suggestOtherStores();
    fail(`no token for: ${missing.join(', ')}`);
  }
  if (missing.length > 0) console.error(`missing: ${missing.join(', ')}`);

  const field = val('--field');
  if (has('--json')) {
    const payload = targets.length === 1 && found.length === 1 ? found[0] : found;
    process.stdout.write(JSON.stringify(payload) + '\n');
    return;
  }

  if (targets.length === 1 && found.length === 1) {
    const row = found[0];
    if (field === 'expiresAt') console.log(row.expiresAt ?? '');
    else if (field === 'user') console.log(row.user ?? '');
    else console.log(row.token);
    return;
  }

  const fmt = val('--format') ?? 'plain';
  for (const row of found) {
    if (fmt === 'env') console.log(`${ENV_VARS[row.platform]}='${row.token}'`);
    else if (fmt === 'json') console.log(JSON.stringify(row));
    else console.log(`${row.platform}\t${row.token}`);
  }
}

function cmdHas(): void {
  const targets = resolveTargets(positionals.slice(1));
  if (targets.length === 0) process.exit(2);
  const store = createStore(DIR);
  const missing = targets.filter((p) => !store.readToken(p.file)).map((p) => p.key);
  if (missing.length > 0) {
    console.error(`missing: ${missing.join(', ')}`);
    process.exit(1);
  }
  process.exit(0);
}

function cmdEnv(): void {
  const names = positionals.slice(1);
  const targets = names.length > 0 ? resolveTargets(names) : PLATFORMS;
  const store = createStore(DIR);
  const prefix = has('--export') ? 'export ' : '';
  let count = 0;
  for (const p of targets) {
    const tok = store.readToken(p.file);
    if (!tok) continue;
    console.log(`${prefix}${ENV_VARS[p.key]}='${tok}'`);
    count++;
  }
  if (count === 0) fail(`no tokens in ${DIR}`);
}

async function main(): Promise<void> {
  const cmd = positionals[0] ?? '';

  if (has('--help') || has('-h') || cmd === 'help') {
    console.log(usage());
    return;
  }
  if (has('--version') || has('-v') || cmd === 'version') {
    console.log(VERSION);
    return;
  }

  if (cmd === 'init') {
    cmdInit();
    return;
  }

  if (cmd === 'use') {
    cmdUse();
    return;
  }

  if (cmd === 'get' || cmd === 'show') {
    cmdGet();
    return;
  }
  if (cmd === 'has') {
    cmdHas();
    return;
  }
  if (cmd === 'env') {
    cmdEnv();
    return;
  }

  if (!existsSync(DIR)) {
    if (cmd === 'set' || has('--preview') || has('--preview-lang')) {
      mkdirSync(DIR, { recursive: true, mode: 0o700 });
    } else {
      suggestOtherStores();
      fail(
        `${DIR} 不存在。\n在当前项目初始化: cred init\n或指定已有目录: cred --dir <path> / export CRED_DIR=<path>`,
      );
    }
  }

  const store = createStore(DIR);

  if (cmd === 'set') {
    const name = positionals[1];
    const p = findPlatform(name ?? '');
    if (!p) fail(`unknown platform: ${name}`);
    const tok = readFileSync(0, 'utf8').trim();
    if (!tok) fail('empty stdin');
    if (!store.saveToken(p.file, tok)) fail(t('msg.writeFail', { code: 'EACCES' }));
    const prev = store.readMeta()[p.file] ?? {};
    const now = new Date().toISOString();
    const patch: Record<string, unknown> = {
      createdAt: prev.createdAt ?? now,
      updatedAt: now,
      lastStatus: null,
    };
    if (!prev.expiresAt && p.defaultExpiryDays) {
      patch.expiresAt = new Date(Date.now() + p.defaultExpiryDays * 86400000).toISOString().slice(0, 10);
    }
    store.setMeta(p.file, patch as never);
    console.log(`${p.label}: saved ${tok.length} chars (mode 600) -> ${join(DIR, p.file)}`);
    return;
  }

  if (cmd === 'copy') {
    const name = positionals[1];
    const p = findPlatform(name ?? '');
    if (!p) fail(`unknown platform: ${name}`);
    const tok = store.readToken(p.file);
    if (!tok) fail(`${p.label}: ${t('status.unset')}`);
    const b64 = Buffer.from(tok, 'utf8').toString('base64');
    process.stdout.write(
      process.env.TMUX ? `\x1bPtmux;\x1b\x1b]52;c;${b64}\x07\x1b\\` : `\x1b]52;c;${b64}\x07`,
    );
    console.log(`${p.label}: ${t('msg.copied', { name: p.label })}`);
    return;
  }

  if (cmd === 'list') {
    const th = theme(ascii);
    const filter = positionals.length > 1 ? resolveTargets(positionals.slice(1)) : null;
    const all = store.rows();
    const rows = filter ? all.filter((r) => filter.some((f) => f.key === r.key)) : all;
    if (has('--json')) {
      console.log(
        JSON.stringify(
          rows.map((r) => ({
            platform: r.key,
            configured: !!r.tok,
            status: r.status?.ok ?? null,
            user: r.status?.user ?? null,
            expiresAt: r.expiresAt,
            updatedAt: r.updated ? r.updated.toISOString() : null,
            mode: r.mode,
          })),
          null,
          2,
        ),
      );
      return;
    }
    if (rows.every((r) => !r.tok)) suggestOtherStores();
    const lines = [`${t('app.brand')} · ${t('list.title')}`, `dir: ${DIR}`, ''];
    for (const row of rows) {
      const st = statusView(row, t, th);
      const upd = row.updated ? ago(row.updated, t) : '—';
      const exp = expiryText(row.expiresAt, t);
      const perm = row.mode && row.mode !== '600' ? `  ⚠ ${row.mode}` : '';
      lines.push(`  ${pad(row.label, 13)} ${st.icon} ${pad(st.text, 22)} ${pad(upd, 14)} ${exp}${perm}`);
    }
    console.log(lines.join('\n'));
    return;
  }

  if (cmd === 'recheck') {
    const th = theme(ascii);
    const only = positionals.length > 1 ? resolveTargets(positionals.slice(1)) : null;
    const targets = only ? store.rows().filter((r) => only.some((p) => p.key === r.key)) : store.rows();
    for (const row of targets) {
      if (!row.tok) {
        console.log(`${pad(row.label, 13)} ${th.unset} ${t('status.unset')}`);
        continue;
      }
      const res = await verify(row.key, row.tok);
      store.setMeta(row.file, { lastStatus: res, lastCheckedAt: new Date().toISOString() });
      const st = statusView({ ...row, status: res }, t, th);
      console.log(`${pad(row.label, 13)} ${st.icon} ${st.text}`);
    }
    return;
  }

  const baseState: ScreenState = {
    rows: store.rows(),
    sel: 0,
    mode: 'list',
    input: null,
    message: '',
    revealed: false,
    locale,
    langIndex: Math.max(0, AVAILABLE.findIndex((e) => e.code === locale)),
    dir: DIR,
    columns: columns(),
    configPath: CONFIG_PATH,
    configLocale: config.locale ?? 'auto',
    ascii,
  };

  if (has('--preview') || has('--preview-lang')) {
    const state: ScreenState = has('--preview-lang') ? { ...baseState, mode: 'lang' } : baseState;
    const instance = render(<Screen state={state} t={t} />);
    setTimeout(() => instance.unmount(), 120);
    return;
  }

  render(<App store={store} locale={locale} configPath={CONFIG_PATH} config={config} ascii={ascii} />);
}

main().catch((err) => {
  console.error(err?.stack ?? String(err));
  process.exit(1);
});
