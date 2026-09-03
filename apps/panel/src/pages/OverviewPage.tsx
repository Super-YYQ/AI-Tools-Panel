import { t } from '../i18n';
import { type Health } from '../api';
import { EmptyState, Loading, StatCard, useInventory } from './InstalledPage';

export function OverviewPage({ health, inventoryKey, connection }: { health: Health | null; inventoryKey: number; connection: string }): React.JSX.Element {
  const { inventory } = useInventory(inventoryKey);
  return (
    <section aria-labelledby="ov-h">
      <div className="page-head">
        <h2 id="ov-h">{t('overview.heading')}</h2>
        <p className="page-desc">{t('overview.desc')}</p>
      </div>
      {connection === 'offline' && (
        <p role="alert" className="error">
          {t('offline.banner', { message: '' })}
        </p>
      )}
      {!inventory ? (
        <Loading />
      ) : (
        <>
          <div className="grid">
            <StatCard icon="repo" label={t('overview.providers')} value={health ? Object.keys(health.providers).join(' / ') : '—'} />
            <StatCard icon="installed" label={t('overview.assets')} value={String(inventory.observations.length)} />
            <StatCard icon="alert" label={t('overview.diagnostics')} value={String(inventory.diagnostics.length)} />
          </div>
          {inventory.runId === null && (
            <EmptyState icon="scan" live>
              {t('scan.never')}
            </EmptyState>
          )}
          <h3>{t('overview.statusDist')}</h3>
          <ul className="counts">
            {Object.entries(inventory.reconcile.counts).map(([k, v]) => (
              <li key={k} className={`count-chip st-${k}`}>
                <span className="count-key">{k}</span>
                <span className="count-num">{v}</span>
              </li>
            ))}
          </ul>
          {inventory.diagnostics.length > 0 && (
            <>
              <h3>{t('overview.diagnostics')}</h3>
              <ul className="diagnostics">
                {inventory.diagnostics.slice(0, 20).map((d, i) => (
                  <li key={i} className={d.severity}>
                    <code>{d.code}</code> {d.message}
                  </li>
                ))}
              </ul>
            </>
          )}
        </>
      )}
    </section>
  );
}
