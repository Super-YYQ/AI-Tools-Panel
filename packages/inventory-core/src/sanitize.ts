/**
 * PRI-001/002: Observation sanitization boundary. Every store implementation
 * calls sanitizeObservation() before persisting, so even an adapter that
 * forgets to whitelist its summary cannot leak raw third-party configuration
 * (frontmatter, manifests, settings) into SQLite or the API.
 */
import type { AnalysisProposalValue, DiagnosticValue, ObservationValue } from '@aitp/contracts';
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

/**
 * PRI-101: canonicalize a source URL — strip userinfo (credentials), query and
 * fragment; normalize .git suffix and trailing slash. URLs that cannot be
 * parsed degrade to their redacted textual form.
 */
export function canonicalizeSourceUrl(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.username = '';
    parsed.password = '';
    parsed.search = '';
    parsed.hash = '';
    let out = `${parsed.protocol}//${parsed.host}${parsed.pathname}`;
    if (out.endsWith('.git')) out = out.slice(0, -4);
    if (out.endsWith('/')) out = out.slice(0, -1);
    return out;
  } catch {
    return redactText(url).value;
  }
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
  // PRI-101: the whole Observation is the privacy boundary — names, evidence,
  // identity URLs and path tokens are sanitized too, not just summary.
  const sourceIdentity = observation.sourceIdentity
    ? {
        ...observation.sourceIdentity,
        ...(observation.sourceIdentity.canonicalUrl
          ? { canonicalUrl: canonicalizeSourceUrl(observation.sourceIdentity.canonicalUrl) }
          : {}),
      }
    : observation.sourceIdentity;
  const { value: redactedRest } = redactObject({
    canonicalName: observation.canonicalName,
    displayName: observation.displayName,
    sourceEvidence: observation.sourceEvidence,
    location: { pathToken: observation.location.pathToken },
  });
  const redactedRestRecord = redactedRest as Record<string, unknown>;
  return {
    ...observation,
    canonicalName: (redactedRestRecord.canonicalName as string) ?? observation.canonicalName,
    displayName: (redactedRestRecord.displayName as string | undefined) ?? observation.displayName,
    sourceIdentity,
    sourceEvidence: (redactedRestRecord.sourceEvidence as ObservationValue['sourceEvidence']) ?? observation.sourceEvidence,
    location: {
      ...observation.location,
      pathToken: ((redactedRestRecord.location as { pathToken?: string } | undefined)?.pathToken) ?? observation.location.pathToken,
    },
    summary: value,
  };
}

/** PRI-103: proposals are untrusted external output — redact before persisting. */
export function sanitizeProposal(proposal: AnalysisProposalValue): AnalysisProposalValue {
  const { value } = redactObject({
    claims: proposal.claims.map((c) => ({ field: c.field, value: c.value, confidence: c.confidence, evidence: c.evidence })),
  });
  const claims = (value as { claims: AnalysisProposalValue['claims'] }).claims;
  return { ...proposal, claims };
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
