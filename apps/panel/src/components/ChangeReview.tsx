import { useState } from 'react';
import type { ChangeSummary } from '../api';

/**
 * FUN-007 (P1-UI-03): full Change Review before any repository write.
 * Shows every file, the complete unified diff, expected hashes and a real
 * Apply/Cancel decision — never a truncated confirm() dialog.
 */
export function ChangeReview({ summary, onApplied, onCancelled }: { summary: ChangeSummary; onApplied: (message: string) => void; onCancelled: () => void }): React.JSX.Element {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const apply = async () => {
    setBusy(true);
    setError('');
    try {
      const result = await api_apply(summary);
      onApplied(`已保存：${result.applied.join(', ')}。请在 Git 中审阅 diff（不会自动 commit）。`);
    } catch (e) {
      setError(`应用失败：${(e as Error).message}`);
      setBusy(false);
    }
  };

  return (
    <section aria-labelledby="review-h" className="review">
      <h2 id="review-h">变更审查</h2>
      <p>
        原因：{summary.reason} · 变更集 <code>{summary.changeSetId}</code>
      </p>
      <p className="empty">写入只在确认后发生；apply 使用一次性 token 与 expected hash 防止覆盖外部修改。</p>
      {summary.changes.map((c) => (
        <details key={c.repoRelativePath} open={summary.changes.length === 1}>
          <summary>
            <code>{c.repoRelativePath}</code> — {c.operation} {c.expectedOldHash ? '（更新，含 expected hash）' : '（新建）'}
          </summary>
          <pre className="diff-view" aria-label={`${c.repoRelativePath} diff`}>
            {c.unifiedDiff || '（无差异）'}
          </pre>
        </details>
      ))}
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      <p>
        <button className="primary" onClick={() => void apply()} disabled={busy}>
          {busy ? '应用中…' : '应用变更'}
        </button>{' '}
        <button onClick={onCancelled} disabled={busy}>
          取消
        </button>
      </p>
    </section>
  );
}

function api_apply(summary: ChangeSummary): Promise<{ ok: boolean; applied: string[] }> {
  // Imported lazily to avoid a circular import with the api module.
  return import('../api').then((m) => m.api.applyChangeSet(summary.changeSetId, summary.applyToken));
}
