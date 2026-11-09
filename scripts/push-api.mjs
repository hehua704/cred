#!/usr/bin/env node
// 通过 GitHub Git Data API 推送提交（本机到 github.com:443 的 git 传输被阻断时使用）。
// 用法: node scripts/push-api.mjs <owner/repo> <token-file> [message]

import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const [slug, tokenFile, message = 'feat: initial import'] = process.argv.slice(2);
if (!slug || !tokenFile) {
  console.error('usage: node push-api.mjs <owner/repo> <token-file> [message]');
  process.exit(1);
}

const token = readFileSync(tokenFile, 'utf8').trim();
const API = 'https://api.github.com';
const headers = {
  authorization: `Bearer ${token}`,
  accept: 'application/vnd.github+json',
  'content-type': 'application/json',
  'user-agent': 'cred-push-api/1.0',
};

async function call(method, path, body) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data = null;
  try {
    data = JSON.parse(text);
  } catch {
    /* 非 JSON */
  }
  if (!res.ok) {
    throw new Error(`${method} ${path} -> ${res.status} ${text.slice(0, 300)}`);
  }
  return data;
}

const files = execFileSync('git', ['ls-files'], { encoding: 'utf8' })
  .split('\n')
  .filter(Boolean);

console.log(`files: ${files.length}`);

// 当前分支与 HEAD
const repo = await call('GET', `/repos/${slug}`);
const branch = repo.default_branch;
let headSha = null;
let baseTree = null;
try {
  const ref = await call('GET', `/repos/${slug}/git/ref/heads/${branch}`);
  headSha = ref.object.sha;
  const commit = await call('GET', `/repos/${slug}/git/commits/${headSha}`);
  baseTree = commit.tree.sha;
} catch {
  /* 空仓库 */
}
console.log(`branch: ${branch}  head: ${headSha ?? '(empty)'}`);

// 1) 上传 blob
const tree = [];
for (const path of files) {
  const content = readFileSync(path);
  const blob = await call('POST', `/repos/${slug}/git/blobs`, {
    content: content.toString('base64'),
    encoding: 'base64',
  });
  const mode = path.startsWith('bin/') ? '100755' : '100644';
  tree.push({ path, mode, type: 'blob', sha: blob.sha });
  process.stdout.write('.');
}
console.log(`\nblobs: ${tree.length}`);

// 2) 建树
const treeRes = await call('POST', `/repos/${slug}/git/trees`, {
  base_tree: baseTree ?? undefined,
  tree,
});

// 3) 建提交
const commitRes = await call('POST', `/repos/${slug}/git/commits`, {
  message,
  tree: treeRes.sha,
  parents: headSha ? [headSha] : [],
});

// 4) 更新引用
if (headSha) {
  await call('PATCH', `/repos/${slug}/git/refs/heads/${branch}`, { sha: commitRes.sha, force: true });
} else {
  await call('POST', `/repos/${slug}/git/refs`, { ref: `refs/heads/${branch}`, sha: commitRes.sha });
}

console.log(`commit: ${commitRes.sha}`);
console.log(`https://github.com/${slug}/commit/${commitRes.sha}`);
