# 开发与发布流程手册（Playbook）

> 本文来自 `@hehua704/cred` 从零到发布的完整实践，可复用于后续任意 npm 包项目。
> 适用环境：Node ≥ 22、npm 11/12、GitHub + npm 双分发。
> 文中 `cred` 可替换为你的项目名，`hehua704` 替换为你的 GitHub/npm 账号。

---

## 0. 一页速览

```
准备账号 → 建项目 → 配凭证 → 本地测试 → 发 npm（主） → 发 GitHub Release（备）
                ↑                                          ↑
           cred 管 token                             CI 自动产出
```

核心原则：

1. **凭证只进文件，不进对话、不进仓库、不进 npm 包**；
2. **发布前必须有自动化的泄漏检查**，不靠人眼；
3. **网络受限时用 API 兜底**（git push 不通就用 Git Data API）；
4. **主备两条分发路**，任何一条挂了另一条还能装。

---

## 1. 一次性准备

| 项 | 说明 |
|---|---|
| GitHub 账号 | 仓库、Release、Actions |
| npm 账号 | 包发布；scope 与用户名一致（`@hehua704/*`） |
| npm Token | Granular Access Token，勾 **Read and write** + **Bypass 2FA** |
| GitHub PAT | Fine-grained，`Contents: R/W`、`Workflows: R/W`、`Actions: R/W` |
| Node | ≥ 22（Ink 8 要求） |

Token 落地（权限 600）：

```bash
mkdir -p ~/.config/cred && chmod 700 ~/.config/cred
# 通过 cred 写入，不要直接 cat > 文件（避免 shell history 残留）
echo 'npm_xxx'    | cred set npm
echo 'github_pat_xxx' | cred set github
```

> **Windows Hello / passkey 用户注意**：无法提供 6 位 TOTP，必须使用带 **Bypass 2FA** 的
> token 才能非交互发布，否则 `npm publish` 会报 `EOTP`。

---

## 2. 新项目脚手架

### 2.1 目录结构

```
project/
├── bin/<name>.js          # 薄入口，指向 dist
├── src/                   # TypeScript 源码
├── locales/               # 若有多语言
├── test/                  # node:test
├── scripts/               # check-no-secrets / push-api 等工具
├── .github/workflows/publish.yml
├── package.json
├── tsconfig.json
├── .gitignore
├── .npmignore
└── README.md
```

### 2.2 package.json 关键字段

```json
{
  "name": "@scope/name",
  "version": "0.1.0",
  "type": "module",
  "bin": { "name": "bin/name.js" },
  "files": ["bin/", "dist/", "locales/", "README.md", "LICENSE"],
  "engines": { "node": ">=22" },
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "prepare": "npm run build",
    "test": "node --test test/*.test.js",
    "check:leak": "node scripts/check-no-secrets.mjs",
    "prepublishOnly": "node scripts/check-no-secrets.mjs && npm run build"
  },
  "publishConfig": { "access": "public" }
}
```

要点：

- `files` 是**白名单**，比 `.npmignore` 更可靠，两者一起用；
- `prepare` 保证从 git 安装时能构建；
- `prepublishOnly` 把泄漏检查卡在发布前。

### 2.3 tsconfig 要点

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "jsx": "react-jsx",
    "outDir": "dist",
    "rootDir": "src",
    "strict": true
  }
}
```

---

## 3. 凭证管理（cred）

### 3.1 目录

```
<project>/.cred/          # 700
├── .gitignore            # *
├── config.toml           # locale / fallback
├── meta.json             # 更新时间、有效期、上次校验
├── github-token          # 600
├── npm-token
├── pypi-token
└── crates-token
```

### 3.2 常用命令

```bash
cred init                      # 建 ./.cred
cred init --from <旧目录>       # 迁移
cred use <dir>                 # 设为全局默认（任意目录可用）
cred list                      # 状态
cred get <platform>            # 只输出 token（脚本用）
cred has <platform>            # 退出码判断
cred env --export              # eval "$(cred env --export)"
cred recheck [platform...]     # 校验
```

### 3.3 解析顺序

`--dir` > `CRED_DIR` > `./.cred` > `cred use` 默认 > `~/.cred` > `./.cred`

> 踩过的坑：在不同目录 `cred init` 会创建**第二个独立存储**，看起来像 token 丢了。
> 现在 `cred` 会提示“附近还有别的凭证目录”。

---

## 4. 本地测试

```bash
npm ci
npm run build
npm test
node bin/<name>.js --help
```

测试建议覆盖：

| 类型 | 内容 |
|---|---|
| 单元 | 宽度计算、locale 解析、配置读写 |
| 渲染 | 每行等宽断言（中英 × 多宽度） |
| CLI | 用 `spawnSync` 跑真实命令，断言输出与退出码 |
| 安全 | `check:leak` 必须通过 |

---

## 5. 发布到 npm（主方案）

### 5.1 首次发布

```bash
npm version 0.1.0 --no-git-tag-version   # 或手改 package.json
npm publish --registry=https://registry.npmjs.org --access public \
  --//registry.npmjs.org/:_authToken="$(cat .cred/npm-token)"
