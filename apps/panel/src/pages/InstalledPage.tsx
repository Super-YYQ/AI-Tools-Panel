import { useEffect, useState } from 'react';
import { api, type ChangeSummary, type Observation } from '../api';
import { t } from '../i18n';
import { Icon, kindIcon, type IconName } from '../components/Icons';

export function Loading(): React.JSX.Element {
  return <p role="status">加载中…</p>;
}

export function useInventory(inventoryKey: number): { inventory: import('../api').InventoryResponse | null; error: string | null } {
  const [inventory, setInventory] = useState<import('../api').InventoryResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api
      .inventory()
      .then(setInventory)
      .catch((e) => setError((e as Error).message));
  }, [inventoryKey]);
  return { inventory, error };
}

export function StatCard({ label, value, icon }: { label: string; value: string; icon?: IconName }): React.JSX.Element {
  return (
    <div className="stat">
      {icon && (
        <span className="stat-icon">
          <Icon name={icon} />
        </span>
      )}
      <div className="stat-value">{value}</div>
      <div className="stat-label">{label}</div>
    </div>
  );
}

/** §A.4 shared empty state: icon + hint, keeps role="status"/.empty semantics. */
export function EmptyState({ icon = 'inbox', children, live = false }: { icon?: IconName; children: React.ReactNode; live?: boolean }): React.JSX.Element {
  return (
    <div className="empty" role="status" aria-live={live ? 'polite' : undefined}>
      <Icon name={icon} size={28} className="empty-icon" />
      <p className="empty-text">{children}</p>
    </div>
  );
}

const FILTER_KEYS = ['kind', 'provider', 'scope', 'status'] as const;
const PAGE_SIZE = 50;

