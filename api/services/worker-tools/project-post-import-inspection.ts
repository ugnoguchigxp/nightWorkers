import fs from "node:fs/promises";
import path from "node:path";
import { getDeepRecordString } from "../../../shared/json-record";
import type {
	PackageManager,
	ProjectLlmContextInspection,
	ProjectManifestInspection,
} from "./project-post-import";

const PACKAGE_MANAGER_LOCKFILES = [
	{ file: "bun.lock", packageManager: "bun" },
	{ file: "bun.lockb", packageManager: "bun" },
	{ file: "pnpm-lock.yaml", packageManager: "pnpm" },
	{ file: "yarn.lock", packageManager: "yarn" },
	{ file: "package-lock.json", packageManager: "npm" },
] as const;
const VERIFICATION_SCRIPT_ORDER = [
	"verify",
	"typecheck",
	"lint",
	"test",
	"build",
] as const;
const MAKE_VERIFICATION_TARGET_ORDER = [
	"verify",
	"lint",
	"test",
	"build",
] as const;

export async function inspectPackageManifest(
	targetPath: string,
): Promise<ProjectManifestInspection> {
	const packageJsonPath = path.join(targetPath, "package.json");
	const lockfiles = await findLockfiles(targetPath);
	const missingBase: ProjectManifestInspection = {
		status: "missing",
		path: packageJsonPath,
		rawContent: null,
		packageJson: null,
		lockfiles,
		detectedPackageManager: null,
		installCommand: null,
		recommendedVerificationCommands: [],
	};

	let rawContent = "";
	try {
		rawContent = await fs.readFile(packageJsonPath, "utf8");
	} catch (error) {
		if (getDeepRecordString(error, "code") === "ENOENT") {
			return inspectMakefileManifest(targetPath, missingBase);
		}
		throw error;
	}

	try {
		const parsed = JSON.parse(rawContent) as Record<string, unknown>;
		const scripts = stringRecord(parsed.scripts);
		const detectedPackageManager = detectPackageManager({
			packageManagerField:
				typeof parsed.packageManager === "string" ? parsed.packageManager : "",
			lockfiles,
		});
		return {
			status: "found",
			path: packageJsonPath,
			rawContent,
			packageJson: {
				name: typeof parsed.name === "string" ? parsed.name : undefined,
				packageManager:
					typeof parsed.packageManager === "string"
						? parsed.packageManager
						: undefined,
				scripts,
				dependencies: stringRecord(parsed.dependencies),
				devDependencies: stringRecord(parsed.devDependencies),
			},
			lockfiles,
			detectedPackageManager,
			installCommand: detectedPackageManager
				? installCommandFor(detectedPackageManager)
				: null,
			recommendedVerificationCommands: buildRecommendedVerificationCommands(
				detectedPackageManager,
				scripts,
			),
		};
	} catch (error) {
		return {
			...missingBase,
			status: "parse_failed",
			rawContent,
			parseError: error instanceof Error ? error.message : String(error),
			detectedPackageManager: detectPackageManager({
				packageManagerField: "",
				lockfiles,
			}),
		};
	}
}

async function inspectMakefileManifest(
	targetPath: string,
	missingBase: ProjectManifestInspection,
): Promise<ProjectManifestInspection> {
	const makefilePath = path.join(targetPath, "Makefile");
	let rawContent = "";
	try {
		rawContent = await fs.readFile(makefilePath, "utf8");
	} catch (error) {
		if (getDeepRecordString(error, "code") === "ENOENT") return missingBase;
		throw error;
	}
	const targets = Array.from(
		new Set(
			rawContent
				.split(/\r?\n/)
				.map((line) => /^([A-Za-z0-9][A-Za-z0-9_.-]*):(?:\s|$)/.exec(line)?.[1])
				.filter((target): target is string => Boolean(target)),
		),
	);
	return {
		...missingBase,
		status: "found",
		path: makefilePath,
		rawContent,
		makefile: { targets },
		recommendedVerificationCommands: MAKE_VERIFICATION_TARGET_ORDER.filter(
			(target) => targets.includes(target),
		).map((target) => `make ${target}`),
	};
}

export async function findLockfiles(targetPath: string) {
	const entries: string[] = await fs
		.readdir(targetPath)
		.catch((error: unknown) => {
			if (getDeepRecordString(error, "code") === "ENOENT") return [];
			throw error;
		});
	return PACKAGE_MANAGER_LOCKFILES.map((candidate) => candidate.file).filter(
		(file) => entries.includes(file),
	);
}

export async function inspectLlmContext(
	targetPath: string,
): Promise<ProjectLlmContextInspection | undefined> {
	const contextPath = path.join(targetPath, "LLM_CONTEXT.md");
	try {
		return {
			status: "found",
			path: contextPath,
			rawContent: await fs.readFile(contextPath, "utf8"),
		};
	} catch (error) {
		if (getDeepRecordString(error, "code") === "ENOENT") {
			return undefined;
		}
		return {
			status: "read_failed",
			path: contextPath,
			rawContent: null,
			errorMessage: error instanceof Error ? error.message : String(error),
		};
	}
}

export function detectPackageManager(input: {
	packageManagerField: string;
	lockfiles: string[];
}): PackageManager {
	const packageManagerMatch = /^(bun|pnpm|npm|yarn)(?:@|$)/.exec(
		input.packageManagerField,
	);
	if (packageManagerMatch) return packageManagerMatch[1] as PackageManager;
	for (const candidate of PACKAGE_MANAGER_LOCKFILES) {
		if (input.lockfiles.includes(candidate.file))
			return candidate.packageManager;
	}
	return "bun";
}

export function installCommandFor(packageManager: PackageManager) {
	if (packageManager === "bun") return ["bun", "install"];
	if (packageManager === "pnpm") return ["pnpm", "install"];
	if (packageManager === "yarn") return ["yarn", "install"];
	return ["npm", "install"];
}

export function packageScriptCommandFor(
	packageManager: PackageManager,
	script: string,
) {
	if (packageManager === "bun") return ["bun", "run", script];
	if (packageManager === "pnpm") return ["pnpm", "run", script];
	if (packageManager === "yarn") return ["yarn", script];
	return ["npm", "run", script];
}

export function runCommandFor(packageManager: PackageManager, script: string) {
	if (packageManager === "bun") return `bun run ${script}`;
	if (packageManager === "pnpm") return `pnpm run ${script}`;
	if (packageManager === "yarn") return `yarn ${script}`;
	return `npm run ${script}`;
}

export function buildRecommendedVerificationCommands(
	packageManager: PackageManager | null,
	scripts: Record<string, string>,
) {
	if (!packageManager) return [];
	if (typeof scripts.verify === "string")
		return [runCommandFor(packageManager, "verify")];
	return VERIFICATION_SCRIPT_ORDER.filter(
		(script) => typeof scripts[script] === "string",
	).map((script) => runCommandFor(packageManager, script));
}

export function stringRecord(value: unknown): Record<string, string> {
	if (!value || typeof value !== "object" || Array.isArray(value)) return {};
	return Object.fromEntries(
		Object.entries(value as Record<string, unknown>).filter(
			(entry): entry is [string, string] => typeof entry[1] === "string",
		),
	);
}
