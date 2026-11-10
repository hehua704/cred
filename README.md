# @hehua704/cred

凭证管理器 —— 用 Ink + React 写的终端 UI，管理 GitHub PAT、npm、PyPI、crates.io 的发布令牌。
中英双语、宽度感知、SSH 可复制、默认打码，并提供给脚本 / DSH 取 token 的机器接口。

```
╭────────────────────────────────────────────────────────────────────────────────╮
│ cred · 凭证管理器                              语言: 中文  ~/.config/cred │
│────────────────────────────────────────────────────────────────────────────────│
│ 凭证列表                     │ GitHub PAT                                     │
│ ▸ GitHub PAT  ● 有效         │ ────────────────────────────────────────────── │
│   crates.io   ● 有效         │ 凭证        github••••••••Unaf                 │
│   PyPI        ◐ 格式正确     │ 用户        hehua704                           │
│   npm         ○ 未配置       │ 状态        ● 有效 · hehua704                  │
│                              │ 更新        2 小时前                           │
│                              │ 到期        未知                               │
│                              │ c 复制  v 显示  r 校验                         │
│────────────────────────────────────────────────────────────────────────────────│
│ ↑↓ 选择 c 复制 v 显示 r 校验 e 有效期 a 新增/替换 d 清除 l 语言 q 退出        │
╰────────────────────────────────────────────────────────────────────────────────╯
```

## 安装

**主方案：npm**

```bash
npm i -g @hehua704/cred      # 安装后全局可用 cred
npx @hehua704/cred           # 不安装直接跑
```

**备用方案：GitHub Release（不依赖 npm registry）**

每个 tag 都会自动产出 `hehua704-cred-<version>.tgz` 并挂到 Release 上，包里已含 `dist/`，
装的时候不需要编译：

```bash
npm i -g https://github.com/hehua704/cred/releases/download/v0.1.0/hehua704-cred-0.1.0.tgz
```

适用于内网、registry 不可达、或不想依赖 npm 的场景。

> 不要用 `npm i -g github:hehua704/cred`：这条会触发 `prepare` 构建，
> 而 npm 12 默认拦截依赖的安装脚本，装完可能没有 `dist/`。

## 命令

包名 `@hehua704/cred`，**命令就是 `cred`**，一一对应。

本地开发时（推荐先这样测）：

```bash
git clone https://github.com/hehua704/cred.git
cd cred
npm install && npm run build
node bin/cred.js             # 等同于 cred
# 或者装成命令：
ln -sf "$PWD/bin/cred.js" ~/.local/bin/cred
```

## 数据目录

配置和 token 只存在本地目录里，不进仓库、不进 npm 包。

解析顺序：

1. `--dir <path>`
2. 环境变量 `CRED_DIR`
3. 当前目录的 `./.cred`（存在时）
4. `cred use` 设置的全局默认目录
5. `~/.cred`（存在时）
6. 回退到 `./.cred`（由 `cred init` 创建）

初始化：

```bash
cd <你的项目>
cred init                  # 创建 ./.cred（700）+ config.toml + .cred/.gitignore
cred init --from <旧目录>   # 从已有目录迁移 token
```

**想在任何目录都能用**，设一次默认目录：

```bash
cred use /path/to/project/.cred   # 写入 ~/.config/cred/config.json
cred use                          # 查看当前默认
cred use --unset                  # 清除
```

`.cred/` 自带 `.gitignore`（内容 `*`），即使项目根没有 gitignore，token 也不会被提交。

```
.cred/
├── .gitignore          # *
├── config.toml         # locale / fallback
├── meta.json           # 更新时间、有效期、上次校验结果
├── github-token        # 600
├── crates-token
└── pypi-token
```

## Token 流程

### 四条规矩

1. **只进文件**：用 `cred set` 或界面里的 `a` 写入，不贴进对话、issue、提交；
2. **权限收紧**：目录 700、文件 600，`.cred/` 自带 `.gitignore`，即使项目根没有 gitignore 也提交不进去；
3. **最小权限**：能限仓库就限仓库，能限 scope 就限 scope；
4. **怀疑泄露立刻吊销重建**，不要等确认。

### 各平台怎么建

**GitHub PAT** — https://github.com/settings/tokens?type=beta

| 项 | 填什么 |
|---|---|
| Expiration | 90 days（建议；能否显示日期取决于平台是否返回到期信息） |
| Contents | Read and write（推代码、建 Release） |
| Workflows | Read and write（推送 `.github/workflows/` 时必需） |
| Actions | Read and write（查 CI 结果） |

**npm** — https://www.npmjs.com/settings/hehua704/tokens → Generate New Token → Granular

- Permissions：Read and write；Packages 选 `@hehua704`（或全部）
- **必须勾 Bypass 2FA**：Windows Hello / passkey 给不出 6 位验证码，否则 `npm publish` 报 `EOTP`
- 注意：按 npm 公告，2027-01 起 bypass-2FA token 不能再直接发布，届时改用 OIDC trusted publishing
  （仓库的 workflow 已支持，配好 `NPM_TOKEN` secret 或 trusted publisher 即可）