export function InstalledPage({ inventoryKey, requestReview }: { inventoryKey: number; requestReview: (r: { summary: ChangeSummary; onApplied: (m: string) => void }) => void }): React.JSX.Element {
  const { inventory } = useInventory(inventoryKey);
  const [view, setView] = useState<'card' | 'list'>(() => (localStorage.getItem('aitp-view') as 'card' | 'list') ?? 'card');
  const [rawSearch, setRawSearch] = useState('');
  const [search, setSearch] = useState('');
  const params = new URLSearchParams(window.location.search);
  const [filters, setFilters] = useState<Record<string, string>>(() => Object.fromEntries(FILTER_KEYS.map((k) => [k, params.get(k) ?? ''])));
  const [page, setPage] = useState(0);

  // P2-UI-05: debounce search input instead of recomputing on every keystroke.
  useEffect(() => {
    const t = setTimeout(() => {
      setSearch(rawSearch);
      setPage(0);
    }, 150);
    return () => clearTimeout(t);
  }, [rawSearch]);

  useEffect(() => {
    const sp = new URLSearchParams(Object.entries(filters).filter(([, v]) => v));
    window.history.replaceState(null, '', `${window.location.pathname}${sp.toString() ? `?${sp}` : ''}`);
  }, [filters]);

  if (!inventory) return <Loading />;
  const statusByKey = new Map(inventory.reconcile.items.map((i) => [i.key, i.status]));
  // P2-UI-05: precompute searchable text once per inventory snapshot —
  // no JSON.stringify per keystroke.
  const searchable = new Map(inventory.observations.map((o) => [o.observationId, searchableText(o)]));
  const filtered = inventory.observations.filter((o) => {
    if (filters.kind && o.kind !== filters.kind) return false;
    if (filters.provider && o.provider !== filters.provider) return false;
    if (filters.scope && o.scope !== filters.scope) return false;
    if (filters.status && statusByKey.get(o.artifactId) !== filters.status) return false;
    if (search && !(searchable.get(o.observationId) ?? '').includes(search.toLowerCase())) return false;
    return true;
  });
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pageItems = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  return (
    <section aria-labelledby="inst-h">
      <div className="page-head">
        <h2 id="inst-h">{t('nav.installed')}</h2>
        <p className="page-desc">{t('installed.desc')}</p>
      </div>
      <div className="toolbar">
        <span className="search-box">
          <Icon name="scan" size={13} className="search-icon" />
          <input type="search" aria-label={t('installed.search')} placeholder={t('installed.searchPlaceholder')} value={rawSearch} onChange={(e) => setRawSearch(e.target.value)} />
        </span>
        {FILTER_KEYS.map((k) => (
          <select key={k} aria-label={t('installed.filter', { key: k })} value={filters[k]} onChange={(e) => setFilters({ ...filters, [k]: e.target.value })}>
            <option value="">{t('installed.all', { key: k })}</option>
            {[...new Set(inventory.observations.map((o) => (k === 'status' ? statusByKey.get(o.artifactId) : (o as never)[k])))]
              .filter(Boolean)
              .map((v) => (
                <option key={String(v)} value={String(v)}>
                  {String(v)}
                </option>
              ))}
          </select>
        ))}
        <button onClick={() => setView(view === 'card' ? 'list' : 'card')}>{view === 'card' ? t('installed.viewList') : t('installed.viewCards')}</button>
      </div>
      {inventory.runId === null ? (
        <EmptyState icon="scan" live>
          {t('installed.empty')}
        </EmptyState>
      ) : filtered.length === 0 ? (
        <EmptyState icon="inbox" live>
          {t('common.empty')}
        </EmptyState>
      ) : view === 'card' ? (
        <div className="cards">
          {pageItems.map((o) => (
            <ObservationCard key={o.observationId} o={o} status={statusByKey.get(o.artifactId)} requestReview={requestReview} />
          ))}
        </div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>{t('installed.name')}</th>
                <th>{t('installed.type')}</th>
                <th>{t('installed.provider')}</th>
                <th>{t('installed.scope')}</th>
                <th>{t('installed.status')}</th>
                <th>{t('installed.path')}</th>
              </tr>
            </thead>
            <tbody>
              {pageItems.map((o) => (
                <tr key={o.observationId}>
                  <td>{o.canonicalName}</td>
                  <td>
                    <span className={`badge kind-${o.kind}`}>
                      <Icon name={kindIcon(o.kind)} size={11} />
                      {o.kind}
                    </span>
                  </td>
                  <td>{o.provider}</td>
                  <td>{o.scope}</td>
                  <td>
                    <span className={`badge st-${statusByKey.get(o.artifactId) ?? 'installed-only'}`}>{statusByKey.get(o.artifactId) ?? 'installed-only'}</span>
                  </td>
                  <td>
                    <code>{o.location.pathToken}</code>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {pageCount > 1 && (
        <nav className="pager" aria-label={t('pager.label')}>
          <button disabled={page === 0} onClick={() => setPage(page - 1)}>
            {t('pager.prev')}
          </button>
          <span>{t('pager.info', { page: page + 1, total: pageCount, count: filtered.length })}</span>
          <button disabled={page >= pageCount - 1} onClick={() => setPage(page + 1)}>
            {t('pager.next')}
          </button>
        </nav>
      )}
    </section>
  );
}

function searchableText(o: Observation): string {
  return [o.canonicalName, o.kind, o.provider, o.scope, o.location.pathToken, String(o.summary.description ?? '')].join(' ').toLowerCase();
}

export function ObservationCard({ o, status, requestReview }: { o: Observation; status?: string; requestReview: (r: { summary: ChangeSummary; onApplied: (m: string) => void }) => void }): React.JSX.Element {
  const description = typeof o.summary.description === 'string' ? o.summary.description : '';
  const [showForm, setShowForm] = useState(false);
  const [shortDescription, setShortDescription] = useState('');
  const [tags, setTags] = useState('');
  const [message, setMessage] = useState('');
  const [vendoring, setVendoring] = useState<Awaited<ReturnType<typeof api.vendoringPreview>> | null>(null);
  const [busy, setBusy] = useState(false);

  const slug = o.canonicalName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'entry';

  const submitDraft = async (policy: 'metadata-only' | 'vendored') => {
    setBusy(true);
    setMessage('');
    try {
      // FUN-008: typed draft — the server serializes the YAML.
      const summary = await api.createTypedDraft({
        reason: policy === 'vendored' ? t('card.reasonVendored') : t('card.reasonAdd'),
        entries: [
          {
            kind: 'Skill',
            entry: {
              metadata: { id: slug, displayName: o.canonicalName, shortDescription, tags: tags.split(/[,，\s]+/).filter(Boolean).map((tg) => tg.toLowerCase()) },
              spec: { targets: [o.provider], source: { type: 'unknown' } },
              overlay: { notes: '' },
              verification: { sourceDigest: `sha256:${o.contentHash}` },
            },
          },
        ],
        fragments: [],
      });
      // FUN-007: full diff review before apply — never window.confirm.
      requestReview({ summary, onApplied: (m) => setMessage(m) });
      setShowForm(false);
      setVendoring(null);
    } catch (e) {
      setMessage(t('common.saveFailed', { message: (e as Error).message }));
    } finally {
      setBusy(false);
    }
  };

  const runVendoringPreview = async () => {
    setMessage('');
    try {
      const dirToken = o.location.pathToken.endsWith('.md') ? o.location.pathToken.split('/').slice(0, -1).join('/') : o.location.pathToken;
      setVendoring(await api.vendoringPreview(dirToken));
    } catch (e) {
      setMessage(t('card.previewFailed', { message: (e as Error).message }));
    }
  };

  return (
    <article className="card" aria-label={`${o.canonicalName} (${o.kind})`}>
      <div className="card-head">
        <span className={`kind-icon kind-${o.kind}`}>
          <Icon name={kindIcon(o.kind)} />
        </span>
        <h3>{o.canonicalName}</h3>
      </div>
      <p className="kind">
        <span className={`badge kind-${o.kind}`}>{o.kind}</span> <span className="badge">{o.provider}</span> <span className="badge">{o.scope}</span>
        {status && <span className={`badge st-${status}`}>{status}</span>}
      </p>
      <p className="desc">{description || <em>{t('card.noDesc')}</em>}</p>
      <p className="meta">
        <code>{o.location.pathToken}</code>
      </p>
      <div className="card-actions">
        <button onClick={() => setShowForm(!showForm)} aria-expanded={showForm}>
          {showForm ? t('card.collapse') : t('card.add')}
        </button>
        {o.kind === 'skill' && o.scope === 'repo' && <button onClick={runVendoringPreview}>{t('card.importPreview')}</button>}
      </div>
      {showForm && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void submitDraft('metadata-only');
          }}
        >
          <label>
            {t('card.humanSummary')} <input value={shortDescription} onChange={(e) => setShortDescription(e.target.value)} required />
          </label>
          <label>
            {t('card.tags')} <input value={tags} onChange={(e) => setTags(e.target.value)} />
          </label>
          <button type="submit" disabled={busy}>
            {busy ? t('common.generating') : t('card.previewAndSave')}
          </button>
        </form>
      )}
      {vendoring && (
        <div className="vendoring">
          <p>
            {t('card.defaultPolicy')}：<strong>{vendoring.defaultPolicy}</strong>
          </p>
          <p>
            {t('card.copyable')}
            {vendoring.gate.allowed.length > 0 ? vendoring.gate.allowed.join(', ') : t('common.none')}
          </p>
          {vendoring.gate.blocked.length > 0 && (
            <p>
              {t('card.blocked')}
              {vendoring.gate.blocked.map((b) => `${b.path} (${b.reason})`).join(', ')}
            </p>
          )}
          <button onClick={() => void submitDraft('metadata-only')}>{t('card.metadataOnly')}</button>
        </div>
      )}
      {message && (
        <p role="status" aria-live="polite">
          {message}
        </p>
      )}
    </article>
  );
}
