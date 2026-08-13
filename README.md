# TickMark CLI

把 Markdown 渲染成 HTML 预览：支持 **GFM 表格**、**checkbox 点击回写源文件**、代码高亮。适合在 IDE 里快速预览 `.md` 并交互式勾选任务项。

## 特性

- **GFM 表格** — 标准 markdown-it 表格渲染（对齐、单元格内格式、竖线转义）
- **表格列过滤** — 每列支持过滤：自动统计列内取值分布（聚合计数），弹层内多选 / 全选 / 反选 / 清空，过滤即时生效，多列叠加（列内 OR、跨列 AND）
- **表格新增列** — 任意位置加列：悬停任一表头点 `+`（在该列右侧插入）或点工具栏 `+ 列`（末尾插入），输入列名即回写 md（表头 + 分隔行 + 数据行同步补单元格）
- **表格单元格填写** — 新增列的单元格可直接点击填写，失焦 / 回车自动回写 md 源文件（自动转义 `\|`，行号安全校验）
- **修改历史（撤销 / 重做 / 重置）** — 工具栏提供 `↶ 撤销`、`↷ 重做`、`重置`：撤销/重做覆盖 checkbox 与表格编辑的全部修改；`重置` 一键取消本次会话所有修改（恢复到打开时的内容，仍可「重做」找回）
- **启动自动备份** — `serve` 启动时把原始 md 物理备份为同目录 `<原文件名>.tickmark.bak`（防止对原数据的破坏），`重置` 本质上就是把这份备份直接放回去；退出时自动删除备份
- **主题切换** — 工具栏「主题」按钮：外观（浅色 / 深色 / 跟随系统）与强调色（蓝 / 绿 / 紫 / 橙 / 玫红）独立切换，选择持久化到本地（`localStorage`），下次打开自动恢复
- **Checkbox 回写** — 预览页点击 `- [ ]` / `- [x]`，直接改写磁盘上的 `.md` 源文件
- **代码高亮** — highlight.js 高亮 + 一键复制按钮
- **独立 HTML 预览** — `serve` 生成单文件 HTML（CSS/JS 全部内联），IDE 直接打开即可交互
- **实时同步** — Sync 按钮重新拉取源文件渲染，配合外部编辑

## 安装

```bash
# 本地开发/全局链接
npm install
npm run compile
npm link

# 或发布后全局安装
npm i -g tickmark-cli
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

### 示例

```bash
timd serve README.md                  # 生成 README.md.tickmark.html 并打开
timd serve examples/test-checkbox-table.md --no-open
timd render README.md --out readme.html
```

## IDE 打开命令配置

用 `tickmark ide` 可以自选预览用的 IDE（`code` / `buddycn` / `cursor` / `vim` 等，支持探测本机安装情况）：

```bash
tickmark ide                 # 列出本机已安装的（预设）IDE，标记当前默认
tickmark ide list            # 同上
tickmark ide set cursor      # 设置默认用 Cursor 打开（写入 ~/.config/tickmark/config.json）
```

打开命令解析优先级（高 → 低）：

1. 单次指定：`tickmark serve x.md --ide code`（也支持带参，如 `--ide "code -r"`）
2. 环境变量：`export TICKMARK_OPEN_CMD="buddycn"`（或 `"code -r"` 等带参命令）
3. 配置文件 `~/.config/tickmark/config.json`（`tickmark ide set` 写入）：
   ```json
   { "openCommand": "buddycn" }
   ```
   或数组形式：
   ```json
   { "openCommand": ["code", "-r"] }
   ```
4. 默认按序探测预设 IDE `buddycn` → `code` → `cursor` → …，找不到则提示手动打开

预设 IDE 见 `tickmark ide` 输出（含 macOS `/Applications` 应用探测）；`--ide` 指定的命令不存在时自动回退到默认配置。

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
src/cli.ts            子命令解析（render / serve）
src/serve.ts          HTTP 服务 + 独立 HTML 生成
src/checkbox.ts       checkbox 回写磁盘逻辑
src/table.ts          表格新增列 / 单元格回写磁盘逻辑
src/markdownEngine.ts markdown-it 渲染引擎
src/page.ts           页面模板
src/config.ts         IDE 打开命令解析
src/types/            类型声明
media/preview.css     预览样式
media/preview.js      页面交互（回写/Sync/复制/表格编辑）
examples/             测试样例
```

## License

MIT
