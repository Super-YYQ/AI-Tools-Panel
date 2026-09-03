import { useEffect, useState } from 'react';
import { api } from '../api';
import { t } from '../i18n';
import { DiffView } from '../components/DiffView';
import { EmptyState, Loading } from './InstalledPage';

/** FUN-006: the Changes page shows the real, app-owned git diff (GIT-003). */
export function ChangesPage(): React.JSX.Element {
  const [summary, setSummary] = useState<{ branch: string; changedFiles: Array<{ status: string; path: string }> } | null>(null);
  const [diff, setDiff] = useState<{ diff: string; truncated: boolean } | null>(null);

  useEffect(() => {
    api.gitSummary().then(setSummary).catch(() => setSummary({ branch: '', changedFiles: [] }));
    api.gitDiff().then(setDiff).catch(() => setDiff({ diff: '', truncated: false }));
  }, []);

  if (!summary) return <Loading />;
  return (
    <section aria-labelledby="ch-h">
      <div className="page-head">
        <h2 id="ch-h">{t('changes.heading')}</h2>
        <p className="page-desc">{t('changes.desc')}</p>
      </div>
      <p className="branch-line">
        {t('changes.branch')}：<code>{summary.branch || t('common.none')}</code>
      </p>
      {summary.changedFiles.length === 0 ? (
        <EmptyState icon="inbox">{t('changes.none')}</EmptyState>
      ) : (
        <>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>{t('changes.fileStatus')}</th>
                  <th>{t('changes.file')}</th>
                </tr>
              </thead>
              <tbody>
                {summary.changedFiles.map((f, i) => (
                  <tr key={i}>
                    <td>
                      <span className={`badge git-${f.status}`}>{f.status}</span>
                    </td>
                    <td>
                      <code>{f.path}</code>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <h3>{t('changes.diffHeading')}</h3>
          {diff && diff.diff ? (
            <DiffView diff={diff.diff} ariaLabel="Git diff" footer={diff.truncated ? t('changes.truncated') : undefined} />
          ) : (
            <EmptyState icon="inbox">{t('changes.noDiff')}</EmptyState>
          )}
        </>
      )}
    </section>
  );
}
