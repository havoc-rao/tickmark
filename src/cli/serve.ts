import * as fs from 'fs';
import * as path from 'path';
import { spawn } from 'child_process';
import { startServer } from '../serve';
import { resolveOpenCommand } from '../config';

/** serve 子命令：生成同层 HTML + 自动用 IDE 打开 + 常驻回写服务 */
export async function cmdServe(args: string[]): Promise<void> {
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

    console.log('✓ TickMark 服务已启动（Ctrl+C 退出）');
    console.log(`  预览文件: ${outHtml}`);
    console.log(`  原始备份: ${path.basename(backupFile)}  (重置 = 备份放回)`);
    console.log(`  点击 checkbox → 自动回写源文件 ${path.basename(file)}`);
    console.log(`  API: http://127.0.0.1:${serverPort(server)}`);

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

/** 从 http.Server 取监听端口 */
function serverPort(server: import('http').Server): number {
  const addr = server.address();
  return typeof addr === 'object' && addr ? addr.port : 0;
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
