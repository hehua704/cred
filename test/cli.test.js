import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, statSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const BIN = join(HERE, '..', 'bin', 'cred.js');

function project() {
  return mkdtempSync(join(tmpdir(), 'cred-test-'));
}

// 每个测试用独立的 HOME/XDG，避免读到开发机上的 ~/.config/cred
function sandboxHome() {
  return mkdtempSync(join(tmpdir(), 'cred-home-'));
}

function runWithHome(cwd, args, input, home) {
  const res = spawnSync(process.execPath, [BIN, ...args], {
    cwd,
    input,
    encoding: 'utf8',
    env: {
      ...process.env,
      LANG: 'zh_CN.UTF-8',
      CRED_DIR: '',
      CRED_LANG: '',
      HOME: home,
      XDG_CONFIG_HOME: join(home, '.config'),
    },
  });
  return { code: res.status, out: res.stdout.trim(), err: res.stderr.trim() };
}

function run(cwd, args, input) {
  return runWithHome(cwd, args, input, sandboxHome());
}

test('init 创建 .cred 并带上 .gitignore', () => {
  const dir = project();
  const r = run(dir, ['init']);
  assert.equal(r.code, 0);
  assert.ok(existsSync(join(dir, '.cred')));
  assert.ok(existsSync(join(dir, '.cred', '.gitignore')));
  assert.equal(readFileSync(join(dir, '.cred', '.gitignore'), 'utf8'), '*\n!.gitignore\n');
  const mode = (statSync(join(dir, '.cred')).mode & 0o777).toString(8);
  assert.equal(mode, '700');
});

test('set 写入 600 权限的 token 文件', () => {
  const dir = project();
  run(dir, ['init']);
  const r = run(dir, ['set', 'github'], 'ghp_abc123\n');
  assert.equal(r.code, 0);
  const file = join(dir, '.cred', 'github-token');
  assert.equal(readFileSync(file, 'utf8').trim(), 'ghp_abc123');
  assert.equal((statSync(file).mode & 0o777).toString(8), '600');
});

test('get 只输出 token，便于脚本取值', () => {
  const dir = project();
  run(dir, ['init']);
  run(dir, ['set', 'pypi'], 'pypi-AgEIcHlwaS5vcmcTESTTOKEN1234567890\n');
  const r = run(dir, ['get', 'pypi']);
  assert.equal(r.code, 0);
  assert.equal(r.out, 'pypi-AgEIcHlwaS5vcmcTESTTOKEN1234567890');
});

test('get --json 返回结构化字段', () => {
  const dir = project();
  run(dir, ['init']);
  run(dir, ['set', 'github'], 'ghp_abc123\n');
  const r = run(dir, ['get', 'github', '--json']);
  const data = JSON.parse(r.out);
  assert.equal(data.platform, 'github');
  assert.equal(data.token, 'ghp_abc123');
  // 平台没告知之前不编日期：写入 token 后到期状态是 unknown
  assert.equal(data.expiresAt, null);
  assert.equal(data.expiresState, 'unknown');
  assert.equal(data.expiresSource, null);
});

test('has 用退出码表达存在性', () => {
  const dir = project();
  run(dir, ['init']);
  assert.equal(run(dir, ['has', 'github']).code, 1);
  run(dir, ['set', 'github'], 'ghp_abc\n');
  assert.equal(run(dir, ['has', 'github']).code, 0);
});

test('env 输出环境变量，--export 加前缀', () => {
  const dir = project();
  run(dir, ['init']);
  run(dir, ['set', 'github'], 'ghp_abc\n');
  run(dir, ['set', 'pypi'], 'pypi-xyz\n');
  const plain = run(dir, ['env']).out.split('\n');
  assert.ok(plain.includes("GITHUB_TOKEN='ghp_abc'"));
  assert.ok(plain.includes("PYPI_TOKEN='pypi-xyz'"));
  const exported = run(dir, ['env', '--export']).out;
  assert.ok(exported.includes("export GITHUB_TOKEN='ghp_abc'"));
});

test('list --json 输出可解析数组', () => {
  const dir = project();
  run(dir, ['init']);
  run(dir, ['set', 'github'], 'ghp_abc\n');
  const rows = JSON.parse(run(dir, ['list', '--json']).out);
  assert.equal(rows.length, 5);
  assert.equal(rows[0].platform, 'github');
  assert.equal(rows[0].configured, true);
  assert.equal(rows[1].configured, false);
});

test('未初始化的目录给出明确提示', () => {
  const dir = project();
  const r = run(dir, ['list']);
  assert.equal(r.code, 1);
  assert.ok(r.err.includes('cred init'));
});

