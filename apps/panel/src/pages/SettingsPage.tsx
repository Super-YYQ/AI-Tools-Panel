import { useEffect, useState } from 'react';
import { api, type Health } from '../api';
import { t } from '../i18n';

/** PRI-006: privacy page — where local data lives, retention, and one-click cleanup. */
export function SettingsPage({ health }: { health: Health | null }): React.JSX.Element {
  const [privacy, setPrivacy] = useState<{ dbPathToken: string; retainedRuns: number; aiEnabled: boolean } | null>(null);
  const [message, setMessage] = useState('');

  useEffect(() => {
    api.privacy().then(setPrivacy).catch(() => setPrivacy(null));
  }, []);

  const clearHistory = async () => {
    try {
      await api.clearHistory();
      setMessage('已清除扫描历史（Catalog 与 Git 文件不受影响）。');
      const p = await api.privacy();
      setPrivacy(p);
    } catch (e) {
      setMessage(`清理失败：${(e as Error).message}`);
    }
  };

  const clearProposals = async () => {
    try {
      await api.clearProposals();
      setMessage('已清除 AI Proposal 记录。');
    } catch (e) {
      setMessage(`清理失败：${(e as Error).message}`);
    }
  };

  return (
    <section aria-labelledby="set-h">
      <h2 id="set-h">{t('settings.heading')}</h2>
      <ul>
        <li>{t('settings.gitAvailable')}：{health?.gitAvailable ? t('settings.yes') : t('settings.no')}</li>
        <li>{t('settings.repoState')}：{health?.repo}</li>
        <li>{t('settings.aiOff')}</li>
        <li>{t('settings.loopback')}</li>
      </ul>
      <h3>{t('settings.privacy')}</h3>
      {privacy ? (
        <ul>
          <li>{t('settings.dbPath', { path: privacy.dbPathToken })}</li>
          <li>{t('settings.retention', { runs: privacy.retainedRuns })}</li>
          <li>{t('settings.aiEnabled')}：{privacy.aiEnabled ? t('settings.yes') : t('settings.no')}</li>
        </ul>
      ) : (
        <p className="empty">隐私信息不可用。</p>
      )}
      <p>
        <button onClick={clearHistory}>{t('settings.clearHistory')}</button>{' '}
        <button onClick={clearProposals}>{t('settings.clearProposals')}</button>
      </p>
      {message && (
        <p role="status" aria-live="polite">
          {message}
        </p>
      )}
      <h3>{t('settings.sourcedLock')}</h3>
      <p className="empty">{t('settings.lockNote')}</p>
    </section>
  );
}
