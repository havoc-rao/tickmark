#!/usr/bin/env node
/**
 * build-media — 把 media/src/ 下的页面脚本源码按依赖顺序合并为 media/preview.js。
 *
 * 背景：preview.js 支持两种加载方式且均要求是单个脚本文件
 *   - 服务器模式：<script src="/preview.js">
 *   - 独立 HTML：内容内联进 <script>（CodeBuddy/编辑器 file:// 预览，ESM 不可用）
 * 因此不能拆成运行时多文件 / ES Modules，改为「源码拆分 + 构建合并」。
 *
 * 产物是一个统一 IIFE：utils → templates → preview 按序拼接，
 * 三者通过函数声明 / var 共享同一作用域，与手写单个大文件完全等价。
 * 用法：node scripts/build-media.js
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SRC_DIR = path.join(ROOT, 'media', 'src');
const OUT_FILE = path.join(ROOT, 'media', 'preview.js');

/** 合并顺序即依赖顺序：utils（通用工具）→ i18n（语言切换，依赖 getStored/setStored）→ templates（HTML 模板常量）→ preview（业务逻辑，可调用 I18N.t()） */
const ORDER = ['utils.js', 'i18n.js', 'templates.js', 'preview.js'];

const parts = ORDER.map((file) => {
  const p = path.join(SRC_DIR, file);
  if (!fs.existsSync(p)) {
    console.error(`[build-media] missing source: ${p}`);
    process.exit(1);
  }
  const src = fs.readFileSync(p, 'utf8');
  return (
    '/* ============================================================\n' +
    ` * source: media/src/${file}\n` +
    ' * ============================================================ */\n' +
    src.trim()
  );
});

const banner = `/**
 * TickMark CLI — 页面交互脚本（构建产物，请勿直接编辑）
 *
 * 源码位于 media/src/ 目录（utils.js / templates.js / preview.js），
 * 由 scripts/build-media.js 按依赖顺序合并生成本文件：
 *   npm run build:media
 *
 * 两种载体：
 * 1. 独立 HTML 文件（CodeBuddy/编辑器预览）：window.__TICKMARK_API 已注入
 *    → checkbox 点击 fetch(API + /api/toggle) 回写 md
 * 2. 服务器模式（浏览器直开 /）：API 为空字符串 → 相对路径 fetch
 */
`;

const output =
  banner +
  `(function () {
  'use strict';

${parts.join('\n\n')}
})();
`;

fs.writeFileSync(OUT_FILE, output);
console.log(
  `[build-media] ${ORDER.join(' + ')} → media/preview.js (${output.split('\n').length} lines)`,
);
