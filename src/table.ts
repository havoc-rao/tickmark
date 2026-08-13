import * as fs from 'fs';
import { MarkdownEngine } from './markdownEngine';

export interface AddColumnResult {
  ok: boolean;
  reason?: string;
  /** 实际插入位置（0-based，0 表示最前，等于列数表示末尾） */
  colIndex?: number;
  /** 实际写入的列名 */
  name?: string;
  /** 实际写入的批量填值（trim 后），未传 fillValue 时为空串 */
  fillValue?: string;
}

export interface AddColumnOptions {
  /** 新增列每个数据行单元格的初始值（默认空串；如 `[x]` 可渲染为勾选 checkbox） */
  fillValue?: string;
}

export interface MoveColumnResult {
  ok: boolean;
  reason?: string;
  /** 实际 from 位置（已 clamp 到合法范围） */
  fromIndex?: number;
  /** 实际 to 位置：移动后该列的最终索引 */
  toIndex?: number;
}

export interface DeleteColumnResult {
  ok: boolean;
  reason?: string;
  /** 实际删除位置（已 clamp 到合法范围） */
  colIndex?: number;
  /** 删除后剩余列数 */
  remaining?: number;
}

export interface SetCellResult {
  ok: boolean;
  reason?: string;
  line?: number;
  colIndex?: number;
  /** 修改后的整行文本 */
  newLineText?: string;
}

interface ParsedRow {
  /** 按未转义 `|` 分割后的片段（首尾可能含竖线产生的空壳） */
  parts: string[];
  /** 行（trim 后）以 `|` 开头 */
  leading: boolean;
  /** 行（trim 后）以 `|` 结尾 */
  trailing: boolean;
}

/** 按未转义的 `|` 分割表格行；支持 `\|` 转义与行内 code span（`...`）中的 `|` */
function splitCells(line: string): string[] {
  const parts: string[] = [];
  let cur = '';
  let inCode = false;
  let i = 0;
  while (i < line.length) {
    const ch = line[i];
    if (ch === '\\' && i + 1 < line.length) {
      cur += ch + line[i + 1];
      i += 2;
      continue;
    }
    if (ch === '`') {
      inCode = !inCode;
      cur += ch;
      i++;
      continue;
    }
    if (ch === '|' && !inCode) {
      parts.push(cur);
      cur = '';
      i++;
      continue;
    }
    cur += ch;
    i++;
  }
  parts.push(cur);
  return parts;
}

function parseRow(line: string): ParsedRow {
  const t = line.trim();
  return {
    parts: splitCells(line),
    leading: t.startsWith('|'),
    trailing: t.endsWith('|'),
  };
}

/** 去掉首尾竖线产生的空壳片段，返回真实单元格数组 */
function dataCells(row: ParsedRow): string[] {
  const cells = row.parts.map((p) => p.trim());
  if (row.leading && cells.length && cells[0] === '') cells.shift();
  if (row.trailing && cells.length && cells[cells.length - 1] === '') cells.pop();
  return cells;
}

function rebuildRow(row: ParsedRow, cells: string[]): string {
  let s = cells.join(' | ');
  if (row.leading) s = '| ' + s;
  if (row.trailing) s += ' |';
  return s;
}

