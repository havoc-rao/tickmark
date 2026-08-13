import MarkdownIt from 'markdown-it';
import taskLists from 'markdown-it-task-lists';
import hljs from 'highlight.js';

/**
 * 自定义 markdown-it 插件：给所有 block_open 元素注入 `data-source-line` 属性。
 *
 * 用途：浏览器端 checkbox 点击时，从 input 向上找最近的 [data-source-line] 元素
 * 拿到源文件行号（0-based），POST 给服务端做回写定位。
 *
 * 注意：markdown-it-task-lists@2.x 不支持 lineNumber 选项，必须靠这个插件补行号。
 */
function sourceLinePlugin(md: MarkdownIt): void {
  md.core.ruler.after('inline', 'source-line-attrs', (state) => {
    const tokens = state.tokens;
    for (let i = 0; i < tokens.length; i++) {
      const t = tokens[i];
      if (t.type.endsWith('_open') && t.map && t.map.length >= 2) {
        t.attrSet('data-source-line', String(t.map[0]));
      }
    }
  });
}

export interface RenderResult {
  html: string;
}

/**
 * Markdown 渲染引擎（CLI 版）—— markdown-it + task-lists + source-line + highlight.js
 *
 * 与 VSCode 版 TickMark 共享同一套逻辑，只是移除了 vscode 依赖。
 */
export class MarkdownEngine {
  private md: MarkdownIt;

  constructor() {
    this.md = new MarkdownIt({
      html: false,
      linkify: true,
      typographer: true,
      highlight: (code, lang) => this.highlight(code, lang),
    });

    this.md.use(taskLists, {
      enabled: true,
      label: true,
    });

    sourceLinePlugin(this.md);
  }

  render(text: string): RenderResult {
    return { html: this.md.render(text) };
  }

  /** 暴露 markdown-it token 流（供表格范围定位 / 回写安全校验等使用） */
  parse(text: string) {
    return this.md.parse(text, {});
  }

  private highlight(code: string, lang: string): string {
    const language = lang && hljs.getLanguage(lang) ? lang : '';
    try {
      if (language) {
        return `<pre class="hljs"><code>${hljs.highlight(code, { language }).value}</code></pre>`;
      }
      return `<pre class="hljs"><code>${hljs.highlightAuto(code).value}</code></pre>`;
    } catch {
      return `<pre class="hljs"><code>${this.md.utils.escapeHtml(code)}</code></pre>`;
    }
  }
}
