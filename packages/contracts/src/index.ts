/**
 * @aitp/contracts — shared domain types, Zod schemas and error codes.
 * ARCHITECTURE.md §5 domain model; SCANNING_SPEC.md §10 diagnostic codes.
 */
import { z } from 'zod';

export const API_VERSION = 'aitp.dev/v1alpha1';
export const API_VERSIONS = [API_VERSION] as const;

export type Provider = 'claude-code' | 'codex';
export type ArtifactKind =
  | 'skill'
  | 'plugin'
  | 'marketplace'
  | 'hook'
  | 'rule-document'
  | 'rule-fragment';
export type Scope = 'user' | 'repo' | 'local' | 'managed' | 'system' | 'plugin';
export type CopyRole = 'source' | 'install' | 'cache' | 'declared' | 'unknown';

export const PROVIDERS: readonly Provider[] = ['claude-code', 'codex'];
export const ARTIFACT_KINDS: readonly ArtifactKind[] = [
  'skill',
  'plugin',
  'marketplace',
  'hook',
  'rule-document',
  'rule-fragment',
];

/** SCANNING_SPEC §10 — stable diagnostic codes. */
export const DiagnosticCode = z.enum([
  'PROVIDER_NOT_INSTALLED',
  'ROOT_NOT_FOUND',
  'ACCESS_DENIED',
  'FILE_TOO_LARGE',
  'INVALID_FRONTMATTER',
  'INVALID_MANIFEST',
  'UNSUPPORTED_VERSION',
  'SYMLINK_OUTSIDE_ROOT',
  'IMPORT_CYCLE',
  'SECRET_REDACTED',
  'PARTIAL_SCAN',
  'PATH_OUTSIDE_ROOT',
  'INTERNAL_ERROR',
]);
export type DiagnosticCodeValue = z.infer<typeof DiagnosticCode>;

export const Evidence = z.object({
  type: z.enum(['installer-metadata', 'manifest', 'git-worktree', 'manual', 'name-match', 'content-match', 'cli-metadata', 'unknown']),
  /** Descriptive origin; never a raw machine absolute path in persisted records. */
  origin: z.string(),
  detail: z.string().optional(),
});
export type EvidenceValue = z.infer<typeof Evidence>;

export const LocalPathRef = z.object({
  /** Repo-relative path or stable path token for user-level locations. */
  pathToken: z.string(),
  scope: z.enum(['user', 'repo', 'local', 'managed', 'system', 'plugin']),
  linkType: z.enum(['none', 'symlink', 'junction']).default('none'),
  resolvedOutsideRoot: z.boolean().default(false),
});
export type LocalPathRefValue = z.infer<typeof LocalPathRef>;

export const ParserInfo = z.object({
  name: z.string(),
  version: z.string(),
});
export type ParserInfoValue = z.infer<typeof ParserInfo>;

/** ARCHITECTURE §5 Observation — one machine fact. */
export const SourceIdentity = z.object({
  type: z.enum(['git', 'marketplace', 'local-authored', 'unknown']),
  canonicalUrl: z.string().optional(),
  marketplaceId: z.string().optional(),
  packageId: z.string().optional(),
  revision: z.string().optional(),
});
export type SourceIdentityValue = z.infer<typeof SourceIdentity>;

export const Observation = z.object({
  observationId: z.string(),
  artifactId: z.string(),
  provider: z.enum(['claude-code', 'codex']),
  kind: z.enum(['skill', 'plugin', 'marketplace', 'hook', 'rule-document', 'rule-fragment']),
  scope: z.enum(['user', 'repo', 'local', 'managed', 'system', 'plugin']),
  canonicalName: z.string(),
  displayName: z.string().optional(),
  sourceIdentity: SourceIdentity.default({ type: 'unknown' }),
  location: LocalPathRef,
  copyRole: z.enum(['source', 'install', 'cache', 'declared', 'unknown']).default('unknown'),
  enabled: z.boolean().or(z.literal('unknown')).default('unknown'),
  contentHash: z.string(),
  summary: z.record(z.unknown()).default({}),
  sourceEvidence: z.array(Evidence).default([]),
  related: z
    .array(z.object({ type: z.enum(['contains', 'imports', 'duplicate-of', 'duplicate-content']), targetId: z.string() }))
    .default([]),
  discoveredAt: z.string(),
  parser: ParserInfo,
});
export type ObservationValue = z.infer<typeof Observation>;

