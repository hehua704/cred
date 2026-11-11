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

const tick = () => new Promise((r) => setTimeout(r, 60));

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
  return { inst, cfg };
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
  assert.match(inst.lastFrame(), /输入代理地址/);

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
