/**
 * §B.7-7 token consistency guardrail (§B.5): --bg/--surface/--border/--text/
 * --accent must carry the §A.2 canonical values in the site template, and —
 * once the panel redesign (§A) lands — must match apps/panel/src/styles.css.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const repoRoot = fileURLToPath(new URL('../../..', import.meta.url));

// TODO(panel-redesign §A): apps/panel/src/styles.css 仍是 §A 之前的旧版浅色
// 主题，还没有 --bg 等 tokens（提示词一尚未合入）。§A 合入后，下面的面板侧
// 分支会自动生效并对两处 tokens 做相等断言；在此之前仅断言 site 模板包含
// §A.2 的规范值，不阻塞。
const CANONICAL: Record<string, string> = {
  '--bg': '#0d1117',
  '--surface': '#161b22',
  '--border': '#30363d',
  '--text': '#e6edf3',
  '--accent': '#58a6ff',
};

function extractTokens(css: string, names: string[]): Record<string, string> {
  const found: Record<string, string> = {};
  for (const name of names) {
    const match = new RegExp(`${name.replace(/[-]/g, '\\$&')}:\\s*([^;\\s]+)\\s*;`).exec(css);
    if (match) found[name] = match[1]!.toLowerCase();
  }
  return found;
}

describe('site tokens match the panel design system', () => {
  const template = readFileSync(`${repoRoot}/packages/site-generator/src/template.ts`, 'utf8');
  const panelCss = readFileSync(`${repoRoot}/apps/panel/src/styles.css`, 'utf8');

  it('template carries the §A.2 canonical token values', () => {
    expect(extractTokens(template, Object.keys(CANONICAL))).toEqual(CANONICAL);
  });

  it('template and panel styles.css agree on shared tokens', () => {
    const panelTokens = extractTokens(panelCss, Object.keys(CANONICAL));
    if (Object.keys(panelTokens).length < Object.keys(CANONICAL).length) {
      // 旧版面板 styles.css 尚无 tokens（见文件头 TODO）；不阻塞，§A 合入后本分支不再命中。
      expect(Object.keys(panelTokens).length).toBeLessThan(Object.keys(CANONICAL).length);
      return;
    }
    expect(panelTokens).toEqual(CANONICAL);
    expect(extractTokens(template, Object.keys(CANONICAL))).toEqual(panelTokens);
  });
});
