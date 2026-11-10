# cred 会话交接（精简版）

> 这份文档替代原会话的完整记录：只保留**结论、实现和踩过的坑**。
> 原会话约 7 MB / 2900 条事件，读一遍要花掉大半上下文；这里压到一页能扫完。
>
> - 来源会话：`/root/开发` · `session-e0dbc3c9-70b5-4382-921f-0de541a6d4e2`
> - 迁移落点：`/root/project/凭证管理器`（本仓库根目录）
> - 生成时间：2026-11-10

---

## 0. 怎么用

新会话直接说：

> 先读 `SESSION-HANDOFF.md`，再按 `docs/RELEASE-PLAYBOOK.md` 干活。当前项目是 `@hehua704/cred`。

需要原文时再解压（本机没有 `zstd` 命令，Node 自带）：

```bash
node -e 'const z=require("zlib"),fs=require("fs");
process.stdout.write(z.zstdDecompressSync(fs.readFileSync(process.argv[1])).toString())' \
  ~/.dsh/sessions/--root-~5F00~53D1--/session-e0dbc3c9-*/session.v4.jsonl.zstd | less
```

---

## 1. 现状一页纸

| 项 | 值 |
|---|---|
| 包名 / 命令 | `@hehua704/cred` / `cred` |
| 当前版本 | `0.1.3`（本地；npm `latest` 仍是 0.1.2，等推送后发） |
| 仓库 | `https://github.com/hehua704/cred`，远端停在 `cf6919d` |
| 本地状态 | 领先远端 2 个提交（0.1.2 的 init 修复 + 0.1.3 的 config 修复），**均未推送** |
| 技术栈 | Node ≥22 · TypeScript 5.9 · Ink 8 + React 19 · ESM |
| 数据目录 | `./.cred`（本机默认 `/root/project/凭证管理器/.cred`） |
| 全局命令 | 已 `npm link`，`/usr/local/bin/cred` 指向本仓库 |
| 测试 | 26 项全过（`npm test`） |
| 缺口 | 四个平台的 token 都在事故后删除了，需要重新写入 |

一次完整验证：

```bash
cd /root/project/凭证管理器
npm run build && npm test
cred -v && cred list
```

---

## 2. 实现（重点）

### 2.1 分层

```
bin/cred.js          薄入口，只 import ../dist/cli.js
src/cli.tsx          参数解析、数据目录解析、命令分派、usage
src/ui/App.tsx       交互状态机（useInput）、挂载时自动校验、OSC 52 复制、resize
src/ui/Screen.tsx    纯展示组件（无副作用，可被 ink-testing-library 直接渲染）
src/store.ts         token 文件 + meta.json 的读写
src/verify.ts        四平台探测，8s 超时（AbortController）
src/i18n.ts          locale 解析优先级 + 字典回退
src/config.ts        .cred/config.toml 的极简 TOML 读写（不引依赖）
src/width.ts         CJK 宽度、ANSI 剥离、pad/truncate
src/platforms.ts     平台注册表：key / file / label / 默认有效期
src/types.ts         共享类型
```

**关键设计：展示层与交互层分离。** `Screen.tsx` 只吃 `ScreenState` 和 `t()`，不碰文件系统，
所以宽屏/窄屏/ASCII/两种语言都能在测试里直接渲染断言，不需要 TTY。

### 2.2 数据目录怎么定

解析顺序（`resolveDir()`）：

1. `--dir <path>`
2. 环境变量 `CRED_DIR`
3. 当前目录的 `./.cred`（存在即用，项目内优先）
4. `cred use` 写入的全局默认（`~/.config/cred/config.json` 的 `defaultDir`）
5. `~/.cred`（存在时）
6. 回退到 `./.cred`（由 `cred init` 创建）

**`cred init` 是唯一例外**：只看 `--dir` / `CRED_DIR`，否则**永远写当前目录**，绝不走全局回退。
这是 0.1.2 修的 bug——早先测试在临时目录里 `init`，写进了真实库，覆盖了真 token。
同一类问题还有第二处：`config.toml` 原先写在 `CONFIG_PATH`（解析后的目录，可能就是全局库）上，
0.1.3 改成写 `join(DIR, 'config.toml')`，测试里加了断言。

### 2.3 存储格式

```
.cred/                 700
├── .gitignore         "*\n!.gitignore\n"（自带兜底，项目根没 gitignore 也不怕）
├── config.toml        locale / fallback
├── meta.json          600，元信息
├── github-token       600，纯 token，无 JSON 包裹
├── crates-token
├── pypi-token
└── npm-token
```

`meta.json` 以文件名（`github-token`）为键：

```json
{
  "github-token": {
    "createdAt": "2026-11-09T…",
    "updatedAt": "2026-11-10T…",
    "expiresAt": "2027-02-07",
    "lastStatus": { "ok": true, "user": "hehua704", "code": null },
    "lastCheckedAt": "2026-11-10T…"
  }
}
```

