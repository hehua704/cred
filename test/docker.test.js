import test from 'node:test';
import assert from 'node:assert/strict';

import { verify } from '../dist/verify.js';

test('docker：没有用户名时不去猜，返回 need-user', async () => {
  const r = await verify('docker', 'dckr_pat_fake');
  assert.equal(r.status.ok, null);
  assert.equal(r.status.code, 'need-user');
  assert.equal(r.expiry.state, 'unknown');
});
