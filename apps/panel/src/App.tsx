import { useCallback, useEffect, useRef, useState } from 'react';
import { api, type Health, type ChangeSummary } from './api';
import { t } from './i18n';
import { Icon, type IconName } from './components/Icons';
import { OverviewPage } from './pages/OverviewPage';
import { InstalledPage } from './pages/InstalledPage';
import { CatalogPage } from './pages/CatalogPage';
import { RulesPage } from './pages/RulesPage';
import { ChangesPage } from './pages/ChangesPage';
import { SettingsPage } from './pages/SettingsPage';
import { ChangeReview } from './components/ChangeReview';

type Page = 'overview' | 'installed' | 'catalog' | 'rules' | 'changes' | 'settings';
type ConnectionState = 'connecting' | 'online' | 'offline';

const PAGES: Array<[Page, string, IconName]> = [
  ['overview', t('nav.overview'), 'overview'],
  ['installed', t('nav.installed'), 'installed'],
  ['catalog', t('nav.catalog'), 'catalog'],
  ['rules', t('nav.rules'), 'rules'],
  ['changes', t('nav.changes'), 'changes'],
  ['settings', t('nav.settings'), 'settings'],
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
            const label =
              d.status === 'completed'
                ? t('scan.result.completed')
                : d.status === 'partial'
                  ? t('scan.result.partial')
                  : d.status === 'cancelled'
                    ? t('scan.result.cancelled')
                    : t('scan.result.failed');
            if (d.counts) {
              setStatus(t('scan.result.counts', { label, total: d.counts.total, added: d.counts.added, changed: d.counts.changed, missing: d.counts.missing }));
            } else {
              setStatus(t('scan.result.plain', { label }));
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
      setStatus(t('scan.failed', { message: (e as Error).message }));
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
      setStatus(t('scan.cancelFailed', { message: (e as Error).message }));
    }
  };

  const repoLabel = connection === 'online' ? (health?.repo === 'ok' ? t('repo.recognized') : t('repo.notGit')) : t('repo.connecting');
  const connLabel = connection === 'online' ? t('conn.online') : connection === 'offline' ? t('conn.offline') : t('repo.connecting');
  const currentPage = PAGES.find(([id]) => id === page);

  return (
    <div className="app">
      {/* DOM order matters for the keyboard contract (E2E-07 walks Tab from the
      scan button): header → main → nav. CSS grid areas keep the sidebar
      visually on the left. */}
      <div className="content">
        <header role="banner" className="topbar">
          <span className="topbar-page">{currentPage?.[1]}</span>
          <span role="status" aria-live="polite" className="status">
            {status}
          </span>
          <div className="topbar-actions">
            <button onClick={startScan} disabled={scanBusy || connection !== 'online'} className="primary">
              <Icon name="scan" className="btn-icon" />
              {scanBusy ? t('scan.running') : t('scan.start')}
            </button>
            {scanBusy && <button onClick={cancelScan}>{t('scan.cancel')}</button>}
          </div>
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
                setStatus(t('app.cancelled'));
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
      <aside className="sidebar">
        <div className="brand">
          <h1>{t('app.title')}</h1>
          <p className="brand-sub">{t('app.subtitle')}</p>
        </div>
        <nav aria-label="主导航" className="nav">
          {PAGES.map(([id, label, icon]) => (
            <button key={id} aria-current={page === id ? 'page' : undefined} onClick={() => setPage(id)}>
              <Icon name={icon} className="nav-icon" />
              <span>{label}</span>
            </button>
          ))}
        </nav>
        <footer className="sidebar-foot">
          <div className="side-row">
            <Icon name="repo" className="side-icon" />
            <span className="side-label">{t('side.repo')}</span>
            <span className={`side-badge${connection === 'online' && health?.repo === 'ok' ? ' side-badge-ok' : ''}`}>{repoLabel}</span>
          </div>
          <div className="side-row">
            <Icon name="pulse" className="side-icon" />
            <span className="side-label">{t('side.connection')}</span>
            <span className={`side-badge${connection === 'online' ? ' side-badge-ok' : connection === 'offline' ? ' side-badge-bad' : ''}`}>{connLabel}</span>
          </div>
        </footer>
      </aside>
    </div>
  );
}
