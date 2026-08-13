#!/usr/bin/env node
import * as fs from 'fs';
import * as path from 'path';
import { spawn } from 'child_process';
import { MarkdownEngine } from './markdownEngine';
import { renderPage } from './page';
import { startServer } from './serve';
import {
  resolveOpenCommand,
  setDefaultCommand,
  listAvailableIdes,
  commandExists,
} from './config';

const VERSION = '0.1.0';

function usage(): void {
  console.log(`
TickMark CLI v${VERSION} — 快速把 md 渲染成 HTML，并支持 checkbox 点击回写源文件

用法:
  tickmark <file.md> [serve 选项]       # 简写，等价于 serve
  tickmark serve  <file.md> [--port <n>] [--html <path>] [--no-open] [--ide <name>]
                               生成同层 HTML（<原名>.tickmark.html），
                               自动用配置的 IDE 打开预览，
                               点击 checkbox 实时回写源 md，退出时删除 HTML。
  tickmark render <file.md> [--out <file.html>]
                               渲染 md 为独立 HTML 文件（静态，不回写）
  tickmark ide [list]          列出本机可用的（预设）IDE 及当前默认
  tickmark ide set <cmd>       设置默认 IDE（写入 ~/.config/tickmark/config.json）
  tickmark --help              显示帮助
  tickmark --version           显示版本

功能:
  • GFM 表格渲染
  • checkbox (- [ ] / - [x]) 点击切换，直接回写 .md 源文件
  • 自动用 IDE 打开预览（可用 tickmark ide 自选 IDE，见下）
  • 退出时自动删除生成的 HTML（--no-open 跳过打开）
  • 代码高亮 + 复制按钮

IDE 选择（优先级高→低）:
  1. 单次指定: tickmark serve x.md --ide code   （也支持带参, 如 --ide "code -r"）
  2. 环境变量: export TICKMARK_OPEN_CMD="buddycn"
  3. 默认 IDE: tickmark ide set cursor           （写入 ~/.config/tickmark/config.json）
  4. 自动探测: buddycn → code → cursor → …（tickmark ide list 查看本机已装）

示例:
  tickmark ide                                  # 查看已装 IDE 与当前默认
  tickmark ide set buddycn                      # 默认用 CodeBuddy (CN) 打开
  tickmark serve sample.md                      # 生成 sample.md.tickmark.html 并打开
  tickmark serve sample.md --ide cursor         # 本次改用 Cursor 打开
  tickmark serve sample.md --no-open            # 只生成不打开
  tickmark serve sample.md --html ./p.html      # 指定 HTML 位置
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

  const k = args.indexOf('--ide');
  const ideArg = k >= 0 && args[k + 1] ? args[k + 1] : undefined;

  const noOpen = args.includes('--no-open');

  let generatedHtml = '';
  let backupFile = '';

  try {
    const { server, htmlFile: outHtml, backupFile: bakFile } = await startServer(file, {
      port,
      htmlFile,
    });
    generatedHtml = outHtml;
    backupFile = bakFile;

    console.log('┌──────────────────────────────────────────────');
    console.log('│  TickMark 服务已启动（Ctrl+C 退出）');
    console.log('│');
    console.log(`│  预览文件: ${outHtml}`);
    console.log(`│  原始备份: ${path.basename(backupFile)}  (重置 = 备份放回)`);
    console.log(`│  点击 checkbox → 自动回写源文件 ${path.basename(file)}`);
    console.log('└──────────────────────────────────────────────');

    // 自动用配置的 IDE 命令打开 HTML
    if (!noOpen && outHtml) {
      const openCfg = resolveOpenCommand(ideArg);
      if (openCfg) {
        openInIde(openCfg.command, outHtml);
        console.log(`✓ 已用 ${openCfg.command.join(' ')} 打开预览`);
      } else {
        console.log(`提示: 未找到 IDE 打开命令，请手动打开 ${outHtml}`);
        console.log('      可配置环境变量 TICKMARK_OPEN_CMD 或 ~/.config/tickmark/config.json 的 openCommand');
      }
    }

    // 退出时删除生成的 HTML 与原始备份（render 产物不受影响）
    const cleanup = () => {
      removeHtml(generatedHtml);
      removeBackup(backupFile);
    };
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

/** ide 子命令：查看/设置默认 IDE */
function cmdIde(args: string[]): void {
  const [sub, ...rest] = args;

  if (sub === 'set') {
    const cmd = (rest.join(' ') || '').trim();
    if (!cmd) {
      console.log('用法: tickmark ide set <命令>');
      console.log('示例: tickmark ide set code        ← VS Code / CodeBuddy');
      console.log('      tickmark ide set "code -r"  ← 带参数（-r 在已开窗口加载）');
      console.log('      tickmark ide set buddycn     ← CodeBuddy (CN)');
      return;
    }
    const bin = cmd.split(/\s+/)[0];
    if (!commandExists(bin)) {
      console.warn(`提示: PATH 中未找到 "${bin}"，打开时可能失败。可用 "tickmark ide" 查看已装 IDE。`);
    }
    const { rcPath } = setDefaultCommand(cmd);
    console.log(`✓ 默认 IDE 已写入 ${rcPath}`);
    console.log(`  后续 "tickmark serve" 将使用: ${cmd}`);
    console.log(`  单次覆盖: tickmark serve <file.md> --ide <其它命令>`);
    return;
  }

  if (sub === 'list' || sub === undefined) {
    const cur = resolveOpenCommand();
    console.log(
      `当前 IDE 打开命令: ${cur ? `${cur.command.join(' ')}  (${cur.source})` : '未配置，打开时需手动处理'}`,
    );
    console.log('');
    console.log('预设 IDE（✓=本机已安装）:');
    for (const { ide, available, isDefault } of listAvailableIdes()) {
      const mark = available ? '✓' : '·';
      const def = isDefault ? '  ← 当前默认' : '';
      console.log(`  ${mark} ${ide.command.padEnd(10)}${ide.label}${def}`);
    }
    console.log('');
    console.log('用法:');
    console.log('  tickmark ide set <命令>            设置默认 IDE');
    console.log('  tickmark serve <file.md> --ide <cmd>  单次指定（不改变默认）');
    return;
  }

  console.error(`未知 ide 子命令: ${sub}（可用: list / set）`);
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

/** 删除 serve 生成的原始 MD 备份文件 */
function removeBackup(backupFile: string): void {
  if (!backupFile) return;
  try {
    if (fs.existsSync(backupFile)) {
      fs.unlinkSync(backupFile);
      console.log(`已删除原始备份: ${backupFile}`);
    }
  } catch (err) {
    console.warn(`删除原始备份失败: ${err instanceof Error ? err.message : String(err)}`);
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
    case 'ide':
      cmdIde(rest);
      break;
    default:
      // 无子命令时默认按 serve 处理：timd <file.md> == timd serve <file.md>
      await cmdServe([sub, ...rest]);
      break;
  }
}

// 顶层 await 支持
main().catch((err) => {
  console.error(err);
  process.exit(1);
});
