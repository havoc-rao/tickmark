/**
 * TickMark — i18n 模块（zh-CN / en-US 基础 UI）
 *
 * 设计目标：
 * - 不引入第三方依赖；字符串集中在 STRINGS 字典，按 key 索引
 * - 持久化偏好到 localStorage（webview 沙箱下静默失败由 getStored 处理）
 * - setLang 时通知 subscribe 监听器，由 preview.js 重建需要本地化的 DOM
 * - 合并顺序：utils（提供 getStored/setStored）→ i18n → templates → preview
 *
 * 用法：
 *   I18N.t('common.cancel')                  // 简单查表
 *   I18N.t('toast.deleted', colName)         // %s 占位
 *   I18N.setLang('en-US')                    // 切换并持久化
 *   var off = I18N.subscribe(reRenderUI)     // 语言变更回调（返回取消订阅函数）
 */

var I18N = (function () {
  var STORAGE_KEY = 'tickmark.lang';
  var DEFAULT_LANG = 'zh-CN';
  var listeners = [];

  /** 支持的语言集合（id → label，用于语言切换菜单） */
  var LANGS = {
    'zh-CN': { label: '中文' },
    'en-US': { label: 'English' },
  };

  /**
   * 字符串字典：key → { zh-CN, en-US }
   * 占位符：%s / %d（按出现顺序替换；与 C printf 风格一致）
   */
  var STRINGS = {
    // 通用
    'common.cancel':      { 'zh-CN': '取消',         'en-US': 'Cancel' },
    'common.confirm':     { 'zh-CN': '确定',         'en-US': 'OK' },
    'common.close':       { 'zh-CN': '关闭',         'en-US': 'Close' },
    'common.noHeader':    { 'zh-CN': '(无表头)',     'en-US': '(no header)' },
    'common.empty':       { 'zh-CN': '(空)',         'en-US': '(empty)' },
    'common.copy':        { 'zh-CN': 'Copy',         'en-US': 'Copy' },
    'common.copied':      { 'zh-CN': 'Copied!',      'en-US': 'Copied!' },

    // 工具栏：icon 由 page.ts 的 toolbarBtn 工厂在 HTML 内渲染（`<span class="tm-i18n-ic">`），
    // 这里的 label 仅含纯文本，避免与 icon 重复叠加。
    'toolbar.edit':    { 'zh-CN': '编辑', 'en-US': 'Edit' },
    'toolbar.edit.title':    { 'zh-CN': '进入表格编辑模式（拖拽换列 / 添加列 / 单元格填写）', 'en-US': 'Toggle table edit mode (drag / add column / edit cells)' },
    'toolbar.refresh': { 'zh-CN': 'Refresh',              'en-US': 'Refresh' },
    'toolbar.refresh.title': { 'zh-CN': '重新渲染',          'en-US': 'Re-render' },
    'toolbar.sync':    { 'zh-CN': 'Sync',                 'en-US': 'Sync' },
    'toolbar.sync.title':    { 'zh-CN': '拉取最新 md 并重新渲染', 'en-US': 'Fetch latest .md and re-render' },
    'toolbar.theme':   { 'zh-CN': '主题',  'en-US': 'Theme' },
    'toolbar.theme.title':   { 'zh-CN': '切换主题与强调色',     'en-US': 'Toggle theme and accent color' },
    'toolbar.outline': { 'zh-CN': '大纲', 'en-US': 'Outline' },
    'toolbar.outline.title': { 'zh-CN': '显示 / 隐藏标题大纲',  'en-US': 'Toggle heading outline' },

    // 主题菜单
    'theme.title':             { 'zh-CN': '主题',   'en-US': 'Theme' },
    'theme.section.appearance':{ 'zh-CN': '外观',   'en-US': 'Appearance' },
    'theme.section.accent':    { 'zh-CN': '强调色', 'en-US': 'Accent' },
    'theme.section.lang':      { 'zh-CN': '语言',   'en-US': 'Language' },
    'theme.opt.light':         { 'zh-CN': '浅色',   'en-US': 'Light' },
    'theme.opt.dark':          { 'zh-CN': '深色',   'en-US': 'Dark' },
    'theme.opt.system':        { 'zh-CN': '跟随系统','en-US': 'Auto' },
    'theme.opt.blue':          { 'zh-CN': '蓝',     'en-US': 'Blue' },
    'theme.opt.green':         { 'zh-CN': '绿',     'en-US': 'Green' },
    'theme.opt.purple':        { 'zh-CN': '紫',     'en-US': 'Purple' },
    'theme.opt.orange':        { 'zh-CN': '橙',     'en-US': 'Orange' },
    'theme.opt.rose':          { 'zh-CN': '玫红',   'en-US': 'Rose' },

    // 列过滤弹层
    'filter.searchPh':  { 'zh-CN': '搜索值…',         'en-US': 'Search values…' },
    'filter.all':       { 'zh-CN': '全选',            'en-US': 'All' },
    'filter.invert':    { 'zh-CN': '反选',            'en-US': 'Invert' },
    'filter.none':      { 'zh-CN': '清空',            'en-US': 'None' },
    'filter.sum':       { 'zh-CN': '%d / %d 值',      'en-US': '%d / %d values' },
    'filter.sumNone':   { 'zh-CN': '无值',            'en-US': 'No values' },
    'filter.empty':     { 'zh-CN': '无匹配值',        'en-US': 'No matches' },
    'filter.rowCount':  { 'zh-CN': '%d / %d 行',      'en-US': '%d / %d rows' },
    'filter.clear':     { 'zh-CN': '清除筛选',        'en-US': 'Clear filters' },
    'filter.addCol':    { 'zh-CN': '+ 列',            'en-US': '+ Column' },
    'filter.addCol.title': { 'zh-CN': '在表格中新增一列（新增列单元格可直接填写并回写 md）', 'en-US': 'Add a column (cells are editable and write back to .md)' },

    // 添加列弹层
    'addCol.title':         { 'zh-CN': '添加列',           'en-US': 'Add column' },
    'addCol.namePh':        { 'zh-CN': '列名，回车确认',   'en-US': 'Column name, press Enter' },
    'addCol.type':          { 'zh-CN': '列类型',           'en-US': 'Type' },
    'addCol.type.text':     { 'zh-CN': '文本',             'en-US': 'Text' },
    'addCol.type.checkbox': { 'zh-CN': '复选框',           'en-US': 'Checkbox' },
    'addCol.fillPh':        { 'zh-CN': '批量填值（可空）', 'en-US': 'Bulk fill (optional)' },
    'addCol.cbDefault':     { 'zh-CN': '默认状态',         'en-US': 'Default' },
    'addCol.cbDefault.unchecked': { 'zh-CN': '☐ 未勾',     'en-US': '☐ Off' },
    'addCol.cbDefault.checked':   { 'zh-CN': '☑ 已勾',     'en-US': '☑ On' },
    'addCol.pos':           { 'zh-CN': '插入位置',         'en-US': 'Position' },
    'addCol.pos.after':     { 'zh-CN': '之后',             'en-US': 'After' },
    'addCol.pos.before':    { 'zh-CN': '之前',             'en-US': 'Before' },
    'addCol.pos.end':       { 'zh-CN': '末尾',             'en-US': 'End' },

    // 单元格填写 / 复选框单元格
    'cell.editPh':   { 'zh-CN': '点击填写',                       'en-US': 'Click to edit' },
    'cell.editTitle':{ 'zh-CN': '点击填写，自动回写 md',          'en-US': 'Click to edit, writes back to .md' },
    'cell.cbTitle':  { 'zh-CN': '点击切换 [x] / [ ]',             'en-US': 'Click to toggle [x] / [ ]' },

    // 表头删除按钮 / 拖拽
    'th.del.title':  { 'zh-CN': '删除该列',                       'en-US': 'Delete column' },
    'th.grip.title': { 'zh-CN': '拖动换列（编辑模式下可用）',     'en-US': 'Drag to move (edit mode only)' },

    // 修改历史按钮
    'hist.undo':          { 'zh-CN': '↶ 撤销', 'en-US': '↶ Undo' },
    'hist.redo':          { 'zh-CN': '↷ 重做', 'en-US': '↷ Redo' },
    'hist.reset':         { 'zh-CN': '重置',     'en-US': 'Reset' },
    'hist.undo.title':    { 'zh-CN': '撤销上一次修改',                         'en-US': 'Undo last change' },
    'hist.redo.title':    { 'zh-CN': '重做已撤销的修改',                       'en-US': 'Redo last undone change' },
    'hist.reset.title':   { 'zh-CN': '取消本次所有修改，恢复到打开时的内容',     'en-US': 'Discard all session edits' },
    'hist.reset.confirm': { 'zh-CN': '再点一次确认', 'en-US': 'Click again' },

    // 大纲
    'outline.title':      { 'zh-CN': '大纲',       'en-US': 'Outline' },
    'outline.close':      { 'zh-CN': '收起',       'en-US': 'Collapse' },
    'outline.emptyTitle': { 'zh-CN': '暂无标题',   'en-US': 'No headings' },
    'outline.emptyHeading':{ 'zh-CN': '(空标题)', 'en-US': '(empty)' },

    // Toast
    'toast.deleted':  { 'zh-CN': '已删除列「%s」', 'en-US': 'Deleted column "%s"' },
    'toast.added':    { 'zh-CN': '已添加列「%s」', 'en-US': 'Added column "%s"' },
    'toast.swapped':  { 'zh-CN': '已交换列',       'en-US': 'Columns swapped' },
    'toast.undo':     { 'zh-CN': '已撤销',         'en-US': 'Undone' },
    'toast.redo':     { 'zh-CN': '已重做',         'en-US': 'Redone' },
    'toast.reset':    { 'zh-CN': '已取消本次所有修改', 'en-US': 'All session edits discarded' },
    'toast.synced':   { 'zh-CN': '已同步最新内容', 'en-US': 'Latest content synced' },
    'toast.syncFail': { 'zh-CN': '同步失败',       'en-US': 'Sync failed' },

    // 错误（API 不可达 / 服务器返回失败）
    'err.connect':     { 'zh-CN': '无法连接 TickMark 服务（%s），请确认 CLI 仍在运行', 'en-US': 'TickMark CLI unreachable at %s' },
    'err.connectCol':  { 'zh-CN': '无法连接 TickMark 服务，请确认 CLI 仍在运行',          'en-US': 'TickMark CLI unreachable' },
    'err.toggle':      { 'zh-CN': 'toggle failed (status %d)',  'en-US': 'toggle failed (status %d)' },
    'err.addCol':      { 'zh-CN': '添加列失败 (status %d)',      'en-US': 'Add column failed (status %d)' },
    'err.delCol':      { 'zh-CN': '删除列失败 (status %d)',      'en-US': 'Delete column failed (status %d)' },
    'err.moveCol':     { 'zh-CN': '交换列失败 (status %d)',      'en-US': 'Move column failed (status %d)' },
    'err.setCell':     { 'zh-CN': '写入失败 (status %d)',        'en-US': 'Write failed (status %d)' },
  };

  var current = '';

  function resolve(lang) {
    return (lang && LANGS[lang]) ? lang : DEFAULT_LANG;
  }

  /**
   * 初始语言优先级：
   * 1. window.__TICKMARK_LANG —— CLI 注入（~/.config/tickmark/config.json 的 lang，
   *    由 `timd config set lang <zh-CN|en-US>` 配置，serve / render 时注入页面）
   * 2. localStorage —— 页面内主题菜单切换的记忆
   * 3. 默认 zh-CN
   */
  function init() {
    var injected =
      typeof window.__TICKMARK_LANG === 'string' && window.__TICKMARK_LANG
        ? window.__TICKMARK_LANG
        : '';
    if (injected && LANGS[injected]) {
      current = resolve(injected);
      setStored(STORAGE_KEY, current); // 与 CLI 配置对齐，保持页面内后续切换一致
    } else {
      current = resolve(getStored(STORAGE_KEY, DEFAULT_LANG));
    }
    document.documentElement.setAttribute('lang', current);
  }

  /** 查表 + 占位符替换：'%s' / '%d' 按出现顺序从 arguments(1..) 取值 */
  function t(key) {
    var pack = STRINGS[key];
    var s;
    if (!pack) {
      s = key;
    } else {
      s = pack[current] || pack[DEFAULT_LANG] || key;
    }
    if (arguments.length <= 1) return s;
    var args = Array.prototype.slice.call(arguments, 1);
    var i = 0;
    return s.replace(/%[sd]/g, function () {
      var v = args[i++];
      return v == null ? '' : String(v);
    });
  }

  function setLang(lang) {
    var next = resolve(lang);
    if (next === current) return;
    current = next;
    setStored(STORAGE_KEY, current);
    document.documentElement.setAttribute('lang', current);
    for (var i = 0; i < listeners.length; i++) {
      try { listeners[i](current); } catch (e) { /* ignore */ }
    }
  }

  function subscribe(fn) {
    listeners.push(fn);
    return function () {
      var i = listeners.indexOf(fn);
      if (i >= 0) listeners.splice(i, 1);
    };
  }

  init();

  return {
    t: t,
    lang: function () { return current; },
    langs: function () { return LANGS; },
    setLang: setLang,
    subscribe: subscribe,
  };
})();
