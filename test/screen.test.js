import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { render } from 'ink-testing-library';

import { Screen } from '../dist/ui/Screen.js';
import { createT } from '../dist/i18n.js';
import { width, stripAnsi } from '../dist/width.js';

const rows = [
  {
    key: 'github', file: 'github-token', label: 'GitHub PAT', defaultExpiryDays: 90,
    tok: 'githubabcdefghijklmnop', mode: '600', updated: new Date(),
    expiresAt: null, status: { ok: true, user: 'hehua704', code: null },
  },
  {
    key: 'crates', file: 'crates-token', label: 'crates.io', defaultExpiryDays: null,
    tok: 'cio1Bjabcdefghijklmn', mode: '600', updated: new Date(),
    expiresAt: null, status: { ok: true, user: null, code: null },
  },
  {
    key: 'pypi', file: 'pypi-token', label: 'PyPI', defaultExpiryDays: null,
    tok: 'pypi-AgEIcHlwaS5vcmc', mode: '600', updated: new Date(),
    expiresAt: null, status: { ok: null, user: null, code: null },
  },
  {
    key: 'npm', file: 'npm-token', label: 'npm', defaultExpiryDays: null,
    tok: null, mode: null, updated: null, expiresAt: null, status: null,
  },
];

function state(locale, columns, ascii = false, mode = 'list') {
  return {
    rows, sel: 0, mode, input: null, message: '', revealed: false,
    locale, langIndex: 0, dir: '/root/.dsh-publish', columns,
    configPath: '/root/.dsh-publish/config.toml', configLocale: 'auto', ascii,
    proxy: { enabled: true, url: 'http://127.0.0.1:7890', bypass: 'github.com,registry.npmjs.org', sel: 0 },
  };
}

function frameWidths(frame) {
  return new Set(frame.split('\n').map((l) => width(stripAnsi(l))));
}

for (const locale of ['zh-CN', 'en']) {
  for (const columns of [60, 76, 100]) {
    test(`${locale} @ ${columns} 列：每行等宽`, () => {
      const { lastFrame } = render(React.createElement(Screen, { state: state(locale, columns), t: createT(locale) }));
      const widths = frameWidths(lastFrame());
      assert.equal(widths.size, 1, `行宽不一致: ${JSON.stringify([...widths])}`);
    });
  }
}

test('窄屏隐藏详情面板', () => {
  const { lastFrame } = render(React.createElement(Screen, { state: state('zh-CN', 60), t: createT('zh-CN') }));
  const frame = stripAnsi(lastFrame());
  assert.ok(!frame.includes('│ GitHub PAT'), '60 列不应出现分栏');
  assert.ok(frame.includes('GitHub PAT'), '列表仍应可见');
});

test('ASCII 模式不含 Unicode 制表符', () => {
  const { lastFrame } = render(React.createElement(Screen, { state: state('en', 82, true), t: createT('en') }));
  const frame = stripAnsi(lastFrame());
  assert.ok(!/[╭╮╰╯│─├┤┬┴●○◐✕]/.test(frame), '仍有 Unicode 字符');
  assert.ok(/\* valid/.test(frame), 'ASCII 图标未生效');
});

test('语言界面同样等宽', () => {
  const { lastFrame } = render(React.createElement(Screen, { state: state('zh-CN', 82, false, 'lang'), t: createT('zh-CN') }));
  const widths = frameWidths(lastFrame());
  assert.equal(widths.size, 1);
});

test('代理界面：两种语言、三档宽度都等宽', () => {
  for (const locale of ['zh-CN', 'en']) {
    for (const columns of [60, 76, 100]) {
      const st = state(locale, columns, false, 'proxy');
      const { lastFrame } = render(
        React.createElement(Screen, { state: st, t: createT(locale) }),
      );
      const widths = frameWidths(lastFrame());
      assert.equal(widths.size, 1, `${locale} @ ${columns}: ${JSON.stringify([...widths])}`);
    }
  }
});

test('代理界面：显示开关、地址与直连名单', () => {
  const st = state('zh-CN', 90, false, 'proxy');
  st.proxy = { enabled: false, url: 'http://127.0.0.1:7890', bypass: 'github.com,registry.npmjs.org', sel: 1 };
  const { lastFrame } = render(React.createElement(Screen, { state: st, t: createT('zh-CN') }));
  const frame = stripAnsi(lastFrame());
  assert.match(frame, /代理设置/);
  assert.match(frame, /启用代理\s+关/);
  assert.match(frame, /127\.0\.0\.1:7890/);
  assert.match(frame, /github\.com/);
});
