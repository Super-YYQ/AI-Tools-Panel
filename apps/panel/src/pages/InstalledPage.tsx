import { useEffect, useState } from 'react';
import { api, type ChangeSummary, type Observation } from '../api';

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

export function StatCard({ label, value }: { label: string; value: string }): React.JSX.Element {
  return (
    <div className="stat">
      <div className="stat-value">{value}</div>
      <div className="stat-label">{label}</div>
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
      <h2 id="inst-h">已安装</h2>
      <div className="toolbar">
        <input type="search" aria-label="全文搜索" placeholder="搜索…" value={rawSearch} onChange={(e) => setRawSearch(e.target.value)} />
        {FILTER_KEYS.map((k) => (
          <select key={k} aria-label={`筛选 ${k}`} value={filters[k]} onChange={(e) => setFilters({ ...filters, [k]: e.target.value })}>
            <option value="">全部 {k}</option>
            {[...new Set(inventory.observations.map((o) => (k === 'status' ? statusByKey.get(o.artifactId) : (o as never)[k])))]
              .filter(Boolean)
              .map((v) => (
                <option key={String(v)} value={String(v)}>
                  {String(v)}
                </option>
              ))}
          </select>
        ))}
        <button onClick={() => setView(view === 'card' ? 'list' : 'card')}>{view === 'card' ? '列表视图' : '卡片视图'}</button>
      </div>
      {inventory.runId === null ? (
        <p className="empty">尚未扫描。请先执行扫描。</p>
      ) : filtered.length === 0 ? (
        <p className="empty">没有匹配当前筛选条件的资产。请调整筛选条件。</p>
      ) : view === 'card' ? (
        <div className="cards">
          {pageItems.map((o) => (
            <ObservationCard key={o.observationId} o={o} status={statusByKey.get(o.artifactId)} requestReview={requestReview} />
          ))}
        </div>
      ) : (
        <table>
          <thead>
            <tr>
              <th>名称</th>
              <th>类型</th>
              <th>Provider</th>
              <th>Scope</th>
              <th>状态</th>
              <th>路径</th>
            </tr>
          </thead>
          <tbody>
            {pageItems.map((o) => (
              <tr key={o.observationId}>
                <td>{o.canonicalName}</td>
                <td>{o.kind}</td>
                <td>{o.provider}</td>
                <td>{o.scope}</td>
                <td>{statusByKey.get(o.artifactId) ?? 'installed-only'}</td>
                <td>
                  <code>{o.location.pathToken}</code>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {pageCount > 1 && (
        <nav className="pager" aria-label="分页">
          <button disabled={page === 0} onClick={() => setPage(page - 1)}>
            上一页
          </button>
          <span>
            第 {page + 1} / {pageCount} 页（共 {filtered.length} 项）
          </span>
          <button disabled={page >= pageCount - 1} onClick={() => setPage(page + 1)}>
            下一页
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
        reason: policy === 'vendored' ? '纳入本地自定义 Skill（vendored）' : '纳入已安装资产到目录',
        entries: [
          {
            kind: 'Skill',
            entry: {
              metadata: { id: slug, displayName: o.canonicalName, shortDescription, tags: tags.split(/[,，\s]+/).filter(Boolean).map((t) => t.toLowerCase()) },
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
      setMessage(`保存失败：${(e as Error).message}`);
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
      setMessage(`预览失败：${(e as Error).message}`);
    }
  };

  return (
    <article className="card" aria-label={`${o.canonicalName} (${o.kind})`}>
      <h3>{o.canonicalName}</h3>
      <p className="kind">
        <span className="badge fact">{o.kind}</span> <span className="badge">{o.provider}</span> <span className="badge">{o.scope}</span>
        {status && <span className="badge status">{status}</span>}
      </p>
      <p className="desc">{description || <em>（原始描述为空）</em>}</p>
      <p className="meta">
        <code>{o.location.pathToken}</code>
      </p>
      <p>
        <button onClick={() => setShowForm(!showForm)} aria-expanded={showForm}>
          {showForm ? '收起' : '纳入目录'}
        </button>
        {o.kind === 'skill' && o.scope === 'repo' && <button onClick={runVendoringPreview}>本地导入预览</button>}
      </p>
      {showForm && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void submitDraft('metadata-only');
          }}
        >
          <label>
            人工简述 <input value={shortDescription} onChange={(e) => setShortDescription(e.target.value)} required />
          </label>
          <label>
            标签（逗号分隔） <input value={tags} onChange={(e) => setTags(e.target.value)} />
          </label>
          <button type="submit" disabled={busy}>
            {busy ? '生成中…' : '预览 diff 并保存'}
          </button>
        </form>
      )}
      {vendoring && (
        <div className="vendoring">
          <p>
            默认内容策略：<strong>{vendoring.defaultPolicy}</strong>
          </p>
          <p>可复制文件：{vendoring.gate.allowed.length > 0 ? vendoring.gate.allowed.join(', ') : '（无）'}</p>
          {vendoring.gate.blocked.length > 0 && <p>阻止/排除：{vendoring.gate.blocked.map((b) => `${b.path} (${b.reason})`).join(', ')}</p>}
          <button onClick={() => void submitDraft('metadata-only')}>仅保存元数据（默认）</button>
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