- 读 token 时只取第一段空白前的字符，容忍尾随换行/注释；
- `set` 时保留原 `createdAt`，只刷新 `updatedAt`，并把 `lastStatus` 置空；
- GitHub 首次写入且没设过有效期时，自动填 +90 天。

### 2.4 校验矩阵

| 平台 | 请求 | 能判断 | 判断不了 |
|---|---|---|---|
| GitHub | `GET api.github.com/user`，`Bearer` | 有效性 + 用户名 | 有没有目标仓库的写权限 |
| crates.io | `GET crates.io/api/v1/me` | 200 → 有效；错误文案含 `website` → **也视为有效** | 已被限制为仅网页，403 不等于无效 |
| npm | `GET registry.npmjs.org/-/whoami` | 有效性 + 用户名 | 发布权限、2FA 策略 |
| PyPI | 纯本地格式：`pypi-` 前缀 + 长度 ≥80 | 格式对不对 | 一切服务端状态（没有 whoami 接口） |

`ok` 三态：`true` 有效 / `false` 无效 / `null` 未知（格式正确或接口不支持）。
`recheck` 和界面里的 `r` 都会把结果写回 `meta.json`，下次打开直接显示上次状态。

### 2.5 TUI

- **布局**：宽度 `clamp(60, 终端列数, 110)`；`W ≥ 76` 双栏（左栏固定 30），否则单栏只留列表。
  所有行用 `width()` 按显示宽度对齐，中英混排不会错位。
- **主题**：Unicode 框线 / ASCII 两套（`--ascii`，或 `LANG` 不含 UTF-8 时自动切）。
- **打码**：`前6 + 8 个点 + 后4`；长度 ≤12 只留前 3。
- **键位**：`↑↓/jk` 选择 · `c` 复制（OSC 52）· `v` 显隐 · `r` 校验 · `e` 有效期（支持 `+90d`）
  · `a` 新增/替换（替换要二次确认）· `d` 清除元信息 · `l` 语言 · `q` 退出。
- **复制**：OSC 52 转义序列直接写剪贴板，SSH 里可用；tmux 下自动包 `\x1bPtmux;` 透传。
  不打印明文，失败就提示按 `v` 手动选。
- **i18n**：`--lang` > `CRED_LANG`/`DSH_LANG` > `config.toml` > `LANG`/`LC_ALL` > `zh-CN`；
  字典缺失回退 `en`，再缺就显示 key。`ja` 只有条目没有字典（`AVAILABLE` 里标了 unsupported）。
- **状态机**：`list | lang | token 输入 | 有效期输入 | 替换确认`，全部在 `useInput` 一个入口里分派。

### 2.6 机器接口（给脚本和 DSH 用）

| 命令 | 输出 |
|---|---|
| `cred get <p>` | 只有 token，无装饰 |
| `cred get <p1> <p2>` | 每行 `platform<TAB>token` |
| `cred get <p> --json` | `{platform,token,expiresAt,updatedAt,user}` |
| `cred get <p1> <p2> --json` | 上面的数组 |
| `cred get <p> --field token\|expiresAt\|user` | 单个字段 |
| `cred get all --format env` | `GITHUB_TOKEN='…'`，只输出已配置的 |
| `cred has <p...>` | 无输出；全部存在 `0`，任一缺失 `1`，平台名非法 `2` |
| `cred env --export` | `export …`，可 `eval "$(cred env --export)"` |
| `cred list --json` | 数组：platform/configured/status/user/expiresAt/updatedAt/mode |

约定：**单平台给裸值，多平台才加前缀**——最常用的写法不被破坏；缺失项走 stderr，不污染 stdout。

### 2.7 安全与发布：四层

1. **仓库层** `.gitignore`：`.cred/`、`*-token`、`meta.json`、`config.toml`、`.env*`、`dist/`、`node_modules/`；
2. **目录层** `.cred/.gitignore` 内容 `*`，即使项目根没有 gitignore 也提交不进去；
3. **打包层** `package.json` 的 `files` 白名单（bin/dist/locales/docs/README/LICENSE）+ `.npmignore` 双保险；
4. **发布层** `prepublishOnly` → `scripts/check-no-secrets.mjs`，枚举**实际会打进包的文件**，
   命中 token 模式就中止发布，不靠人眼。

运行时：目录 700、文件 600、默认打码、复制不打印。

### 2.8 测试

`node --test`，26 项：

- `test/cli.test.js`（17）：init/set/get/has/env/list、`--dir`、多平台、`cred use`、
  以及「init 只写当前目录」的回归测试；
- `test/screen.test.js`（9）：两语言 × 60/76/100 列**每行等宽**、窄屏隐藏详情、ASCII 无 Unicode 字符。

