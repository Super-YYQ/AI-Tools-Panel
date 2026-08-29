# AI Tools Panel agent instructions

## Objective

Build a Windows-first local inventory panel for Claude Code and Codex configuration assets. The product is complete only when deterministic scanning, local Web browsing/editing, and Git-backed catalog changes work without AI.

## Invariants

- **Deterministic core:** filesystem and supported CLI/API evidence create inventory records; AI only proposes optional metadata enrichment.
- **Read-mostly machine boundary:** v1 reads installed tool configuration and writes only inside this repository or the app-owned local data directory.
- **Evidence:** every discovered item records provider, scope, source path or API origin, parser version, content hash, and discovery time.
- **Unknown stays unknown:** unproven repositories, licenses, versions, and install commands remain `unknown` or `candidate` with confidence and evidence.
- **Secrets stay local:** redact credentials and personal paths before logs, snapshots, fixtures, AI requests, or repository files.
- **Reviewable writes:** preview file diffs before applying catalog changes. Keep commit and push outside automatic application flows.

## Task routing

- **Requirements or scope:** read `docs/PRODUCT_SPEC.md`.
- **Package boundaries, data flow, API design, or domain terms:** read `docs/ARCHITECTURE.md` and `docs/DECISIONS.md`.
- **Claude/Codex discovery or parsing:** read `docs/SCANNING_SPEC.md`.
- **YAML/Markdown layout, IDs, overlays, imports, or reconciliation:** read `docs/CATALOG_SPEC.md`.
- **Pages, components, filters, editing workflows, or accessibility:** read `docs/WEB_UI_SPEC.md`.
- **AI summaries, classification, source inference, provider integration, or confidence:** read `docs/AI_ENRICHMENT_SPEC.md`.
- **Credentials, path privacy, Hook safety, file writes, or Git behavior:** read `docs/SECURITY_AND_GIT.md`.
- **Planning implementation work:** read `docs/IMPLEMENTATION_PLAN.md`; implement the earliest incomplete milestone unless the user names another.
- **Tests or completion review:** read `docs/TEST_STRATEGY.md`.
- **Product landscape or license rationale:** read `docs/research/agent-config-control-plane-landscape-2026-08-29.md`.

## Work loop

1. Read the task-specific documents above and identify the affected acceptance criteria.
2. Inspect the current code and tests; treat checked-in schemas and fixtures as executable contracts.
3. Make the smallest coherent change that preserves the invariants.
4. Run the focused tests, then the repository-wide verification commands defined by the implemented package scripts.
5. Update the authoritative document or decision record when behavior or a boundary changes.
6. Report changed files, verification evidence, unresolved risks, and the next incomplete criterion.

A step is complete when every affected acceptance criterion has implementation and test evidence, or the remaining blocker is explicitly documented.

## Git rules

- Use native `git` for repository operations; use platform tools only for operations native Git cannot perform.
- A request to commit does not authorize push. Push only after explicit user authorization for that push.
- Preserve unrelated working-tree changes and keep generated/local data out of commits.
