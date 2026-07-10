import fs from "node:fs";
import path from "node:path";
import type { ProjectQualityCapabilities } from "../../../shared/schemas/quality.schema";

function readPackageScripts(repoRoot: string): Record<string, string> {
	const packageJsonPath = path.join(repoRoot, "package.json");
	if (!fs.existsSync(packageJsonPath)) return {};
	try {
		const parsed = JSON.parse(
			fs.readFileSync(packageJsonPath, "utf8"),
		) as unknown;
		if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
			return {};
		const scripts = (parsed as Record<string, unknown>).scripts;
		if (!scripts || typeof scripts !== "object" || Array.isArray(scripts))
			return {};
		return Object.fromEntries(
			Object.entries(scripts).filter(
				(entry): entry is [string, string] => typeof entry[1] === "string",
			),
		);
	} catch {
		return {};
	}
}

function shellQuote(value: string) {
	return `'${value.replace(/'/g, "'\\''")}'`;
}

function bunRun(scriptName: string) {
	return `bun run ${shellQuote(scriptName)}`;
}

export function detectQualityCapabilities(
	repoRoot: string,
): ProjectQualityCapabilities {
	const scripts = readPackageScripts(repoRoot);
	const unitCommand = scripts.test ? bunRun("test") : undefined;
	const coverageCommand = scripts["test:coverage"]
		? bunRun("test:coverage")
		: undefined;
	const e2eCommand = scripts["test:e2e"] ? bunRun("test:e2e") : undefined;
	const allMissing = [
		...(unitCommand ? [] : ["unit"]),
		...(e2eCommand ? [] : ["e2e"]),
	];
	return {
		projectType: "typescript",
		unit: {
			runnable: Boolean(unitCommand),
			missingCapabilities: unitCommand ? [] : ["unit"],
			command: unitCommand,
		},
		coverage: {
			runnable: Boolean(coverageCommand),
			missingCapabilities: coverageCommand ? [] : ["coverage"],
			command: coverageCommand,
		},
		e2e: {
			runnable: Boolean(e2eCommand),
			missingCapabilities: e2eCommand ? [] : ["e2e"],
			command: e2eCommand,
		},
		all: {
			runnable: Boolean(unitCommand && e2eCommand),
			missingCapabilities: allMissing,
			command:
				unitCommand && e2eCommand
					? [unitCommand, coverageCommand, e2eCommand]
							.filter(Boolean)
							.join(" && ")
					: undefined,
		},
	};
}
