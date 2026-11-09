# @hehua704/cred

凭证管理器 —— 用 Ink + React 写的终端 UI，管理 GitHub PAT、npm、PyPI、crates.io 的发布令牌。
中英双语、宽度感知、SSH 可复制、默认打码，并提供给脚本 / DSH 取 token 的机器接口。

```
╭────────────────────────────────────────────────────────────────────────────────╮
│ cred · 凭证管理器                              语言: 中文  /root/.dsh-publish │
│────────────────────────────────────────────────────────────────────────────────│
│ 凭证列表                     │ GitHub PAT                                     │
│ ▸ GitHub PAT  ● 有效         │ ────────────────────────────────────────────── │
│   crates.io   ● 有效         │ 凭证        github••••••••Unaf                 │
│   PyPI        ◐ 格式正确     │ 用户        hehua704                           │
│   npm         ○ 未配置       │ 状态        ● 有效 · hehua704                  │
│                              │ 更新        2 小时前                           │
│                              │ 到期        90 天后                            │
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
cd /root/开发/cred
npm install && npm run build
node bin/cred.js             # 等同于 cred
# 或者装成命令：
ln -sf "$PWD/bin/cred.js" ~/.local/bin/cred
```

## 数据目录

配置和 token 放在**项目目录**下，不再散落到 `~/.dsh-publish`。

解析顺序：

1. `--dir <path>`
2. 环境变量 `CRED_DIR`
3. 当前目录的 `./.cred`（存在时）
4. `~/.cred`（存在时）
5. 回退到 `./.cred`（由 `cred init` 创建）

初始化：

```bash
cd <你的项目>
cred init                     # 创建 ./.cred（700）+ config.toml + .cred/.gitignore
cred init --from ~/.dsh-publish   # 迁移已有 token
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
cred get github --json        # {"platform","token","expiresAt","updatedAt","user"}
cred get github --field expiresAt
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
cred get github --dir /root/开发/cred/.cred
```

或者设置一次环境变量：

```bash
export CRED_DIR=/root/开发/cred/.cred
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
| `e` | 编辑有效期（`2027-02-07` 或 `+90d`） |
| `a` | 新增 / 替换 token |
| `d` | 清除元信息（不删 token 文件） |
| `l` | 切换语言 |
| `q` | 退出 |

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
| `npm publish --provenance` | **主方案**，需 `NPM_PUBLISH=true` |
| `softprops/action-gh-release` | **备用方案**，把 tarball 挂到 Release |

主方案启用条件（一次性）：

- 在 npmjs.com → Packages → `@hehua704/cred` → Settings → Trusted publishing 添加
  GitHub Actions：`hehua704` / `cred` / `publish.yml`；
- 仓库 Settings → Variables 添加 `NPM_PUBLISH=true`。

在那之前，打 tag 只跑测试并产出 Release 包，不会尝试 npm 发布，也不会有失败的红叉。

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
```

## License

MIT © hehua704
