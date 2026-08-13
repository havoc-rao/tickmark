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
          refreshHistoryButtons();
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
      reRender('已同步最新内容');
    });
  }

  /** 拉取服务端最新整页 HTML，替换 .markdown-body 并重挂表格过滤器/大纲/历史按钮态 */
  function reRender(okMsg) {
    fetch(api('/api/html'))
      .then(function (r) { return r.text(); })
      .then(function (pageHtml) {
        var doc = new DOMParser().parseFromString(pageHtml, 'text/html');
        var newBody = doc.querySelector('.markdown-body');
        if (!newBody) throw new Error('no .markdown-body');
        var oldBody = document.querySelector('.markdown-body');
        if (oldBody && oldBody.parentNode) {
          oldBody.parentNode.replaceChild(newBody, oldBody);
        }
        initTableFilters();
        initOutline();
        refreshHistoryButtons();
        if (okMsg) showToast(okMsg, false);
      })
      .catch(function () {
        showToast('同步失败', true);
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
    var addColBtn = document.createElement('button');
    addColBtn.type = 'button';
    addColBtn.className = 'tm-tbl-addcol';
    addColBtn.textContent = '+ 列';
    addColBtn.title = '在表格中新增一列（新增列单元格可直接填写并回写 md）';
    bar.appendChild(addColBtn);
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
    for (var h = 0; h < headRow.cells.length; h++) {
      cols.push(cellText(headRow.cells[h]));
      headRow.cells[h].setAttribute('data-col', String(h));
      addThAddBtn(headRow.cells[h], h);
    }
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
    // 表头悬停 + 按钮：在对应列右侧新增一列
    var thAddEl = closest(t, '.tm-th-add');
    if (thAddEl) {
      var wrapA = closest(thAddEl, '.tm-tbl');
      var tblA = wrapA ? wrapA.querySelector('table') : null;
      if (tblA) {
        var thEl = closest(thAddEl, 'th');
        var ci = thEl ? (parseInt(thEl.getAttribute('data-col'), 10) || 0) + 1 : 0;
        openAddColPopup(tblA, ci, function () { return thAddEl; }, wrapA);
        return;
      }
    }
    // 工具栏 + 列按钮：在表格末尾新增一列
    var addColBtnEl = closest(t, '.tm-tbl-addcol');
    if (addColBtnEl) {
      var wrapB = closest(addColBtnEl, '.tm-tbl');
      var tblB = wrapB ? wrapB.querySelector('table') : null;
      if (tblB && tblB.__tmModel) {
        openAddColPopup(tblB, tblB.__tmModel.cols.length, function () { return addColBtnEl; }, wrapB);
        return;
      }
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
    if (closest(t, '#tm-outline, #tm-outline-wrap')) return; // 大纲内部点击不关闭
    closePopup();
    closeOutline();
    cancelResetConfirm(); // 点击页面其他位置 → 取消重置确认态
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
    if (e.key === 'Escape') {
      closePopup(); closeOutline(); closeAddColPopup(); cancelResetConfirm();
    }
  });

  initTableFilters();

  // ---- 表格列编辑：新增列（任意位置）+ 新增列单元格直接填写回写 ----
  var addColPopover = null;
  var addColModel = null; // { table, colIndex }

  /** 表头悬停 + 按钮（在该列右侧插入新列） */
  function addThAddBtn(th, colIndex) {
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'tm-th-add';
    btn.title = '在右侧添加列';
    btn.textContent = '+';
    btn.setAttribute('data-col', String(colIndex));
    th.appendChild(btn);
  }

  function getAddColPopup() {
    if (!addColPopover) {
      var pop = document.createElement('div');
      pop.className = 'tm-ac-pop';
      pop.id = 'tm-ac-pop';
      pop.style.display = 'none';
      pop.innerHTML =
        '<div class="tm-ac-head">' +
        '<span class="tm-ac-title">添加列</span>' +
        '<button type="button" class="tm-ac-close" title="取消">×</button>' +
        '</div>' +
        '<div class="tm-ac-hint"></div>' +
        '<input class="tm-ac-name" type="text" placeholder="列名，回车确认"/>' +
        '<div class="tm-ac-actions">' +
        '<button type="button" class="tm-ac-cancel">取消</button>' +
        '<button type="button" class="tm-ac-ok">确定</button>' +
        '</div>';
      addColPopover = tmPopover({ content: pop, maxWidth: 300, maxHeight: 220, gap: 6 });

      var nameInput = pop.querySelector('.tm-ac-name');
      nameInput.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') { e.preventDefault(); confirmAddCol(); }
        if (e.key === 'Escape') { e.preventDefault(); closeAddColPopup(); }
      });
      nameInput.addEventListener('click', function (e) { e.stopPropagation(); });
      pop.querySelector('.tm-ac-ok').addEventListener('click', confirmAddCol);
      pop.querySelector('.tm-ac-cancel').addEventListener('click', closeAddColPopup);
      pop.querySelector('.tm-ac-close').addEventListener('click', closeAddColPopup);
    }
    return addColPopover.el;
  }

  function openAddColPopup(table, colIndex, anchorFn, wrap) {
    addColModel = { table: table, colIndex: colIndex };
    var pop = getAddColPopup();
    pop.querySelector('.tm-ac-name').value = '';
    var hint = pop.querySelector('.tm-ac-hint');
    var model = table.__tmModel;
    var total = model ? model.cols.length : 0;
    hint.textContent = colIndex >= total
      ? '将在表格末尾添加新列'
      : '将在「' + ((model && model.cols[colIndex]) || '(空)') + '」之前添加新列';
    addColPopover.show(anchorFn, wrap);
    pop.querySelector('.tm-ac-name').focus();
  }

  function closeAddColPopup() {
    if (addColPopover) addColPopover.hide();
    addColModel = null;
  }

  function confirmAddCol() {
    var m = addColModel;
    if (!m || !m.table || !m.table.isConnected) { closeAddColPopup(); return; }
    var pop = getAddColPopup();
    var name = (pop.querySelector('.tm-ac-name').value || '').trim();
    var headerLine = parseInt(m.table.getAttribute('data-source-line'), 10) || 0;
    fetch(api('/api/table/add-column'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ line: headerLine, colIndex: m.colIndex, name: name }),
    })
      .then(function (res) { return res.json().then(function (d) { return { status: res.status, data: d }; }); })
      .then(function (r) {
        if (r.status === 200 && r.data.ok) {
          localInsertColumn(m.table, r.data.colIndex, r.data.name);
          var model = m.table.__tmModel;
          if (model) {
            // 已生效的过滤列在插入位置及之后要整体右移一位
            var newSel = {};
            for (var k in model.sel) {
              if (!model.sel.hasOwnProperty(k)) continue;
              var kk = parseInt(k, 10);
              newSel[kk >= r.data.colIndex ? kk + 1 : kk] = model.sel[k];
            }
            model.sel = newSel;
            model.cols.splice(r.data.colIndex, 0, r.data.name);
            mountFilterBar(model);
          }
          closeAddColPopup();
          showToast('已添加列「' + r.data.name + '」', false);
          refreshHistoryButtons();
        } else {
          showToast(r.data.reason || '添加列失败 (status ' + r.status + ')', true);
        }
      })
      .catch(function (err) {
        console.error('[tickmark] add column failed:', err);
        showToast('无法连接 TickMark 服务，请确认 CLI 仍在运行', true);
      });
  }

  /** 本地 DOM 同步插入列：th（带 + 按钮）+ 每行 contenteditable td */
  function localInsertColumn(table, idx, name) {
    var headRow = table.tHead && table.tHead.rows[0];
    if (!headRow) return;
    var th = document.createElement('th');
    th.textContent = name;
    addThAddBtn(th, idx);
    if (idx >= headRow.cells.length) headRow.appendChild(th);
    else headRow.insertBefore(th, headRow.cells[idx]);
    for (var h = 0; h < headRow.cells.length; h++) {
      headRow.cells[h].setAttribute('data-col', String(h));
      var b = headRow.cells[h].querySelector('.tm-th-add');
      if (b) b.setAttribute('data-col', String(h));
    }
    var tbody = table.tBodies[0];
    if (!tbody) return;
    for (var i = 0; i < tbody.rows.length; i++) {
      var td = document.createElement('td');
      td.className = 'tm-edit-cell';
      td.setAttribute('contenteditable', 'true');
      td.setAttribute('data-col', String(idx));
      td.title = '点击填写，自动回写 md';
      var row = tbody.rows[i];
      if (idx >= row.cells.length) row.appendChild(td);
      else row.insertBefore(td, row.cells[idx]);
    }
  }

  /** 可编辑单元格提交：blur / Enter 时回写该列值 */
  function submitCellEdit(td, value, oldValue) {
    var tr = td.parentNode;
    var line = tr && tr.getAttribute ? (parseInt(tr.getAttribute('data-source-line'), 10) || 0) : 0;
    var col = parseInt(td.getAttribute('data-col'), 10) || 0;
    fetch(api('/api/table/set-cell'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ line: line, colIndex: col, value: value }),
    })
      .then(function (res) { return res.json().then(function (d) { return { status: res.status, data: d }; }); })
      .then(function (r) {
        if (r.status === 200 && r.data.ok) {
          td.textContent = value;
          console.log('[tickmark] cell updated', line, col, '->', value);
          refreshHistoryButtons();
        } else {
          td.textContent = oldValue;
          showToast(r.data.reason || '写入失败 (status ' + r.status + ')', true);
        }
      })
      .catch(function (err) {
        td.textContent = oldValue;
        console.error('[tickmark] set cell failed:', err);
        showToast('无法连接 TickMark 服务，请确认 CLI 仍在运行', true);
      });
  }

  // 记录编辑前快照（回滚用）
  document.addEventListener('focusin', function (e) {
    var t = e.target;
    if (t && t.classList && t.classList.contains('tm-edit-cell')) {
      t.__tmOld = t.textContent || '';
    }
  }, true);

  // 失焦提交：值有变化才回写
  document.addEventListener('focusout', function (e) {
    var t = e.target;
    if (!t || !t.classList || !t.classList.contains('tm-edit-cell')) return;
    var val = (t.textContent || '').replace(/\s*\n\s*/g, ' ').trim();
    var old = t.__tmOld !== undefined ? t.__tmOld : '';
    delete t.__tmOld;
    if (val === old) return;
    submitCellEdit(t, val, old);
  }, true);

  // Enter 提交（contenteditable 内 Enter 默认换行 → 改为提交）
  document.addEventListener('keydown', function (e) {
    var t = e.target;
    if (t && t.classList && t.classList.contains('tm-edit-cell') && e.key === 'Enter') {
      e.preventDefault();
      t.blur();
    }
  });

  // ---- 修改历史：撤销 / 重做 / 取消本次所有修改 ----
  var historyBtns = null; // { undo, redo, reset }

  function ensureHistoryButtons() {
    // 幂等：以 DOM 为准，Sync/撤销后 toolbar 未重建，复用既有按钮
    if (historyBtns && historyBtns.undo.isConnected) return historyBtns;
    var toolbar = document.querySelector('.tm-toolbar');
    if (!toolbar) return null;
    var refresh = document.getElementById('tm-refresh');
    var group = document.createElement('span');
    group.className = 'tm-hist-group';
    group.innerHTML =
      '<button type="button" class="tm-btn tm-hist-undo" title="撤销上一次修改">↶ 撤销</button>' +
      '<button type="button" class="tm-btn tm-hist-redo" title="重做已撤销的修改">↷ 重做</button>' +
      '<button type="button" class="tm-btn tm-hist-reset" title="取消本次所有修改，恢复到打开时的内容">重置</button>';
    var undo = group.querySelector('.tm-hist-undo');
    var redo = group.querySelector('.tm-hist-redo');
    var reset = group.querySelector('.tm-hist-reset');
    undo.addEventListener('click', historyAction('undo'));
    redo.addEventListener('click', historyAction('redo'));
    reset.addEventListener('click', resetClickHandler);
    if (refresh) toolbar.insertBefore(group, refresh);
    else toolbar.appendChild(group);
    historyBtns = { undo: undo, redo: redo, reset: reset };
    return historyBtns;
  }

  /**
   * 重置按钮点击：两段式确认（不依赖 window.confirm，webview sandbox 里被禁）。
   * 第一次点击 → 按钮变红显示「再点一次确认」，3s 内第二次点击才执行。
   */
  function resetClickHandler(e) {
    e.stopPropagation();
    var btn = historyBtns && historyBtns.reset;
    if (!btn || btn.disabled) return;
    if (btn.classList.contains('confirming')) {
      btn.classList.remove('confirming');
      btn.textContent = '重置';
      clearTimeout(btn.__tmConfirmTimer);
      doHistory('reset');
    } else {
      btn.classList.add('confirming');
      btn.textContent = '再点一次确认';
      clearTimeout(btn.__tmConfirmTimer);
      btn.__tmConfirmTimer = setTimeout(function () {
        btn.classList.remove('confirming');
        btn.textContent = '重置';
      }, 5000);
    }
  }

  /** 取消重置确认态（点击页面其他位置 / Escape 时调用） */
  function cancelResetConfirm() {
    var btn = historyBtns && historyBtns.reset;
    if (btn && btn.classList.contains('confirming')) {
      btn.classList.remove('confirming');
      btn.textContent = '重置';
      clearTimeout(btn.__tmConfirmTimer);
    }
  }

  /** 撤销 / 重做 / 重置 操作（成功后整体重渲染） */
  function historyAction(act) {
    return function (e) {
      e.stopPropagation();
      doHistory(act);
    };
  }

  function doHistory(act) {
    fetch(api('/api/history/' + act), { method: 'POST' })
        .then(function (res) { return res.json().then(function (d) { return { status: res.status, data: d }; }); })
        .then(function (r) {
          if (r.status === 200 && r.data.ok) {
            var msg = act === 'reset' ? '已取消本次所有修改' : (act === 'undo' ? '已撤销' : '已重做');
            reRender(msg);
          } else {
            showToast(r.data.reason || (act + ' failed (status ' + r.status + ')'), true);
          }
        })
        .catch(function (err) {
          console.error('[tickmark] history ' + act + ' failed:', err);
          showToast('无法连接 TickMark 服务，请确认 CLI 仍在运行', true);
        });
  }

  /** 从服务端拉取历史状态，更新三个按钮可用态 */
  function refreshHistoryButtons() {
    if (!historyBtns || !historyBtns.undo.isConnected) ensureHistoryButtons();
    if (!historyBtns) return;
    fetch(api('/api/history/status'))
      .then(function (res) { return res.json(); })
      .then(function (s) {
        var resetBtn = historyBtns.reset;
        // 状态刷新时重置按钮恢复正常文本（若正处于「再点一次确认」态）
        if (resetBtn.classList.contains('confirming')) {
          resetBtn.classList.remove('confirming');
          resetBtn.textContent = '重置';
          clearTimeout(resetBtn.__tmConfirmTimer);
        }
        historyBtns.undo.disabled = !s.canUndo;
        historyBtns.redo.disabled = !s.canRedo;
        resetBtn.disabled = !s.dirty;
      })
      .catch(function () { /* 服务未就绪时保持可用态，点击会给出明确错误 */ });
  }

  function initHistoryButtons() {
    ensureHistoryButtons();
    refreshHistoryButtons();
  }

  // ---- 大纲（TOC）：标题树 + 点击跳转 + 滚动高亮 ----
  var TOC_OFFSET = 56;          // sticky 工具栏高度 + 余量
  var tocWrap = null;
  var tocPanel = null;
  var tocToggle = null;
  var tocList = null;
  var tocItems = [];            // [{ el: heading, link: <a> }]
  var tocSuppress = false;       // 程序滚动期间暂停高亮追踪
  var tocSuppressTimer = 0;
  var tocRaf = 0;

  // 必须在上述 var 初始化之后调用：var 的初始化赋值在后，
  // 若提前调用会把已设置的 tocPanel/tocToggle 引用重置为 null → 初次点击无反应
  initOutline();
  initHistoryButtons();

  function ensureOutlineToggle() {
    // 幂等：以 DOM 为准。若 DOM 已存在（残留 / 重复初始化）直接复用，
    // 避免 Sync 后走同一初始化入口重复创建按钮 → 出现两个「大纲」。
    var existingWrap = document.getElementById('tm-outline-wrap');
    var existingBtn = existingWrap && existingWrap.querySelector('#tm-outline-toggle');
    if (existingWrap && existingBtn) {
      tocToggle = existingBtn;
      tocWrap = existingWrap;
      return;
    }
    if (tocToggle && !tocToggle.isConnected) { tocToggle = null; tocWrap = null; }
    if (tocToggle) return;

    var wrap = document.createElement('div');
    wrap.id = 'tm-outline-wrap';
    wrap.className = 'tm-outline-wrap';
    var btn = document.createElement('button');
    btn.id = 'tm-outline-toggle';
    btn.className = 'tm-btn';
    btn.type = 'button';
    btn.title = '显示 / 隐藏标题大纲';
    btn.innerHTML = '<span class="tm-toc-ic" aria-hidden="true">☰</span> 大纲';
    btn.addEventListener('click', function (e) {
      e.stopPropagation();
      setOutlineOpen(!(tocPanel && tocPanel.classList.contains('open')));
    });
    wrap.appendChild(btn);
    var toolbar = document.querySelector('.tm-toolbar');
    if (toolbar) {
      // 大纲按钮固定放工具栏最右侧（Sync 之后）
      toolbar.appendChild(wrap);
    } else {
      btn.classList.add('tm-outline-fab');
      document.body.appendChild(btn);
    }
    tocToggle = btn;
    tocWrap = wrap;
  }

  function createOutlinePanel() {
    // 幂等：若已存在则复用，避免重复挂载产生两份面板
    var existingPanel = document.getElementById('tm-outline');
    if (existingPanel) {
      tocPanel = existingPanel;
      tocList = existingPanel.querySelector('.tm-toc-list');
      return;
    }
    var panel = document.createElement('aside');
    panel.id = 'tm-outline';
    panel.className = 'tm-outline';
    panel.setAttribute('aria-label', '标题大纲');
    panel.innerHTML =
      '<div class="tm-toc-head">' +
        '<span class="tm-toc-title">大纲</span>' +
        '<button type="button" class="tm-toc-close" title="收起" aria-label="收起大纲">×</button>' +
      '</div>' +
      '<div class="tm-toc-body"><ul class="tm-toc-list"></ul></div>';
    // 挂到 wrap 下：absolute 定位贴住按钮下方；toolbar sticky → 滚动时视觉固定
    if (tocWrap && tocWrap.parentNode) tocWrap.appendChild(panel);
    else document.body.appendChild(panel);
    panel.querySelector('.tm-toc-close').addEventListener('click', function (e) {
      e.stopPropagation();
      setOutlineOpen(false);
    });
    tocPanel = panel;
    tocList = panel.querySelector('.tm-toc-list');
  }

  /** 从当前 .markdown-body 扫描标题，重建大纲列表（Sync 后调用以刷新引用） */
  function buildOutline() {
    var mdBody = document.querySelector('.markdown-body');
    if (!mdBody || !tocPanel) return;
    var headings = mdBody.querySelectorAll('h1, h2, h3, h4, h5, h6');
    var body = tocPanel.querySelector('.tm-toc-body');
    body.innerHTML = '<ul class="tm-toc-list"></ul>';
    tocList = body.querySelector('.tm-toc-list');
    tocItems = [];
    for (var i = 0; i < headings.length; i++) {
      (function (h) {
        var level = parseInt(h.tagName.charAt(1), 10);
        var li = document.createElement('li');
        li.className = 'tm-toc-item';
        var a = document.createElement('a');
        a.className = 'tm-toc-link';
        a.href = '#';
        a.setAttribute('data-level', String(level));
        a.style.paddingLeft = (14 + (level - 1) * 12) + 'px';
        var txt = (h.textContent || '').replace(/\s+/g, ' ').trim() || '(空标题)';
        a.textContent = txt;
        a.title = txt;
        a.addEventListener('click', function (e) {
          e.preventDefault();
          jumpToHeading(h);
        });
        li.appendChild(a);
        tocList.appendChild(li);
        tocItems.push({ el: h, link: a });
      })(headings[i]);
    }
    if (!tocItems.length) {
      var empty = document.createElement('div');
      empty.className = 'tm-toc-empty';
      empty.textContent = '暂无标题';
      body.appendChild(empty);
    }
    updateActiveHeading();
  }

  function initOutline() {
    ensureOutlineToggle();
    if (!tocPanel) {
      createOutlinePanel(); // 内部对 DOM 幂等复用
      // 捕获阶段监听：正文若在内部容器里滚动，window 上收不到冒泡的 scroll 事件
      window.addEventListener('scroll', onTocScroll, { passive: true, capture: true });
      document.addEventListener('scroll', onTocScroll, { passive: true, capture: true });
    }
    buildOutline();
  }

  function setOutlineOpen(open) {
    if (!tocPanel) return;
    tocPanel.classList.toggle('open', open);
    if (tocToggle) tocToggle.classList.toggle('active', open);
    if (open) updateActiveHeading();
  }

  function closeOutline() { if (tocPanel) setOutlineOpen(false); }

  /** 读取滚动器当前垂直位置（window 或元素） */
  function scrollTopOf(scroller) {
    return scroller === window
      ? (document.scrollingElement || document.documentElement).scrollTop
      : scroller.scrollTop;
  }

  /** 标题在滚动器内的目标滚动位置（减去 TOC_OFFSET 让开 sticky 工具栏） */
  function headingTargetTop(h, scroller) {
    if (scroller === window) {
      return h.getBoundingClientRect().top + scrollTopOf(scroller) - TOC_OFFSET;
    }
    return h.getBoundingClientRect().top - scroller.getBoundingClientRect().top
      + scroller.scrollTop - TOC_OFFSET;
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

  /**
   * 点击跳转：算准目标位置（findScroller 找真实滚动容器 + headingTargetTop
   * 减去 TOC_OFFSET 让开 sticky 工具栏）后纯 JS 平滑滚动，不经过 scrollIntoView，
   * 避免嵌入式 webview 里先跳 top 0 的闪动。rAF 不可用时瞬间跳转兜底。
   */
  function jumpToHeading(h) {
    if (!h || !h.isConnected) {
      // Sync 替换正文后旧标题引用已脱离 DOM（getBoundingClientRect 全 0 → 会被钳制回顶部）。
      // 先按原索引重建引用，再定位到对应新节点，避免误跳 top。
      var idx = -1;
      if (h && tocItems.length) {
        for (var k = 0; k < tocItems.length; k++) {
          if (tocItems[k].el === h) { idx = k; break; }
        }
      }
      buildOutline();
      h = (idx >= 0 && tocItems[idx]) ? tocItems[idx].el : (tocItems.length ? tocItems[0].el : null);
      if (!h) return;
    }

    suppressTracking();     // 滚动动画期间锁定高亮，停止后自动解锁
    setActiveHeading(h);

    var scroller = findScroller(h);
    var targetTop = headingTargetTop(h, scroller);
    if (typeof requestAnimationFrame === 'function') {
      smoothScrollTo(scroller, targetTop);
    } else if (scroller === window) {
      window.scrollTo(0, Math.max(0, targetTop));
    } else {
      scroller.scrollTop = Math.max(0, targetTop);
    }
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

  /** 滚动动画期间暂停高亮追踪：滚动静止 160ms 后解锁，2s 兜底 */
  function suppressTracking() {
    tocSuppress = true;
    clearTimeout(tocSuppressTimer);
    var off = function () {
      tocSuppress = false;
      document.removeEventListener('scroll', settle, true);
    };
    var settle = function () {
      clearTimeout(tocSuppressTimer);
      tocSuppressTimer = setTimeout(off, 160);
    };
    document.addEventListener('scroll', settle, { passive: true, capture: true });
    settle();
    setTimeout(off, 2000);
  }

  function setActiveHeading(h) {
    var body = tocPanel ? tocPanel.querySelector('.tm-toc-body') : null;
    for (var i = 0; i < tocItems.length; i++) {
      var on = tocItems[i].el === h;
      tocItems[i].link.classList.toggle('active', on);
      // 仅滚动大纲面板自身（scrollIntoView 可能连带滚动 html 打断页面滚动）
      if (on && body && tocItems[i].el && tocItems[i].el.isConnected) {
        var lRect = tocItems[i].link.getBoundingClientRect();
        var pRect = body.getBoundingClientRect();
        if (lRect.top < pRect.top || lRect.bottom > pRect.bottom) {
          body.scrollTop += (lRect.top - pRect.top) - (pRect.height - lRect.height) / 2;
        }
      }
    }
  }

  /** 滚动时高亮当前所在章节：取最后一条已越过顶部偏移线的标题 */
  function updateActiveHeading() {
    if (!tocItems.length) return;
    var line = TOC_OFFSET + 6;
    var activeEl = null;
    for (var i = 0; i < tocItems.length; i++) {
      if (!tocItems[i].el || !tocItems[i].el.isConnected) continue; // 旧节点脱离 DOM → 跳过
      var r = tocItems[i].el.getBoundingClientRect();
      if (r.top - line <= 0) activeEl = tocItems[i].el;
      else break;
    }
    if (!activeEl) activeEl = tocItems[0].el;
    setActiveHeading(activeEl);
  }

  function onTocScroll(e) {
    // 忽略大纲面板自身的滚动，避免误触发高亮重算
    if (e && e.target && e.target.nodeType === 1 && closest(e.target, '#tm-outline')) return;
    if (tocSuppress || !tocPanel || !tocPanel.classList.contains('open')) return;
    if (tocRaf) return;
    tocRaf = requestAnimationFrame(function () { tocRaf = 0; updateActiveHeading(); });
  }

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
