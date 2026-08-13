/**
 * TickMark — HTML 模板常量模块
 *
 * 集中管理页面中所有弹层 / 面板 / 按钮组的结构模板字符串，
 * 业务逻辑（preview.js）只负责 innerHTML 注入与事件绑定。
 * 本文件与 utils.js / preview.js 由 scripts/build-media.js 合并进同一 IIFE。
 */

/** 列过滤器图标（SVG） */
var TM_ICON_FILTER =
  '<svg class="tm-cf-ic" viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">' +
  '<path fill="currentColor" d="M1.5 2h13a.5.5 0 0 1 .4.8L10 8.9v5.1a.5.5 0 0 1-.6.5l-3-1a.5.5 0 0 1-.4-.5V8.9L1.1 2.8A.5.5 0 0 1 1.5 2z"/></svg>';

/**
 * 列过滤弹层结构（值多选 / 搜索 / 全选反选清空），
 * 列表项由 renderFilterList 动态填充；按钮/输入的文案由 preview.js
 * 在弹层首次出现时通过 I18N.t() 写入（保持 DOM 静态以便 outerHTML 复用）。
 */
var TM_FPOP_HTML =
  '<div class="tm-fpop-head">' +
  '<label class="tm-fpop-master">' +
  '<input type="checkbox" class="tm-fpop-all"/>' +
  '<span class="tm-fpop-title"></span>' +
  '</label>' +
  '<span class="tm-fpop-sum"></span>' +
  '</div>' +
  '<input class="tm-fpop-search" type="text"/>' +
  '<div class="tm-fpop-actions">' +
  '<button type="button" data-act="all"></button>' +
  '<button type="button" data-act="invert"></button>' +
  '<button type="button" data-act="none"></button>' +
  '</div>' +
  '<ul class="tm-fpop-list"></ul>';

/** 添加列弹层结构（列名 / 类型 / 批量填值 / 插入位置），
 *  插入位置的自定义下拉由 preview.js 动态渲染（渲染到 .tm-ac-pos-choose 容器内） */
var TM_AC_POP_HTML =
  '<div class="tm-ac-head">' +
  '<span class="tm-ac-title"></span>' +
  '<button type="button" class="tm-ac-close" title="取消">×</button>' +
  '</div>' +
  '<input class="tm-ac-name" type="text"/>' +
  '<div class="tm-ac-type-row">' +
  '<span class="tm-ac-label"></span>' +
  '<button type="button" class="tm-ac-type" data-type="text"></button>' +
  '<button type="button" class="tm-ac-type" data-type="checkbox"></button>' +
  '</div>' +
  '<div class="tm-ac-fill-row" data-show="text">' +
  '<input class="tm-ac-fill" type="text"/>' +
  '</div>' +
  '<div class="tm-ac-cb-row" data-show="checkbox" style="display:none">' +
  '<span class="tm-ac-label"></span>' +
  '<button type="button" class="tm-ac-cb-default" data-val="[ ]"></button>' +
  '<button type="button" class="tm-ac-cb-default" data-val="[x]"></button>' +
  '</div>' +
  '<div class="tm-ac-pos-row">' +
  '<span class="tm-ac-label"></span>' +
  // 自定义 choose 容器（trigger + panel）：替代浏览器原生 <select>，统一视觉
  '<div class="tm-choose tm-ac-pos-choose" data-key="addCol-pos"></div>' +
  '<button type="button" class="tm-ac-pos-side active" data-side="after"></button>' +
  '<button type="button" class="tm-ac-pos-side" data-side="before"></button>' +
  '</div>' +
  '<div class="tm-ac-actions">' +
  '<button type="button" class="tm-ac-cancel"></button>' +
  '<button type="button" class="tm-ac-ok"></button>' +
  '</div>';

/** 历史操作按钮组（撤销 / 重做 / 重置），由 ensureHistoryButtons 注入 */
var TM_HISTORY_GROUP_HTML =
  '<button type="button" class="tm-btn tm-hist-undo" title="撤销上一次修改">↶ 撤销</button>' +
  '<button type="button" class="tm-btn tm-hist-redo" title="重做已撤销的修改">↷ 重做</button>' +
  '<button type="button" class="tm-btn tm-hist-reset" title="取消本次所有修改，恢复到打开时的内容">重置</button>';

/**
 * 大纲面板结构（标题 / 收起按钮 / 列表容器），
 * 标题与 close title 由 preview.js 在面板首次创建时通过 I18N.t() 写入。
 */
var TM_OUTLINE_HTML =
  '<div class="tm-toc-head">' +
  '<span class="tm-toc-title"></span>' +
  '<button type="button" class="tm-toc-close" aria-label="">×</button>' +
  '</div>' +
  '<div class="tm-toc-body"><ul class="tm-toc-list"></ul></div>';

/**
 * 主题菜单结构（外观 + 强调色 + 语言 三组），
 * section 标题和 close title 由 preview.js 通过 I18N.t() 写入。
 */
var TM_THEME_POP_HTML =
  '<div class="tm-theme-head">' +
  '<span class="tm-theme-title"></span>' +
  '<button type="button" class="tm-theme-close" aria-label="">×</button>' +
  '</div>' +
  '<div class="tm-theme-sec" data-sec="appearance"></div>' +
  '<div class="tm-theme-options" data-group="theme"></div>' +
  '<div class="tm-theme-sec" data-sec="accent"></div>' +
  '<div class="tm-theme-options" data-group="accent"></div>' +
  '<div class="tm-theme-sec" data-sec="lang"></div>' +
  '<div class="tm-theme-options" data-group="lang"></div>';
