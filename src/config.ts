import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

/**
 * IDE 打开命令配置
 *
 * 优先级（高 → 低）：
 * 1. 环境变量 TICKMARK_OPEN_CMD（如 "buddycn" 或 "code -r"）
 * 2. 配置文件 ~/.tickmarkrc.json：
 *    { "openCommand": "buddycn" }            字符串
 *    { "openCommand": ["code", "-r"] }       数组
 * 3. 默认尝试 buddycn（CodeBuddy CN），找不到则尝试 code（CodeBuddy/VS Code）
 *
 * 找不到任何命令时返回 null，调用方提示手动打开。
 */
export interface OpenConfig {
  /** 命令 token 数组（不含待打开的 HTML 路径） */
  command: string[];
  /** 来源描述 */
  source: string;
}

export function resolveOpenCommand(): OpenConfig | null {
  // 1. 环境变量
  const env = process.env.TICKMARK_OPEN_CMD;
  if (env && env.trim()) {
    return { command: env.trim().split(/\s+/), source: '环境变量 TICKMARK_OPEN_CMD' };
  }

  // 2. 配置文件
  try {
    const rcPath = path.join(os.homedir(), '.tickmarkrc.json');
    if (fs.existsSync(rcPath)) {
      const rc = JSON.parse(fs.readFileSync(rcPath, 'utf8'));
      if (rc && rc.openCommand) {
        if (Array.isArray(rc.openCommand) && rc.openCommand.length > 0) {
          return {
            command: rc.openCommand.map(String),
            source: `配置文件 ${rcPath}`,
          };
        }
        if (typeof rc.openCommand === 'string' && rc.openCommand.trim()) {
          return {
            command: rc.openCommand.trim().split(/\s+/),
            source: `配置文件 ${rcPath}`,
          };
        }
      }
    }
  } catch {
    // 配置损坏则忽略，继续默认
  }

  // 3. 默认：按序探测 buddycn / code
  for (const cmd of ['buddycn', 'code']) {
    if (commandExists(cmd)) {
      return { command: [cmd], source: `默认探测 (${cmd})` };
    }
  }

  return null;
}

function commandExists(cmd: string): boolean {
  const dirs = (process.env.PATH || '').split(path.delimiter);
  for (const dir of dirs) {
    if (!dir) continue;
    const full = path.join(dir, cmd);
    try {
      fs.accessSync(full, fs.constants.X_OK);
      return true;
    } catch {
      // try next
    }
  }
  return false;
}
