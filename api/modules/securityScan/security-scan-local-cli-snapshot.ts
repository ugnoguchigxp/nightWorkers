import { execFile } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import type {
	SecurityScanCapabilities,
	SecurityScanSelection,
	SecurityScanTarget,
} from "../../../shared/schemas/security-scan.schema";
import { AppError } from "../../lib/errors";
import { isVulnWorkbenchCliConfigured } from "../../services/vulnworkbench-cli-runtime";
import type {
	LocalCliDiffPreview,
	LocalCliProfilePlan,
} from "./security-scan-local-cli-command";

const execFileAsync = promisify(execFile);

export async function requireLocalCliProject(projectPath: string) {
	if (!isVulnWorkbenchCliConfigured()) {
		throw new AppError(
			409,
			"SECURITY_SCAN_LOCAL_CLI_NOT_CONFIGURED",
			"vulnWorkbench CLIが見つかりません。NIGHTWORKERS_VULNWORKBENCH_CWDを確認してください。",
		);
	}
	const stat = await fs.stat(projectPath).catch(() => null);
	if (!stat?.isDirectory()) {
		throw new AppError(
			404,
			"SECURITY_SCAN_PROJECT_PATH_NOT_FOUND",
			"NightWorkersに登録されたProjectフォルダーが見つかりません。",
		);
	}
}

export function resolveLocalCliSelection(
	capabilities: SecurityScanCapabilities,
	selection: SecurityScanSelection,
	target: SecurityScanTarget,
) {
	if (selection.mode === "preset") {
		const preset = capabilities.presets.find(
			(candidate) => candidate.id === selection.presetId,
		);
		const presetTarget = preset?.targets.find(
			(candidate) => candidate.kind === target.kind,
		);
		if (preset && presetTarget) {
			return {
				profileRef: presetTarget.profileRef,
				estimatedDurationSeconds: presetTarget.estimatedDurationSeconds,
				warnings: presetTarget.warnings,
			};
		}
	} else {
		const profile = capabilities.selectableProfiles.find(
			(candidate) => candidate.ref === selection.profileRef,
		);
		if (profile?.supportedTargets.includes(target.kind)) {
			return {
				profileRef: profile.ref,
				estimatedDurationSeconds: null,
				warnings: profile.warnings,
			};
		}
	}
	throw new AppError(
		422,
		"SECURITY_SCAN_LOCAL_CLI_SELECTION_UNSUPPORTED",
		"選択したスキャンプロファイルと対象の組み合わせはローカルCLIで利用できません。",
	);
}

export function localCliToolSteps(
	plan: LocalCliProfilePlan,
	diffPreview: LocalCliDiffPreview | null,
) {
	const availability = new Map(
		diffPreview?.tools.map((tool) => [tool.toolId, tool] as const) ?? [],
	);
	return plan.resolvedSteps.map((step) => {
		const tool = availability.get(step.id);
		return {
			id: step.id,
			name: step.displayName,
			category: toolCategory(step.id, step.kind),
			required: step.required,
			availability: tool
				? tool.applicability === "applicable"
					? ("available" as const)
					: ("unavailable" as const)
				: step.kind === "static_tool"
					? ("available" as const)
					: ("conditional" as const),
			...(tool?.reasonCode ? { reason: tool.reasonCode } : {}),
		};
	});
}

export function localCliDiffWarnings(preview: LocalCliDiffPreview | null) {
	if (!preview) return [];
	const warnings: string[] = [];
	if (preview.coverage.unsupported > 0) {
		warnings.push(
			`${preview.coverage.unsupported}件の変更ファイルはスキャン対象外です。`,
		);
	}
	if (preview.coverage.tooLarge > 0) {
		warnings.push(
			`${preview.coverage.tooLarge}件の変更ファイルがサイズ上限を超えています。`,
		);
	}
	return warnings;
}

function toolCategory(stepId: string, kind: string) {
	if (stepId === "gitleaks") return "secret";
	if (stepId === "osv") return "dependency";
	if (stepId === "trivy") return "filesystem";
	if (stepId === "semgrep") return "static";
	if (kind === "sbom_export") return "sbom";
	if (kind === "api_schema_scan") return "api";
	if (kind === "dast" || kind === "runtime_scanner") return "runtime";
	if (kind === "container_image_scan") return "container";
	return "security";
}

export async function captureLocalCliTarget(projectPath: string) {
	const root = path.resolve(projectPath);
	const files = await listSourceFiles(root);
	const digest = crypto.createHash("sha256");
	for (const file of files) {
		const relative = path.relative(root, file).split(path.sep).join("/");
		digest.update(relative).update("\0");
		const fileStat = await fs.lstat(file).catch(() => null);
		if (fileStat?.isSymbolicLink()) {
			digest.update("symlink\0");
			digest.update(await fs.readlink(file).catch(() => "unreadable"));
		} else if (fileStat?.isFile()) {
			digest.update("file\0");
			const content = await fs.readFile(file).catch(() => null);
			if (content) digest.update(content);
		} else {
			digest.update("unreadable\0");
		}
		digest.update("\0");
	}
	return {
		digest: digest.digest("hex"),
		gitHead: await readGitHead(root),
		fileCount: files.length,
	};
}

async function listSourceFiles(root: string) {
	try {
		const { stdout } = await execFileAsync(
			"git",
			["ls-files", "-co", "--exclude-standard", "-z"],
			{ cwd: root, maxBuffer: 32 * 1024 * 1024 },
		);
		return stdout
			.split("\0")
			.filter(Boolean)
			.map((entry) => path.resolve(root, entry))
			.filter((entry) => entry.startsWith(`${root}${path.sep}`))
			.sort();
	} catch {
		const files: string[] = [];
		async function visit(directory: string) {
			for (const entry of await fs.readdir(directory, {
				withFileTypes: true,
			})) {
				if ([".git", "node_modules", ".nightworkers"].includes(entry.name))
					continue;
				const fullPath = path.join(directory, entry.name);
				if (entry.isDirectory()) await visit(fullPath);
				else if (entry.isFile()) files.push(fullPath);
			}
		}
		await visit(root);
		return files.sort();
	}
}

async function readGitHead(root: string) {
	try {
		const { stdout } = await execFileAsync("git", ["rev-parse", "HEAD"], {
			cwd: root,
			maxBuffer: 16 * 1024,
		});
		return stdout.trim() || null;
	} catch {
		return null;
	}
}
