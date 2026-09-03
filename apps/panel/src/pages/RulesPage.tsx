import { useEffect, useState } from 'react';
import { api, type Observation, type ChangeSummary } from '../api';
import { t } from '../i18n';
import { Icon } from '../components/Icons';
import { EmptyState, Loading } from './InstalledPage';

export function RulesPage({ inventoryKey, requestReview }: { inventoryKey: number; requestReview: (r: { summary: ChangeSummary; onApplied: (m: string) => void }) => void }): React.JSX.Element {
  const [inventory, setInventory] = useState<{ observations: Observation[] } | null>(null);
  const [loadError, setLoadError] = useState('');

  useEffect(() => {
    api
      .inventory()
      .then((inv) => setInventory({ observations: inv.observations }))
      .catch((e) => setLoadError((e as Error).message));
  }, [inventoryKey]);

  return (
    <section aria-labelledby="rules-h">
      <div className="page-head">
        <h2 id="rules-h">{t('nav.rules')}</h2>
        <p className="page-desc">{t('rules.desc')}</p>
      </div>
      {loadError && (
        <p role="alert" className="error">
          {loadError}
        </p>
      )}
      {!inventory && !loadError && <Loading />}
      {inventory && inventory.observations.filter((o) => o.kind === 'rule-document').length === 0 && (
        <EmptyState icon="rules">{t('rules.empty')}</EmptyState>
      )}
      {inventory && (
        <ul className="rule-list">
          {inventory.observations
            .filter((o) => o.kind === 'rule-document')
            .map((o) => (
              <RuleDocItem key={o.observationId} o={o} requestReview={requestReview} />
            ))}
        </ul>
      )}
    </section>
  );
}

/** RULE-005: save selected lines as a Catalog Rule Fragment via ChangeSet. */
function RuleDocItem({ o, requestReview }: { o: Observation; requestReview: (r: { summary: ChangeSummary; onApplied: (m: string) => void }) => void }): React.JSX.Element {
  const chain = (o.summary.chain as Array<{ dirToken: string; selected: string | null; excluded: string[] }> | undefined) ?? [];
  const [open, setOpen] = useState(false);
  const [lines, setLines] = useState<Array<{ n: number; text: string }> | null>(null);
  const [start, setStart] = useState('1');
  const [end, setEnd] = useState('1');
  const [categories, setCategories] = useState('workflow');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  const loadContent = async () => {
    setMessage('');
    try {
      const content = await api.ruleContent(o.observationId);
      setLines(content.lines);
      setEnd(String(Math.min(3, content.lines.length)));
    } catch (e) {
      setMessage(t('rules.readFailed', { message: (e as Error).message }));
    }
  };

  const saveFragment = async () => {
    setBusy(true);
    setMessage('');
    const s = parseInt(start, 10);
    const e = parseInt(end, 10);
    const selected = (lines ?? []).filter((l) => l.n >= s && l.n <= e);
    if (selected.length === 0) {
      setMessage(t('rules.invalidRange'));
      setBusy(false);
      return;
    }
    const id = `${o.canonicalName.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-l${s}-${e}`.replace(/^-+|-+$/g, '') || 'rule-fragment';
    try {
      // FUN-008: typed fragment DTO; server builds the Markdown frontmatter.
      const summary = await api.createTypedDraft({
        reason: t('draft.reasonFragment'),
        entries: [],
        fragments: [
          {
            id,
            displayName: `${o.canonicalName} lines ${s}-${e}`,
            targets: ['claude-code', 'codex'],
            categories: categories.split(/[,，\s]+/).filter(Boolean).map((c) => c.toLowerCase()),
            source: { document: o.canonicalName, lines: `${s}-${e}` },
            body: selected.map((l) => l.text).join('\n'),
          },
        ],
      });
      requestReview({ summary, onApplied: (m) => setMessage(m.replace('已保存', '已保存规则片段')) });
      setOpen(false);
    } catch (err) {
      setMessage(t('common.saveFailed', { message: (err as Error).message }));
    } finally {
      setBusy(false);
    }
  };

  return (
    <li className="rule-item">
      <div className="rule-head">
        <span className="kind-icon kind-rule-document">
          <Icon name="rule-document" />
        </span>
        <strong>{o.canonicalName}</strong>
        <code className="rule-path">{o.location.pathToken}</code>
        {typeof o.summary.loadedInContext === 'boolean' && <span className="badge">{o.summary.loadedInContext ? t('rules.loaded') : t('rules.notLoaded')}</span>}
        {chain.length > 0 && <span className="rule-chain">{t('rules.chainLayers', { n: chain.filter((c) => c.selected).length })}</span>}
        <span className="rule-actions">
          <button
            onClick={() => {
              void (open ? setOpen(false) : loadContent().then(() => setOpen(true)));
            }}
            aria-expanded={open}
          >
            {t('rules.saveFragment')}
          </button>
        </span>
      </div>
      {message && (
        <p role="status" aria-live="polite">
          {message}
        </p>
      )}
      {open && lines && (
        <div className="fragment-form">
          <pre className="lines">{lines.map((l) => `${String(l.n).padStart(4)} | ${l.text}`).join('\n')}</pre>
          <label>
            {t('rules.startLine')} <input value={start} onChange={(e2) => setStart(e2.target.value)} />
          </label>
          <label>
            {t('rules.endLine')} <input value={end} onChange={(e2) => setEnd(e2.target.value)} />
          </label>
          <label>
            {t('rules.categories')} <input value={categories} onChange={(e2) => setCategories(e2.target.value)} />
          </label>
          <button onClick={() => void saveFragment()} disabled={busy}>
            {busy ? t('common.generating') : t('rules.previewSaveFragment')}
          </button>
        </div>
      )}
    </li>
  );
}
