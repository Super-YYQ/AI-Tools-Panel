import { useCallback, useEffect, useRef, useState } from 'react';
import { api, type Health, type ChangeSummary } from './api';
import { t } from './i18n';
import { OverviewPage } from './pages/OverviewPage';
import { InstalledPage } from './pages/InstalledPage';
import { CatalogPage } from './pages/CatalogPage';
import { RulesPage } from './pages/RulesPage';
import { ChangesPage } from './pages/ChangesPage';
import { SettingsPage } from './pages/SettingsPage';
import { ChangeReview } from './components/ChangeReview';

type Page = 'overview' | 'installed' | 'catalog' | 'rules' | 'changes' | 'settings';
type ConnectionState = 'connecting' | 'online' | 'offline';

const PAGES: Array<[Page, string]> = [
  ['overview', t('nav.overview')],
  ['installed', t('nav.installed')],
  ['catalog', t('nav.catalog')],
  ['rules', t('nav.rules')],
  ['changes', t('nav.changes')],
  ['settings', t('nav.settings')],
];

function validPage(hash: string): Page {
  const candidate = hash.replace('#', '');
  return PAGES.some(([p]) => p === candidate) ? (candidate as Page) : 'overview';
}

export interface ReviewRequest {
  summary: ChangeSummary;
  onApplied: (message: string) => void;
}

export function App() {
  const [page, setPage] = useState<Page>(() => validPage(window.location.hash));
  const [health, setHealth] = useState<Health | null>(null);
  const [inventoryKey, setInventoryKey] = useState(0);
  const [connection, setConnection] = useState<ConnectionState>('connecting');
  const [loadError, setLoadError] = useState<string | null>(null);
  const [scanBusy, setScanBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [review, setReview] = useState<ReviewRequest | null>(null);
  const currentScanId = useRef<string | null>(null);

  const refresh = useCallback(async () => {
    setConnection('connecting');
    try {
      const h = await api.health();
      setHealth(h);
      setLoadError(null);
      setConnection('online');
      setInventoryKey((k) => k + 1);
    } catch (e) {
      setLoadError((e as Error).message);
      setConnection('offline');
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    // FUN-001: keep the URL hash in sync with the page only.
    window.location.hash = page;
  }, [page]);

  /** FUN-002: scan via SSE streaming instead of 300ms polling. */
  const startScan = async () => {
    setScanBusy(true);
    setStatus('');
    try {
      const { scanId } = await api.startScan();
      currentScanId.current = scanId;
      api.streamScanEvents(
        scanId,
        (event, data) => {
          if (event === 'done' && data) {
            const d = data as { status?: string; counts?: { added: number; changed: number; missing: number; total: number } };
            const label = d.status === 'completed' ? '完成' : d.status === 'partial' ? '部分完成' : d.status === 'cancelled' ? '已取消' : '失败';
            if (d.counts) {
              setStatus(`扫描${label}：发现 ${d.counts.total} 项（新增 ${d.counts.added}，变化 ${d.counts.changed}，消失 ${d.counts.missing}）`);
            } else {
              setStatus(`扫描${label}`);
            }
          }
        },
        async () => {
          setScanBusy(false);
          currentScanId.current = null;
          await refresh();
        },
      );
    } catch (e) {
      setStatus(`扫描失败：${(e as Error).message}`);
      setScanBusy(false);
    }
  };

  /** FUN-003: user-facing cancellation during a running scan. */
  const cancelScan = async () => {
    const scanId = currentScanId.current;
    if (!scanId) return;
    try {
      setStatus(t('scan.cancelling'));
      await api.cancelScan(scanId);
    } catch (e) {
      setStatus(`取消失败：${(e as Error).message}`);
    }
  };

  return (
    <div className="app">
      <header role="banner" className="topbar">
        <h1>{t('app.title')}</h1>
        <span className="repo">{connection === 'online' ? (health?.repo === 'ok' ? t('repo.recognized') : t('repo.notGit')) : t('repo.connecting')}</span>
        <button onClick={startScan} disabled={scanBusy || connection !== 'online'} className="primary">
          {scanBusy ? t('scan.running') : t('scan.start')}
        </button>
        {scanBusy && <button onClick={cancelScan}>{t('scan.cancel')}</button>}
        <span role="status" aria-live="polite" className="status">
          {status}
        </span>
      </header>
      {/* P2-UI-06: explicit offline/error state with retry. */}
      {connection === 'offline' && (
        <div role="alert" className="banner error">
          {t('offline.banner', { message: loadError ?? '' })} <button onClick={() => void refresh()}>{t('common.retry')}</button>
        </div>
      )}
      {/* APP-002: actionable diagnosis when the working directory is not a Git repo. */}
      {connection === 'online' && health && health.repo !== 'ok' && (
        <div role="alert" className="banner error">
          <strong>{t('repo.notGit.title')}</strong>
          <p>{t('repo.notGit.diagnosis')}</p>
          <p>{t('repo.notGit.fix')}</p>
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
        {review ? (
          <ChangeReview
            summary={review.summary}
            onApplied={(message) => {
              setReview(null);
              setStatus(message);
              void refresh();
            }}
            onCancelled={() => {
              setReview(null);
              setStatus('已取消。未写入任何文件。');
            }}
          />
        ) : (
          <>
            {page === 'overview' && <OverviewPage health={health} inventoryKey={inventoryKey} connection={connection} />}
            {page === 'installed' && <InstalledPage inventoryKey={inventoryKey} requestReview={setReview} />}
            {page === 'catalog' && <CatalogPage requestReview={setReview} />}
            {page === 'rules' && <RulesPage inventoryKey={inventoryKey} requestReview={setReview} />}
            {page === 'changes' && <ChangesPage />}
            {page === 'settings' && <SettingsPage health={health} />}
          </>
        )}
      </main>
    </div>
  );
}