/** 单元格值写入 md 前的转义：竖线必须转义、换行压成空格 */
function escapeCell(v: string): string {
  return String(v).replace(/\|/g, '\\|').replace(/[\r\n]+/g, ' ');
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

function insertAt<T>(arr: T[], index: number, value: T): T[] {
  const out = arr.slice();
  const i = clamp(index, 0, out.length);
  out.splice(i, 0, value);
  return out;
}

/** 用 markdown-it 重新解析全文，定位表头行 headerLine 所属表格的行范围 [start, end) */
function findTableRange(
  engine: MarkdownEngine,
  content: string,
  headerLine: number,
): { start: number; end: number } | null {
  const tokens = engine.parse(content);
  for (const t of tokens) {
    if (t.type === 'table_open' && t.map && t.map[0] === headerLine) {
      return { start: t.map[0], end: t.map[1] };
    }
  }
  return null;
}

/** 校验某行是否处于某表格的 tbody 数据行（防止误改非表格行） */
function isTableBodyRow(engine: MarkdownEngine, content: string, line: number): boolean {
  const tokens = engine.parse(content);
  let inBody = false;
  for (const t of tokens) {
    if (t.type === 'table_open' || t.type === 'thead_open') {
      inBody = false;
      continue;
    }
    if (t.type === 'tbody_open') {
      inBody = true;
      continue;
    }
    if (t.type === 'table_close' || t.type === 'tfoot_open') {
      inBody = false;
      continue;
    }
    if (t.type === 'tr_open' && inBody && t.map && t.map[0] === line) return true;
  }
  return false;
}

/**
 * 在表格的 colIndex 位置插入新列（任意位置，0 = 最前，列数 = 末尾）。
 *
 * 表格结构（markdown-it token map）：
 * - start  = 表头行
 * - start+1 = 分隔行（|---|）
 * - start+2 .. end-1 = 数据行
 * 插入列不会改变行数，因此所有 data-source-line 保持稳定。
 */
export function addColumnInFile(
  filePath: string,
  headerLine: number,
  colIndex: number,
  name: string,
  opts: AddColumnOptions = {},
): AddColumnResult {
  const content = fs.readFileSync(filePath, 'utf8');
  const engine = new MarkdownEngine();
  const range = findTableRange(engine, content, headerLine);
  if (!range) {
    return { ok: false, reason: `line ${headerLine} is not a table header` };
  }

  const lines = content.split('\n');
  const header = parseRow(lines[range.start]);
  const idx = clamp(Math.trunc(colIndex) || 0, 0, dataCells(header).length);

  const cleanName = escapeCell(String(name ?? '').trim() || '新列');
  lines[range.start] = rebuildRow(header, insertAt(dataCells(header), idx, cleanName));

  const sepRow = parseRow(lines[range.start + 1] ?? '');
  lines[range.start + 1] = rebuildRow(sepRow, insertAt(dataCells(sepRow), idx, '---'));

  // 批量填值：fillValue 适用于数据行每个新增单元格（表头与分隔行不动）
  // 例：fillValue = '[x]' → markdown-it-task-lists 把该列渲染为勾选 checkbox
  const fill = escapeCell(String(opts.fillValue ?? '').trim());
  for (let l = range.start + 2; l < range.end; l++) {
    const row = parseRow(lines[l] ?? '');
    const cells = dataCells(row);
    if (!cells.length) continue;
    lines[l] = rebuildRow(row, insertAt(cells, idx, fill));
  }

  fs.writeFileSync(filePath, lines.join('\n'), 'utf8');
  return { ok: true, colIndex: idx, name: cleanName, fillValue: fill };
}

/**
 * 改写某数据行 colIndex 列的值并回写磁盘。
 * 先经 markdown-it 校验目标行确为表格数据行，防止外部改过文件后错改行。
 */
export function setCellInFile(
  filePath: string,
  line: number,
  colIndex: number,
  value: string,
): SetCellResult {
  const content = fs.readFileSync(filePath, 'utf8');
  const engine = new MarkdownEngine();
  if (!isTableBodyRow(engine, content, line)) {
    return { ok: false, reason: `line ${line} is not a table data row` };
  }
  const lines = content.split('\n');
  const row = parseRow(lines[line]);
  const cells = dataCells(row);
  const idx = clamp(Math.trunc(colIndex) || 0, 0, Math.max(0, cells.length - 1));
  cells[idx] = escapeCell(String(value ?? ''));
  const newText = rebuildRow(row, cells);
  lines[line] = newText;
  fs.writeFileSync(filePath, lines.join('\n'), 'utf8');
  return { ok: true, line, colIndex: idx, newLineText: newText };
}

/**
 * 把表头所在表格的 fromIndex 列移动到 toIndex 位置（to 是「移到该列之前」语义）。
 * 同步更新表头、分隔行与所有数据行；只换顺序，不改列内容。
 * 行数不变 → data-source-line 全部保持稳定。
 */
export function moveColumnInFile(
  filePath: string,
  headerLine: number,
  fromIndex: number,
  toIndex: number,
): MoveColumnResult {
  const content = fs.readFileSync(filePath, 'utf8');
  const engine = new MarkdownEngine();
  const range = findTableRange(engine, content, headerLine);
  if (!range) {
    return { ok: false, reason: `line ${headerLine} is not a table header` };
  }

  const lines = content.split('\n');
  const headerCells = dataCells(parseRow(lines[range.start]));
  const n = headerCells.length;
  if (n < 2) {
    return { ok: false, reason: 'table has fewer than 2 columns' };
  }

  const from = clamp(Math.trunc(fromIndex) || 0, 0, n - 1);
  // to 是「插入前」的列索引；clamp 到 [0, n]
  let to = clamp(Math.trunc(toIndex) || 0, 0, n);
  if (from === to || from + 1 === to) {
    return { ok: false, reason: 'no move needed' };
  }

  // 把 from 列抽出后再插入到目标位置；from < to 时插入索引需 -1（已先移除一列）
  function reorder(cells: string[]): string[] {
    if (!cells.length) return cells;
    const ci = clamp(from, 0, cells.length - 1);
    const ti = clamp(from < to ? to - 1 : to, 0, cells.length);
    if (ci === ti || ci + 1 === ti) return cells;
    const out = cells.slice();
    const moved = out.splice(ci, 1)[0];
    out.splice(ti, 0, moved);
    return out;
  }

  lines[range.start] = rebuildRow(parseRow(lines[range.start]), reorder(headerCells));

  const sepRow = parseRow(lines[range.start + 1] ?? '');
  lines[range.start + 1] = rebuildRow(sepRow, reorder(dataCells(sepRow)));

  for (let l = range.start + 2; l < range.end; l++) {
    const row = parseRow(lines[l] ?? '');
    const cells = dataCells(row);
    if (!cells.length) continue;
    lines[l] = rebuildRow(row, reorder(cells));
  }

  fs.writeFileSync(filePath, lines.join('\n'), 'utf8');
  const finalTo = from < to ? to - 1 : to;
  return { ok: true, fromIndex: from, toIndex: finalTo };
}

/**
 * 删除表头所在表格的第 colIndex 列。
 * 同步更新表头、分隔行与所有数据行；行数不变 → data-source-line 全部保持稳定。
 * 单列表拒绝删除（保留表骨架）。
 */
export function deleteColumnInFile(
  filePath: string,
  headerLine: number,
  colIndex: number,
): DeleteColumnResult {
  const content = fs.readFileSync(filePath, 'utf8');
  const engine = new MarkdownEngine();
  const range = findTableRange(engine, content, headerLine);
  if (!range) {
    return { ok: false, reason: `line ${headerLine} is not a table header` };
  }

  const lines = content.split('\n');
  const headerCells = dataCells(parseRow(lines[range.start]));
  const n = headerCells.length;
  if (n <= 1) {
    return { ok: false, reason: 'table has only one column' };
  }

  const idx = clamp(Math.trunc(colIndex) || 0, 0, n - 1);

  function removeAt(cells: string[]): string[] {
    if (!cells.length) return cells;
    const ci = clamp(idx, 0, cells.length - 1);
    const out = cells.slice();
    out.splice(ci, 1);
    return out;
  }

  lines[range.start] = rebuildRow(parseRow(lines[range.start]), removeAt(headerCells));

  const sepRow = parseRow(lines[range.start + 1] ?? '');
  lines[range.start + 1] = rebuildRow(sepRow, removeAt(dataCells(sepRow)));

  for (let l = range.start + 2; l < range.end; l++) {
    const row = parseRow(lines[l] ?? '');
    const cells = dataCells(row);
    if (!cells.length) continue;
    lines[l] = rebuildRow(row, removeAt(cells));
  }

  fs.writeFileSync(filePath, lines.join('\n'), 'utf8');
  return { ok: true, colIndex: idx, remaining: n - 1 };
}
