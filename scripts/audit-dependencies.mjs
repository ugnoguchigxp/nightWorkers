import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { evaluateDependencyAudit } from './dependency-audit-policy.mjs';

const allowlistPath = new URL('../config/dependency-audit-allowlist.json', import.meta.url);
const allowlist = JSON.parse(fs.readFileSync(allowlistPath, 'utf8'));
const auditProcess = spawnSync('bun', ['audit', '--json'], {
  cwd: process.cwd(),
  encoding: 'utf8',
  env: process.env,
});

if (!auditProcess.stdout.trim()) {
  console.error(auditProcess.stderr.trim());
  throw new Error('bun audit did not return a JSON report.');
}

let audit;
try {
  audit = JSON.parse(auditProcess.stdout);
} catch (error) {
  console.error(auditProcess.stdout.trim());
  throw new Error(`Unable to parse bun audit JSON: ${error.message}`);
}

if (process.env.NIGHTWORKERS_AUDIT_REPORT) {
  fs.mkdirSync(path.dirname(path.resolve(process.env.NIGHTWORKERS_AUDIT_REPORT)), {
    recursive: true,
  });
  fs.writeFileSync(
    process.env.NIGHTWORKERS_AUDIT_REPORT,
    `${JSON.stringify(audit, null, 2)}\n`,
  );
}

const result = evaluateDependencyAudit(audit, allowlist);
if (result.configurationErrors.length > 0) {
  console.error('Dependency audit policy configuration is invalid:');
  for (const error of result.configurationErrors) console.error(`- ${error}`);
}
if (result.staleExceptions.length > 0) {
  console.error('Dependency audit allowlist contains stale or invalid entries:');
  for (const exception of result.staleExceptions) {
		console.error(
			`- ${exception.advisoryId ?? 'missing-advisory-id'} ${exception.package ?? ''}`.trim(),
		);
  }
}

if (
  result.configurationErrors.length > 0 ||
  result.unallowlisted.length > 0 ||
  result.staleExceptions.length > 0
) {
  for (const finding of result.unallowlisted) {
    console.error(
      `- [${finding.severity}] ${finding.packageName}: ${finding.title} (${finding.url})`,
    );
  }
  process.exit(1);
}

console.log(
  `Dependency audit policy passed: ${result.findings.length} finding(s) at or above ${result.minimumSeverity}, ${result.activeExceptions.length} active exception(s).`,
);
