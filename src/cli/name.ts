import * as path from 'path';

/**
 * 当前 CLI 实际被调用的名字（tickmark / timd）。
 * 用于 help 与提示信息：展示用户真实敲的命令，复制即用。
 * bin/ 下 tickmark.js 与 timd 软链指向同一入口，靠 argv[1] 区分。
 */
export function cliName(): string {
  const base = path
    .basename(process.argv[1] || '')
    .replace(/\.(js|cjs|mjs|exe)$/i, '');
  if (base === 'timd') return 'timd';
  return 'tickmark';
}
