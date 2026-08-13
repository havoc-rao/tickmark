import * as fs from 'fs';
import * as path from 'path';

/**
 * 定位包根目录：编译产物位于 <root>/out[/cli]，向上查找 package.json。
 * 兼容两种安装形态：
 *  - npm link / git clone 开发态：<repo>/out/cli.js → <repo>
 *  - install.sh 发布态：~/.local/share/tickmark/out/cli/* → ~/.local/share/tickmark
 */
export function packageRoot(): string {
  let dir = __dirname;
  for (let i = 0; i < 8; i++) {
    try {
      if (fs.existsSync(path.join(dir, 'package.json'))) return dir;
    } catch {
      // ignore
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return __dirname;
}

/** 读取 package.json 中的当前版本号（运行时读取，避免硬编码漂移） */
export function currentVersion(): string {
  try {
    const pkg = JSON.parse(
      fs.readFileSync(path.join(packageRoot(), 'package.json'), 'utf8'),
    );
    return typeof pkg.version === 'string' ? pkg.version : '0.0.0';
  } catch {
    return '0.0.0';
  }
}

/** 语义化版本比较：a > b 返回正数，a === b 返回 0，a < b 返回负数 */
export function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    const na = pa[i] || 0;
    const nb = pb[i] || 0;
    if (na !== nb) return na - nb;
  }
  return 0;
}
