# TickMark CLI

把 Markdown 渲染成 HTML 预览：支持 **GFM 表格**、**checkbox 点击回写源文件**、代码高亮。适合在 IDE 里快速预览 `.md` 并交互式勾选任务项。

## 特性

- **GFM 表格** — 标准 markdown-it 表格渲染（对齐、单元格内格式、竖线转义）
- **表格列过滤** — 每列支持过滤：自动统计列内取值分布（聚合计数），弹层内多选 / 全选 / 反选 / 清空，过滤即时生效，多列叠加（列内 OR、跨列 AND）
- **表格新增列** — 任意位置加列：悬停任一表头点 `+`（在该列右侧插入）或点工具栏 `+ 列`（末尾插入），输入列名即回写 md（表头 + 分隔行 + 数据行同步补单元格）；可选「批量填值」（如 `[x]`）让新列每个数据行单元格预填同一文本
- **表格单元格填写** — 新增列的单元格可直接点击填写，失焦 / 回车自动回写 md 源文件（自动转义 `\|`，行号安全校验）；批量填值 `[x]`/`[ ]` 时该列渲染为可点击 checkbox 单元格，点击自动切换并回写
- **表格列拖拽换列** — 工具栏点「✎ 编辑」进入编辑模式：表头显示拖拽手柄 `⋮⋮`，拖到目标列位置（左/右）即换列并回写 md；过滤选中状态、过滤工具栏同步跟随
- **修改历史（撤销 / 重做 / 重置）** — 工具栏提供 `↶ 撤销`、`↷ 重做`、`重置`：撤销/重做覆盖 checkbox 与表格编辑的全部修改；`重置` 一键取消本次会话所有修改（恢复到打开时的内容，仍可「重做」找回）
- **启动自动备份** — `serve` 启动时把原始 md 物理备份为同目录 `<原文件名>.tickmark.bak`（防止对原数据的破坏），`重置` 本质上就是把这份备份直接放回去；退出时自动删除备份
- **主题切换** — 工具栏「主题」按钮：外观（浅色 / 深色 / 跟随系统）、强调色（蓝 / 绿 / 紫 / 橙 / 玫红）、**语言**（中文 / English）独立切换，选择持久化到本地（`localStorage`），下次打开自动恢复
- **Checkbox 回写** — 预览页点击 `- [ ]` / `- [x]`，直接改写磁盘上的 `.md` 源文件
- **代码高亮** — highlight.js 高亮 + 一键复制按钮
- **独立 HTML 预览** — `serve` 生成单文件 HTML（CSS/JS 全部内联），IDE 直接打开即可交互
- **实时同步** — Sync 按钮重新拉取源文件渲染，配合外部编辑
- **i18n 基础 UI** — 中文（默认）/ English，预览页所有按钮 / 提示 / Toast 可实时切换；切换无需刷新页面，菜单、表格过滤栏、添加列弹层（含「插入位置」自定义下拉）文案一并更新

## 安装

### 一键安装（推荐）

```bash
curl -fsSL https://raw.githubusercontent.com/havoc-rao/tickmark/main/scripts/install.sh | sh
```

脚本会：下载最新 release 产物到 `~/.local/share/tickmark` → `npm install --omit=dev` 装运行时依赖 → 软链 `tickmark` / `timd` 到 `~/.local/bin`。

> 若 `~/.local/bin` 不在 PATH，把 `export PATH="$HOME/.local/bin:$PATH"` 加到 `~/.zshrc` / `~/.bashrc`，重启 shell。

**当前会话立即生效**（不重启 shell）：

```bash
eval "$(curl -fsSL https://raw.githubusercontent.com/havoc-rao/tickmark/main/scripts/install.sh | sh)"
```

前置要求：`node >= 18`、`npm`、`curl`、`tar`。

### 本地开发

```bash
git clone https://github.com/havoc-rao/tickmark.git
cd tickmark
npm install
npm run compile
npm link          # 全局软链 tickmark / timd
```

安装后获得两个等价命令：

| 命令 | 说明 |
| ---- | ---- |
| `tickmark` | 全名 |
| `timd` | 缩写 |

## 用法

### serve — 交互式预览（推荐）

```bash
tickmark serve <file.md> [--port <n>] [--html <path>] [--no-open] [--ide <name>]
timd    serve <file.md> --no-open
timd    server <file.md>        # server 是 serve 的别名
```

- 在同目录生成 `<原名>.tickmark.html`，用配置的 IDE 命令自动打开预览
- 点击 checkbox → 实时回写源 md（HTTP POST `/api/toggle`，0-based 行号定位）
- `Ctrl+C` 退出时自动删除生成的 HTML
- `--no-open` 跳过自动打开；`--html` 指定 HTML 输出位置
- `--ide <name>` 单次指定用哪个 IDE 打开（如 `--ide cursor`），不改变默认设置

### render — 静态渲染

```bash
tickmark render <file.md> [--out <file.html>]
```

渲染为独立 HTML 文件（静态，无回写能力）。

### update — 自动更新（GitHub）

```bash
timd update --check       # 只检查最新版本，不升级
timd update               # 检测到新版本即自动升级
timd update --force       # 强制重装（已是最新也执行）
```

- 通过 `releases/latest` 302 重定向解析最新 tag（与安装脚本一致，不受 API 限流影响；失败自动回退 GitHub API，可设 `GITHUB_TOKEN` 绕过限流）
- **release 安装**（`install.sh` 装到 `~/.local/share/tickmark`）：下载 `tickmark_<version>.tar.gz` → 解压替换安装目录（保留 `node_modules` 增量装依赖）→ `npm install --omit=dev`
- **git 源码安装**（目录含 `.git`）：校验工作区干净 → `git pull --ff-only` → `npm install --omit=dev` → `npm run compile`
- 软链 `~/.local/bin/tickmark` / `timd` 指向同一安装目录，无需变动

