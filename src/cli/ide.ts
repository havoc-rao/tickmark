import {
  resolveOpenCommand,
  setDefaultCommand,
  listAvailableIdes,
  commandExists,
} from '../config';
import { cliName } from './name';

/** ide 子命令：查看/设置默认 IDE */
export function cmdIde(args: string[]): void {
  const bin = cliName();
  const [sub, ...rest] = args;

  if (sub === 'set') {
    const cmd = (rest.join(' ') || '').trim();
    if (!cmd) {
      console.log(`用法: ${bin} ide set <命令>`);
      console.log(`示例: ${bin} ide set code        ← VS Code / CodeBuddy`);
      console.log(`      ${bin} ide set "code -r"  ← 带参数（-r 在已开窗口加载）`);
      console.log(`      ${bin} ide set buddycn     ← CodeBuddy (CN)`);
      return;
    }
    const ideBin = cmd.split(/\s+/)[0];
    if (!commandExists(ideBin)) {
      console.warn(`提示: PATH 中未找到 "${ideBin}"，打开时可能失败。可用 "${bin} ide" 查看已装 IDE。`);
    }
    const { rcPath } = setDefaultCommand(cmd);
    console.log(`✓ 默认 IDE 已写入 ${rcPath}`);
    console.log(`  后续 "${bin} serve" 将使用: ${cmd}`);
    console.log(`  单次覆盖: ${bin} serve <file.md> --ide <其它命令>`);
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
    console.log(`  ${bin} ide set <命令>                设置默认 IDE`);
    console.log(`  ${bin} serve <file.md> --ide <cmd>   单次指定（不改变默认）`);
    return;
  }

  console.error(`未知 ide 子命令: ${sub}（可用: list / set）`);
}
