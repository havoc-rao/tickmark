# TickMark CLI

把 Markdown 渲染成 HTML 预览：支持 **GFM 表格**、**checkbox 点击回写源文件**、代码高亮。适合在 IDE 里快速预览 `.md` 并交互式勾选任务项。

## 特性

- **GFM 表格** — 标准 markdown-it 表格渲染（对齐、单元格内格式、竖线转义）
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
tickmark serve <file.md> [--port <n>] [--html <path>] [--no-open]
timd    serve <file.md> --no-open
```

- 在同目录生成 `<原名>.tickmark.html`，用配置的 IDE 命令自动打开预览
- 点击 checkbox → 实时回写源 md（HTTP POST `/api/toggle`，0-based 行号定位）
- `Ctrl+C` 退出时自动删除生成的 HTML
- `--no-open` 跳过自动打开；`--html` 指定 HTML 输出位置

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

打开命令解析优先级（高 → 低）：

1. 环境变量：`export TICKMARK_OPEN_CMD="buddycn"`（或 `"code -r"` 等带参命令）
2. 配置文件 `~/.tickmarkrc.json`：
   ```json
   { "openCommand": "buddycn" }
   ```
   或数组形式：
   ```json
   { "openCommand": ["code", "-r"] }
   ```
3. 默认按序探测 `buddycn` → `code`，找不到则提示手动打开

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
src/markdownEngine.ts markdown-it 渲染引擎
src/page.ts           页面模板
src/config.ts         IDE 打开命令解析
src/types/            类型声明
media/preview.css     预览样式
media/preview.js      页面交互（回写/Sync/复制）
examples/             测试样例
```

## License

MIT