/** ARCHITECTURE §5 — stable identity for a logical artifact. */
export interface ArtifactIdentity {
  id: string;
  kind: ArtifactKind;
  canonicalName: string;
  provisional: boolean;
}

export const Diagnostic = z.object({
  code: DiagnosticCode,
  severity: z.enum(['info', 'warning', 'error']),
  provider: z.string().optional(),
  target: z.string().optional(),
  message: z.string(),
  recovery: z.string().optional(),
  runId: z.string().optional(),
});
export type DiagnosticValue = z.infer<typeof Diagnostic>;

export const ScanRunStatus = z.enum(['pending', 'running', 'completed', 'partial', 'failed', 'cancelled']);
export type ScanRunStatusValue = z.infer<typeof ScanRunStatus>;

export interface ScanRun {
  runId: string;
  status: ScanRunStatusValue;
  startedAt: string;
  finishedAt?: string;
  providers: Provider[];
  counts: { added: number; changed: number; missing: number; total: number };
  diagnosticCounts: Record<string, number>;
}

export const SourceRef = z.discriminatedUnion('type', [
  z.object({ type: z.literal('git'), url: z.string(), revision: z.string().optional(), subdirectory: z.string().optional() }),
  z.object({ type: z.literal('marketplace'), marketplaceId: z.string(), packageId: z.string(), revision: z.string().optional() }),
  z.object({ type: z.literal('url'), url: z.string() }),
  z.object({ type: z.literal('local-authored'), repositoryRelativePath: z.string().optional() }),
  z.object({ type: z.literal('unknown') }),
]);
export type SourceRefValue = z.infer<typeof SourceRef>;

/** ARCHITECTURE §5 ChangeSet — reviewed repository writes (create|update|archive only). */
export const FileChange = z.object({
  operation: z.enum(['create', 'update', 'archive']),
  repoRelativePath: z.string(),
  expectedOldHash: z.string().optional(),
  newHash: z.string(),
  unifiedDiff: z.string(),
  content: z.string().optional(),
});
export type FileChangeValue = z.infer<typeof FileChange>;

export const ChangeSet = z.object({
  changeSetId: z.string(),
  createdAt: z.string(),
  reason: z.string(),
  changes: z.array(FileChange),
  status: z.enum(['draft', 'applied', 'failed', 'superseded']).default('draft'),
  applyToken: z.string().optional(),
});
export type ChangeSetValue = z.infer<typeof ChangeSet>;

/** ARCHITECTURE §5 AnalysisProposal — optional, never inventory. */
export const AnalysisProposal = z.object({
  proposalId: z.string(),
  artifactId: z.string(),
  task: z.string(),
  claims: z.array(
    z.object({
      field: z.string(),
      value: z.unknown(),
      confidence: z.number().min(0).max(1),
      evidence: z.array(Evidence),
    }),
  ),
  provider: z.string(),
  model: z.string().optional(),
  createdAt: z.string(),
  inputDigest: z.string(),
  status: z.enum(['pending', 'accepted', 'rejected', 'superseded']).default('pending'),
});
export type AnalysisProposalValue = z.infer<typeof AnalysisProposal>;

/** CATALOG_SPEC §3 — per-kind catalog document. */
export const CatalogMetadata = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
  displayName: z.string().min(1),
  shortDescription: z.string().default(''),
  tags: z.array(z.string()).default([]),
  archived: z.boolean().default(false),
});
export type CatalogMetadataValue = z.infer<typeof CatalogMetadata>;

export const FieldOrigin = z.enum(['human', 'imported', 'accepted-ai']);

export const CatalogOverlay = z.object({
  notes: z.string().default(''),
  fieldOrigins: z.record(FieldOrigin).default({}),
});
export type CatalogOverlayValue = z.infer<typeof CatalogOverlay>;

