import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';
import { MarkdownEngine } from './markdownEngine';
import { toggleCheckboxInFile } from './checkbox';
import { addColumnInFile, setCellInFile } from './table';
import { renderPage, renderStandalonePage } from './page';

export interface ServeResult {
  server: http.Server;
  port: number;
  /** 生成的独立 HTML 文件路径（供 CodeBuddy/编辑器预览） */
  htmlFile: string;
  /** 启动时对原始 MD 的磁盘备份路径（重置 = 把这份备份放回去） */
  backupFile: string;
}

export interface ServeOptions {
  port?: number;
  host?: string;
  /** 自定义 HTML 输出路径；默认系统临时目录 */
  htmlFile?: string;
  /** 是否生成独立 HTML 文件（默认 true，配合编辑器预览） */
  generateHtml?: boolean;
}

/**
 * 启动本地 HTTP 服务（常驻），负责 checkbox 回写：
 * - POST /api/toggle  { line, checked } → 改写磁盘 md 文件
 * - GET  /api/content → 返回最新 md 内容（页面刷新用）
 * - GET  /            → 服务器模式渲染页（浏览器直接用）
 *
 * 同时生成一个独立 HTML 文件：CSS/JS 全部内联，注入 API 地址，
 * 供 CodeBuddy/编辑器直接预览，点击 checkbox 走 fetch 回写到 CLI 进程。
 */
