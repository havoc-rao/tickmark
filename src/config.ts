import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

/**
 * IDE 打开命令配置
 *
 * 优先级（高 → 低）：
 * 1. 命令行 --ide 参数（显式指定，如 tickmark serve x.md --ide code）
 * 2. 环境变量 TICKMARK_OPEN_CMD（如 "buddycn" 或 "code -r"）
 * 3. 配置文件 ~/.config/tickmark/config.json：{ "openCommand": "buddycn" }
 *    （通过 `tickmark ide set <cmd>` 写入，也可手工编辑）
 * 4. 默认按序探测预设 IDE（buddycn → code → cursor → …），找不到则返回 null
 *
 * 找不到任何命令时返回 null，调用方提示手动打开。
 */
export interface OpenConfig {
  /** 命令 token 数组（不含待打开的 HTML 路径） */
  command: string[];
  /** 来源描述 */
  source: string;
}

export interface IdeDescriptor {
  id: string;
  label: string;
  /** 命令行入口（PATH 中的可执行文件） */
  command: string;
  /** macOS 应用名：/Applications/<name>.app 存在性探测 */
  macApp?: string;
}

/** 预设 IDE 表：id → 常见命令，保持默认探测顺序 */
export const KNOWN_IDES: IdeDescriptor[] = [
  { id: 'buddycn', label: 'CodeBuddy (CN)', command: 'buddycn', macApp: 'CodeBuddy (CN)' },
  { id: 'code', label: 'VS Code / CodeBuddy', command: 'code', macApp: 'Visual Studio Code' },
  { id: 'cursor', label: 'Cursor', command: 'cursor', macApp: 'Cursor' },
  { id: 'windsurf', label: 'Windsurf', command: 'windsurf', macApp: 'Windsurf' },
  { id: 'intellij', label: 'IntelliJ IDEA', command: 'idea', macApp: 'IntelliJ IDEA' },
  { id: 'pycharm', label: 'PyCharm', command: 'pycharm', macApp: 'PyCharm' },
  { id: 'goland', label: 'GoLand', command: 'goland', macApp: 'GoLand' },
  { id: 'webstorm', label: 'WebStorm', command: 'webstorm', macApp: 'WebStorm' },
  { id: 'sublime', label: 'Sublime Text', command: 'subl', macApp: 'Sublime Text' },
  { id: 'vim', label: 'Vim', command: 'vim' },
  { id: 'nvim', label: 'Neovim', command: 'nvim' },
];

/** 偏好配置文件路径：~/.config/tickmark/config.json */
export function rcFilePath(): string {
  return path.join(os.homedir(), '.config', 'tickmark', 'config.json');
}

/** 支持的语言（预览页 i18n） */
export const KNOWN_LANGS = ['zh-CN', 'en-US'] as const;

/** 读取配置的语言偏好（zh-CN / en-US），非法/未设置时回退 zh-CN */
export function resolveLang(): string {
  const rc = readRc();
  const v = rc.lang;
  return typeof v === 'string' && (KNOWN_LANGS as readonly string[]).includes(v) ? v : 'zh-CN';
}

/** 写语言偏好到 ~/.config/tickmark/config.json（保留其它字段） */
export function setLang(lang: string): { rcPath: string; lang: string } {
  const v = lang.trim();
  if (!(KNOWN_LANGS as readonly string[]).includes(v)) {
    throw new Error(`未知语言: ${v}（可用: ${KNOWN_LANGS.join(' / ')}）`);
  }
  const rc = readRc();
  rc.lang = v;
  const rcPath = rcFilePath();
  fs.mkdirSync(path.dirname(rcPath), { recursive: true });
  fs.writeFileSync(rcPath, JSON.stringify(rc, null, 2) + '\n', 'utf8');
  return { rcPath, lang: v };
}

/** 读取全部配置（供 `timd config` 查看；会尝试兼容旧配置路径） */
export function readAllConfig(): Record<string, unknown> {
  return readRc();
}

/** 读单个配置键；未设置返回 undefined */
export function readConfigKey(key: string): unknown {
  return readRc()[key];
}

