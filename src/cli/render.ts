import * as fs from 'fs';
import * as path from 'path';
import { MarkdownEngine } from '../markdownEngine';
import { renderPage } from '../page';
import { resolveLang } from '../config';
import { cliName } from './name';

/** render 子命令：静态转换 */
export function cmdRender(args: string[]): void {
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
    lang: resolveLang(),
  });

  const outFile = out || file.replace(/\.(md|markdown|mdx)$/i, '') + '.html';
  fs.writeFileSync(outFile, page, 'utf8');
  console.log(`✓ 已渲染: ${outFile}`);
  console.log(`  原始文件未修改。运行 "${cliName()} serve ${file}" 可获得 checkbox 回写能力。`);
}
