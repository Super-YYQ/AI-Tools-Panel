import { useEffect, useState } from 'react';
import { api, type ChangeSummary } from '../api';
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
        reason: '收藏未安装条目',
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
      setMessage(`保存失败：${(e as Error).message}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <section aria-labelledby="cat-h">
      <h2 id="cat-h">目录库</h2>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {!entries && !error && <Loading />}
      {entries && (
        <table>
          <thead>
            <tr>
              <th>文件</th>
              <th>ID</th>
              <th>显示名</th>
              <th>所有权</th>
              <th>内容策略</th>
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
      )}
      <h3>收藏未安装条目</h3>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void saveFavorite();
        }}
      >
        <label>
          名称 <input value={name} onChange={(e) => setName(e.target.value)} required />
        </label>
        <label>
          URL / Marketplace 标识 <input value={url} onChange={(e) => setUrl(e.target.value)} required />
        </label>
        <button type="submit" disabled={saving}>
          {saving ? '保存中…' : '预览并保存'}
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
