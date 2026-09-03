import { useEffect, useState } from 'react';
import { api, type ChangeSummary } from '../api';
import { t } from '../i18n';
import { Loading } from './InstalledPage';

export function CatalogPage({ requestReview }: { requestReview: (r: { summary: ChangeSummary; onApplied: (m: string) => void }) => void }): React.JSX.Element {
  const [entries, setEntries] = useState<Array<{ repoRelativePath: string; entry: Record<string, unknown> }> | null>(null);
  const [error, setError] = useState('');
  const [url, setUrl] = useState('');
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    api.catalog().then((r) => setEntries(r.entries)).catch((e) => setError((e as Error).message));
  }, []);

  const saveFavorite = async () => {
    setSaving(true);
    setMessage('');
    try {
      const id = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'favorite';
      // FUN-008: typed draft; FUN-004: url source stays a verified-false favorite.
      const summary = await api.createTypedDraft({
        reason: t('draft.reasonFavorite'),
        entries: [
          {
            kind: 'Skill',
            entry: {
              metadata: { id, displayName: name || id },
              spec: { source: { type: 'url', url } },
            },
          },
        ],
        fragments: [],
      });
      requestReview({ summary, onApplied: (m) => setMessage(m) });
      const r = await api.catalog();
      setEntries(r.entries);
    } catch (e) {
      setMessage(t('common.saveFailed', { message: (e as Error).message }));
    } finally {
      setSaving(false);
    }
  };

  return (
    <section aria-labelledby="cat-h">
      <div className="page-head">
        <h2 id="cat-h">{t('nav.catalog')}</h2>
        <p className="page-desc">{t('catalog.desc')}</p>
      </div>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {!entries && !error && <Loading />}
      {entries && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>{t('catalog.file')}</th>
                <th>{t('catalog.id')}</th>
                <th>{t('catalog.displayName')}</th>
                <th>{t('catalog.ownership')}</th>
                <th>{t('catalog.policy')}</th>
              </tr>
            </thead>
            <tbody>
              {entries.map(({ repoRelativePath, entry }) => {
                const meta = entry.metadata as { id?: string; displayName?: string } | undefined;
                const spec = entry.spec as { ownership?: string; contentPolicy?: string } | undefined;
                return (
                  <tr key={repoRelativePath}>
                    <td>
                      <code>{repoRelativePath}</code>
                    </td>
                    <td>{meta?.id}</td>
                    <td>{meta?.displayName}</td>
                    <td>{spec?.ownership}</td>
                    <td>{spec?.contentPolicy}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <h3>{t('catalog.favoriteHeading')}</h3>
      <form
        className="inline-form"
        onSubmit={(e) => {
          e.preventDefault();
          void saveFavorite();
        }}
      >
        <label>
          {t('catalog.name')} <input value={name} onChange={(e) => setName(e.target.value)} required />
        </label>
        <label>
          {t('catalog.url')} <input value={url} onChange={(e) => setUrl(e.target.value)} required />
        </label>
        <button type="submit" disabled={saving}>
          {saving ? t('catalog.saving') : t('catalog.previewSave')}
        </button>
      </form>
      {message && (
        <p role="status" aria-live="polite">
          {message}
        </p>
      )}
    </section>
  );
}
