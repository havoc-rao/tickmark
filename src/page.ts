export interface PageOptions {
  title: string;
  bodyHtml: string;
}

export interface StandalonePageOptions extends PageOptions {
  cssText: string;
  jsText: string;
  /** CLI 服务端 API 地址，注入给页面脚本 fetch 用 */
  apiBase: string;
}

/** 服务器模式页面（引用 /preview.js 与 /preview.css） */
export function renderPage(opts: PageOptions): string {
  const { title, bodyHtml } = opts;

  return /* html */ `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapeHtml(title)}</title>
  <link rel="stylesheet" href="/preview.css" />
</head>
<body>
  <header class="tm-toolbar">
    <span class="tm-title">TickMark</span>
    <span class="tm-file">${escapeHtml(title)}</span>
    <button id="tm-refresh" class="tm-btn" title="重新渲染">Refresh</button>
    <div id="tm-theme-wrap" class="tm-theme-wrap">
      <button id="tm-theme-toggle" class="tm-btn" type="button" title="切换主题与强调色"><span class="tm-theme-ic">◐</span> 主题</button>
    </div>
  </header>
  <main class="markdown-body">
    ${bodyHtml}
  </main>
  <script>window.__TICKMARK_API = '';</script>
  <script src="/preview.js"></script>
</body>
</html>`;
}

/** 独立 HTML 文件（CodeBuddy/编辑器直接预览用）：CSS/JS 全部内联 + 注入 API 地址 */
export function renderStandalonePage(opts: StandalonePageOptions): string {
  const { title, bodyHtml, cssText, jsText, apiBase } = opts;

  return /* html */ `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapeHtml(title)}</title>
  <style>
${cssText}
  </style>
</head>
<body>
  <header class="tm-toolbar">
    <span class="tm-title">TickMark</span>
    <span class="tm-file">${escapeHtml(title)}</span>
    <button id="tm-refresh" class="tm-btn" title="拉取最新 md 并重新渲染">Sync</button>
    <div id="tm-theme-wrap" class="tm-theme-wrap">
      <button id="tm-theme-toggle" class="tm-btn" type="button" title="切换主题与强调色"><span class="tm-theme-ic">◐</span> 主题</button>
    </div>
  </header>
  <main class="markdown-body">
    ${bodyHtml}
  </main>
  <script>
    window.__TICKMARK_API = ${JSON.stringify(apiBase)};
  </script>
  <script>
${jsText}
  </script>
</body>
</html>`;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
