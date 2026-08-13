import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFileSync } from 'child_process';
import { packageRoot, currentVersion, compareVersions } from './version';
import { cliName } from './name';

/** GitHub 仓库标识（与 scripts/install.sh / release 资产命名保持一致） */
const OWNER = 'havoc-rao';
const REPO = 'tickmark';
const BIN = 'tickmark';
/** release 资产命名：tickmark_<version>.tar.gz（version 不含 v 前缀） */
const ASSET_PREFIX = `${BIN}_`;

interface ReleaseInfo {
  tag: string;
  version: string;
}

/**
 * 解析 GitHub 最新 release 的 tag。
 * 1) 优先用 releases/latest 的 302 Location（与 install.sh 一致）：不受 API 限流影响；
 * 2) 失败则回退 GitHub API（未认证限流 60 次/小时，设置 GITHUB_TOKEN / GH_TOKEN 可绕过）。
 */
async function resolveLatestRelease(): Promise<ReleaseInfo> {
  // 1) 重定向法：GET /releases/latest → 302 Location 指向 /tag/<tag>
  try {
    const res = await fetch(`https://github.com/${OWNER}/${REPO}/releases/latest`, {
      redirect: 'manual',
      headers: { 'User-Agent': 'tickmark-cli' },
    });
    const loc = res.headers.get('location') || '';
    const m = loc.match(/\/tag\/([^/]+)\/?$/);
    if (m) {
      const tag = decodeURIComponent(m[1]);
      return { tag, version: tag.replace(/^v/, '') };
    }
  } catch {
    // 网络失败 → 走 API 兜底
  }

  // 2) API 兜底
  const api = `https://api.github.com/repos/${OWNER}/${REPO}/releases/latest`;
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  const res = await fetch(api, {
    headers: {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'tickmark-cli',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
  if (!res.ok) {
    throw new Error(
      `GitHub API HTTP ${res.status}` +
        (res.status === 403 || res.status === 429
          ? '（可能触发 API 限流，设置 GITHUB_TOKEN 可绕过）'
          : ''),
    );
  }
  const data = (await res.json()) as { tag_name?: string };
  if (!data.tag_name) throw new Error('GitHub API 响应缺少 tag_name');
  const tag = data.tag_name;
  return { tag, version: tag.replace(/^v/, '') };
}

/** 下载 release tarball 到临时目录，返回本地路径 */
async function downloadTarball(tag: string, version: string): Promise<string> {
  const url = `https://github.com/${OWNER}/${REPO}/releases/download/${tag}/${ASSET_PREFIX}${version}.tar.gz`;
  const dest = path.join(
    os.tmpdir(),
    `${BIN}_${version}_${process.pid}_${Date.now()}.tar.gz`,
  );
  console.log(`  下载: ${url}`);
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) {
    throw new Error(`下载失败 HTTP ${res.status}\n  可浏览可用资产: https://github.com/${OWNER}/${REPO}/releases/tag/${tag}`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(dest, buf);
  return dest;
}

/**
 * 解压并替换安装目录（保留 node_modules，增量装依赖更快）。
 * 与 install.sh 相同的产物布局：bin / media / out / package.json / README.md。
 */
function extractAndInstall(tarball: string, installDir: string): void {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), `${BIN}-extract-`));
  try {
    execFileSync('tar', ['-xzf', tarball, '-C', tmp], { stdio: 'inherit' });
    for (const f of ['bin/tickmark.js', 'out/cli.js', 'package.json']) {
      if (!fs.existsSync(path.join(tmp, f))) {
        throw new Error(`发布产物缺少 ${f}，资产不完整，已中止（未改动现有安装）`);
      }
    }
    for (const f of fs.readdirSync(installDir)) {
      if (f === 'node_modules') continue;
      fs.rmSync(path.join(installDir, f), { recursive: true, force: true });
    }
    for (const f of fs.readdirSync(tmp)) {
      fs.renameSync(path.join(tmp, f), path.join(installDir, f));
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

/** 在安装目录执行 npm install --omit=dev（与 install.sh 一致） */
function npmInstall(installDir: string): void {
  console.log('  安装运行时依赖（npm install --omit=dev --no-audit --no-fund）…');
  execFileSync('npm', ['install', '--omit=dev', '--no-audit', '--no-fund', '--silent'], {
    cwd: installDir,
    stdio: 'inherit',
  });
}

/** git 源码安装态：pull + 装依赖 + 重新编译 */
function updateViaGit(repoDir: string): void {
  const status = execFileSync('git', ['status', '--porcelain'], {
    cwd: repoDir,
    encoding: 'utf8',
  }).trim();
  if (status) {
    console.error('✗ 工作区有未提交的修改，无法自动更新：');
    console.error(status.split('\n').map((l) => `  ${l}`).join('\n'));
    console.error('  请先 commit 或 stash 后重试。');
    process.exit(1);
  }
  console.log('  git pull --ff-only …');
  execFileSync('git', ['pull', '--ff-only'], { cwd: repoDir, stdio: 'inherit' });
  npmInstall(repoDir);
  console.log('  npm run compile …');
  execFileSync('npm', ['run', 'compile'], { cwd: repoDir, stdio: 'inherit' });
}

/**
 * update 子命令：从 GitHub 自动更新到最新版本。
 *
 *   timd update           检查并升级（release 安装 → 下载替换；git 源码安装 → pull+编译）
 *   timd update --check   只检查最新版本，不升级
 *   timd update --force   强制重装（当前已是最新时也执行）
 */
export async function cmdUpdate(args: string[]): Promise<void> {
  const checkOnly = args.includes('--check');
  const force = args.includes('--force');

  const root = packageRoot();
  const current = currentVersion();

  let release: ReleaseInfo;
  try {
    release = await resolveLatestRelease();
  } catch (err) {
    console.error(`✗ 检查更新失败: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }

  console.log(`  ${BIN} 当前版本: v${current}`);
  console.log(`  最新版本:    v${release.version}  (${release.tag})`);

  const updateAvailable = compareVersions(release.version, current) > 0;
  if (!updateAvailable && !force) {
    console.log('✓ 已是最新版本');
    return;
  }
  if (checkOnly) {
    console.log(`→ 检测到新版本 v${release.version}，执行 "${cliName()} update" 升级`);
    return;
  }

  try {
    const isGitInstall = fs.existsSync(path.join(root, '.git'));
    if (isGitInstall) {
      console.log('  检测到 git 源码安装 → git pull + 重新编译');
      updateViaGit(root);
    } else {
      const tarball = await downloadTarball(release.tag, release.version);
      try {
        extractAndInstall(tarball, root);
        npmInstall(root);
      } finally {
        fs.rmSync(tarball, { force: true });
      }
    }
  } catch (err) {
    console.error(`✗ 更新失败: ${err instanceof Error ? err.message : String(err)}`);
    console.error('  可手动重新安装: curl -fsSL https://raw.githubusercontent.com/havoc-rao/tickmark/main/scripts/install.sh | sh');
    process.exit(1);
  }

  console.log(`✓ 已更新到 v${currentVersion()}`);
  console.log(`  软链 $HOME/.local/bin/tickmark / timd 无需变动（指向同一安装目录）`);
  console.log(`  验证: ${cliName()} --version`);
}
