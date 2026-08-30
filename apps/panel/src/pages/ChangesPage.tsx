import { useEffect, useState } from 'react';
import { api } from '../api';
import { t } from '../i18n';
import { Loading } from './InstalledPage';

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
      <h2 id="ch-h">{t('changes.heading')}</h2>
      <p>{t('changes.branch')}：{summary.branch || '（无）'}</p>
      {summary.changedFiles.length === 0 ? (
        <p className="empty">{t('changes.none')}</p>
      ) : (
        <>
          <table>
            <thead>
              <tr>
                <th>状态</th>
                <th>文件</th>
              </tr>
            </thead>
            <tbody>
              {summary.changedFiles.map((f, i) => (
                <tr key={i}>
                  <td>
                    <code>{f.status}</code>
                  </td>
                  <td>
                    <code>{f.path}</code>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <h3>{t('changes.diffHeading')}</h3>
          {diff && diff.diff ? (
            <pre className="diff-view" aria-label="Git diff">
              {diff.diff}
              {diff.truncated ? '\n…（diff 过长，已截断。完整内容请用 git diff 查看）' : ''}
            </pre>
          ) : (
            <p className="empty">{t('changes.noDiff')}</p>
          )}
        </>
      )}
    </section>
  );
}
