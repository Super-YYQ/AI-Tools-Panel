import { useCallback, useEffect, useState } from 'react';
import { api, type Health, type InventoryResponse, type Observation } from './api';

type Page = 'overview' | 'installed' | 'catalog' | 'rules' | 'changes' | 'settings';

const PAGES: Array<[Page, string]> = [
  ['overview', '总览'],
  ['installed', '已安装'],
  ['catalog', '目录库'],
  ['rules', '规则'],
  ['changes', '变更'],
  ['settings', '设置'],
];

export function App() {
  const [page, setPage] = useState<Page>(() => (window.location.hash.replace('#', '') || 'overview') as Page);
  const [health, setHealth] = useState<Health | null>(null);
  const [inventory, setInventory] = useState<InventoryResponse | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [scanBusy, setScanBusy] = useState(false);
  const [status, setStatus] = useState('');

  const refresh = useCallback(async () => {
    try {
      const h = await api.health();
      setHealth(h);
      const inv = await api.inventory();
      setInventory(inv);
      setLoadError(null);
    } catch (e) {
      setLoadError(`无法连接本机服务：${(e as Error).message}`);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    window.location.hash = page;
  }, [page]);

  const startScan = async () => {
    setScanBusy(true);
    setStatus('');
    try {
      const { scanId } = await api.startScan();
      // Poll until terminal.
      for (let i = 0; i < 300; i++) {
        await new Promise((r) => setTimeout(r, 300));
        const run = await api.scanStatus(scanId);
        if (['completed', 'partial', 'failed', 'cancelled'].includes(run.status)) {
          setStatus(`扫描${run.status === 'completed' ? '完成' : run.status === 'partial' ? '部分完成' : '取消/失败'}：发现 ${run.counts.total} 项（新增 ${run.counts.added}，变化 ${run.counts.changed}，消失 ${run.counts.missing}）`);
          break;
        }
      }
      await refresh();
    } catch (e) {
      setStatus(`扫描失败：${(e as Error).message}`);
    } finally {
      setScanBusy(false);
    }
  };

  return (
    <div className="app">
      <header role="banner" className="topbar">
        <h1>AI Tools Panel</h1>
        <span className="repo">{health ? (health.repo === 'ok' ? '仓库已识别' : '非 Git 仓库') : '连接中…'}</span>
        <button onClick={startScan} disabled={scanBusy} className="primary">
          {scanBusy ? '扫描中…' : '开始扫描'}
        </button>
        <span role="status" aria-live="polite" className="status">
          {status}
        </span>
      </header>
      {loadError && (
        <div role="alert" className="banner error">
          {loadError}
        </div>
      )}
      <nav aria-label="主导航" className="nav">
        {PAGES.map(([id, label]) => (
          <button key={id} aria-current={page === id ? 'page' : undefined} onClick={() => setPage(id)}>
            {label}
          </button>
        ))}
      </nav>
      <main id="main">
        {page === 'overview' && <Overview health={health} inventory={inventory} onNavigate={setPage} />}
        {page === 'installed' && <Installed inventory={inventory} />}
        {page === 'catalog' && <CatalogPage />}
        {page === 'rules' && <Rules inventory={inventory} />}
        {page === 'changes' && <Changes />}
        {page === 'settings' && <Settings health={health} />}
      </main>
    </div>
  );
}

function Overview({ health, inventory, onNavigate }: { health: Health | null; inventory: InventoryResponse | null; onNavigate: (p: never) => void }) {
  void onNavigate;
  if (!inventory) return <Loading />;
  const kinds: Record<string, number> = {};
  for (const o of inventory.observations) kinds[o.kind] = (kinds[o.kind] ?? 0) + 1;
  return (
    <section aria-labelledby="ov-h">
      <h2 id="ov-h">总览</h2>
      <div className="grid">
        <StatCard label="Provider" value={health ? Object.keys(health.providers).join(' / ') : '—'} />
        <StatCard label="发现资产" value={String(inventory.observations.length)} />
        <StatCard label="诊断" value={String(inventory.diagnostics.length)} />
      </div>
      <h3>状态分布</h3>
      <ul className="counts">
        {Object.entries(inventory.reconcile.counts).map(([k, v]) => (
          <li key={k}>
            {k}: {v}
          </li>
        ))}
      </ul>
      <h3>类型分布</h3>
      <ul className="counts">
        {Object.entries(kinds).map(([k, v]) => (
          <li key={k}>
            {k}: {v}
          </li>
        ))}
      </ul>
      {inventory.diagnostics.length > 0 && (
        <>
          <h3>诊断</h3>
          <ul className="diagnostics">
            {inventory.diagnostics.slice(0, 20).map((d, i) => (
              <li key={i} className={d.severity}>
                <code>{d.code}</code> {d.message}
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="stat">
      <div className="stat-value">{value}</div>
      <div className="stat-label">{label}</div>
    </div>
  );
}

function Loading() {
  return <p role="status">加载中…</p>;
}

const FILTER_KEYS = ['kind', 'provider', 'scope', 'status'] as const;

function Installed({ inventory }: { inventory: InventoryResponse | null }) {
  const [view, setView] = useState<'card' | 'list'>(() => (localStorage.getItem('aitp-view') as 'card' | 'list') ?? 'card');
  const [search, setSearch] = useState('');
  const params = new URLSearchParams(window.location.search);
  const [filters, setFilters] = useState<Record<string, string>>(() => Object.fromEntries(FILTER_KEYS.map((k) => [k, params.get(k) ?? ''])));

  useEffect(() => {
    const sp = new URLSearchParams(Object.entries(filters).filter(([, v]) => v));
    window.history.replaceState(null, '', `${window.location.pathname}${sp.toString() ? `?${sp}` : ''}`);
  }, [filters]);

  if (!inventory) return <Loading />;
  const statusByKey = new Map(inventory.reconcile.items.map((i) => [i.key, i.status]));
  const filtered = inventory.observations.filter((o) => {
    if (filters.kind && o.kind !== filters.kind) return false;
    if (filters.provider && o.provider !== filters.provider) return false;
    if (filters.scope && o.scope !== filters.scope) return false;
    if (filters.status && statusByKey.get(o.artifactId) !== filters.status) return false;
    if (search && !JSON.stringify(o).toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  return (
    <section aria-labelledby="inst-h">
      <h2 id="inst-h">已安装</h2>
      <div className="toolbar">
        <input
          type="search"
          aria-label="全文搜索"
          placeholder="搜索…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
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
      {filtered.length === 0 ? (
        <p className="empty">没有匹配当前筛选条件的资产。请调整筛选或先执行扫描。</p>
      ) : view === 'card' ? (
        <div className="cards">
          {filtered.map((o) => (
            <ObservationCard key={o.observationId} o={o} status={statusByKey.get(o.artifactId)} />
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
            {filtered.map((o) => (
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
    </section>
  );
}

/** Fact / proposal visual distinction (WEB_UI_SPEC §1). */
function ObservationCard({ o, status }: { o: Observation; status?: string }) {
  const description = typeof o.summary.description === 'string' ? o.summary.description : '';
  const [showForm, setShowForm] = useState(false);
  const [shortDescription, setShortDescription] = useState('');
  const [tags, setTags] = useState('');
  const [message, setMessage] = useState('');
  const [vendoring, setVendoring] = useState<Awaited<ReturnType<typeof api.vendoringPreview>> | null>(null);

  const slug = o.canonicalName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'entry';
  const yamlFor = (policy: 'metadata-only' | 'vendored'): string => [
    'apiVersion: aitp.dev/v1alpha1',
    'kind: Skill',
    'metadata:',
    `  id: ${slug}`,
    `  displayName: ${o.canonicalName}`,
    `  shortDescription: ${JSON.stringify(shortDescription)}`,
    `  tags: [${tags.split(/[,，\s]+/).filter(Boolean).map((t) => t.toLowerCase()).sort().join(', ')}]`,
    'spec:',
    '  targets:',
    `    - ${o.provider}`,
    '  ownership: referenced',
    '  source:',
    '    type: unknown',
    `  contentPolicy: ${policy}`,
    'overlay:',
    "  notes: ''",
    '  fieldOrigins:',
    '    shortDescription: human',
    '',
  ].join('\n');

  const submitDraft = async (policy: 'metadata-only' | 'vendored') => {
    setMessage('');
    try {
      const draft = await api.createDraft(
        [{ repoRelativePath: `catalog/skills/${slug}.yaml`, operation: 'create', content: yamlFor(policy) }],
        policy === 'vendored' ? '纳入本地自定义 Skill（vendored）' : '纳入已安装资产到目录',
      );
      const cs = await api.getChangeSet(draft.changeSetId);
      const preview = cs.changes.map((c) => `--- ${c.repoRelativePath}
${c.unifiedDiff.slice(0, 600)}`).join('\n');
      const ok = window.confirm(`变更预览（unified diff）：
${preview}

确认写入仓库？`);
      if (!ok) {
        setMessage('已取消。未写入任何文件。');
        return;
      }
      const result = await api.applyChangeSet(draft.changeSetId, draft.applyToken);
      setMessage(`已保存：${result.applied.join(', ')}。请在 Git 中审阅 diff（不会自动 commit）。`);
      setShowForm(false);
    } catch (e) {
      setMessage(`保存失败：${(e as Error).message}`);
    }
  };

  const runVendoringPreview = async () => {
    setMessage('');
    try {
      const dirToken = o.location.pathToken.endsWith('.md')
        ? o.location.pathToken.split('/').slice(0, -1).join('/')
        : o.location.pathToken;
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
        {o.kind === 'skill' && o.scope === 'repo' && (
          <button onClick={runVendoringPreview}>本地导入预览</button>
        )}
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
          <button type="submit">预览 diff 并保存</button>
        </form>
      )}
      {vendoring && (
        <div className="vendoring">
          <p>
            默认内容策略：<strong>{vendoring.defaultPolicy}</strong>
          </p>
          <p>可复制文件：{vendoring.gate.allowed.length > 0 ? vendoring.gate.allowed.join(', ') : '（无）'}</p>
          {vendoring.gate.blocked.length > 0 && (
            <p>
              阻止/排除：{vendoring.gate.blocked.map((b) => `${b.path} (${b.reason})`).join(', ')}
            </p>
          )}
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

function CatalogPage() {
  const [entries, setEntries] = useState<Array<{ repoRelativePath: string; entry: Record<string, unknown> }> | null>(null);
  const [error, setError] = useState('');
  const [url, setUrl] = useState('');
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState('');

  useEffect(() => {
    api.catalog().then((r) => setEntries(r.entries)).catch((e) => setError((e as Error).message));
  }, []);

  const saveFavorite = async () => {
    setSaving(true);
    setSaved('');
    try {
      const id = name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '') || 'favorite';
      const yaml = [
        'apiVersion: aitp.dev/v1alpha1',
        'kind: Skill',
        'metadata:',
        `  id: ${id}`,
        `  displayName: ${name || id}`,
        '  shortDescription: ""',
        '  tags: []',
        'spec:',
        `  source:`,
        `    type: url`,
        `    url: ${url}`,
        '  contentPolicy: metadata-only',
        '',
      ].join('\n');
      const draft = await api.createDraft([{ repoRelativePath: `catalog/skills/${id}.yaml`, operation: 'create', content: yaml }], '收藏未安装条目');
      const cs = await api.getChangeSet(draft.changeSetId);
      const ok = window.confirm(`将创建以下文件：\n${cs.changes.map((c) => c.repoRelativePath).join('\n')}\n确认应用？`);
      if (ok) {
        await api.applyChangeSet(draft.changeSetId, draft.applyToken);
        setSaved(`已保存 catalog/skills/${id}.yaml（catalog-only，来源未验证）。请在 Git 中审阅 diff。`);
        const r = await api.catalog();
        setEntries(r.entries);
      } else {
        setSaved('已取消。未写入任何文件。');
      }
    } catch (e) {
      setSaved(`保存失败：${(e as Error).message}`);
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
      {saved && (
        <p role="status" aria-live="polite">
          {saved}
        </p>
      )}
    </section>
  );
}

function Rules({ inventory }: { inventory: InventoryResponse | null }) {
  if (!inventory) return <Loading />;
  const docs = inventory.observations.filter((o) => o.kind === 'rule-document');
  return (
    <section aria-labelledby="rules-h">
      <h2 id="rules-h">规则</h2>
      {docs.length === 0 ? (
        <p className="empty">未发现规则文档。扫描后此处显示 CLAUDE.md / AGENTS.md 及模块规则。</p>
      ) : (
        <ul>
          {docs.map((o) => (
            <RuleDocItem key={o.observationId} o={o} />
          ))}
        </ul>
      )}
    </section>
  );
}

/** RULE-005: save selected lines as a Catalog Rule Fragment via ChangeSet. */
function RuleDocItem({ o }: { o: Observation }) {
  const chain = (o.summary.chain as Array<{ dir: string; document: string }> | undefined) ?? [];
  const [open, setOpen] = useState(false);
  const [lines, setLines] = useState<Array<{ n: number; text: string }> | null>(null);
  const [start, setStart] = useState('1');
  const [end, setEnd] = useState('1');
  const [categories, setCategories] = useState('workflow');
  const [message, setMessage] = useState('');

  const loadContent = async () => {
    setMessage('');
    try {
      const content = await api.ruleContent(o.observationId);
      setLines(content.lines);
      setEnd(String(Math.min(3, content.lines.length)));
    } catch (e) {
      setMessage(`读取失败：${(e as Error).message}`);
    }
  };

  const saveFragment = async () => {
    setMessage('');
    const s = parseInt(start, 10);
    const e = parseInt(end, 10);
    const selected = (lines ?? []).filter((l) => l.n >= s && l.n <= e);
    if (selected.length === 0) {
      setMessage('行区间无效。');
      return;
    }
    const cats = categories.split(/[,，\s]+/).filter(Boolean).map((c) => c.toLowerCase());
    const id = `${o.canonicalName.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-l${s}-${e}`.replace(/^-+|-+$/g, '') || 'rule-fragment';
    const fm = [
      'apiVersion: aitp.dev/v1alpha1',
      'kind: RuleFragment',
      `id: ${id}`,
      `displayName: ${o.canonicalName} lines ${s}-${e}`,
      'targets:',
      '  - claude-code',
      '  - codex',
      'categories:',
      ...cats.map((c) => `  - ${c}`),
      'source:',
      `  document: ${o.canonicalName}`,
      `  lines: ${s}-${e}`,
      'fieldOrigins:',
      '  categories: human',
    ].join('\n');
    const body = selected.map((l) => l.text).join('\n');
    const md = `---\n${fm}\n---\n\n${body}\n`;
    try {
      const draft = await api.createDraft(
        [{ repoRelativePath: `catalog/rule-fragments/${id}.md`, operation: 'create', content: md }],
        '保存规则片段',
      );
      const cs = await api.getChangeSet(draft.changeSetId);
      const ok = window.confirm(`将创建 catalog/rule-fragments/${id}.md\n\n${cs.changes[0]?.unifiedDiff.slice(0, 600)}\n\n确认写入？`);
      if (!ok) {
        setMessage('已取消。未写入任何文件。');
        return;
      }
      await api.applyChangeSet(draft.changeSetId, draft.applyToken);
      setMessage(`已保存规则片段 ${id}.md。原规则文件未变化。`);
    } catch (err) {
      setMessage(`保存失败：${(err as Error).message}`);
    }
  };

  return (
    <li>
      <strong>{o.canonicalName}</strong> — <code>{o.location.pathToken}</code>
      {typeof o.summary.loadedInContext === 'boolean' && (
        <span className="badge"> {o.summary.loadedInContext ? '本次上下文加载' : '文件存在但未加载'}</span>
      )}
      {chain.length > 0 && <span> 加载链：{chain.length} 层</span>}
      <button onClick={() => { void (open ? setOpen(false) : loadContent().then(() => setOpen(true))); }} aria-expanded={open}>
        保存片段
      </button>
      {message && (
        <p role="status" aria-live="polite">
          {message}
        </p>
      )}
      {open && lines && (
        <div className="fragment-form">
          <pre className="lines">{lines.map((l) => `${String(l.n).padStart(4)} | ${l.text}`).join('\n')}</pre>
          <label>
            起始行 <input value={start} onChange={(e2) => setStart(e2.target.value)} />
          </label>
          <label>
            结束行 <input value={end} onChange={(e2) => setEnd(e2.target.value)} />
          </label>
          <label>
            分类 <input value={categories} onChange={(e2) => setCategories(e2.target.value)} />
          </label>
          <button onClick={() => void saveFragment()}>预览并保存片段</button>
        </div>
      )}
    </li>
  );
}

function Changes() {
  const [summary, setSummary] = useState<{ branch: string; changedFiles: Array<{ status: string; path: string }> } | null>(null);
  useEffect(() => {
    api.gitSummary().then(setSummary).catch(() => setSummary({ branch: '', changedFiles: [] }));
  }, []);
  if (!summary) return <Loading />;
  return (
    <section aria-labelledby="ch-h">
      <h2 id="ch-h">变更</h2>
      <p>分支：{summary.branch || '（无）'}</p>
      {summary.changedFiles.length === 0 ? (
        <p className="empty">工作树无变更。面板只展示文件，commit/push 需要你自己执行（GIT-004）。</p>
      ) : (
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
      )}
    </section>
  );
}

function Settings({ health }: { health: Health | null }) {
  return (
    <section aria-labelledby="set-h">
      <h2 id="set-h">设置与来源</h2>
      <ul>
        <li>Git 可用：{health?.gitAvailable ? '是' : '否'}</li>
        <li>仓库状态：{health?.repo}</li>
        <li>AI 校准：默认关闭（未配置 Provider 时禁用）</li>
        <li>服务仅绑定本机 loopback 地址</li>
      </ul>
      <h3>sources.lock</h3>
      <p className="empty">锁文件由确定性 resolver 更新；AI 不写锁文件。</p>
    </section>
  );
}
