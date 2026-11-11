import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { render } from 'ink-testing-library';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { App } from '../dist/ui/App.js';
import { createStore } from '../dist/store.js';
import { readConfig } from '../dist/config.js';

const tick = () => new Promise((r) => setTimeout(r, 120));

async function waitFor(inst, re, timeout = 1500) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (re.test(inst.lastFrame())) return true;
    await new Promise((r) => setTimeout(r, 30));
  }
  return false;
}

function mount(configText) {
  const dir = mkdtempSync(join(tmpdir(), 'cred-tui-'));
  const cfg = join(dir, 'config.toml');
  writeFileSync(cfg, configText);
  const store = createStore(dir);
  const inst = render(
    React.createElement(App, {
      store,
      locale: 'zh-CN',
      configPath: cfg,
      config: readConfig(cfg),
      ascii: false,
    }),
  );
  return { inst, cfg, dir };
}

test('TUI：按 p 进代理页，Enter 切换开关并写回配置', async () => {
  const { inst, cfg } = mount('locale = "zh-CN"\nproxy = "http://127.0.0.1:7890"\nproxy_enabled = false\n');
  await tick();

  inst.stdin.write('p');
  await tick();
  assert.match(inst.lastFrame(), /代理设置/);

  inst.stdin.write('\r');
  await tick();
  assert.equal(readConfig(cfg).proxy_enabled, true);
  assert.match(inst.lastFrame(), /启用代理\s+开/);

  inst.stdin.write('\u001b');
  await tick();
  assert.match(inst.lastFrame(), /凭证列表/);
  inst.unmount();
});

test('TUI：代理页按 Esc 取消编辑，不写配置', async () => {
  const { inst, cfg } = mount('locale = "zh-CN"\nproxy = "http://127.0.0.1:7890"\nproxy_enabled = true\n');
  await tick();
  inst.stdin.write('p');
  await tick();
  inst.stdin.write('j'); // 选中“地址”
  await tick();
  inst.stdin.write('\r'); // 进入编辑
  await tick();
  assert.ok(await waitFor(inst, /Enter 保存/), '应打开输入弹窗');

  inst.stdin.write('\u001b'); // Esc 取消
  await tick();
  assert.equal(readConfig(cfg).proxy, 'http://127.0.0.1:7890');
  assert.match(inst.lastFrame(), /代理设置/);
  inst.unmount();
});

test('TUI：空格键也能切换代理开关', async () => {
  const { inst, cfg } = mount('locale = "zh-CN"\nproxy = "http://127.0.0.1:7890"\nproxy_enabled = true\n');
  await tick();
  inst.stdin.write('p');
  await tick();
  inst.stdin.write(' ');
  await tick();
  assert.equal(readConfig(cfg).proxy_enabled, false);
  inst.unmount();
});

test('TUI：Docker Hub 表单要求用户名，到期默认 90 天', async () => {
  const { inst, dir } = mount('locale = "zh-CN"\n');
  await tick();

  for (let i = 0; i < 4; i++) inst.stdin.write('j'); // 选中 Docker Hub
  await tick();
  inst.stdin.write('a');
  assert.ok(await waitFor(inst, /用户名/), 'Docker Hub 表单应有用户名一栏');
  assert.match(inst.lastFrame(), /\+90d/, '到期应默认 +90d');

  inst.stdin.write('dckr_pat_test123');
  await tick();
  inst.stdin.write('\t'); // 到用户名
  await tick();
  inst.stdin.write('hehua704');
  await tick();
  inst.stdin.write('\t'); // 到到期
  await tick();
  inst.stdin.write('\r');
  await tick();

  const { readFileSync } = await import('node:fs');
  assert.equal(readFileSync(join(dir, 'docker-token'), 'utf8').trim(), 'dckr_pat_test123');
  const meta = JSON.parse(readFileSync(join(dir, 'meta.json'), 'utf8'));
  assert.equal(meta['docker-token'].username, 'hehua704');
  assert.equal(
    meta['docker-token'].expiresAt,
    new Date(Date.now() + 90 * 86400000).toISOString().slice(0, 10),
  );
  assert.equal(meta['docker-token'].expiresSource, 'default');
  inst.unmount();
});
