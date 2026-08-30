import { t } from '../i18n';
import { Loading, StatCard, useInventory } from './InstalledPage';

export function OverviewPage({ health, inventoryKey, connection }: { health: Health | null; inventoryKey: number; connection: string }): React.JSX.Element {
  const { inventory } = useInventory(inventoryKey);
  return (
    <section aria-labelledby="ov-h">
      <h2 id="ov-h">{t('overview.heading')}</h2>
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
            <StatCard label={t('overview.providers')} value={health ? Object.keys(health.providers).join(' / ') : '—'} />
            <StatCard label={t('overview.assets')} value={String(inventory.observations.length)} />
            <StatCard label={t('overview.diagnostics')} value={String(inventory.diagnostics.length)} />
          </div>
          {inventory.runId === null && (
            <p role="status" className="empty" aria-live="polite">
              {t('scan.never')}
            </p>
          )}
          <h3>{t('overview.statusDist')}</h3>
          <ul className="counts">
            {Object.entries(inventory.reconcile.counts).map(([k, v]) => (
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
        </>
      )}
    </section>
  );
}
