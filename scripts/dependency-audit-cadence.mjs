import { createHash } from 'node:crypto';

export const DEPENDENCY_AUDIT_CADENCE = Object.freeze({
  schemaVersion: 1,
  intervalMs: 7 * 24 * 60 * 60 * 1000,
});

export function createDependencyAuditFingerprint(inputs) {
  const digest = createHash('sha256');
  for (const [name, content] of Object.entries(inputs).sort(([left], [right]) =>
    left.localeCompare(right),
  )) {
    digest.update(name);
    digest.update('\0');
    digest.update(String(Buffer.byteLength(content)));
    digest.update('\0');
    digest.update(content);
    digest.update('\0');
  }
  return digest.digest('hex');
}

export function evaluateDependencyAuditCadence({
  state,
  fingerprint,
  now = new Date(),
  force = false,
}) {
  if (force) return { shouldRun: true, reason: 'forced' };
  if (!state || state.schemaVersion !== DEPENDENCY_AUDIT_CADENCE.schemaVersion) {
    return { shouldRun: true, reason: 'missing-or-invalid-state' };
  }
  if (state.fingerprint !== fingerprint) {
    return { shouldRun: true, reason: 'dependency-or-policy-changed' };
  }

  const auditedAt = Date.parse(state.auditedAt);
  const nowMs = now.getTime();
  if (!Number.isFinite(auditedAt) || auditedAt > nowMs) {
    return { shouldRun: true, reason: 'missing-or-invalid-state' };
  }

  const nextAuditAt = auditedAt + DEPENDENCY_AUDIT_CADENCE.intervalMs;
  if (nowMs >= nextAuditAt) {
    return { shouldRun: true, reason: 'weekly-interval-elapsed' };
  }
  return {
    shouldRun: false,
    reason: 'recent-success',
    nextAuditAt: new Date(nextAuditAt).toISOString(),
  };
}

export function createDependencyAuditState(fingerprint, auditedAt = new Date()) {
  return {
    schemaVersion: DEPENDENCY_AUDIT_CADENCE.schemaVersion,
    fingerprint,
    auditedAt: auditedAt.toISOString(),
  };
}
