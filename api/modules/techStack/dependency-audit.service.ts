import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
	type ProjectDependencyAuditResult,
	type ProjectDependencyAuditSeverity,
	projectDependencyAuditResultSchema,
} from "../../../shared/schemas/tech-stack.schema";
import { ValidationError } from "../../lib/errors";
import { buildChildProcessEnvironment } from "../../services/execution/child-process-environment";

const execFileAsync = promisify(execFile);
const severityRank: Record<ProjectDependencyAuditSeverity, number> = {
	low: 0,
	moderate: 1,
	high: 2,
	critical: 3,
};

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function asNullableString(value: unknown) {
	return typeof value === "string" && value.trim() ? value : null;
}

function asSeverity(value: unknown): ProjectDependencyAuditSeverity | null {
	if (typeof value !== "string") return null;
	const normalized = value.toLowerCase();
	return normalized === "low" ||
		normalized === "moderate" ||
		normalized === "high" ||
		normalized === "critical"
		? normalized
		: null;
}

export function parseBunDependencyAuditReport(
	report: unknown,
	auditedAt = new Date(),
): ProjectDependencyAuditResult {
	if (!isRecord(report)) {
		throw new ValidationError("bun audit returned an invalid JSON report");
	}
	const findings = Object.entries(report).flatMap(
		([packageName, advisories]) =>
			Array.isArray(advisories)
				? advisories.flatMap((advisory, index) => {
						if (!isRecord(advisory)) return [];
						const severity = asSeverity(advisory.severity);
						const title = asNullableString(advisory.title);
						if (!severity || !title) return [];
						return [
							{
								packageName,
								advisoryId: String(
									advisory.id ?? advisory.url ?? `${packageName}:${index}`,
								),
								title,
								severity,
								vulnerableVersions: asNullableString(
									advisory.vulnerable_versions,
								),
								url: asNullableString(advisory.url),
							},
						];
					})
				: [],
	);
	findings.sort(
		(left, right) =>
			severityRank[right.severity] - severityRank[left.severity] ||
			left.packageName.localeCompare(right.packageName),
	);
	const counts = {
		total: findings.length,
		low: 0,
		moderate: 0,
		high: 0,
		critical: 0,
	};
	for (const finding of findings) counts[finding.severity] += 1;
	return projectDependencyAuditResultSchema.parse({
		packageManager: "bun",
		auditedAt,
		counts,
		findings,
	});
}

export async function runBunDependencyAudit(
	repoRoot: string,
): Promise<ProjectDependencyAuditResult> {
	let stdout = "";
	let stderr = "";
	try {
		const result = await execFileAsync("bun", ["audit", "--json"], {
			cwd: repoRoot,
			encoding: "utf8",
			timeout: 60_000,
			maxBuffer: 8_000_000,
			env: buildChildProcessEnvironment({
				purpose: "workspace_command",
				overrides: { FORCE_COLOR: "0", NO_COLOR: "1" },
			}),
		});
		stdout = String(result.stdout);
		stderr = String(result.stderr);
	} catch (error) {
		const commandError = error as Error & {
			stdout?: string | Buffer;
			stderr?: string | Buffer;
		};
		stdout = String(commandError.stdout ?? "");
		stderr = String(commandError.stderr ?? commandError.message);
	}
	if (!stdout.trim()) {
		throw new ValidationError("bun audit did not return a JSON report", {
			stderr: stderr.trim().slice(0, 2_000),
		});
	}
	let report: unknown;
	try {
		report = JSON.parse(stdout);
	} catch {
		throw new ValidationError("bun audit returned invalid JSON", {
			stderr: stderr.trim().slice(0, 2_000),
		});
	}
	return parseBunDependencyAuditReport(report);
}