### 示例

```bash
timd serve README.md                  # 生成 README.md.tickmark.html 并打开
timd serve examples/test-checkbox-table.md --no-open
timd render README.md --out readme.html
timd update --check                   # 检查是否有新版本
```

## 配置管理（`tickmark config`）

IDE 打开命令与界面语言本质都是写入 `~/.config/tickmark/config.json` 的配置项，统一用 `tickmark config` 管理：

```bash
tickmark config                        # 查看当前配置（IDE / 语言 / 已存配置项）
tickmark config list                   # 同上
tickmark config set ide cursor         # 设置默认用 Cursor 打开
tickmark config set lang en-US         # 预览界面切到英文（zh-CN / en-US）
tickmark config get lang               # 读取单个配置（未设置显示 (未设置)）
tickmark config unset openCommand      # 删除某个配置项，恢复默认
```

`tickmark ide` 为兼容旧命令，等价于 `tickmark config set ide` / `tickmark config`（列 IDE）。

### 配置项

| key | 说明 | 示例值 |
|---|---|---|
| `openCommand` / `ide` | 预览用 IDE 打开命令（支持数组形式 `["code", "-r"]`） | `code`、`buddycn`、`"code -r"` |
| `lang` / `language` | 预览页界面语言（i18n，zh-CN 默认） | `zh-CN`、`en-US` |

`config set lang` 写入后，重新 `tickmark serve` / `render` 生成的预览页即按该语言打开（CLI 配置优先于页面内切换）；页面内主题菜单也能临时切换语言。

### IDE 打开命令解析优先级（高 → 低）

1. 单次指定：`tickmark serve x.md --ide code`（也支持带参，如 `--ide "code -r"`）
2. 环境变量：`export TICKMARK_OPEN_CMD="buddycn"`（或 `"code -r"` 等带参命令）
3. 配置文件 `~/.config/tickmark/config.json`（`tickmark config set ide` 写入）：
   ```json
   { "openCommand": "buddycn" }
   ```
   或数组形式：
   ```json
   { "openCommand": ["code", "-r"] }
   ```
4. 默认按序探测预设 IDE `buddycn` → `code` → `cursor` → …，找不到则提示手动打开

预设 IDE 见 `tickmark config` 输出（含 macOS `/Applications` 应用探测）；`--ide` 指定的命令不存在时自动回退到默认配置。

## 测试样例

`examples/test-checkbox-table.md` 覆盖了 checkbox 回写与表格渲染的各场景：

- checkbox：三态（`[ ]`/`[x]`/`[X]`）、`-`/`*`/`+` 前缀、多级嵌套缩进、行内格式混合、空内容后缀、负例（有序列表/引用块中的 checkbox 仅渲染不回写）
- 表格：三种对齐、单元格内格式（粗体/行内代码/链接/竖线转义）、空单元格、表格内嵌 checkbox 文本

```bash
timd serve examples/test-checkbox-table.md
```

## 工作原理

```
.md ──► markdown-it + markdown-it-task-lists ──► HTML（含 data-source-line 行号）
         ▲                                             │
         │ 点击 checkbox                                │ POST /api/toggle {line, checked}
         └─────────────────────────────────────────────┘
                         改写磁盘源文件
```

- 行号来源：自定义 markdown-it 插件给每个 block 元素注入 `data-source-line`（0-based）
- 回写安全：`src/checkbox.ts` 用正则 `^(\s*[-*+]\s+\[)([ xX])(\])(.*)$` 重新校验目标行确为 task item 才改写，外部改动过文件也不会错改行
- 载体：`serve` 同时提供「独立 HTML（fetch 回写）」与「服务器模式（浏览器直开 `/`）」两种

## 项目结构

```
bin/tickmark.js       CLI 入口（加载 out/cli.js）
src/cli.ts            子命令分发器（render / serve / config / ide / update）
src/cli/serve.ts      serve 子命令（含 server 别名，HTTP 服务 + 独立 HTML 生成）
src/cli/render.ts     render 子命令（静态渲染）
src/cli/config.ts     config 子命令（统一管理 IDE / 语言等配置）
src/cli/ide.ts        ide 子命令（兼容旧命令，委托 config）
src/cli/update.ts     update 子命令（GitHub 自动更新）
src/cli/version.ts    版本读取与语义化比较（包根定位）
src/serve.ts          HTTP 服务 + 独立 HTML 生成
src/checkbox.ts       checkbox 回写磁盘逻辑
src/table.ts          表格新增列 / 单元格回写磁盘逻辑
src/markdownEngine.ts markdown-it 渲染引擎
src/page.ts           页面模板
src/config.ts         配置文件读写（IDE 打开命令 / 语言，~/.config/tickmark/config.json）
src/types/            类型声明
media/preview.css     预览样式
media/preview.js      页面交互（构建产物，由 media/src 合并生成）
media/src/utils.js    预览页通用工具（api/closest/tmPopover/主题存储等）
media/src/i18n.js     国际化模块（zh-CN / en-US 字典 + t()/setLang/subscribe）
media/src/templates.js HTML 模板常量（过滤弹层/新增列/历史/大纲/主题）
media/src/preview.js  页面交互源码（回写/Sync/复制/表格编辑/自定义下拉/语言切换）
scripts/build-media.js 按 utils → i18n → templates → preview 合并为 media/preview.js（npm run build:media）
examples/             测试样例
```

## License

MIT
