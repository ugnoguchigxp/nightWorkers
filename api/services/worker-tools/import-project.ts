import fs from "node:fs/promises";
import path from "node:path";
import { type CloneGitRepoOutput, cloneGitRepoTool } from "./clone-git-repo";
import {
	type MaterializeTemplateOutput,
	materializeTemplateTool,
} from "./materialize-template";
import {
	inspectAndInitializeImportedProject,
	type ProjectPostImportOutput,
} from "./project-post-import";
import {
	resolveStarterTemplate,
	type StarterStack,
	type TemplateRegistry,
} from "./template-registry";
import type { WorkerToolResult } from "./types";

export interface ImportProjectInput {
	repoRoot: string;
	source?: "starter" | "git";
	stack?: StarterStack;
	repoUrl?: string;
	templateId?: string;
	variant?: string;
	overlays?: string[];
	targetPath?: string;
	ref?: string;
	depth?: number;
	overwrite?: boolean;
	stripGitDir?: boolean;
	exclude?: string[];
	initialize?: boolean;
	allowedPaths?: string[];
	deniedPaths?: string[];
	registry?: TemplateRegistry;
}

export interface ImportProjectOutput {
	mode: "template" | "git" | "";
	template?: MaterializeTemplateOutput | null;
	git?: CloneGitRepoOutput | null;
	postImport?: ProjectPostImportOutput | null;
}

const EMPTY_PROJECT_ROOT_IGNORES = new Set([".git", ".DS_Store"]);

export async function importProjectTool(
	input: ImportProjectInput,
): Promise<WorkerToolResult<ImportProjectOutput>> {
	const startedAt = new Date().toISOString();
	const source = input.source?.trim();
	const stack = input.stack?.trim() as StarterStack | undefined;
	const repoUrl = input.repoUrl?.trim();
	const templateId = input.templateId?.trim();
	const importMode =
		source === "git"
			? "git"
			: source === "starter"
				? "starter"
				: repoUrl
					? "git"
					: "starter";

	if (source && source !== "starter" && source !== "git") {
		return failedImportProject(
			startedAt,
			"INVALID_IMPORT_PROJECT_SOURCE",
			`Unknown import_project source: ${input.source}`,
		);
	}

	if (importMode === "git" && templateId) {
		return failedImportProject(
			startedAt,
			"INVALID_IMPORT_PROJECT_ARGS",
			"import_project cannot use templateId when source=git.",
		);
	}
	if (importMode === "git" && stack) {
		return failedImportProject(
			startedAt,
			"INVALID_IMPORT_PROJECT_ARGS",
			"import_project cannot use stack when source=git.",
		);
	}
	if (importMode === "git" && !repoUrl) {
		return failedImportProject(
			startedAt,
			"INVALID_IMPORT_PROJECT_ARGS",
			"import_project requires repoUrl when source=git.",
		);
	}

	if (importMode === "starter") {
		const targetPath = await normalizeImportTargetPath(input);
		const resolved = templateId
			? resolveStarterTemplate({
					stack: templateId === "python-standard" ? "python" : "hono",
					variant: input.variant,
					registry: input.registry,
				})
			: resolveStarterTemplate({
					stack,
					variant: input.variant,
					registry: input.registry,
				});
		if (!resolved.ok) {
			return failedImportProject(startedAt, resolved.code, resolved.message);
		}
		const result = await materializeTemplateTool({
			templateId: resolved.template.id,
			variant: input.variant,
			overlays: input.overlays,
			targetPath,
			overwrite: input.overwrite,
			exclude: input.exclude,
			repoRoot: input.repoRoot,
			allowedPaths: input.allowedPaths,
			deniedPaths: input.deniedPaths,
			registry: input.registry,
		});
		const postImport =
			result.ok && result.payload?.targetPath
				? await inspectAndInitializeImportedProject({
						targetPath: result.payload.targetPath,
						initialize: input.initialize,
						removeLicenseFile: true,
						createBaselineCommit: true,
						requireBootstrap: true,
					})
				: null;
		return {
			ok: result.ok,
			toolName: "import_project",
			startedAt,
			finishedAt: new Date().toISOString(),
			payload: {
				mode: "template",
				template: result.payload,
				git: null,
				postImport,
			},
			error: result.error,
			artifactIds: result.artifactIds,
		};
	}

	const targetPath = await normalizeImportTargetPath(input);
	const result = await cloneGitRepoTool({
		repoUrl: repoUrl || "",
		targetPath,
		ref: input.ref,
		depth: input.depth,
		overwrite: input.overwrite,
		stripGitDir: input.stripGitDir,
		repoRoot: input.repoRoot,
		allowedPaths: input.allowedPaths,
		deniedPaths: input.deniedPaths,
	});
	const postImport =
		result.ok && result.payload?.targetPath
			? await inspectAndInitializeImportedProject({
					targetPath: result.payload.targetPath,
					initialize: input.initialize,
					removeLicenseFile: false,
					createBaselineCommit: false,
					requireBootstrap: false,
				})
			: null;
	return {
		ok: result.ok,
		toolName: "import_project",
		startedAt,
		finishedAt: new Date().toISOString(),
		payload: { mode: "git", template: null, git: result.payload, postImport },
		error: result.error,
		artifactIds: result.artifactIds,
	};
}

async function normalizeImportTargetPath(input: {
	repoRoot: string;
	targetPath?: string;
}) {
	const targetPath = input.targetPath?.trim();
	if (!targetPath || path.isAbsolute(targetPath)) return targetPath;

	const normalizedTarget = path.normalize(targetPath);
	if (!normalizedTarget || normalizedTarget === ".") return targetPath;

	const segments = normalizedTarget.split(path.sep).filter(Boolean);
	if (segments.length !== 1) return targetPath;

	const repoRoot = path.resolve(input.repoRoot);
	if (segments[0] !== path.basename(repoRoot)) return targetPath;
	if (await projectRootHasMaterialContent(repoRoot)) return targetPath;

	return ".";
}

async function projectRootHasMaterialContent(repoRoot: string) {
	const entries = await fs
		.readdir(repoRoot, { withFileTypes: true })
		.catch((error: unknown) => {
			if (typeof error === "object" && error && "code" in error) {
				const code = (error as { code?: unknown }).code;
				if (code === "ENOENT") return [];
			}
			throw error;
		});
	return entries.some((entry) => !EMPTY_PROJECT_ROOT_IGNORES.has(entry.name));
}

function failedImportProject(
	startedAt: string,
	code: string,
	message: string,
): WorkerToolResult<ImportProjectOutput> {
	return {
		ok: false,
		toolName: "import_project",
		startedAt,
		finishedAt: new Date().toISOString(),
		payload: { mode: "", template: null, git: null, postImport: null },
		error: { code, message },
	};
}
