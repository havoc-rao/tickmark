export interface PageOptions {
  title: string;
  bodyHtml: string;
  /** 界面语言（zh-CN / en-US），来自 ~/.config/tickmark/config.json 的 lang */
  lang?: string;
}

export interface StandalonePageOptions extends PageOptions {
  cssText: string;
  jsText: string;
  /** CLI 服务端 API 地址，注入给页面脚本 fetch 用 */
  apiBase: string;
}

/** 注入 i18n 语言：CLI 配置（config.json lang）优先于页面 localStorage，作为打开时的初始语言 */
function langScript(lang?: string): string {
  const v = lang && (lang === 'zh-CN' || lang === 'en-US') ? lang : '';
  return v
    ? `  <script>window.__TICKMARK_LANG = ${JSON.stringify(v)};</script>\n`
    : '';
}

/**
 * 渲染一个按钮（带 i18n hook）：
 * - text 由 data-i18n-key 控制（preview.js 启动时按当前语言填充）
 * - title 由 data-i18n-title 控制（hover tooltip）
 * - 服务端模板在文本/标题位置留空，由客户端 hydrate，避免双向耦合
 */
function toolbarBtn(
  idAttr: string,
  extraClass: string,
  i18nKey: string,
  iconHtml: string,
  i18nTitleKey: string,
): string {
  const cls = extraClass ? ` class="tm-btn ${extraClass}"` : ' class="tm-btn"';
  const t = i18nTitleKey ? ` data-i18n-title="${i18nTitleKey}"` : '';
  return (
    `<button id="${idAttr}"${cls} type="button"${t}>` +
    (iconHtml ? `<span class="tm-i18n-ic" aria-hidden="true">${iconHtml}</span> ` : '') +
    `<span data-i18n-key="${i18nKey}"></span>` +
    `</button>`
  );
}

/** 服务器模式页面（引用 /preview.js 与 /preview.css） */
export function renderPage(opts: PageOptions): string {
  const { title, bodyHtml, lang } = opts;

  return /* html */ `<!DOCTYPE html>
<html lang="${lang === 'en-US' ? 'en' : 'zh-CN'}">
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
    ${toolbarBtn('tm-edit-toggle', 'tm-edit-toggle', 'toolbar.edit', '✎', 'toolbar.edit.title')}
    ${toolbarBtn('tm-refresh', '', 'toolbar.refresh', '', 'toolbar.refresh.title')}
    <div id="tm-theme-wrap" class="tm-theme-wrap">
      ${toolbarBtn('tm-theme-toggle', 'tm-theme-toggle', 'toolbar.theme', '◐', 'toolbar.theme.title')}
    </div>
  </header>
  <main class="markdown-body">
    ${bodyHtml}
  </main>
${langScript(lang)}  <script>window.__TICKMARK_API = '';</script>
  <script src="/preview.js"></script>
</body>
</html>`;
}

/** 独立 HTML 文件（CodeBuddy/编辑器直接预览用）：CSS/JS 全部内联 + 注入 API 地址 */
export function renderStandalonePage(opts: StandalonePageOptions): string {
  const { title, bodyHtml, cssText, jsText, apiBase, lang } = opts;

  return /* html */ `<!DOCTYPE html>
<html lang="${lang === 'en-US' ? 'en' : 'zh-CN'}">
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
    ${toolbarBtn('tm-edit-toggle', 'tm-edit-toggle', 'toolbar.edit', '✎', 'toolbar.edit.title')}
    ${toolbarBtn('tm-refresh', '', 'toolbar.sync', '', 'toolbar.sync.title')}
    <div id="tm-theme-wrap" class="tm-theme-wrap">
      ${toolbarBtn('tm-theme-toggle', 'tm-theme-toggle', 'toolbar.theme', '◐', 'toolbar.theme.title')}
    </div>
  </header>
  <main class="markdown-body">
    ${bodyHtml}
  </main>
${langScript(lang)}  <script>
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