test('--dir 覆盖默认目录', () => {
  const dir = project();
  const custom = join(dir, 'custom');
  run(dir, ['init', '--dir', custom]);
  run(dir, ['set', 'github', '--dir', custom], 'ghp_zzz\n');
  const r = run(dir, ['get', 'github', '--dir', custom]);
  assert.equal(r.out, 'ghp_zzz');
});

test('get 支持一次多个平台（tab 分隔）', () => {
  const dir = project();
  run(dir, ['init']);
  run(dir, ['set', 'github'], 'ghp_aaa\n');
  run(dir, ['set', 'pypi'], 'pypi-bbb\n');
  const out = run(dir, ['get', 'github', 'pypi']).out.split('\n');
  assert.deepEqual(out, ['github\tghp_aaa', 'pypi\tpypi-bbb']);
});

test('get all 只输出已配置的平台', () => {
  const dir = project();
  run(dir, ['init']);
  run(dir, ['set', 'github'], 'ghp_aaa\n');
  const r = run(dir, ['get', 'all', '--format', 'env']);
  assert.equal(r.out, "GITHUB_TOKEN='ghp_aaa'");
  assert.ok(r.err.includes('missing'));
});

test('get 多平台 --json 返回数组', () => {
  const dir = project();
  run(dir, ['init']);
  run(dir, ['set', 'github'], 'ghp_aaa\n');
  run(dir, ['set', 'pypi'], 'pypi-bbb\n');
  const arr = JSON.parse(run(dir, ['get', 'github', 'pypi', '--json']).out);
  assert.ok(Array.isArray(arr));
  assert.deepEqual(arr.map((x) => x.platform), ['github', 'pypi']);
});

test('has 多平台：全部存在才返回 0', () => {
  const dir = project();
  run(dir, ['init']);
  run(dir, ['set', 'github'], 'ghp_aaa\n');
  run(dir, ['set', 'pypi'], 'pypi-bbb\n');
  assert.equal(run(dir, ['has', 'github', 'pypi']).code, 0);
  const r = run(dir, ['has', 'github', 'npm']);
  assert.equal(r.code, 1);
  assert.ok(r.err.includes('npm'));
});

test('env 支持平台筛选', () => {
  const dir = project();
  run(dir, ['init']);
  run(dir, ['set', 'github'], 'ghp_aaa\n');
  run(dir, ['set', 'pypi'], 'pypi-bbb\n');
  assert.equal(run(dir, ['env', 'pypi']).out, "PYPI_TOKEN='pypi-bbb'");
});

test('list 支持平台筛选', () => {
  const dir = project();
  run(dir, ['init']);
  run(dir, ['set', 'github'], 'ghp_aaa\n');
  const rows = JSON.parse(run(dir, ['list', 'github', '--json']).out);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].platform, 'github');
});

test('cred use 设置默认目录后可在其他目录使用', () => {
  const home = sandboxHome();
  const dirA = project();
  const dirB = project();
  runWithHome(dirA, ['init'], undefined, home);
  runWithHome(dirA, ['set', 'github'], 'ghp_aaa\n', home);

  // 未设置前：dirB 里读不到
  assert.equal(runWithHome(dirB, ['has', 'github'], undefined, home).code, 1);

  const use = runWithHome(dirA, ['use', join(dirA, '.cred')], undefined, home);
  assert.equal(use.code, 0);
  assert.ok(use.out.includes('默认目录已设为'));

  // 设置后：dirB 里也能读到
  assert.equal(runWithHome(dirB, ['has', 'github'], undefined, home).code, 0);
  const got = runWithHome(dirB, ['get', 'github'], undefined, home);
  assert.equal(got.out, 'ghp_aaa');
});

test('init 只写当前目录，不会误改全局默认库', () => {
  const home = sandboxHome();
  const dirA = project();
  const dirB = project();

  runWithHome(dirA, ['init'], undefined, home);
  runWithHome(dirA, ['set', 'github'], 'ghp_real\n', home);
  runWithHome(dirA, ['use', join(dirA, '.cred')], undefined, home);

  // 在 dirB 里 init：必须建在 dirB，而不是写进 dirA
  const r = runWithHome(dirB, ['init'], undefined, home);
  assert.equal(r.code, 0);
  assert.ok(r.out.includes(join(dirB, '.cred')), `输出应指向 dirB: ${r.out}`);

  // dirA 的 token 不能被覆盖
  const got = runWithHome(dirA, ['get', 'github'], undefined, home);
  assert.equal(got.out, 'ghp_real');
  assert.equal(runWithHome(dirB, ['has', 'github'], undefined, home).code, 1);

  // config.toml 也必须落在 dirB，而不是默认库
  assert.ok(existsSync(join(dirB, '.cred', 'config.toml')), 'dirB 应有自己的 config.toml');
  assert.match(readFileSync(join(dirB, '.cred', 'config.toml'), 'utf8'), /locale = "auto"/);
});