```

注意：

- 本机 registry 可能是镜像（`npmmirror`），**发布必须显式指定官方源**；
- 发布后 registry 有 **1–5 分钟传播延迟**，`dist-tags` 先可用、packument 后可用；
- 新包若还没配 trusted publisher，`npm publish` 会 404（见故障手册）。

### 5.2 后续版本

```bash
npm version patch|minor|major --no-git-tag-version
npm publish --access public
```

### 5.3 OIDC（可选升级，2027 前完成）

1. npmjs.com → 包页面 → Settings → Trusted publishing → GitHub Actions；
2. 填 `owner` / `repo` / `publish.yml`，Environment 留空；
3. workflow 加 `permissions: id-token: write`，去掉 `NODE_AUTH_TOKEN`，用 `--provenance`。

> 首次发布前包页面不存在，无法配置；需要先发一个引导版本（如 `0.0.1`）。

---

## 6. GitHub 分发（备方案）

每个 tag 自动产出 tarball 并挂到 Release：

```bash
npm i -g https://github.com/<owner>/<repo>/releases/download/v0.1.0/<name>-0.1.0.tgz
```

为什么不用 `npm i -g github:owner/repo`：

- 会触发 `prepare` 构建；
- **npm 12 默认拦截依赖安装脚本**（`allowScripts` 默认关闭），装完可能没有 `dist/`。

Release 的 tarball 是 `npm pack` 产物，**已含 `dist/`**，无需构建，最稳。

---

## 7. CI 工作流模板

```yaml
name: publish
on:
  push: { tags: ['v*'] }
  workflow_dispatch:

permissions:
  contents: write   # 上传 Release 资产

jobs:
  publish:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '22', registry-url: 'https://registry.npmjs.org' }
      - run: npm ci
      - run: npm test
      - run: npm run check:leak
      - run: npm pack
      - name: npm publish
        if: vars.NPM_PUBLISH == 'true'
        run: npm publish --access public
        env: { NODE_AUTH_TOKEN: "${{ secrets.NPM_TOKEN }}" }
      - uses: softprops/action-gh-release@v2
        with: { files: '*.tgz', generate_release_notes: true }
        env: { GITHUB_TOKEN: "${{ secrets.GITHUB_TOKEN }}" }
```

需要配置：

| 类型 | 名称 | 值 |
|---|---|---|
| Secret | `NPM_TOKEN` | npm Granular Token |
| Variable | `NPM_PUBLISH` | `true` |

用变量做开关，避免配置没就绪时打 tag 出现红叉。

---

## 8. 网络受限环境的对策（实测）

| 现象 | 原因 | 对策 |
|---|---|---|
| `git ls-remote` 超时 | 到 `github.com:443` 的 TCP 被阻断 | 用 Git Data API 推送（`scripts/push-api.mjs`） |
| `npm ci` 报 `EALLOWREMOTE` | lockfile 里 `resolved` 指向镜像站 | 用官方源重新生成 lockfile |
| `npm view` 报 EACCES | `~/.npm` 缓存权限损坏 | 加 `--cache /tmp/npmcache` |
| 发布 404 | 包尚未传播 / 无权限 | 等待 1–5 分钟，或检查 scope |

### Git Data API 推送

```bash
node scripts/push-api.mjs <owner/repo> <token-file> "commit message"
```

原理：`blob → tree → commit → ref`，效果等价于 `git push`，只依赖 `api.github.com`。

---

## 9. 安全红线

1. **Token 绝不贴进对话**——贴过就等于泄露，必须吊销重建；
2. `.gitignore` 必须覆盖 `.cred/`、`*-token`、`meta.json`、`config.toml`、`.env*`；
3. `.npmignore` 与 `files` 双保险；
4. `prepublishOnly` 跑 `check-no-secrets`，命中即中止；
5. 文件权限：目录 700、token 600；
6. 发布前扫描 README/源码里的本机路径、内网 IP、邮箱。

`check-no-secrets` 检查的模式：

```
.cred/  .dsh-publish/  *-token  meta.json  config.toml  .env*  *.pem  *.key
```

---

## 10. 故障手册（本次真实踩过）

| 现象 | 根因 | 解决 |
|---|---|---|
| `EOTP` 且无 TOTP 可用 | 2FA 为 passkey（Windows Hello） | 换带 Bypass 2FA 的 token |
| `401 Unauthorized` | 本地仍是旧 token（网站已吊销） | `cred set npm` 重新写入 |
| `E404` 发布失败 | trusted publisher 未配置/不匹配 | 核对包名、repo、workflow 文件名 |
| `EALLOWREMOTE` | lockfile 指向镜像 tarball | `npm i --registry=https://registry.npmjs.org` 重生成 |
| `check:leak` 报 `dist/.cred` | 曾在 `dist/` 里执行过 `cred init` | 删除后重建，并在 CI 保留该检查 |
| registry 404 但 `dist-tags` 200 | 新包 packument 异步生成 | 等 1–5 分钟 |
| `npm pack --dry-run --json` 空 | npm 12 行为差异 | 改为真实 `npm pack` + `tar -tzf` |
| 命令要 `cd` 到项目才能用 | 凭证目录按 cwd 解析 | `cred use <dir>` 设全局默认 |

---

## 11. 上线检查清单

发布前：

- [ ] `npm test` 全绿
- [ ] `npm run check:leak` 通过
- [ ] `git status` 干净（无 `.cred`、`dist` 以外的意外文件）
- [ ] README 无本机路径、内网地址、真实邮箱
- [ ] `package.json` 的 `version`、`files`、`repository` 正确
- [ ] 本机 registry 不是镜像（或显式 `--registry`）

发布后：

- [ ] `npm view <pkg> version` 返回新版本
- [ ] 全新目录 `npm i -g <pkg>` 能跑
- [ ] GitHub Release 有 tarball
- [ ] `cred list` 里 token 状态正常

---

## 12. 命令速查

```bash
# 凭证
cred init / cred use / cred list / cred get <p> / cred has <p> / cred env --export

# 构建测试
npm ci && npm run build && npm test && npm run check:leak

# 发布
npm version 0.1.1 --no-git-tag-version
npm publish --access public --registry=https://registry.npmjs.org

# GitHub（网络受限时）
node scripts/push-api.mjs owner/repo .cred/github-token "msg"

# 验证
npm view @scope/name version
npm i -g @scope/name && name --version
```
