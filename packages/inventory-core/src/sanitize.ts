/**
 * PRI-001/002: Observation sanitization boundary. Every store implementation
 * calls sanitizeObservation() before persisting, so even an adapter that
 * forgets to whitelist its summary cannot leak raw third-party configuration
 * (frontmatter, manifests, settings) into SQLite or the API.
 */
import type { DiagnosticValue, ObservationValue } from '@aitp/contracts';
import { redactObject, redactText } from '@aitp/security';

/** Product-relevant summary fields per kind; everything else is dropped. */
const SUMMARY_ALLOWLIST: Record<ObservationValue['kind'], string[]> = {
  skill: ['name', 'description', 'version', 'scripts', 'resourceFiles'],
  plugin: ['manifestName', 'version', 'description', 'componentTypes'],
  marketplace: ['manifestName', 'pluginNames', 'ownerName'],
  hook: ['owner', 'events', 'trust'],
  'rule-document': ['role', 'imports', 'lines', 'loadedInContext', 'chain', 'document'],
  'rule-fragment': ['document', 'startLine', 'endLine', 'textHash'],
};

function whitelist(value: Record<string, unknown>, allowed: string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of allowed) {
    if (value[key] !== undefined) out[key] = value[key];
  }
  return out;
}

export function sanitizeObservation(observation: ObservationValue): ObservationValue {
  const allowed = SUMMARY_ALLOWLIST[observation.kind] ?? [];
  const cleaned = whitelist(observation.summary ?? {}, allowed);
  const { value } = redactObject(cleaned);
  // Never persist machine-absolute-looking paths inside summaries.
  for (const key of Object.keys(value)) {
    const v = value[key];
    if (typeof v === 'string' && /^[a-zA-Z]:\\/.test(v)) value[key] = '<redacted:absolute-path>';
  }
  return { ...observation, summary: value };
}

export function sanitizeObservations(observations: ObservationValue[]): ObservationValue[] {
  return observations.map(sanitizeObservation);
}

/** Parser error messages can embed file content — redact before persistence. */
export function sanitizeDiagnostic(diagnostic: DiagnosticValue): DiagnosticValue {
  const { value } = redactObject({ ...diagnostic, message: redactText(diagnostic.message).value });
  return value as DiagnosticValue;
}

export function sanitizeDiagnostics(diagnostics: DiagnosticValue[]): DiagnosticValue[] {
  return diagnostics.map(sanitizeDiagnostic);
}
