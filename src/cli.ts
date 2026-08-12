#!/usr/bin/env node
import * as fs from 'fs';
import * as path from 'path';
import { spawn } from 'child_process';
import { MarkdownEngine } from './markdownEngine';
import { renderPage } from './page';
import { startServer } from './serve';
import { resolveOpenCommand } from './config';

const VERSION = '0.1.0';

function usage(): void {
  console.log(`
TickMark CLI v${VERSION} — 快速把 md 渲染成 HTML，并支持 checkbox 点击回写源文件

用法:
  tickmark serve  <file.md> [--port <n>] [--html <path>] [--no-open]
                               生成同层 HTML（<原名>.tickmark.html），
                               自动用配置的 IDE 打开预览，
                               点击 checkbox 实时回写源 md，退出时删除 HTML。
  tickmark render <file.md> [--out <file.html>]
                               渲染 md 为独立 HTML 文件（静态，不回写）
  tickmark --help              显示帮助
  tickmark --version           显示版本

功能:
  • GFM 表格渲染
  • checkbox (- [ ] / - [x]) 点击切换，直接回写 .md 源文件
  • 自动用 IDE 打开预览（配置见下）
  • 退出时自动删除生成的 HTML（--no-open 跳过打开）
  • 代码高亮 + 复制按钮

IDE 打开命令配置（优先级高→低）:
  1. 环境变量: export TICKMARK_OPEN_CMD="buddycn"
  2. 配置文件 ~/.tickmarkrc.json: { "openCommand": "buddycn" }
     或数组: { "openCommand": ["code", "-r"] }
  3. 默认探测 buddycn → code

示例:
  tickmark serve sample.md                        # 生成 sample.md.tickmark.html 并打开
  tickmark serve sample.md --no-open              # 只生成不打开
  tickmark serve sample.md --html ./p.html        # 指定 HTML 位置
  tickmark render README.md --out readme.html
`);
}

/** render 子命令：静态转换 */
function cmdRender(args: string[]): void {
  const file = args[0];
  if (!file || !fs.existsSync(file)) {
    console.error(`文件不存在: ${file}`);
    process.exit(1);
  }

  let out: string | undefined;
  const i = args.indexOf('--out');
  if (i >= 0 && args[i + 1]) out = args[i + 1];

  const engine = new MarkdownEngine();
  const content = fs.readFileSync(file, 'utf8');
  const { html } = engine.render(content);
  const page = renderPage({
    title: path.basename(file),
    bodyHtml: html,
  });

  const outFile = out || file.replace(/\.(md|markdown|mdx)$/i, '') + '.html';
  fs.writeFileSync(outFile, page, 'utf8');
  console.log(`✓ 已渲染: ${outFile}`);
  console.log(`  原始文件未修改。运行 "tickmark serve ${file}" 可获得 checkbox 回写能力。`);
}

/** serve 子命令：生成同层 HTML + 自动用 IDE 打开 + 常驻回写服务 */
async function cmdServe(args: string[]): Promise<void> {
  const file = args[0];
  if (!file || !fs.existsSync(file)) {
    console.error(`文件不存在: ${file}`);
    process.exit(1);
  }

  const i = args.indexOf('--port');
  const port = i >= 0 ? Number(args[i + 1]) : undefined;

  const j = args.indexOf('--html');
  const htmlFile = j >= 0 && args[j + 1] ? path.resolve(args[j + 1]) : undefined;

  const noOpen = args.includes('--no-open');

  let generatedHtml = '';

  try {
    const { server, htmlFile: outHtml } = await startServer(file, {
      port,
      htmlFile,
    });
    generatedHtml = outHtml;

    console.log('┌──────────────────────────────────────────────');
    console.log('│  TickMark 服务已启动（Ctrl+C 退出）');
    console.log('│');
    console.log(`│  预览文件: ${outHtml}`);
    console.log(`│  点击 checkbox → 自动回写源文件 ${path.basename(file)}`);
    console.log('└──────────────────────────────────────────────');

    // 自动用配置的 IDE 命令打开 HTML
    if (!noOpen && outHtml) {
      const openCfg = resolveOpenCommand();
      if (openCfg) {
        openInIde(openCfg.command, outHtml);
        console.log(`✓ 已用 ${openCfg.command.join(' ')} 打开预览`);
      } else {
        console.log(`提示: 未找到 IDE 打开命令，请手动打开 ${outHtml}`);
        console.log('      可配置环境变量 TICKMARK_OPEN_CMD 或 ~/.tickmarkrc.json 的 openCommand');
      }
    }

    // 退出时删除生成的 HTML（render 产物不受影响）
    const cleanup = () => removeHtml(generatedHtml);
    process.on('SIGINT', () => {
      cleanup();
      process.exit(0);
    });
    process.on('SIGTERM', () => {
      cleanup();
      process.exit(0);
    });
    process.on('SIGHUP', () => {
      cleanup();
      process.exit(0);
    });
    server.on('close', () => {
      cleanup();
      process.exit(0);
    });
  } catch (err) {
    console.error(`启动失败: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
}

/** 用 IDE 命令打开文件（非阻塞，detached） */
function openInIde(command: string[], filePath: string): void {
  try {
    const child = spawn(command[0], [...command.slice(1), filePath], {
      stdio: 'ignore',
      detached: true,
    });
    child.unref();
  } catch (err) {
    console.error(`打开失败（${command.join(' ')}）: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/** 删除 serve 生成的 HTML 文件 */
function removeHtml(htmlFile: string): void {
  if (!htmlFile) return;
  try {
    if (fs.existsSync(htmlFile)) {
      fs.unlinkSync(htmlFile);
      console.log(`\n已删除预览文件: ${htmlFile}`);
    }
  } catch (err) {
    console.warn(`删除预览文件失败: ${err instanceof Error ? err.message : String(err)}`);
  }
}

async function main(): Promise<void> {
  const [, , sub, ...rest] = process.argv;

  if (!sub || sub === '--help' || sub === '-h' || sub === 'help') {
    usage();
    return;
  }
  if (sub === '--version' || sub === '-v' || sub === 'version') {
    console.log(VERSION);
    return;
  }

  switch (sub) {
    case 'render':
      cmdRender(rest);
      break;
    case 'serve':
      await cmdServe(rest);
      break;
    default:
      console.error(`未知子命令: ${sub}`);
      usage();
      process.exit(1);
  }
}

// 顶层 await 支持
main().catch((err) => {
  console.error(err);
  process.exit(1);
});
