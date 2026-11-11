#!/usr/bin/env node
import React from 'react';
import { render } from 'ink';
import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync, cpSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';

import { createStore, expiryPatch, resolveExpiry } from './store.js';
import { createT, resolveLocale, AVAILABLE, SUPPORTED } from './i18n.js';
import { readConfig, writeConfig } from './config.js';
import type { Config } from './config.js';
import { DEFAULT_BYPASS } from './config.js';
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
  docker: 'DOCKERHUB_TOKEN',
};

const FLAGS_WITH_VALUE = new Set(['--dir', '--lang', '--width', '--from', '--field', '--format']);

interface Parsed {
  flags: Map<string, string | true>;
  pos: string[];
  /** `--` 之后的原始参数，原样交给子进程（cred run） */
  rest: string[];
}

function parseArgs(input: string[]): Parsed {
  const flags = new Map<string, string | true>();
  const pos: string[] = [];
  let rest: string[] = [];
  for (let i = 0; i < input.length; i++) {
    const a = input[i];
    if (a === '--') {
      rest = input.slice(i + 1);
      break;
    }
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
  return { flags, pos, rest };
}

const { flags, pos: positionals, rest } = parseArgs(process.argv.slice(2));
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
  cred get <p> --field        token | expires | expiresAt | user
  cred has <platform...>      exit 0 only if every target exists
  cred env [platform...]      print GITHUB_TOKEN=... lines (--export for eval)
  cred proxy [on|off|<url>]   proxy switch / address (never applied globally)
  cred proxy --export         export proxy vars (only when enabled)
  cred run [--proxy] -- cmd   run cmd with token env; --proxy adds HTTPS_PROXY too
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
  // config.toml 也必须落在目标目录里：CONFIG_PATH 是“解析后的目录”的路径，
  // 在空目录里 init 时它指向全局默认库，绝不能往那里写。
  const cfgPath = join(DIR, 'config.toml');
  if (!existsSync(cfgPath)) writeConfig(cfgPath, { locale: 'auto', fallback: 'en' });

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
  const found: Array<{
    platform: string;
    token: string;
    expiresAt: string | null;
    expiresState: string;
    expiresSource: string | null;
    updatedAt: string | null;
    user: string | null;
  }> = [];
  const missing: string[] = [];

  for (const p of targets) {
    const tok = store.readToken(p.file);
    if (!tok) {
      missing.push(p.key);
      continue;
    }
    const m = meta[p.file] ?? {};
    const exp = resolveExpiry(m);
    found.push({
      platform: p.key,
      token: tok,
      expiresAt: exp.at,
      expiresState: exp.state,
      expiresSource: exp.source,
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
    else if (field === 'expires') {
      console.log(
        row.expiresState === 'date'
          ? (row.expiresAt ?? 'unknown')
          : row.expiresState === 'never'
            ? 'never'
            : 'unknown',
      );
    } else if (field === 'user') console.log(row.user ?? '');
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

// 代理只按需拼装，绝不写进全局环境：只影响显式调用（cred run --proxy / cred proxy）。
// 总开关是 proxy_enabled；bypass 里的域名始终直连（默认 GitHub + npm）。
function proxyBypass(): string {
  return config.proxy_bypass || DEFAULT_BYPASS;
}

function mergeNoProxy(bypass: string): string {
  const cur = process.env.NO_PROXY || process.env.no_proxy || '';
  const parts = [...cur.split(','), ...bypass.split(',')]
    .map((x) => x.trim())
    .filter(Boolean);
  return [...new Set(parts)].join(',');
}

function proxyEnv(proxy: string): Record<string, string> {
  return {
    HTTPS_PROXY: proxy,
    HTTP_PROXY: proxy,
    NODE_USE_ENV_PROXY: '1',
    NO_PROXY: mergeNoProxy(proxyBypass()),
  };
}

function proxyLines(proxy: string, prefix: string): string[] {
  const e = proxyEnv(proxy);
  return Object.entries(e).map(([k, v]) =>
    k === 'NODE_USE_ENV_PROXY' ? `${prefix}${k}=${v}` : `${prefix}${k}='${v}'`,
  );
}

function updateConfig(patch: Partial<Config>): boolean {
  const cur = readConfig(CONFIG_PATH);
  return writeConfig(CONFIG_PATH, { ...cur, ...patch });
}

function cmdProxy(): void {
  const arg = positionals[1];

  if (arg === 'on' || arg === 'off') {
    if (arg === 'on' && !config.proxy) {
      fail(`还没有代理地址。先执行：cred proxy http://127.0.0.1:7890`);
    }
    if (!updateConfig({ proxy_enabled: arg === 'on' })) {
      fail(`写入失败: ${CONFIG_PATH}`);
    }
    console.log(arg === 'on' ? '代理已开启（仅对 cred run --proxy / cred proxy --export 生效）' : '代理已关闭（配置保留）');
    return;
  }

  if (arg && !arg.startsWith('-')) {
    if (!/^https?:\/\/[^\s]+$/.test(arg)) fail(`代理地址要写成 http(s)://host:port`);
    if (!updateConfig({ proxy: arg })) fail(`写入失败: ${CONFIG_PATH}`);
    console.log(`代理地址已设为: ${arg}`);
    return;
  }

  const enabled = config.proxy_enabled === true;
  if (has('--export')) {
    if (!enabled) {
      console.error('代理未开启（cred proxy on）');
      return;
    }
    if (!config.proxy) fail(`未配置代理地址：cred proxy http://host:port`);
    proxyLines(config.proxy, 'export ').forEach((l) => console.log(l));
    return;
  }

  console.log(`代理: ${enabled ? '开' : '关'}`);
  console.log(`地址: ${config.proxy ?? '(未设置)'}`);
  console.log(`直连: ${proxyBypass()}`);
  console.log(`配置: ${CONFIG_PATH}`);
}

function cmdRun(): void {
  if (rest.length === 0) fail('usage: cred run [--proxy] -- <command> [args...]', 2);
  const store = createStore(DIR);
  const env: Record<string, string> = { ...(process.env as Record<string, string>) };
  for (const p of PLATFORMS) {
    const tok = store.readToken(p.file);
    if (tok) env[ENV_VARS[p.key]] = tok;
  }
  if (has('--proxy')) {
    if (config.proxy_enabled !== true) {
      console.error('代理未开启，本条命令按直连执行（需要时先 cred proxy on）');
    } else if (!config.proxy) {
      console.error('没有配置代理地址，本条命令按直连执行');
    } else {
      Object.assign(env, proxyEnv(config.proxy));
    }
  }
  const r = spawnSync(rest[0], rest.slice(1), { stdio: 'inherit', env });
  if (r.error) fail(`无法执行 ${rest[0]}: ${r.error.message}`);
  process.exit(r.status ?? 1);
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
  if (has('--proxy')) {
    if (config.proxy_enabled === true && config.proxy) {
      for (const line of proxyLines(config.proxy, prefix)) console.log(line);
    } else {
      console.error('代理未开启，未输出代理变量（需要时先 cred proxy on）');
    }
  }
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

  if (cmd === 'proxy') {
    cmdProxy();
    return;
  }

  if (cmd === 'run') {
    cmdRun();
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
    // 换了 token，旧的到期信息不再属于这枚凭证：回到“未知”，等平台下一次告知。
    store.setMeta(p.file, {
      createdAt: prev.createdAt ?? now,
      updatedAt: now,
      lastStatus: null,
      expiresAt: null,
      expiresState: 'unknown',
      expiresSource: null,
    });
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
            expiresState: r.expiresState,
            expiresSource: r.expiresSource,
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
      const exp = expiryText(row, t);
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
      const { status, expiry } = await verify(row.key, row.tok);
      const patch = expiryPatch(store.readMeta()[row.file] ?? {}, expiry);
      store.setMeta(row.file, { lastStatus: status, lastCheckedAt: new Date().toISOString(), ...patch });
      const next = { ...row, status, ...patch };
      const st = statusView(next, t, th);
      console.log(
        `${pad(row.label, 13)} ${st.icon} ${pad(st.text, 22)} ${expiryText(next, t)}`,
      );
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
    proxy: {
      enabled: config.proxy_enabled === true,
      url: config.proxy ?? '',
      bypass: config.proxy_bypass || DEFAULT_BYPASS,
      sel: 0,
    },
  };

  if (has('--preview') || has('--preview-lang') || has('--preview-proxy')) {
    const state: ScreenState = has('--preview-lang')
      ? { ...baseState, mode: 'lang' }
      : has('--preview-proxy')
        ? { ...baseState, mode: 'proxy' }
        : baseState;
    const instance = render(<Screen state={state} t={t} />);
    setTimeout(() => instance.unmount(), 120);
    return;
  }

  render(<App store={store} locale={locale} configPath={CONFIG_PATH} config={config} ascii={ascii} />);
}

// 需要联网的命令：代理开启时用 --use-env-proxy 重新执行自己。
// 代理只作用于这一个进程，不写进全局环境；子进程继承的也只是本次调用的环境。
const NETWORK_COMMANDS = new Set(['', 'recheck']);
if (
  config.proxy_enabled === true &&
  config.proxy &&
  NETWORK_COMMANDS.has(positionals[0] ?? '') &&
  !process.env.CRED_PROXY_REEXEC &&
  process.allowedNodeEnvironmentFlags.has('--use-env-proxy')
) {
  const r = spawnSync(
    process.execPath,
    ['--use-env-proxy', process.argv[1], ...process.argv.slice(2)],
    {
      stdio: 'inherit',
      env: {
        ...process.env,
        HTTPS_PROXY: config.proxy,
        HTTP_PROXY: config.proxy,
        NO_PROXY: mergeNoProxy(proxyBypass()),
        CRED_PROXY_REEXEC: '1',
      },
    },
  );
  process.exit(r.status ?? 1);
}

main().catch((err) => {
  console.error(err?.stack ?? String(err));
  process.exit(1);
});