**PyPI** — https://pypi.org/manage/account/token/

- 第一个包用 Entire account，之后收窄到具体项目
- 没有 whoami 接口，`cred` 只能校验格式（`pypi-` 前缀 + 长度 ≥80）

**crates.io** — https://crates.io/settings/tokens

- Scopes：`publish-new`、`publish-update`、`yank`
- 默认不过期，必须手动轮换

### 写入与自检

```bash
cred set github < token.txt      # 也可以 echo 'xxx' | cred set github
cred set npm    < token.txt
cred set pypi   < token.txt
cred set crates < token.txt

cred recheck                     # 逐个联网校验，结果写回 meta.json
cred list                        # 看状态和到期（未知 = 平台没告知）
```

交互界面里选中平台按 `a` 粘贴；替换已有 token 需要二次确认，保存后自动校验一次。

### 轮换与吊销

| 时机 | 动作 |
|---|---|
| 每 90 天 | 重建 GitHub / crates / PyPI，旧的吊销 |
| 怀疑泄露 | 立刻吊销、重建，不用先确认 |
| 换机器 | 旧 token 吊销，新机器重建 |

吊销入口：GitHub `settings/tokens` · npm `settings/<user>/tokens` · PyPI `manage/account/token` · crates.io `settings/tokens`。

## 常用命令

```bash
cred                          # 交互界面
cred list                     # 列表
cred list --json              # 机器可读
cred recheck                  # 全部校验
cred copy pypi                # 复制到剪贴板（OSC 52）
```

## 多平台

`list` / `get` / `has` / `env` 都接受**多个平台名**，顺序即输出顺序；`all` 表示全部。

```bash
cred get github pypi              # 每行 platform<TAB>token
cred get github pypi --json       # 数组
cred get all --format env         # 只导出已配置的
cred has github pypi crates       # 全部存在才 exit 0
cred env github pypi --export
cred list github npm --json
```

单平台时保持“只输出值”的语义，方便 `$(cred get github)`；多平台时才加前缀，避免歧义。

`--format`：`plain`（默认，tab 分隔）、`env`、`json`。

`has` 的退出码：全部存在 `0`，任一缺失 `1`（缺失项打到 stderr），平台名非法 `2`。

## 跨系统

Windows / macOS / Linux 通用，要求 Node ≥ 22（Ink 8 的要求）。

| 事项 | 处理 |
|---|---|
| 路径分隔符 | 全部走 `node:path`，`C:\\Users\\...` 正常 |
| `~` 展开 | `--dir ~/x`、`--from ~/x` 均支持 |
| 权限位 | Windows 上 `chmod` 只是只读标记，`600/700` 不生效；Unix 上强制 600 |
| 复制 | OSC 52 在 Windows Terminal / iTerm2 / WezTerm 可用 |
| 命令入口 | npm 安装时生成 `.cmd` shim，PowerShell 里直接 `cred` |

## 给脚本 / DSH 取 token

这是给程序用的接口，**输出只有值，没有装饰**：

```bash
cred get github               # 只打印 token
cred get github --json        # {"platform","token","expiresAt","expiresState","expiresSource",…}
cred get github --field expires   # 2027-02-08 | never | unknown
cred get github --field expiresAt # 只有准确日期，未知时为空
cred get github --field user
cred has github               # 存在 exit 0，不存在 exit 1
cred env                      # GITHUB_TOKEN='...' 每行一个
cred env --export             # export GITHUB_TOKEN='...'，可 eval
```

在 DSH 里调用：

```bash
TOKEN=$(cred get github)                    # 直接取值
eval "$(cred env --export)"                 # 一次性注入所有 token
cred has pypi || cred set pypi              # 先判断再补
```

如果 DSH 的工作目录不是项目根，用 `--dir` 指定：

```bash
cred get github --dir /path/to/.cred
```

或者设置一次环境变量：

```bash
export CRED_DIR=/path/to/.cred
```

退出码约定：

| 码 | 含义 |
|---|---|
| 0 | 成功 |
| 1 | token 不存在 / 目录未初始化 |
| 2 | 平台名非法 |

## 快捷键（交互界面）

| 键 | 作用 |
|---|---|
| `↑` `↓` / `j` `k` | 选择平台 |
| `c` | 复制 token（OSC 52，SSH 可用） |
| `v` | 显示 / 隐藏明文 |
| `r` | 联网校验 |
| `e` | 编辑有效期（`2027-02-07` / `+90d` / `none` 不过期 / 留空=未知） |
| `a` | 新增 / 替换 token |
| `d` | 清除元信息（不删 token 文件） |
| `l` | 切换语言 |
| `q` | 退出 |

## 到期时间从哪来

只有**平台自己说了**才算数：