关键细节：CLI 测试用 `spawnSync` 起独立进程，**隔离 `HOME` 与 `XDG_CONFIG_HOME`**，
并清空 `CRED_DIR`——测试永远碰不到真实库。这条是事故之后加的。

### 2.9 构建与发布链路

```
tsc → dist/           （dist 不进 git，但进 npm 包；prepare 时自动构建）
npm test → check:leak → npm pack → npm publish --access public
tag v* → GitHub Actions：test → leak → pack → 发 npm（vars.NPM_PUBLISH）→ 附件挂 Release（备用）
```

---

## 3. 走错的尝试（只留结论）

| 尝试 | 结果 | 结论 |
|---|---|---|
| npm Trusted Publishing（OIDC） | 未发布的包在 packages 页看不到，无法配置；仓库/工作流名要逐字匹配 | 放弃，改 token；OIDC 留作 2027 前的升级项 |
| 2FA 走浏览器授权 | `EOTP`；Windows Hello 给不出 6 位码 | 只能用带 **Bypass 2FA** 的 granular token |
| 换 token 后仍 401 | 网站已吊销，本地文件还是旧的 | 先 `cred set` 覆盖，再看 401 |
| `git push` 到 github.com | `:443` 直连被阻断（`ls-remote` 偶尔能过，clone/push 不行） | 用 Git Data API（`scripts/push-api.mjs`）或 `ghproxy.net` 镜像 remote |
| CI 装依赖 `EALLOWREMOTE` | lockfile 的 `resolved` 指向镜像站 | 用官方 registry 重新生成 lockfile |
| `dist/` 里混进 `.cred` | 某次在 `dist/` 跑过 `init` | `check-no-secrets` 拦住；已删 |
| 新包 registry 404 但 dist-tags 200 | packument 异步生成 | 等 1–5 分钟，不是发布失败 |
| `npm pack --dry-run --json` 空输出 | npm 12 行为差异 | 改用真实打包 + `tar -tzf` 校验 |
| 命令必须 `cd` 到项目才能用 | 目录解析只认 `./.cred` | 加 `cred use` 设全局默认 |
| 测试覆盖了真实 token | `init` 回退到了全局默认库 | 0.1.2：init 锁死当前目录 + 测试隔离 HOME |
| 新目录 init 后没有 `config.toml` | 写的是解析后的 `CONFIG_PATH`，落到全局库 | 0.1.3：改写到目标目录，加断言 |
| crates.io 显示 403 | `/api/v1/me` 已限制为仅网页，合法 token 也 403 | 按错误文案判断，`website` 也算有效 |
| PyPI 想校验用户名 | 没有 whoami 接口 | 只做格式校验，如实标「格式正确」 |
| 把 PyPI token 贴进对话 | 已吊销重建 | 铁律：只走 `cred set` 或写文件 |

---

## 4. 未完成 / 下一步

1. **重新写入 token**（事故后已删）：GitHub PAT、PyPI、npm、crates。
   ```bash
   echo 'github_pat_xxx' | cred set github
   echo 'pypi-xxx'       | cred set pypi
   echo 'npm_xxx'        | cred set npm
   cred recheck
   ```
2. **推送到远端并发 0.1.3**（远端还是 `cf6919d`）。直连不通时：
   ```bash
   git push mirror main      # mirror = https://ghproxy.net/https://github.com/hehua704/cred.git
   # 或 node scripts/push-api.mjs hehua704/cred .cred/github-token "fix(cli): …"
   ```
3. npm 上还挂着一个 `0.0.0-stage` 残留（72 小时内可 unpublish，不影响 `latest`）。
4. `ja` 只有语言条目，没有字典；要用就补 `locales/ja.json`。

---

## 5. 命令速查

```bash
cred                              # 交互界面
cred list [平台…] [--json]        # 列表
cred get github pypi              # 取 token（tab 分隔）
cred get github --json            # 带元信息
cred has github npm               # 退出码判断
cred env --export                 # 导出环境变量
cred recheck [平台…]              # 联网校验并写回 meta
cred set npm < token.txt          # 写入（600）
cred copy pypi                    # OSC 52 复制
cred init [--from <旧目录>]       # 当前目录建 .cred
cred use <dir> | cred use         # 设/看全局默认
cred --preview --width 84         # 渲染一帧（不需要 TTY）
```

---

## 6. 原会话索引

| 会话 | 位置 | 大小 | 内容 |
|---|---|---|---|
| 主会话 | `/root/开发` · `session-e0dbc3c9-…` | 7.0 MB / 2947 事件 | 命名 → 凭证 → TUI → npm/GitHub 发布 → 事故与修复 |
| 空壳 | `/root/project/cred` · `session-b4323209-…` | 1.3 KB | 只开了个头，无内容 |

会话文件都是 `~/.dsh/sessions/<cwd 转义>/<id>/session.v4.jsonl.zstd`，
用第 0 节那段 Node 一行命令即可解压成 JSONL。
