const SEVERITY_RANK = new Map([
  ['low', 0],
  ['moderate', 1],
  ['high', 2],
  ['critical', 3],
]);

function exceptionKey(packageName, advisoryId) {
  return `${packageName}\0${advisoryId}`;
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

export function evaluateDependencyAudit(audit, allowlist, now = new Date()) {
  const configuredMinimumSeverity = String(
    allowlist.minimumSeverity ?? 'high',
  ).toLowerCase();
  const minimumSeverityRank = SEVERITY_RANK.get(configuredMinimumSeverity);
  const configurationErrors = [];
  if (minimumSeverityRank === undefined) {
    configurationErrors.push(
      `Unsupported minimumSeverity: ${configuredMinimumSeverity}`,
    );
  }
  const effectiveMinimumSeverityRank = minimumSeverityRank ?? SEVERITY_RANK.get('high');
  const findings = Object.entries(audit).flatMap(([packageName, advisories]) =>
    advisories
      .filter(
        (advisory) =>
          (SEVERITY_RANK.get(String(advisory.severity).toLowerCase()) ?? -1) >=
          effectiveMinimumSeverityRank,
      )
      .map((advisory) => ({ packageName, ...advisory })),
  );
  const exceptions = Array.isArray(allowlist.exceptions) ? allowlist.exceptions : [];
  const activeExceptions = exceptions.filter((exception) => {
    if (
      exception.advisoryId === undefined ||
      exception.advisoryId === null ||
      !isNonEmptyString(exception.package) ||
      !isNonEmptyString(exception.owner) ||
      !isNonEmptyString(exception.expiresAt) ||
      !isNonEmptyString(exception.reason) ||
      !isNonEmptyString(exception.mitigation)
    ) {
      return false;
    }
    return new Date(exception.expiresAt).getTime() > now.getTime();
  });
  const activeExceptionKeys = new Set(
    activeExceptions.map((exception) =>
      exceptionKey(exception.package, String(exception.advisoryId)),
    ),
  );
  const unallowlisted = findings.filter(
    (finding) =>
      !activeExceptionKeys.has(
        exceptionKey(finding.packageName, String(finding.id)),
      ),
  );
  const staleExceptions = exceptions.filter(
    (exception) =>
      !findings.some(
        (finding) =>
          finding.packageName === exception.package &&
          String(finding.id) === String(exception.advisoryId),
      ) ||
      !activeExceptionKeys.has(
        exceptionKey(exception.package, String(exception.advisoryId)),
      ),
  );

  return {
    minimumSeverity: configuredMinimumSeverity,
    configurationErrors,
    findings,
    activeExceptions,
    unallowlisted,
    staleExceptions,
  };
}
