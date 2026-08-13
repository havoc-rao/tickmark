/**
 * TickMark — 通用工具模块（DOM / 弹层 / 存储 / 滚动 / Toast）
 *
 * 本文件与 templates.js / preview.js 由 scripts/build-media.js 合并进
 * 同一 IIFE 共享作用域，依赖方直接以函数声明调用，无需导入。
 */

/** API 地址拼接（API 由页面注入：window.__TICKMARK_API） */
function api(path) {
  return API + path;
}

/** 单元格文本规范化：空白折叠为单空格，空值显示 (空) / (empty) */
function cellText(el) {
  var s = (el.textContent || '').replace(/\s+/g, ' ').trim();
  return s === '' ? (typeof I18N !== 'undefined' ? I18N.t('common.empty') : '(空)') : s;
}

/** 向上查找匹配选择器的祖先元素 */
function closest(el, sel) {
  while (el) {
    if (el.matches && el.matches(sel)) return el;
    el = el.parentNode;
  }
  return null;
}

/**
 * 轻量 Popover 组件：弹层绝对定位到 container 内，以 offset（锚点相对容器偏移）关联位置。
 * container 须为定位上下文（position: relative）；弹层置于其内部时，
 * 页面/容器滚动会随 container 一起移动 → 天然跟随，无需 scroll 监听。
 * 仅在弹层内容尺寸变化后调用 update() 重算即可。
 */
function tmPopover(cfg) {
  var content = cfg.content; // 弹层元素（初始 display:none，由组件迁移挂载）
  var maxWidth = cfg.maxWidth || 310;
  var maxHeight = cfg.maxHeight || 400;
  var gap = cfg.gap || 6;
  var getAnchor = cfg.getAnchor || null; // 每次定位前懒查 DOM，避免外部重建后失效
  var container = null;

  function geome() {
    if (!getAnchor || !container || !container.isConnected) return;
    var anchor = getAnchor();
    // 锚点未挂载（外部重建 / 切换表格）→ 自动关闭弹层，避免卡在视口左上角
    if (!anchor || !anchor.isConnected) { content.style.display = 'none'; return; }
    if (content.parentNode !== container) container.appendChild(content);
    var ar = anchor.getBoundingClientRect();
    var wr = container.getBoundingClientRect();
    var cw = Math.min(maxWidth, (window.innerWidth || 900) - 16);
        content.style.width = cw + 'px';
        content.style.maxHeight = maxHeight + 'px';
    var ch = Math.max(0, content.offsetHeight);
    var vw = window.innerWidth || 900;
    var vh = window.innerHeight || 800;
    // 水平：弹层中心对准锚点中心，越界钳制
    var x = ar.left + ar.width / 2 - cw / 2;
    if (x < 8) x = 8;
    if (x + cw > vw - 8) x = Math.max(8, vw - cw - 8);
    // 垂直：锚点下方，放不下翻转到上方
    var y = ar.bottom + gap;
    if (y + ch > vh - 8) y = Math.max(8, ar.top - ch - gap);
    // 换算为相对 container 的 offset（absolute 定位）
    content.style.left = x - wr.left + 'px';
    content.style.top = y - wr.top + 'px';
    content.style.display = 'block';
  }

  return {
    update: geome,
    show: function (getAnchorFn, c) {
      getAnchor = getAnchorFn || getAnchor;
      container = c || container;
      geome();
    },
    hide: function () { content.style.display = 'none'; },
    el: content,
  };
}

/** 读取本地偏好；webview sandbox 下 localStorage 可能不可用 → 返回默认值 */
function getStored(key, fallback) {
  try {
    var v = window.localStorage.getItem(key);
    return v === null || v === '' ? fallback : v;
  } catch (e) {
    return fallback;
  }
}

/** 写入本地偏好；webview sandbox 下静默失败 */
function setStored(key, value) {
  try { window.localStorage.setItem(key, value); } catch (e) { /* ignore */ }
}

/** 系统是否深色主题（跟随 prefers-color-scheme） */
function themeSystemDark() {
  return !!(window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
}

/** 读取滚动器当前垂直位置（window 或元素） */
function scrollTopOf(scroller) {
  return scroller === window
    ? (document.scrollingElement || document.documentElement).scrollTop
    : scroller.scrollTop;
}

/**
 * 纯 JS 平滑滚动（rAF 插值）：不依赖 scrollIntoView / CSS scroll-behavior。
 * 嵌入式预览（CodeBuddy Simple Browser 的 sandbox iframe）里 scrollIntoView
 * 的 smooth 目标可能被算成文档原点 → 先跳 top 0 再被修正，产生闪动。
 * 这里直接算准目标位置、从当前真实位置平滑滚过去，任何环境行为一致。
 */
function smoothScrollTo(scroller, targetTop) {
  var startTop = scrollTopOf(scroller);
  var dist = targetTop - startTop;
  if (Math.abs(dist) <= 1) return;
  var dur = Math.max(160, Math.min(480, Math.abs(dist) * 0.12)); // 距离自适应时长
  var t0 = null;
  function step(ts) {
    if (t0 === null) t0 = ts;
    var p = Math.min(1, (ts - t0) / dur);
    var v = startTop + dist * (1 - Math.pow(1 - p, 3)); // ease-out cubic
    if (scroller === window) window.scrollTo(0, v);
    else scroller.scrollTop = v;
    if (p < 1) requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
}

/** 向上找真正可滚动的祖先容器；都不可滚则返回 window */
function findScroller(el) {
  var node = el.parentElement;
  while (node && node !== document.body && node !== document.documentElement) {
    var st = window.getComputedStyle(node);
    var oy = st.overflowY;
    if ((oy === 'auto' || oy === 'scroll') && node.scrollHeight > node.clientHeight + 1) {
      return node;
    }
    node = node.parentElement;
  }
  return window;
}

/** Toast 提示：复用 preview.css 中的 .tm-toast 样式，2.6s 自动消失 */
function showToast(msg, isError) {
  var toast = document.createElement('div');
  toast.className = 'tm-toast' + (isError ? ' tm-toast-error' : '');
  toast.textContent = msg;
  document.body.appendChild(toast);
  setTimeout(function () {
    toast.classList.add('tm-toast-hide');
    setTimeout(function () { toast.remove(); }, 400);
  }, 2600);
}
