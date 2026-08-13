import * as fs from 'fs';
import * as path from 'path';
import {
  resolveOpenCommand,
  setDefaultCommand,
  listAvailableIdes,
  commandExists,
  resolveLang,
  setLang,
  readAllConfig,
  readConfigKey,
  setConfigKey,
  rcFilePath,
} from '../config';
import { cliName } from './name';

/** 已知配置键：ide（openCommand） / lang */
const KNOWN_KEYS: Record<string, string> = {
  ide: 'openCommand',
  opencommand: 'openCommand',
  'open-command': 'openCommand',
  lang: 'lang',
  language: 'lang',
};

/** config 子命令：统一查看 / 设置 IDE 与语言等偏好（写入 ~/.config/tickmark/config.json） */
export function cmdConfig(args: string[]): void {
  const bin = cliName();
  const [sub, ...rest] = args;

  // 查看全部配置
  if (sub === 'list' || sub === 'ls' || sub === 'show' || sub === undefined) {
    showConfig(bin);
    return;
  }

  if (sub === 'get') {
    const key = rest[0];
    if (!key) {
      console.log(`用法: ${bin} config get <key>`);
      console.log(`  可用 key: ide（IDE 打开命令）、lang（语言: zh-CN / en-US）`);
      return;
    }
    const v = readConfigKey(key);
    console.log(v === undefined || v === '' ? '(未设置)' : String(v));
    return;
  }

  if (sub === 'set') {
    const key = rest[0];
    const value = rest.slice(1).join(' ');
    if (!key || !value) {
      console.log(`用法: ${bin} config set <key> <value>`);
      console.log(`  ide <命令>        设置默认 IDE，如: ${bin} config set ide code`);
      console.log(`  lang <zh-CN|en-US>  设置界面语言，如: ${bin} config set lang en-US`);
      return;
    }
    setConfigValue(bin, key, value);
    return;
  }

  if (sub === 'unset' || sub === 'delete' || sub === 'del' || sub === 'rm') {
    const key = rest[0];
    if (!key) {
      console.log(`用法: ${bin} config unset <key>`);
      return;
    }
    const rc = readAllConfig();
    delete rc[key];
    const rcPath = rcFilePath();
    fs.mkdirSync(path.dirname(rcPath), { recursive: true });
    fs.writeFileSync(rcPath, JSON.stringify(rc, null, 2) + '\n', 'utf8');
    console.log(`✓ 已删除配置 ${key}（${rcPath}）`);
    return;
  }

  console.error(`未知 config 子命令: ${sub}（可用: list / get / set / unset）`);
}

/** 处理 config set，按 key 归一化并校验 */
function setConfigValue(bin: string, rawKey: string, value: string): void {
  const key = KNOWN_KEYS[rawKey.toLowerCase()];
  if (!key) {
    console.error(`未知配置键: ${rawKey}`);
    console.log(`  可用 key: ide（IDE 打开命令）、lang（语言: zh-CN / en-US）`);
    return;
  }

  if (key === 'openCommand') {
    const ideBin = value.trim().split(/\s+/)[0];
    if (!commandExists(ideBin)) {
      console.warn(`提示: PATH 中未找到 "${ideBin}"，打开时可能失败。可用 "${bin} config list" 查看已装 IDE。`);
    }
    const { rcPath, command } = setDefaultCommand(value);
    console.log(`✓ 默认 IDE 已写入 ${rcPath}`);
    console.log(`  后续 "${bin} serve" 将使用: ${command}`);
    console.log(`  单次覆盖: ${bin} serve <file.md> --ide <其它命令>`);
    return;
  }

  if (key === 'lang') {
    try {
      const { rcPath, lang } = setLang(value);
      console.log(`✓ 界面语言已写入 ${rcPath}`);
      console.log(`  当前语言: ${lang}（重新 ${bin} serve / render 后预览页生效）`);
      return;
    } catch (err) {
      console.error(err instanceof Error ? err.message : String(err));
      console.log(`  可用语言: zh-CN（中文）/ en-US（English）`);
      return;
    }
  }

  // 兜底（理论上不可达）
  const { rcPath } = setConfigKey(key, value);
  console.log(`✓ ${key} 已写入 ${rcPath}`);
}

/** 展示当前配置总览 + 已装 IDE 与语言 */
function showConfig(bin: string): void {
  const rc = readAllConfig();
  const keys = Object.keys(rc);

  console.log(`配置文件: ${rcFilePath()}`);
  console.log('');

  // IDE
  const cur = resolveOpenCommand();
  console.log(`IDE 打开命令: ${cur ? `${cur.command.join(' ')}  (${cur.source})` : '未配置，打开时需手动处理'}`);
  for (const { ide, available, isDefault } of listAvailableIdes()) {
    const mark = available ? '✓' : '·';
    const def = isDefault ? '  ← 当前默认' : '';
    console.log(`  ${mark} ${ide.command.padEnd(10)}${ide.label}${def}`);
  }
  console.log('');

  // 语言
  console.log(`界面语言: ${resolveLang()}`);
  console.log('');

  if (!keys.length) {
    console.log('（config.json 暂无自定义项，以上均为默认值）');
  } else {
    console.log('已存配置项:');
    for (const k of keys) {
      console.log(`  ${k} = ${JSON.stringify(rc[k])}`);
    }
  }

  console.log('');
  console.log('用法:');
  console.log(`  ${bin} config                    查看当前配置`);
  console.log(`  ${bin} config set ide <命令>     设置默认 IDE（如 code / "code -r" / buddycn）`);
  console.log(`  ${bin} config set lang <lang>    设置界面语言（zh-CN / en-US）`);
  console.log(`  ${bin} config get <key>          读取单个配置`);
  console.log(`  ${bin} config unset <key>        删除配置项`);
  console.log(`  ${bin} ide                       兼容旧命令：查看/设置 IDE`);
}
