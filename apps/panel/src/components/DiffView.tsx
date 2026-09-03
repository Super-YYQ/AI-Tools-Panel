/** Line-classified unified diff renderer (§A.4): file headers muted, hunk
 * headers accent, + lines success, - lines danger. Keeps the caller's
 * aria-label — the E2E suite locates diffs through it. */

type DiffLineType = 'file' | 'hunk' | 'add' | 'del' | 'meta' | 'context';

const FILE_PREFIXES = [
  'diff ',
  'index ',
  'old mode',
  'new mode',
  'new file mode',
  'deleted file mode',
  'rename from',
  'rename to',
  'copy from',
  'copy to',
  'similarity index',
  'dissimilarity index',
  'Binary files',
  '\\ No newline',
];

function classify(line: string, inHunk: boolean): DiffLineType {
  if (line.startsWith('diff ')) return 'file';
  if (line.startsWith('@@')) return 'hunk';
  if (!inHunk) {
    if (FILE_PREFIXES.some((p) => line.startsWith(p))) return 'file';
    return 'context';
  }
  if (line.startsWith('+')) return 'add';
  if (line.startsWith('-')) return 'del';
  if (line.startsWith('\\')) return 'meta';
  return 'context';
}

export interface DiffViewProps {
  diff: string;
  /** Accessible name for the <pre>; must keep containing "diff" (E2E anchor). */
  ariaLabel?: string;
  /** Shown as a muted line when the diff is empty (e.g. （无差异）). */
  emptyText?: string;
  /** Extra muted line rendered after the diff (e.g. truncation notice). */
  footer?: string;
  className?: string;
}

export function DiffView({ diff, ariaLabel, emptyText, footer, className }: DiffViewProps): React.JSX.Element {
  const lines: Array<{ text: string; type: DiffLineType }> = [];
  if (diff.trim().length === 0) {
    if (emptyText) lines.push({ text: emptyText, type: 'meta' });
  } else {
    const raw = diff.split('\n');
    if (raw.length > 0 && raw[raw.length - 1] === '') raw.pop();
    let inHunk = false;
    for (const text of raw) {
      const type = classify(text, inHunk);
      if (type === 'hunk') inHunk = true;
      else if (type === 'file') inHunk = false;
      lines.push({ text, type });
    }
  }
  return (
    <pre className={className ? `diff-view ${className}` : 'diff-view'} aria-label={ariaLabel}>
      {lines.map((l, i) => (
        <span key={i} className={`diff-line diff-${l.type}`}>
          {l.text.length > 0 ? l.text : '\u00A0'}
        </span>
      ))}
      {footer ? <span className="diff-line diff-meta">{footer}</span> : null}
    </pre>
  );
}