export function startServer(
  filePath: string,
  opts: ServeOptions = {},
): Promise<ServeResult> {
  const engine = new MarkdownEngine();
  const absPath = path.resolve(filePath);
  const mediaDir = path.join(__dirname, '..', 'media');
  const host = opts.host || '127.0.0.1';

  // 启动时对原始 MD 的磁盘备份（防止对原数据的破坏；重置 = 把备份放回去）
  const backupPath = path.join(path.dirname(absPath), path.basename(absPath) + '.tickmark.bak');

  // ---- 修改历史（快照栈）：undo / redo / 重置到启动时状态 ----
  let history: string[] = [];
  let historyCursor = 0;

  function readSnapshot(): string {
    return fs.readFileSync(absPath, 'utf8');
  }

  function initHistory(): void {
    const original = readSnapshot();
    history = [original];
    historyCursor = 0;
    // 物理备份原始内容到磁盘：进程崩溃 / 内存丢失后仍有恢复基准
    try {
      fs.writeFileSync(backupPath, original, 'utf8');
    } catch (err) {
      console.warn('[tickmark] 备份原始文件失败:', err);
    }
  }

  /** 每次成功修改后调用：截断 redo 分支并记录新快照 */
  function recordChange(): void {
    history.length = historyCursor + 1;
    history.push(readSnapshot());
    historyCursor = history.length - 1;
  }

  /** 把文件恢复到历史快照并移动游标 */
  function applyHistory(cursor: number): boolean {
    try {
      fs.writeFileSync(absPath, history[cursor], 'utf8');
      historyCursor = cursor;
      return true;
    } catch {
      return false;
    }
  }

  function historyStatus() {
    return {
      canUndo: historyCursor > 0,
      canRedo: historyCursor < history.length - 1,
      dirty: historyCursor > 0,
      total: history.length,
    };
  }

  initHistory();

  const server = http.createServer(async (req, res) => {
    // CORS：独立 HTML（file:// 打开）fetch 本地服务需要
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    try {
      const url = new URL(req.url || '/', `http://${req.headers.host || host}`);

      // API: 切换 checkbox
      if (url.pathname === '/api/toggle' && req.method === 'POST') {
        const body = await readBody(req);
        const data = JSON.parse(body);
        const result = toggleCheckboxInFile(
          absPath,
          Number(data.line),
          Boolean(data.checked),
        );
        if (result.ok) recordChange();
        res.writeHead(result.ok ? 200 : 409, {
          'Content-Type': 'application/json; charset=utf-8',
        });
        res.end(JSON.stringify(result));
        return;
      }

      // API: 读取最新 md 内容（页面刷新用）
      if (url.pathname === '/api/content' && req.method === 'GET') {
        const content = fs.readFileSync(absPath, 'utf8');
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ content }));
        return;
      }

      // API: 表格新增列（任意位置；插入列不改变行数，源文件行号稳定）
      if (url.pathname === '/api/table/add-column' && req.method === 'POST') {
        const body = await readBody(req);
        const data = JSON.parse(body);
        const result = addColumnInFile(
          absPath,
          Number(data.line),
          Number(data.colIndex),
          String(data.name ?? ''),
        );
        if (result.ok) recordChange();
        res.writeHead(result.ok ? 200 : 409, {
          'Content-Type': 'application/json; charset=utf-8',
        });
        res.end(JSON.stringify(result));
        return;
      }

      // API: 改写表格某数据行某列的值
      if (url.pathname === '/api/table/set-cell' && req.method === 'POST') {
        const body = await readBody(req);
        const data = JSON.parse(body);
        const result = setCellInFile(
          absPath,
          Number(data.line),
          Number(data.colIndex),
          String(data.value ?? ''),
        );
        if (result.ok) recordChange();
        res.writeHead(result.ok ? 200 : 409, {
          'Content-Type': 'application/json; charset=utf-8',
        });
        res.end(JSON.stringify(result));
        return;
      }

      // API: 历史状态查询（前端按钮可用态）
      if (url.pathname === '/api/history/status' && req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify(historyStatus()));
        return;
      }

      // API: 撤销
      if (url.pathname === '/api/history/undo' && req.method === 'POST') {
        const ok = historyCursor > 0 && applyHistory(historyCursor - 1);
        res.writeHead(ok ? 200 : 409, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ ok, ...(ok ? historyStatus() : { reason: 'nothing to undo' }) }));
        return;
      }

      // API: 反撤销
      if (url.pathname === '/api/history/redo' && req.method === 'POST') {
        const ok = historyCursor < history.length - 1 && applyHistory(historyCursor + 1);
        res.writeHead(ok ? 200 : 409, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ ok, ...(ok ? historyStatus() : { reason: 'nothing to redo' }) }));
        return;
      }

      // API: 取消本次所有修改（重置 = 把启动时的磁盘备份放回去）
      if (url.pathname === '/api/history/reset' && req.method === 'POST') {
        let content: string | null = null;
        if (fs.existsSync(backupPath)) {
          try {
            content = fs.readFileSync(backupPath, 'utf8');
          } catch {
            content = null;
          }
        }
        if (content === null && history.length) content = history[0]; // 备份缺失时回退内存快照
        let ok = false;
        if (content !== null) {
          try {
            fs.writeFileSync(absPath, content, 'utf8');
            historyCursor = 0;
            ok = true;
          } catch {
            ok = false;
          }
        }
        res.writeHead(ok ? 200 : 409, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ ok, ...(ok ? historyStatus() : { reason: 'reset failed: 备份不存在' }) }));
        return;
      }

      // 静态资源（服务器模式）
      if (url.pathname === '/preview.js' || url.pathname === '/preview.css') {
        const file = path.join(mediaDir, url.pathname);
        if (fs.existsSync(file)) {
          const ext = path.extname(file);
          res.writeHead(200, {
            'Content-Type':
              ext === '.css' ? 'text/css; charset=utf-8' : 'text/javascript; charset=utf-8',
          });
          res.end(fs.readFileSync(file));
          return;
        }
      }

      // 主页（服务器模式，浏览器直开用）
      if (url.pathname === '/' || url.pathname === '/index.html') {
        const content = fs.readFileSync(absPath, 'utf8');
        const { html } = engine.render(content);
        const page = renderPage({ title: path.basename(absPath), bodyHtml: html });
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(page);
        return;
      }

      // API: 服务器模式页面 HTML（独立文件 Sync 按钮 DOMParser 解析用）
      if (url.pathname === '/api/html' && req.method === 'GET') {
        const content = fs.readFileSync(absPath, 'utf8');
        const { html } = engine.render(content);
        const page = renderPage({ title: path.basename(absPath), bodyHtml: html });
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(page);
        return;
      }

      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not found');
    } catch (err) {
      console.error('[tickmark] request failed:', err);
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: String(err) }));
    }
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(opts.port || 0, host, () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : opts.port || 0;

      let htmlFile = '';
      if (opts.generateHtml !== false) {
        htmlFile = writeStandaloneHtml({
          filePath: absPath,
          outPath: opts.htmlFile,
          engine,
          apiBase: `http://${host}:${port}`,
          mediaDir,
        });
      }

      console.log('');
      console.log('  TickMark  ─  Markdown preview');
      console.log(`  File:   ${absPath}`);
      console.log(`  Backup: ${backupPath}`);
      console.log('  → 启动时已备份原始 md，重置 = 把备份放回；退出时自动删除备份');
      if (htmlFile) {
        console.log(`  HTML:   ${htmlFile}`);
        console.log('  → 在 CodeBuddy/编辑器中预览该 HTML 文件，点击 checkbox 即回写 md');
      }
      console.log(`  API:    http://${host}:${port}   (Ctrl+C 退出)`);
      console.log('');
      resolve({ server, port, htmlFile, backupFile: backupPath });
    });
  });
}

/** 生成独立 HTML 文件：CSS/JS 内联 + 注入 API 地址 */
function writeStandaloneHtml(params: {
  filePath: string;
  outPath?: string;
  engine: MarkdownEngine;
  apiBase: string;
  mediaDir: string;
}): string {
  const { filePath, engine, apiBase, mediaDir } = params;

  const content = fs.readFileSync(filePath, 'utf8');
  const { html } = engine.render(content);

  const cssPath = path.join(mediaDir, 'preview.css');
  const jsPath = path.join(mediaDir, 'preview.js');
  const cssText = fs.existsSync(cssPath) ? fs.readFileSync(cssPath, 'utf8') : '';
  const jsText = fs.existsSync(jsPath) ? fs.readFileSync(jsPath, 'utf8') : '';

  // 默认与源文件同层：<原名>.tickmark.html（如 sample.md → sample.md.tickmark.html）
  const base = path.basename(filePath);
  const outPath =
    params.outPath ||
    path.join(path.dirname(filePath), `${base}.tickmark.html`);

  const page = renderStandalonePage({
    title: path.basename(filePath),
    bodyHtml: html,
    cssText,
    jsText,
    apiBase,
  });

  fs.writeFileSync(outPath, page, 'utf8');
  return outPath;
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => (data += chunk));
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}