export const LicenseInfo = z.object({
  status: z.enum(['confirmed', 'candidate', 'unknown', 'incompatible']).default('unknown'),
  expression: z.string().optional(),
  evidence: z.string().optional(),
  note: z.string().optional(),
});
export type LicenseInfoValue = z.infer<typeof LicenseInfo>;

export const CatalogSpec = z.object({
  targets: z.array(z.enum(['claude-code', 'codex'])).default([]),
  ownership: z.enum(['authored', 'referenced', 'vendored', 'unknown']).default('unknown'),
  source: SourceRef.default({ type: 'unknown' }),
  license: LicenseInfo.default({ status: 'unknown' }),
  installInstructions: z.record(z.string()).default({}),
  contentPolicy: z.enum(['metadata-only', 'vendored']).default('metadata-only'),
  /** Referenced component ids (plugins), or rule fragment source info. */
  components: z.array(z.string()).default([]),
  ruleFragment: z
    .object({
      document: z.string(),
      lines: z.string(),
      textHash: z.string(),
    })
    .optional(),
});
export type CatalogSpecValue = z.infer<typeof CatalogSpec>;

export const CatalogEntry = z.object({
  apiVersion: z.string(),
  kind: z.enum(['Skill', 'Plugin', 'Marketplace', 'Hook', 'RuleFragment']),
  metadata: CatalogMetadata,
  spec: CatalogSpec,
  overlay: CatalogOverlay.default({ notes: '', fieldOrigins: {} }),
  verification: z
    .object({
      lastVerifiedAt: z.string().optional(),
      sourceDigest: z.string().optional(),
    })
    .default({}),
  /** Unknown fields are preserved on read and round-tripped on write (CAT-006). */
  unknown: z.record(z.unknown()).optional(),
});
export type CatalogEntryValue = z.infer<typeof CatalogEntry>;

/** Unified error envelope (ARCHITECTURE §8). */
export interface ErrorEnvelope {
  code: string;
  message: string;
  details?: unknown;
  recovery?: string;
  requestId?: string;
}

/** ARCHITECTURE §10 — provider adapter contract (ADR-005: adapters never write Catalog). */
export interface Candidate {
  provider: Provider;
  kind: ArtifactKind;
  scope: Scope;
  name: string;
  absolutePath: string;
  copyRole: CopyRole;
}

export interface ScanContext {
  repoRoot: string;
  homeDir: string;
  cwd: string;
  limits: { maxFileBytes: number; maxFiles: number; maxDepth: number };
}

export interface ParseResult {
  observations: ObservationValue[];
  diagnostics: DiagnosticValue[];
}

export interface DetectionResult {
  provider: Provider;
  installed: boolean;
  configRoot?: string;
  detail?: string;
}

export interface ProviderAdapter {
  id: Provider;
  version: string;
  detect(context: ScanContext): Promise<DetectionResult>;
  discover(context: ScanContext): AsyncIterable<Candidate>;
  parse(candidate: Candidate, context: ScanContext): Promise<ParseResult>;
}

/** ARCHITECTURE §2 — storage behind an interface; in-memory for tests (ADR-011). */
export interface InventoryStore {
  saveScanRun(run: ScanRun, observations: ObservationValue[], diagnostics: DiagnosticValue[]): Promise<void>;
  getLastSuccessfulRun(): Promise<ScanRun | undefined>;
  getScanRun(runId: string): Promise<ScanRun | undefined>;
  listObservations(runId: string): Promise<ObservationValue[]>;
  listDiagnostics(runId: string): Promise<DiagnosticValue[]>;
  saveProposal(proposal: AnalysisProposalValue): Promise<void>;
  listProposals(artifactId?: string): Promise<AnalysisProposalValue[]>;
  /** PRI-002: retention metadata for the privacy page. */
  listRuns(): Promise<ScanRun[]>;
  clearHistory(): Promise<void>;
  clearProposals(): Promise<void>;
}

export interface CatalogStore {
  readEntry(repoRelativePath: string): Promise<CatalogEntryValue | undefined>;
  listEntries(): Promise<Array<{ repoRelativePath: string; entry: CatalogEntryValue }>>;
  loadRaw(repoRelativePath: string): Promise<string | undefined>;
}