| 情况 | 显示 |
|---|---|
| 平台返回了到期日期 | `90 天后` / `已过期 3 天` / `今天到期` |
| 平台明确说不过期 | `不过期` |
| 平台没说、或这个平台根本不提供 | `未知` |
| 你按 `e` 手动填过 | 日期 + `手动`（平台下次给出结论时以平台为准） |

目前只有 GitHub 可能提供到期时间：对会过期的 token，它在响应头
`github-authentication-token-expiration` 里返回日期；**头不存在时不推断“不过期”**。
crates.io、PyPI、npm 都没有查询到期的接口，所以默认显示 `未知`。

写入或替换 token 时会清空旧的到期信息——旧日期属于旧凭证，不能沿用。

## 语言

优先级：`--lang` > `CRED_LANG`/`DSH_LANG` > `config.toml` > 系统 `LANG` > 默认 `zh-CN`。

```toml
locale = "zh-CN"     # zh-CN | en | auto
fallback = "en"
```

界面里按 `l` 选择会写回 `.cred/config.toml`。

## 校验

| 平台 | 接口 | 说明 |
|---|---|---|
| GitHub | `GET api.github.com/user` | 返回账号名 |
| crates.io | `GET crates.io/api/v1/me` | 接口仅限网页，靠错误文案区分有效性 |
| npm | `GET registry.npmjs.org/-/whoami` | 返回账号名 |
| PyPI | — | 无查询接口，仅校验前缀与长度 |

## 测试

```bash
npm test
```

- 9 条 CLI 测试：init / set / get / get --json / has / env / list --json / 未初始化提示 / --dir；
- 9 条渲染测试：中英 × 60/76/100 列等宽、窄屏降级、ASCII 无 Unicode、语言界面。

## 发布流程

1. 改 `package.json` 的 `version`；
2. 打 tag 并推送：

```bash
git tag v0.1.1 && git push origin v0.1.1
```

3. GitHub Actions 自动执行：

| 步骤 | 说明 |
|---|---|
| `npm ci` / `npm test` / `check:leak` | 每次必跑 |
| `npm pack` | 生成 tarball |
| `npm publish` | **主方案**，用仓库 secret `NPM_TOKEN` |
| `softprops/action-gh-release` | **备用方案**，把 tarball 挂到 Release |

主方案启用条件（一次性）：

- 仓库 Settings → Secrets and variables → Actions → **New repository secret**
  名称 `NPM_TOKEN`，值填 npm 的 Granular Access Token（Read and write + 允许 Bypass 2FA）；
- 仓库 Settings → Variables 添加 `NPM_PUBLISH=true`。

之后打 tag 就会自动发布，同时产出 Release 包。

> 也可以本地直接发：`npm publish --access public`（需要 `~/.npmrc` 或 `--//registry.npmjs.org/:_authToken=...`）。

### 以后想升级到 OIDC

token 方式简单，但 2027 年 1 月起 npm 会禁止 bypass-2FA token 直接发布。届时可切换：

1. npmjs.com → 包页面 → Settings → Trusted publishing → 添加 GitHub Actions
   （`hehua704` / `cred` / `publish.yml`）；
2. 删掉 `NPM_TOKEN` secret，workflow 里去掉 `env: NODE_AUTH_TOKEN`，加回
   `permissions: id-token: write` 和 `npm publish --provenance`。

## 发布前检查

本机配置**不会**进入仓库，也不会进入 npm 包：

| 文件 | 作用 |
|---|---|
| `.gitignore` | 忽略 `.cred/`、`node_modules/`、`dist/`、`*-token`、`meta.json`、`config.toml`、`.env*` |
| `.npmignore` | 发布过滤，与 `package.json` 的 `files` 白名单双保险 |
| `scripts/check-no-secrets.mjs` | 扫描 tarball 文件列表，命中凭证模式直接失败 |

`npm publish` 会自动跑 `prepublishOnly`，先检查再构建：

```bash
npm run check:leak      # 手动跑一次
```

输出示例：

```
✓ 发布检查通过：16 个文件，未发现本机凭证
   LICENSE
   README.md
   bin/cred.js
   dist/cli.js
   locales/zh-CN.json
   ...
```

任何 `*-token`、`meta.json`、`config.toml`、`.env`、`.cred/` 出现在包里都会让发布中止。

## 结构

```
bin/cred.js          入口（指向 dist）
src/cli.tsx          参数解析、数据目录解析、命令分派
src/ui/App.tsx       交互状态与键盘
src/ui/Screen.tsx    纯展示组件
src/store.ts         token 文件与 meta.json
src/verify.ts        各平台校验
src/i18n.ts          文案与优先级
src/config.ts        TOML 读写
src/width.ts         宽度计算
locales/*.json       文案
docs/RELEASE-PLAYBOOK.md   开发与发布流程手册（可复用到其他项目）
```

## License

MIT © hehua704