/** 写任意配置键到 config.json（保留其它字段）；返回写入后的完整配置 */
export function setConfigKey(key: string, value: string): { rcPath: string; key: string; value: string } {
  const rc = readRc();
  rc[key] = value.trim();
  const rcPath = rcFilePath();
  fs.mkdirSync(path.dirname(rcPath), { recursive: true });
  fs.writeFileSync(rcPath, JSON.stringify(rc, null, 2) + '\n', 'utf8');
  return { rcPath, key, value: value.trim() };
}

/** 旧版配置路径（迁移前）：~/.tickmarkrc.json */
const LEGACY_RC_PATH = path.join(os.homedir(), '.tickmarkrc.json');

function readRc(): Record<string, unknown> {
  // 优先读新位置，不存在时兼容旧位置
  const candidates = [rcFilePath(), LEGACY_RC_PATH];
  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) {
        return JSON.parse(fs.readFileSync(p, 'utf8'));
      }
    } catch {
      // 配置损坏则忽略，继续下一个
    }
  }
  return {};
}

/**
 * 解析用于打开 HTML 的 IDE 命令。
 * @param preferred 命令行 --ide 显式指定的命令（如 "code" / "code -r"），仅当该命令存在时生效
 */
export function resolveOpenCommand(preferred?: string): OpenConfig | null {
  // 1. 命令行显式指定
  if (preferred && preferred.trim()) {
    const cmd = preferred.trim().split(/\s+/);
    if (commandExists(cmd[0])) {
      return { command: cmd, source: `--ide ${cmd[0]}` };
    }
  }

  // 2. 环境变量
  const env = process.env.TICKMARK_OPEN_CMD;
  if (env && env.trim()) {
    return { command: env.trim().split(/\s+/), source: '环境变量 TICKMARK_OPEN_CMD' };
  }

  // 3. 配置文件
  const rc = readRc();
  const rcCmd = rc.openCommand;
  if (typeof rcCmd === 'string' && rcCmd.trim()) {
    return { command: rcCmd.trim().split(/\s+/), source: `配置文件 ${rcFilePath()}` };
  }
  if (Array.isArray(rcCmd) && rcCmd.length > 0) {
    return { command: rcCmd.map(String), source: `配置文件 ${rcFilePath()}` };
  }

  // 4. 默认按序探测预设 IDE
  for (const ide of KNOWN_IDES) {
    if (commandExists(ide.command)) {
      return { command: [ide.command], source: `默认探测 (${ide.command})` };
    }
  }

  return null;
}

/** 写默认打开命令到 ~/.config/tickmark/config.json（保留其它字段） */
export function setDefaultCommand(cmd: string): { rcPath: string; command: string } {
  const rc = readRc();
  rc.openCommand = cmd.trim();
  const rcPath = rcFilePath();
  fs.mkdirSync(path.dirname(rcPath), { recursive: true });
  fs.writeFileSync(rcPath, JSON.stringify(rc, null, 2) + '\n', 'utf8');
  return { rcPath, command: cmd.trim() };
}

/** 探测单个预设 IDE 是否可用（PATH 命令 或 macOS /Applications 应用） */
export function ideAvailability(ide: IdeDescriptor): boolean {
  if (commandExists(ide.command)) return true;
  if (ide.macApp && process.platform === 'darwin') {
    return fs.existsSync(path.join('/Applications', `${ide.macApp}.app`));
  }
  return false;
}

/** 列出预设 IDE 及本机安装状态、当前默认标记 */
export function listAvailableIdes(): Array<{
  ide: IdeDescriptor;
  available: boolean;
  isDefault: boolean;
}> {
  const cur = resolveOpenCommand();
  const curCmd = cur?.command[0] ?? null;
  return KNOWN_IDES.map((ide) => {
    const available = ideAvailability(ide);
    const isDefault = !!curCmd && curCmd === ide.command;
    return { ide, available, isDefault };
  });
}

/** 在 PATH 中探测可执行命令是否存在 */
export function commandExists(cmd: string): boolean {
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