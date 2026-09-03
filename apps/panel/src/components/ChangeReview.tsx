import { useState } from 'react';
import { t } from '../i18n';
import type { ChangeSummary } from '../api';
import { DiffView } from './DiffView';

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
      onApplied(t('review.applied', { files: result.applied.join(', ') }));
    } catch (e) {
      setError(t('review.error', { message: (e as Error).message }));
      setBusy(false);
    }
  };

  return (
    <section aria-labelledby="review-h" className="review">
      <div className="page-head">
        <h2 id="review-h">{t('review.heading')}</h2>
        <p className="page-desc">
          {t('review.reasonLabel')}：{summary.reason} · {t('review.changeSet')} <code>{summary.changeSetId}</code>
        </p>
      </div>
      <p className="note">{t('review.note')}</p>
      {summary.changes.map((c) => (
        <details key={c.repoRelativePath} open={summary.changes.length === 1}>
          <summary>
            <code>{c.repoRelativePath}</code> — {c.operation} {c.expectedOldHash ? t('review.updateFile') : t('review.newFile')}
          </summary>
          <DiffView diff={c.unifiedDiff} ariaLabel={`${c.repoRelativePath} diff`} emptyText={t('review.noDiff')} />
        </details>
      ))}
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      <p className="review-actions">
        <button className="primary" onClick={() => void apply()} disabled={busy}>
          {busy ? t('review.applying') : t('review.apply')}
        </button>{' '}
        <button onClick={onCancelled} disabled={busy}>
          {t('review.cancel')}
        </button>
      </p>
    </section>
  );
}

function api_apply(summary: ChangeSummary): Promise<{ ok: boolean; applied: string[] }> {
  // Imported lazily to avoid a circular import with the api module.
  return import('../api').then((m) => m.api.applyChangeSet(summary.changeSetId, summary.applyToken));
}
