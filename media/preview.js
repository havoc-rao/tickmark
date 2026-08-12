/**
 * TickMark CLI — 页面交互脚本
 *
 * 支持两种载体：
 * 1. 独立 HTML 文件（CodeBuddy/编辑器预览）：window.__TICKMARK_API 已注入
 *    → checkbox 点击 fetch(API + /api/toggle) 回写 md
 * 2. 服务器模式（浏览器直开 /）：API 为空字符串 → 相对路径 fetch
 *
 * 职责：
 * - checkbox change → POST /api/toggle → 成功保持勾选，失败回滚 + toast
 * - Sync 按钮 → GET /api/content 拉最新 md → 重新渲染整个 body
 * - 代码块复制按钮
 */
(function () {
  'use strict';

  var API = (window.__TICKMARK_API || '').replace(/\/$/, '');

  function api(path) {
    return API + path;
  }

  // ---- Checkbox 点击 → POST /api/toggle ----
  document.addEventListener('change', function (e) {
    var target = e.target;
    if (!target || target.tagName !== 'INPUT' || target.type !== 'checkbox') return;
    if (target.className.indexOf('task-list-item-checkbox') < 0) return;

    var lineEl = target.closest ? target.closest('[data-source-line]') : null;
    var line = lineEl ? parseInt(lineEl.getAttribute('data-source-line'), 10) || 0 : 0;
    var checked = target.checked;

    fetch(api('/api/toggle'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ line: line, checked: checked }),
    })
      .then(function (res) {
        return res.json().then(function (data) {
          return { status: res.status, data: data };
        });
      })
      .then(function (r) {
        if (r.status === 200 && r.data.ok) {
          console.log('[tickmark] toggled line', line, '->', r.data.newChar);
          // 成功：保持本地勾选态
        } else {
          target.checked = !checked; // 回滚
          showToast(r.data.reason || 'toggle failed (status ' + r.status + ')', true);
        }
      })
      .catch(function (err) {
        target.checked = !checked; // 网络失败回滚
        console.error('[tickmark] fetch failed:', err);
        showToast('无法连接 TickMark 服务（' + (API || '?') + '），请确认 CLI 仍在运行', true);
      });
  });

  // ---- Sync 按钮：拉最新 md 重渲染 ----
  var syncBtn = document.getElementById('tm-refresh');
  if (syncBtn) {
    syncBtn.addEventListener('click', function () {
      fetch(api('/api/content'))
        .then(function (res) { return res.json(); })
        .then(function (data) {
          if (!data.content) throw new Error('empty content');
          // 用 hidden iframe 渲染最新内容再替换 body（保留 toolbar）
          var toolbar = document.querySelector('.tm-toolbar');
          fetch(api('/api/html'))
            .then(function (r) { return r.text(); })
            .then(function (pageHtml) {
              var doc = new DOMParser().parseFromString(pageHtml, 'text/html');
              var newBody = doc.querySelector('.markdown-body');
              if (newBody) {
                var oldBody = document.querySelector('.markdown-body');
                if (oldBody && oldBody.parentNode) {
                  oldBody.parentNode.replaceChild(newBody, oldBody);
                }
                initTableFilters();
                showToast('已同步最新内容', false);
              }
            })
            .catch(function () {
              showToast('同步失败', true);
            });
        })
        .catch(function (err) {
          console.error('[tickmark] sync failed:', err);
          showToast('无法连接 TickMark 服务，请确认 CLI 仍在运行', true);
        });
    });
  }

  // ---- 代码块复制按钮 ----
  var codeBlocks = document.querySelectorAll('pre code');
  for (var i = 0; i < codeBlocks.length; i++) {
    (function (codeEl) {
      var pre = codeEl.parentElement;
      if (!pre) return;
      var btn = document.createElement('button');
      btn.className = 'code-copy-btn';
      btn.textContent = 'Copy';
      btn.addEventListener('click', function () {
        var text = codeEl.textContent || '';
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(text).catch(function () {});
        } else {
          var ta = document.createElement('textarea');
          ta.value = text;
          document.body.appendChild(ta);
          ta.select();
          try { document.execCommand('copy'); } catch (e) { /* ignore */ }
          document.body.removeChild(ta);
        }
        btn.textContent = 'Copied!';
        setTimeout(function () { btn.textContent = 'Copy'; }, 1500);
      });
      pre.style.position = 'relative';
      pre.appendChild(btn);
    })(codeBlocks[i]);
  }

  // ---- 表格列过滤：聚合统计 / 多选 / 全选 / 反选 ----
  var currentModel = null;
  var TM_ICON_FILTER =
    '<svg class="tm-cf-ic" viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">' +
    '<path fill="currentColor" d="M1.5 2h13a.5.5 0 0 1 .4.8L10 8.9v5.1a.5.5 0 0 1-.6.5l-3-1a.5.5 0 0 1-.4-.5V8.9L1.1 2.8A.5.5 0 0 1 1.5 2z"/></svg>';

  function cellText(el) {
    var s = (el.textContent || '').replace(/\s+/g, ' ').trim();
    return s === '' ? '(空)' : s;
  }

  /** 空单元格显示灰色占位 (空)，提升表格可读性 */
  function markEmptyCells(table) {
    var tds = table.querySelectorAll('td');
    for (var i = 0; i < tds.length; i++) {
      var td = tds[i];
      if ((td.textContent || '').trim() === '' && !td.querySelector('img, input')) {
        td.classList.add('tm-empty');
        td.textContent = '(空)';
      }
    }
  }

  /** 检测数字列：该列 ≥80% 非空单元格为纯数字 → 右对齐 + 等宽数字 */
  function detectNumCols(table, headRow) {
    var tbody = table.tBodies[0];
    var res = [], c, r, cell, t;
    for (c = 0; c < headRow.cells.length; c++) {
      var num = 0, total = 0;
      for (r = 0; r < tbody.rows.length; r++) {
        cell = tbody.rows[r].cells[c];
        if (!cell) continue;
        total++;
        t = (cell.textContent || '').trim();
        if (t !== '' && /^[-+]?\d{1,3}([.,]\d{3})*([.,]\d+)?$/.test(t)) num++;
      }
      res.push(total > 0 && num / total >= 0.8);
    }
    return res;
  }

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

  var filterPopover = null;

  function getPopup() {
    if (!filterPopover) {
      var pop = document.createElement('div');
      pop.className = 'tm-fpop';
      pop.id = 'tm-fpop';
      pop.style.display = 'none';
      pop.innerHTML =
        '<div class="tm-fpop-head">' +
        '<label class="tm-fpop-master" title="全选 / 全不选">' +
        '<input type="checkbox" class="tm-fpop-all"/>' +
        '<span class="tm-fpop-title"></span>' +
        '</label>' +
        '<span class="tm-fpop-sum"></span>' +
        '</div>' +
        '<input class="tm-fpop-search" type="text" placeholder="搜索值…"/>' +
        '<div class="tm-fpop-actions">' +
        '<button type="button" data-act="all">全选</button>' +
        '<button type="button" data-act="invert">反选</button>' +
        '<button type="button" data-act="none">清空</button>' +
        '</div>' +
        '<ul class="tm-fpop-list"></ul>';
      // 不 append 到 body：由 popover 挂载到当前表格的定位容器
      filterPopover = tmPopover({ content: pop, maxWidth: 310, maxHeight: 400, gap: 6 });
    }
    return filterPopover.el;
  }

  function rowVal(m, row, col) {
    var cell = row.cells[col];
    return cell ? cellText(cell) : '';
  }

  function passes(m, row) {
    for (var c = 0; c < m.cols.length; c++) {
      var s = m.sel[c];
      if (!s) continue;
      if (!s.size) return false;
      if (!s.has(rowVal(m, row, c))) return false;
    }
    return true;
  }

  /** 统计某列各取值的行数；只统计通过「其它列」过滤的行（同列内多选为 OR，跨列为 AND） */
  function countsFor(m, col) {
    var counts = {}, c, r, row, pass, s, v;
    for (r = 0; r < m.rows.length; r++) {
      row = m.rows[r];
      pass = true;
      for (c = 0; c < m.cols.length; c++) {
        if (c === col) continue;
        s = m.sel[c];
        if (s && s.size && !s.has(rowVal(m, row, c))) { pass = false; break; }
      }
      if (!pass) continue;
      v = rowVal(m, row, col);
      counts[v] = (counts[v] || 0) + 1;
    }
    return counts;
  }

  /** 列的唯一取值，按出现次数降序、文本升序 */
  function colValues(m, col) {
    var counts = countsFor(m, col);
    return Object.keys(counts).sort(function (a, b) {
      if (counts[a] !== counts[b]) return counts[b] - counts[a];
      return a < b ? -1 : a > b ? 1 : 0;
    });
  }

  /** 纯函数渲染：工具栏（汇总行数 + 每列过滤按钮 + 清除筛选） */
  function renderFilterBar(m) {
    var visible = 0, r, c, s, num, cell, btn, ic, nm;
    for (r = 0; r < m.rows.length; r++) {
      if (m.rows[r].style.display !== 'none') visible++;
    }
    var bar = document.createElement('div');
    bar.className = 'tm-tbl-bar';
    var sum = document.createElement('span');
    sum.className = 'tm-tbl-sum';
    bar.appendChild(sum);
    var hasActive = false;
    for (c = 0; c < m.cols.length; c++) {
      cell = document.createElement('span');
      cell.className = 'tm-cf-cell';
      btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'tm-colfilter';
      btn.setAttribute('data-col', String(c));
      ic = document.createElement('span');
      ic.innerHTML = TM_ICON_FILTER;
      btn.appendChild(ic);
      nm = document.createElement('span');
      nm.className = 'tm-cf-name';
      nm.textContent = m.cols[c] || '(无表头)';
      btn.appendChild(nm);
      num = document.createElement('span');
      num.className = 'tm-cf-num';
      btn.appendChild(num);
      s = m.sel[c];
      if (s && s.size) {
        btn.classList.add('active');
        num.textContent = s.size + '/' + colValues(m, c).length;
        hasActive = true;
      }
      cell.appendChild(btn);
      bar.appendChild(cell);
    }
    var clearBtn = document.createElement('button');
    clearBtn.type = 'button';
    clearBtn.className = 'tm-tbl-clear';
    clearBtn.textContent = '清除筛选';
    if (!hasActive) clearBtn.style.display = 'none';
    bar.appendChild(clearBtn);
    sum.textContent = hasActive
      ? '显示 ' + visible + ' / ' + m.rows.length + ' 行'
      : m.rows.length + ' 行';
    return bar;
  }

  /** 挂载调度：整体重建工具栏（替换旧节点，保持位于 table 之前） */
  function mountFilterBar(m) {
    var wrap = m.table.parentNode;
    if (!wrap) return;
    var old = wrap.querySelector('.tm-tbl-bar');
    var bar = renderFilterBar(m);
    if (old && old.parentNode) old.parentNode.replaceChild(bar, old);
    else wrap.insertBefore(bar, m.table);
  }

  /** 纯函数渲染：弹层值列表（选中高亮 / 计数胶囊 / 空态） */
  function renderFilterList(m) {
    var col = m.activeCol;
    var counts = countsFor(m, col);
    var keys = Object.keys(counts).sort(function (a, b) {
      if (counts[a] !== counts[b]) return counts[b] - counts[a];
      return a < b ? -1 : a > b ? 1 : 0;
    });
    var sel = m.sel[col] || new Set();
    var list = document.createElement('ul');
    list.className = 'tm-fpop-list';
    for (var k = 0; k < keys.length; k++) {
      var v = keys[k];
      var li = document.createElement('li');
      li.className = sel.has(v) ? 'selected' : '';
      var lab = document.createElement('label');
      var cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.className = 'tm-fpop-cb';
      cb.setAttribute('data-val', v);
      cb.checked = sel.has(v);
      var vs = document.createElement('span');
      vs.className = 'tm-fpop-val';
      vs.textContent = v;
      vs.title = v;
      var cs = document.createElement('span');
      cs.className = 'tm-fpop-cnt';
      cs.textContent = String(counts[v]);
      lab.appendChild(cb);
      lab.appendChild(vs);
      lab.appendChild(cs);
      li.appendChild(lab);
      list.appendChild(li);
    }
    if (!keys.length) {
      var empty = document.createElement('li');
      empty.className = 'tm-fpop-empty';
      empty.textContent = '无匹配值';
      list.appendChild(empty);
    }
    return {
      keys: keys,
      list: list,
      masterChecked: keys.length > 0 && sel.size === keys.length,
      masterIndeterminate: sel.size > 0 && sel.size < keys.length,
      sumText: keys.length ? sel.size + ' / ' + keys.length + ' 值' : '无值',
      titleText: m.cols[col] || '(无表头)',
    };
  }

  /** 弹层状态刷新：只重建值列表 + 同步主框/标题/总数；搜索框保留（不丢焦点） */
  function refreshPopup(m) {
    var pop = getPopup();
    var col = m.activeCol;
    if (col < 0) return;
    var st = renderFilterList(m);
    var oldList = pop.querySelector('.tm-fpop-list');
    if (oldList) oldList.parentNode.replaceChild(st.list, oldList);
    var master = pop.querySelector('.tm-fpop-all');
    if (master) {
      master.checked = st.masterChecked;
      master.indeterminate = st.masterIndeterminate;
    }
    var ttl = pop.querySelector('.tm-fpop-title');
    ttl.textContent = st.titleText;
    ttl.title = st.titleText;
    pop.querySelector('.tm-fpop-sum').textContent = st.sumText;
    var q = (pop.querySelector('.tm-fpop-search').value || '').toLowerCase();
    if (q) {
      var items = st.list.children;
      for (var j = 0; j < items.length; j++) {
        var iv = items[j].querySelector('.tm-fpop-val');
        items[j].style.display = (!iv || iv.textContent.toLowerCase().indexOf(q) >= 0) ? '' : 'none';
      }
    }
    filterPopover.update();
  }

  /** 过滤入口：行显隐 → 重建工具栏 → 刷新弹层（若打开） */
  function applyFilter(m) {
    var r;
    for (r = 0; r < m.rows.length; r++) {
      m.rows[r].style.display = passes(m, m.rows[r]) ? '' : 'none';
    }
    mountFilterBar(m);
    if (currentModel === m && m.activeCol >= 0) refreshPopup(m);
  }

  function openPopup(m, col) {
    if (m.activeCol === col) { closePopup(); return; }
    m.activeCol = col;
    currentModel = m;
    if (!m.sel[col]) {
      var vals = colValues(m, col);
      var initSet = new Set();
      for (var i0 = 0; i0 < vals.length; i0++) initSet.add(vals[i0]);
      m.sel[col] = initSet; // 首次打开默认全选
    }
    var pop = getPopup();
    var wrap = m.table.parentNode;
    pop.querySelector('.tm-fpop-search').value = '';
    // 组件挂载：弹层移入 wrap（定位上下文）；anchor 由 getAnchor 懒查，避免工具栏重建后失效
    filterPopover.show(
      function () { return wrap.querySelector('.tm-colfilter[data-col="' + m.activeCol + '"]') || wrap; },
      wrap
    );
    applyFilter(m); // 内部按需 refreshPopup + update
  }

  function closePopup() {
    if (filterPopover) filterPopover.hide();
    if (currentModel) currentModel.activeCol = -1;
    currentModel = null;
  }

  function handleAction(btn) {
    var m = currentModel;
    if (!m || m.activeCol < 0) return;
    var act = btn.getAttribute('data-act');
    var vals = Object.keys(countsFor(m, m.activeCol));
    var sel = new Set(), i, v, cur = m.sel[m.activeCol] || new Set();
    if (act === 'all') {
      for (i = 0; i < vals.length; i++) sel.add(vals[i]);
    } else if (act === 'invert') {
      for (i = 0; i < vals.length; i++) { v = vals[i]; if (!cur.has(v)) sel.add(v); }
    }
    m.sel[m.activeCol] = sel; // none → 空集 → 该列筛出所有行
    applyFilter(m);
  }

  function setupTableFilter(table) {
    var tbody = table.tBodies[0];
    var headRow = (table.tHead && table.tHead.rows[0]) || null;
    if (!tbody || !headRow || !headRow.cells.length || !tbody.rows.length) return;
    var cols = [];
    for (var h = 0; h < headRow.cells.length; h++) cols.push(cellText(headRow.cells[h]));
    markEmptyCells(table);
    var numCols = detectNumCols(table, headRow);
    for (var nc = 0; nc < numCols.length && nc < headRow.cells.length; nc++) {
      if (!numCols[nc]) continue;
      headRow.cells[nc].classList.add('tm-num');
      for (var nr = 0; nr < tbody.rows.length; nr++) {
        var nc2 = tbody.rows[nr].cells[nc];
        if (nc2) nc2.classList.add('tm-num');
      }
    }

    var wrap = document.createElement('div');
    wrap.className = 'tm-tbl';
    var model = { table: table, cols: cols, rows: tbody.rows, sel: {}, activeCol: -1 };
    table.__tmModel = model;
    var bar = renderFilterBar(model); // 先渲染初始工具栏
    wrap.appendChild(bar);
    table.parentNode.insertBefore(wrap, table);
    wrap.appendChild(table);
    applyFilter(model); // 统一重挂载（行过滤 + 工具栏 + 弹层刷新）
  }

  function initTableFilters() {
    var tables = document.querySelectorAll('.markdown-body table');
    for (var i = 0; i < tables.length; i++) {
      var tbl = tables[i];
      if (tbl.getAttribute('data-tm-finit') === '1') continue;
      tbl.setAttribute('data-tm-finit', '1');
      setupTableFilter(tbl);
    }
  }

  document.addEventListener('click', function (e) {
    var t = e.target;
    if (!t || t.nodeType !== 1) return;
    if (closest(t, '#tm-fpop')) {
      var act = closest(t, '.tm-fpop-actions [data-act]');
      if (act && act.tagName === 'BUTTON') handleAction(act);
      return; // 点击弹层内部不关闭
    }
    var colBtn = closest(t, '.tm-colfilter');
    if (colBtn) {
      var wrapT = closest(colBtn, '.tm-tbl');
      var tableEl = wrapT ? wrapT.querySelector('table') : null;
      var m2 = tableEl ? tableEl.__tmModel : null;
      if (m2) {
        openPopup(m2, parseInt(colBtn.getAttribute('data-col'), 10));
        return;
      }
    }
    var clearBtnEl = closest(t, '.tm-tbl-clear');
    if (clearBtnEl) {
      var wrap2 = closest(clearBtnEl, '.tm-tbl');
      var tbl2 = wrap2 ? wrap2.querySelector('table') : null;
      if (tbl2 && tbl2.__tmModel) {
        tbl2.__tmModel.sel = {};
        applyFilter(tbl2.__tmModel);
        closePopup();
      }
      return;
    }
    closePopup();
  });

  document.addEventListener('change', function (e) {
    var t = e.target;
    if (!t || t.nodeType !== 1 || t.tagName !== 'INPUT' || t.type !== 'checkbox') return;
    if (t.classList.contains('tm-fpop-all')) {
      var m0 = currentModel;
      if (!m0 || m0.activeCol < 0) return;
      var vals0 = Object.keys(countsFor(m0, m0.activeCol));
      var ns = new Set();
      if (t.checked) { for (var i2 = 0; i2 < vals0.length; i2++) ns.add(vals0[i2]); }
      m0.sel[m0.activeCol] = ns; // 取消勾选 → 空集 → 该列筛出所有行
      applyFilter(m0);
      return;
    }
    if (!t.classList.contains('tm-fpop-cb')) return;
    var m = currentModel;
    if (!m || m.activeCol < 0) return;
    var s = m.sel[m.activeCol] || (m.sel[m.activeCol] = new Set());
    if (t.checked) s.add(t.getAttribute('data-val'));
    else s.delete(t.getAttribute('data-val'));
    // 更新该项的选中高亮
    var liEl = closest(t, 'li');
    if (liEl) liEl.classList.toggle('selected', t.checked);
    applyFilter(m);
  });

  document.addEventListener('input', function (e) {
    var t = e.target;
    if (!t || !t.classList || !t.classList.contains('tm-fpop-search')) return;
    var q = (t.value || '').toLowerCase();
    var list = document.getElementById('tm-fpop-list');
    if (!list) return;
    for (var i = 0; i < list.children.length; i++) {
      var v = list.children[i].querySelector('.tm-fpop-val');
      list.children[i].style.display =
        (!v || v.textContent.toLowerCase().indexOf(q) >= 0) ? '' : 'none';
    }
  });

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') closePopup();
  });

  initTableFilters();

  // ---- Toast 提示 ----
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
})();
