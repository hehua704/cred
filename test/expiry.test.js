import test from 'node:test';
import assert from 'node:assert/strict';

import { parseGithubExpiry } from '../dist/verify.js';
import { parseExpiryInput } from '../dist/expiry.js';
import { expiryPatch, resolveExpiry } from '../dist/store.js';
import { expiryText } from '../dist/ui/Screen.js';
import { createT } from '../dist/i18n.js';

const t = createT('zh-CN');

// ---------- 平台告知 ----------

test('GitHub 到期头：有日期就用日期', () => {
  const r = parseGithubExpiry({
    'github-authentication-token-expiration': '2027-02-08 12:00:00 UTC',
  });
  assert.deepEqual(r, { state: 'date', at: '2027-02-08' });
});

test('GitHub 到期头：没有头就是未知，不推断成不过期', () => {
  assert.deepEqual(parseGithubExpiry({}), { state: 'unknown', at: null });
});

test('GitHub 到期头：格式不认识也不猜', () => {
  assert.deepEqual(
    parseGithubExpiry({ 'github-authentication-token-expiration': 'someday' }),
    { state: 'unknown', at: null },
  );
});

// ---------- 显示 ----------

test('到期显示：有日期显示剩余天数', () => {
  const at = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
  assert.match(expiryText({ expiresAt: at, expiresState: 'date' }, t), /天后/);
});

test('到期显示：过期显示已过期', () => {
  assert.match(expiryText({ expiresAt: '2020-01-01', expiresState: 'date' }, t), /已过期/);
});

test('到期显示：明确不过期才显示不过期', () => {
  assert.equal(expiryText({ expiresAt: null, expiresState: 'never' }, t), '不过期');
});

test('到期显示：没有依据就是未知', () => {
  assert.equal(expiryText({ expiresAt: null, expiresState: 'unknown' }, t), '未知');
  assert.equal(expiryText({ expiresAt: null, expiresState: 'date' }, t), '未知');
});

// ---------- 手动输入 ----------

test('有效期输入：日期 / +Nd / none / 空', () => {
  assert.deepEqual(parseExpiryInput('2027-02-08'), { state: 'date', at: '2027-02-08' });
  assert.deepEqual(parseExpiryInput('none'), { state: 'never', at: null });
  assert.deepEqual(parseExpiryInput('不过期'), { state: 'never', at: null });
  assert.deepEqual(parseExpiryInput(''), { state: 'unknown', at: null });
  const plus = parseExpiryInput('+10d', Date.parse('2026-01-01T00:00:00Z'));
  assert.deepEqual(plus, { state: 'date', at: '2026-01-11' });
});

test('有效期输入：非法格式返回 null', () => {
  assert.equal(parseExpiryInput('2027-02-31'), null);
  assert.equal(parseExpiryInput('tomorrow'), null);
  assert.equal(parseExpiryInput('2027/02/08'), null);
});

// ---------- 合并规则 ----------

test('合并：平台给了结论就以平台为准', () => {
  assert.deepEqual(
    expiryPatch({ expiresSource: 'manual', expiresState: 'date', expiresAt: '2027-01-01' }, {
      state: 'date',
      at: '2027-03-01',
    }),
    { expiresAt: '2027-03-01', expiresState: 'date', expiresSource: 'platform' },
  );
});

test('合并：平台没说时保留手动值', () => {
  assert.deepEqual(
    expiryPatch({ expiresSource: 'manual', expiresState: 'date', expiresAt: '2027-01-01' }, {
      state: 'unknown',
      at: null,
    }),
    {},
  );
});

test('合并：平台没说且没有手动值就是未知', () => {
  assert.deepEqual(expiryPatch({}, { state: 'unknown', at: null }), {
    expiresAt: null,
    expiresState: 'unknown',
    expiresSource: null,
  });
});

test('合并：没拿到响应时什么都不改', () => {
  const prev = { expiresSource: 'platform', expiresState: 'date', expiresAt: '2027-01-01' };
  assert.deepEqual(expiryPatch(prev, null), {});
});

test('老数据只有 expiresAt 时按手动日期处理', () => {
  assert.deepEqual(resolveExpiry({ expiresAt: '2027-01-01' }), {
    at: '2027-01-01',
    state: 'date',
    source: 'manual',
  });
  assert.deepEqual(resolveExpiry({}), { at: null, state: 'unknown', source: null });
});
