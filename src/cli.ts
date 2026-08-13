#!/usr/bin/env node
import { cmdRender } from './cli/render';
import { cmdServe } from './cli/serve';
import { cmdIde } from './cli/ide';
import { cmdConfig } from './cli/config';
import { cmdUpdate } from './cli/update';
import { currentVersion } from './cli/version';
import { cliName } from './cli/name';

function usage(): void {
  const bin = cliName();
  const alias = bin === 'timd' ? 'tickmark' : 'timd';
  console.log(`
TickMark CLI v${currentVersion()} — 快速把 md 渲染成 HTML，并支持 checkbox 点击回写源文件（别名: ${alias}）

用法:
  ${bin} <file.md> [serve 选项]       # 简写，等价于 serve
  ${bin} serve  <file.md> [--port <n>] [--html <path>] [--no-open] [--ide <name>]
                               生成同层 HTML（<原名>.tickmark.html），
                               自动用配置的 IDE 打开预览，
                               点击 checkbox 实时回写源 md，退出时删除 HTML。
  ${bin} render <file.md> [--out <file.html>]
                               渲染 md 为独立 HTML 文件（静态，不回写）
  ${bin} config              查看当前配置（IDE / 语言，存于 ~/.config/tickmark/config.json）
  ${bin} config set ide <cmd>   设置默认 IDE（如 code / "code -r" / buddycn）
  ${bin} config set lang <lang> 设置界面语言（zh-CN / en-US）
  ${bin} ide [list]          兼容旧命令：列出本机可用的（预设）IDE 及当前默认
  ${bin} ide set <cmd>       兼容旧命令：设置默认 IDE（同 config set ide）
  ${bin} update [--check]    从 GitHub 检查并自动更新到最新版本（--check 只检查不升级）
  ${bin} --help              显示帮助
  ${bin} --version           显示版本

功能:
  • GFM 表格渲染
  • checkbox (- [ ] / - [x]) 点击切换，直接回写 .md 源文件
  • 自动用 IDE 打开预览（可用 ${bin} config set ide 自选 IDE，见下）
  • 退出时自动删除生成的 HTML（--no-open 跳过打开）
  • 代码高亮 + 复制按钮
  • 界面语言（i18n）：${bin} config set lang zh-CN|en-US 切换预览页中/英文
  • update 自动更新（release 安装下载替换 / git 源码安装 git pull+编译）

配置（写入 ~/.config/tickmark/config.json）:
  ${bin} config                      # 查看 IDE / 语言等全部配置
  ${bin} config set ide cursor       # 默认 IDE
  ${bin} config set lang en-US       # 预览页英文（默认 zh-CN）

IDE 选择（优先级高→低）:
  1. 单次指定: ${bin} serve x.md --ide code   （也支持带参, 如 --ide "code -r"）
  2. 环境变量: export TICKMARK_OPEN_CMD="buddycn"
  3. 默认 IDE: ${bin} config set ide cursor   （写入 ~/.config/tickmark/config.json）
  4. 自动探测: buddycn → code → cursor → …（${bin} config list 查看本机已装）

示例:
  ${bin} config set lang en-US                 # 预览界面切到英文
  ${bin} config set ide buddycn                # 默认用 CodeBuddy (CN) 打开
  ${bin} serve sample.md                       # 生成 sample.md.tickmark.html 并打开
  ${bin} serve sample.md --ide cursor         # 本次改用 Cursor 打开
  ${bin} serve sample.md --no-open            # 只生成不打开
  ${bin} serve sample.md --html ./p.html      # 指定 HTML 位置
  ${bin} render README.md --out readme.html
  ${bin} update --check                       # 只看有没有新版本
  ${bin} update                               # 自动升级到最新版
`);
}

async function main(): Promise<void> {
  const [, , sub, ...rest] = process.argv;

  if (!sub || sub === '--help' || sub === '-h' || sub === 'help') {
    usage();
    return;
  }
  if (sub === '--version' || sub === '-v' || sub === 'version') {
    console.log(currentVersion());
    return;
  }

  switch (sub) {
    case 'render':
      cmdRender(rest);
      break;
    case 'serve':
    case 'server':
      await cmdServe(rest);
      break;
    case 'ide':
      cmdIde(rest);
      break;
    case 'config':
      cmdConfig(rest);
      break;
    case 'update':
      await cmdUpdate(rest);
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
