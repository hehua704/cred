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
  assert.equal(data.expiresAt, new Date(Date.now() + 90 * 86400000).toISOString().slice(0, 10));
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
  assert.equal(rows.length, 4);
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
});
