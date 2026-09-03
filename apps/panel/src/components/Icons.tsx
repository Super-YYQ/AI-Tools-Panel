/** Inline SVG icon set (§A.5): 16×16 line art, stroke=currentColor, no icon
 * library dependency. Octicons-flavoured shapes drawn by hand so the panel
 * stays offline-first under the local CSP (script-src 'self'). */

export type IconName =
  | 'overview'
  | 'installed'
  | 'catalog'
  | 'rules'
  | 'changes'
  | 'settings'
  | 'scan'
  | 'alert'
  | 'inbox'
  | 'repo'
  | 'pulse'
  | 'skill'
  | 'plugin'
  | 'marketplace'
  | 'hook'
  | 'rule-document';

const fileLines = (
  <>
    <path d="M9.5 1.8 H4.5 a1 1 0 0 0 -1 1 v10.4 a1 1 0 0 0 1 1 h7 a1 1 0 0 0 1 -1 V4.8 Z" />
    <path d="M9.5 1.8 V4.8 H12.5" />
    <path d="M5.8 8.3 H10.2" />
    <path d="M5.8 10.8 H10.2" />
  </>
);

const ICONS: Record<IconName, React.JSX.Element> = {
  overview: (
    <>
      <rect x="2" y="2" width="5" height="5" rx="1" />
      <rect x="9" y="2" width="5" height="5" rx="1" />
      <rect x="2" y="9" width="5" height="5" rx="1" />
      <rect x="9" y="9" width="5" height="5" rx="1" />
    </>
  ),
  installed: (
    <>
      <path d="M8 1.8 L13.8 4.7 V11.3 L8 14.2 L2.2 11.3 V4.7 Z" />
      <path d="M2.2 4.7 L8 7.6 L13.8 4.7" />
      <path d="M8 7.6 V14.2" />
      <path d="M5.1 3.25 L10.9 6.15" />
    </>
  ),
  catalog: (
    <>
      <path d="M8 3.6 C6.9 2.7 5.3 2.3 3.2 2.3 V12.6 C5.3 12.6 6.9 13 8 13.9 C9.1 13 10.7 12.6 12.8 12.6 V2.3 C10.7 2.3 9.1 2.7 8 3.6 Z" />
      <path d="M8 3.6 V13.9" />
    </>
  ),
  rules: fileLines,
  'rule-document': fileLines,
  changes: (
    <>
      <circle cx="3.5" cy="3.5" r="1.75" />
      <circle cx="12.5" cy="12.5" r="1.75" />
      <path d="M3.5 5.25 V9 A2.25 2.25 0 0 0 5.75 11.25 H9.9" />
      <path d="M8.4 9.75 L10.15 11.25 L8.4 12.75" />
      <path d="M12.5 10.75 V7 A2.25 2.25 0 0 0 10.25 4.75 H6.1" />
      <path d="M7.6 3.25 L5.85 4.75 L7.6 6.25" />
    </>
  ),
  settings: (
    <>
      <circle cx="8" cy="8" r="2.1" />
      <circle cx="8" cy="8" r="4.5" />
      <path d="M12.5 8 H14.3" />
      <path d="M8 12.5 V14.3" />
      <path d="M3.5 8 H1.7" />
      <path d="M8 3.5 V1.7" />
      <path d="M11.18 11.18 L12.45 12.45" />
      <path d="M4.82 11.18 L3.55 12.45" />
      <path d="M3.55 3.55 L4.82 4.82" />
      <path d="M12.45 3.55 L11.18 4.82" />
    </>
  ),
  scan: (
    <>
      <circle cx="7" cy="7" r="4.4" />
      <path d="M10.2 10.2 L14 14" />
    </>
  ),
  alert: (
    <>
      <path d="M7.0 2.6 a1.15 1.15 0 0 1 2 0 l5.1 8.9 a1.15 1.15 0 0 1 -1 1.73 H2.9 a1.15 1.15 0 0 1 -1 -1.73 Z" />
      <path d="M8 6.4 V9.3" />
      <path d="M8 11.75 h0.01" />
    </>
  ),
  inbox: (
    <>
      <path d="M3.8 3 H12.2 A1.3 1.3 0 0 1 13.5 4.3 V11.7 A1.3 1.3 0 0 1 12.2 13 H3.8 A1.3 1.3 0 0 1 2.5 11.7 V4.3 A1.3 1.3 0 0 1 3.8 3 Z" />
      <path d="M2.5 9.2 H5.6 L6.7 11 H9.3 L10.4 9.2 H13.5" />
    </>
  ),
  repo: (
    <>
      <circle cx="4" cy="3.7" r="1.7" />
      <circle cx="4" cy="12.3" r="1.7" />
      <circle cx="12" cy="3.7" r="1.7" />
      <path d="M4 5.4 V10.6" />
      <path d="M12 5.4 V6.6 A2 2 0 0 1 10 8.6 H6.2" />
    </>
  ),
  pulse: <path d="M1.8 8 H4.6 L6.3 3.9 L9.7 12.1 L11.4 8 H14.2" />,
  skill: <path d="M8.9 1.8 L3.8 8.6 H7.4 L7.1 14.2 L12.2 7.4 H8.6 Z" />,
  plugin: (
    <path d="M3 12.8 V5.4 A1 1 0 0 1 4 4.4 H6.3 A1.45 1.45 0 1 1 8.7 4.4 H11 A1 1 0 0 1 12 5.4 V7.4 A1.45 1.45 0 1 0 12 9.8 V11.8 A1 1 0 0 1 11 12.8 Z" />
  ),
  marketplace: (
    <>
      <path d="M8.6 2.5 H3.5 A1 1 0 0 0 2.5 3.5 V8.6 A1.4 1.4 0 0 0 2.94 9.6 L7.4 14.06 A1.4 1.4 0 0 0 9.42 14.06 L14.06 9.42 A1.4 1.4 0 0 0 14.06 7.4 L9.6 2.94 A1.4 1.4 0 0 0 8.6 2.5 Z" />
      <circle cx="5.7" cy="5.7" r="1.05" />
    </>
  ),
  hook: (
    <>
      <circle cx="8" cy="4.1" r="1.8" />
      <path d="M8 5.9 V14.2" />
      <path d="M3.2 9.4 A4.9 4.9 0 0 0 12.8 9.4" />
      <path d="M5.8 7.3 H10.2" />
    </>
  ),
};

export function Icon({ name, size = 16, className }: { name: IconName; size?: number; className?: string }): React.JSX.Element {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {ICONS[name]}
    </svg>
  );
}

/** Kind badges reuse the icon of the same name; unknown kinds fall back to the package glyph. */
export function kindIcon(kind: string): IconName {
  return (Object.keys(ICONS) as IconName[]).includes(kind as IconName) ? (kind as IconName) : 'installed';
}
