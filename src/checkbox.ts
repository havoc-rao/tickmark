import * as fs from 'fs';

export interface ToggleResult {
  ok: boolean;
  line: number;
  newChar: string;
  /** 修改后的整行内容 */
  newLineText: string;
  reason?: string;
}

const TASK_ITEM_RE = /^(\s*[-*+]\s+\[)([ xX])(\])(.*)$/;

/**
 * 切换 md 文件某一行 checkbox 状态，直接改写磁盘文件。
 *
 * 核心：行号来自渲染快照，文件可能被外部编辑过 → 重新 regex 校验目标行
 * 仍是 task item 才改写；不匹配则返回失败原因，绝不错改行。
 */
export function toggleCheckboxInFile(
  filePath: string,
  line: number,
  checked: boolean,
): ToggleResult {
  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split('\n');

  const safeLine = Math.min(Math.max(0, line), lines.length - 1);
  const lineText = lines[safeLine];

  const m = lineText.match(TASK_ITEM_RE);
  if (!m) {
    return {
      ok: false,
      line: safeLine,
      newChar: checked ? 'x' : ' ',
      newLineText: lineText,
      reason: `line ${safeLine} is not a task item: "${lineText.slice(0, 50)}"`,
    };
  }

  const newChar = checked ? 'x' : ' ';
  const newLine = `${m[1]}${newChar}${m[3]}${m[4]}`;
  lines[safeLine] = newLine;

  fs.writeFileSync(filePath, lines.join('\n'), 'utf8');

  return { ok: true, line: safeLine, newChar, newLineText: newLine };
}
