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
