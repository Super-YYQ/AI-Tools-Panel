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
      setMessage(t('settings.clearedHistory'));
      const p = await api.privacy();
      setPrivacy(p);
    } catch (e) {
      setMessage(t('settings.clearFailed', { message: (e as Error).message }));
    }
  };

  const clearProposals = async () => {
    try {
      await api.clearProposals();
      setMessage(t('settings.clearedProposals'));
    } catch (e) {
      setMessage(t('settings.clearFailed', { message: (e as Error).message }));
    }
  };

  return (
    <section aria-labelledby="set-h">
      <div className="page-head">
        <h2 id="set-h">{t('settings.heading')}</h2>
      </div>
      <div className="panel">
        <ul className="info-list">
          <li>
            {t('settings.gitAvailable')}：<span className={health?.gitAvailable ? 'text-ok' : 'text-muted'}>{health?.gitAvailable ? t('settings.yes') : t('settings.no')}</span>
          </li>
          <li>
            {t('settings.repoState')}：<code>{health?.repo}</code>
          </li>
          <li>{t('settings.aiOff')}</li>
          <li>{t('settings.loopback')}</li>
        </ul>
      </div>
      <h3>{t('settings.privacy')}</h3>
      <div className="panel">
        {privacy ? (
          <ul className="info-list">
            <li>
              {t('settings.dbPath', { path: privacy.dbPathToken })}
            </li>
            <li>{t('settings.retention', { runs: privacy.retainedRuns })}</li>
            <li>
              {t('settings.aiEnabled')}：{privacy.aiEnabled ? t('settings.yes') : t('settings.no')}
            </li>
          </ul>
        ) : (
          <p className="note">{t('settings.privacyUnavailable')}</p>
        )}
        <p className="panel-actions">
          <button onClick={clearHistory}>{t('settings.clearHistory')}</button> <button onClick={clearProposals}>{t('settings.clearProposals')}</button>
        </p>
      </div>
      {message && (
        <p role="status" aria-live="polite">
          {message}
        </p>
      )}
      <h3>{t('settings.sourcedLock')}</h3>
      <p className="note">{t('settings.lockNote')}</p>
    </section>
  );
}