test('proxy：地址写入配置，默认关闭，状态可读', () => {
  const dir = project();
  run(dir, ['init']);

  const set = run(dir, ['proxy', 'http://127.0.0.1:1']);
  assert.equal(set.code, 0);
  assert.match(run(dir, ['proxy']).out, /代理: 关/);
  assert.match(run(dir, ['proxy']).out, /地址: http:\/\/127\.0\.0\.1:1/);

  // 未开启时 export 不输出任何东西
  assert.equal(run(dir, ['proxy', '--export']).out, '');

  // 地址不合法要拒绝
  assert.notEqual(run(dir, ['proxy', '127.0.0.1:1']).code, 0);
});

test('proxy 开关：off 不注入，on 才注入并带 NO_PROXY', () => {
  const dir = project();
  run(dir, ['init']);
  run(dir, ['set', 'github'], 'ghp_abc\n');
  run(dir, ['proxy', 'http://127.0.0.1:1']);

  const probe =
    'console.log((process.env.HTTPS_PROXY||"none")+"|"+(process.env.NO_PROXY||"").includes("registry.npmjs.org"))';

  const off = run(dir, ['run', '--proxy', '--', process.execPath, '-e', probe]);
  assert.equal(off.out, 'none|false', '关闭时不能注入代理');

  run(dir, ['proxy', 'on']);
  const on = run(dir, ['run', '--proxy', '--', process.execPath, '-e', probe]);
  assert.equal(on.out, 'http://127.0.0.1:1|true', '开启时注入代理，且 npm 在直连名单里');

  run(dir, ['proxy', 'off']);
  assert.match(run(dir, ['proxy']).out, /代理: 关/);
});

test('run：默认只注入 token，不带代理', () => {
  const dir = project();
  run(dir, ['init']);
  run(dir, ['set', 'github'], 'ghp_abc\n');
  run(dir, ['proxy', 'http://127.0.0.1:1']);
  run(dir, ['proxy', 'on']);

  const plain = run(dir, [
    'run',
    '--',
    process.execPath,
    '-e',
    'console.log((process.env.GITHUB_TOKEN||"none")+"|"+(process.env.HTTPS_PROXY||"none"))',
  ]);
  assert.equal(plain.out, 'ghp_abc|none');
});

test('env --proxy 只在开启时追加代理变量', () => {
  const dir = project();
  run(dir, ['init']);
  run(dir, ['set', 'github'], 'ghp_abc\n');
  run(dir, ['proxy', 'http://127.0.0.1:1']);

  const off = run(dir, ['env', '--proxy']).out.split('\n');
  assert.ok(off.includes("GITHUB_TOKEN='ghp_abc'"));
  assert.ok(!off.some((l) => l.startsWith('HTTPS_PROXY=')), '关闭时不应出现代理');

  run(dir, ['proxy', 'on']);
  const on = run(dir, ['env', '--export', '--proxy']).out.split('\n');
  assert.ok(on.includes("export GITHUB_TOKEN='ghp_abc'"));
  assert.ok(on.includes("export HTTPS_PROXY='http://127.0.0.1:1'"));
  assert.ok(on.some((l) => l.startsWith('export NO_PROXY=')));
});

test('docker：与其它平台一样的 set/get/env/has', () => {
  const dir = project();
  run(dir, ['init']);
  const set = run(dir, ['set', 'docker'], 'dckr_pat_abc123\n');
  assert.equal(set.code, 0);
  assert.equal(run(dir, ['get', 'docker']).out, 'dckr_pat_abc123');
  assert.equal(run(dir, ['has', 'docker']).code, 0);
  assert.ok(run(dir, ['env']).out.includes("DOCKERHUB_TOKEN='dckr_pat_abc123'"));

  const rows = JSON.parse(run(dir, ['list', '--json']).out);
  const docker = rows.find((r) => r.platform === 'docker');
  assert.equal(docker.configured, true);
  assert.equal(docker.expiresState, 'unknown');
});

test('docker：--user 记录用户名，供校验和 --field user 使用', () => {
  const dir = project();
  run(dir, ['init']);
  const r = run(dir, ['set', 'docker', '--user', 'hehua704'], 'dckr_pat_abc123\n');
  assert.equal(r.code, 0);
  assert.equal(run(dir, ['get', 'docker', '--field', 'user']).out, 'hehua704');

  const rows = JSON.parse(run(dir, ['list', '--json']).out);
  const docker = rows.find((x) => x.platform === 'docker');
  assert.equal(docker.configured, true);
  assert.equal(docker.user, 'hehua704');
});
