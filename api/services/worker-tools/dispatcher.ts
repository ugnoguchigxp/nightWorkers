import type { TestInventoryCaseSelection } from "../../../shared/schemas/verification-checklist.schema";
import type { AgentSafetyPolicy } from "../../modules/codingAgent";
import {
	projectExplorationCatalogTool,
	projectExplorationCatalogUnavailableResult,
} from "../../modules/ontology/exploration/project-exploration-catalog-tool";
import type { WorkerToolName } from "../tool-policy/types";
import { assertRunWorkspaceSideEffectAuthority } from "../workspace/run-workspace-authority.service";
import { applyPatchTool } from "./apply-patch";
import { cloneGitRepoTool } from "./clone-git-repo";
import { copyDirectoryTool } from "./copy-directory";
import { fetchContentTool } from "./fetch-content";
import { findFileTool } from "./find-file";
import { gitDiffTool, gitStatusTool } from "./git";
import { importProjectTool } from "./import-project";
import { listDirTool } from "./list-dir";
import { materializeTemplateTool } from "./materialize-template";
import { mcpCallTool } from "./mcp-call-tool";
import type { WorkerToolExecutionContext } from "./output-compression";
import { readFileTool } from "./read-file";
import { replaceContentTool } from "./replace-content";
import { runBackgroundCommandTool } from "./run-background-command";
import { runCommandTool } from "./run-command";
import { runVerificationTool } from "./run-verification";
import { searchFilesTool } from "./search-files";
import { searchWebTool } from "./search-web";
import { inspectStructureTool } from "./structure-inspection/inspect-structure";
import type { WorkerToolResult } from "./types";

export type WorkerToolDispatchInput = {
	toolName: WorkerToolName;
	args: Record<string, unknown>;
	repoRoot: string;
	taskId?: string;
	runId?: string;
	safetyPolicy?: AgentSafetyPolicy;
	readFiles: string[];
	toolContext?: WorkerToolExecutionContext;
	projectExplorationCatalogAccess?: {
		serverId: string;
		projectPath: string;
		expectedHead: string;
	};
	runtimeEnvironment?: Record<string, string>;
	confinementRequired?: boolean;
};

export type WorkerToolDispatchResult = {
	result: WorkerToolResult<unknown>;
	readFilesChanged?: string[];
};

export async function executeWorkerTool(
	input: WorkerToolDispatchInput,
): Promise<WorkerToolDispatchResult> {
	if (input.runId && WORKSPACE_SIDE_EFFECT_TOOLS.has(input.toolName)) {
		const authority = await assertRunWorkspaceSideEffectAuthority({
			runId: input.runId,
			taskId: input.taskId,
			requestedRoot: input.repoRoot,
		});
		if (!authority.ok) {
			const now = new Date().toISOString();
			return {
				result: {
					ok: false,
					toolName: input.toolName,
					startedAt: now,
					finishedAt: now,
					payload: {},
					error: {
						code: authority.code,
						message: authority.message,
						retryable: false,
					},
				},
			};
		}
	}
	const {
		toolName,
		args,
		repoRoot,
		safetyPolicy,
		readFiles,
		toolContext,
		runtimeEnvironment,
		confinementRequired,
	} = input;

	if (toolName === "list_dir") {
		return {
			result: await listDirTool({
				relativePath: args.relativePath as string | undefined,
				recursive: args.recursive as boolean | undefined,
				skipIgnored: args.skipIgnored as boolean | undefined,
				maxEntries: args.maxEntries as number | undefined,
				repoRoot,
				allowedPaths: safetyPolicy?.allowedPaths,
				deniedPaths: safetyPolicy?.deniedPaths,
			}),
		};
	}

	if (toolName === "find_file") {
		return {
			result: await findFileTool({
				fileMask: args.fileMask as string,
				relativePath: args.relativePath as string | undefined,
				recursive: args.recursive as boolean | undefined,
				maxResults: args.maxResults as number | undefined,
				repoRoot,
				allowedPaths: safetyPolicy?.allowedPaths,
				deniedPaths: safetyPolicy?.deniedPaths,
			}),
		};
	}

	if (toolName === "read_file") {
		const result = await readFileTool({
			filePath: args.filePath as string,
			repoRoot,
			startLine: args.startLine as number | undefined,
			endLine: args.endLine as number | undefined,
			fresh: args.fresh as boolean | undefined,
			compressionMode: args.compressionMode as "auto" | "off" | undefined,
			readCache: toolContext?.readFileCache,
			allowedPaths: safetyPolicy?.allowedPaths,
			deniedPaths: safetyPolicy?.deniedPaths,
		});
		const filePath = args.filePath as string;
		if (
			result.ok &&
			typeof filePath === "string" &&
			!readFiles.includes(filePath)
		) {
			return { result, readFilesChanged: [...readFiles, filePath] };
		}
		return { result };
	}

	if (toolName === "read_current_specification") {
		const { readCurrentSpecificationTool } = await import(
			"./read-current-specification"
		);
		return {
			result: await readCurrentSpecificationTool({
				taskId: (args.taskId as string | undefined) || input.taskId || "",
				view: args.view as never,
				includeDesignContext: args.includeDesignContext as boolean | undefined,
			}),
		};
	}

	if (toolName === "inspect_structure") {
		return {
			result: await inspectStructureTool({
				filePath: args.filePath as string,
				repoRoot,
				includeImports: args.includeImports as boolean | undefined,
				previewPrimitives: args.previewPrimitives as boolean | undefined,
				maxPaths: args.maxPaths as number | undefined,
				allowedPaths: safetyPolicy?.allowedPaths,
				deniedPaths: safetyPolicy?.deniedPaths,
			}),
		};
	}

	if (toolName === "search_files") {
		return {
			result: await searchFilesTool({
				query: args.query as string,
				repoRoot,
				glob: args.glob as string | undefined,
				maxResults: args.maxResults as number | undefined,
				caseSensitive: args.caseSensitive as boolean | undefined,
				allowedPaths: safetyPolicy?.allowedPaths,
				deniedPaths: safetyPolicy?.deniedPaths,
			}),
		};
	}

	if (toolName === "search_web") {
		return {
			result: await searchWebTool({
				query: args.query as string,
				maxResults: args.maxResults as number | undefined,
			}),
		};
	}

	if (toolName === "fetch_content") {
		return {
			result: await fetchContentTool({
				url: args.url as string,
				maxChars: args.maxChars as number | undefined,
			}),
		};
	}

	// Keep all direct workspace writes behind this dispatcher so future proposal/dry-run
	// runs can capture planned changes here before any tool mutates the real repo.
	if (toolName === "copy_directory") {
		return {
			result: await copyDirectoryTool({
				sourcePath: args.sourcePath as string,
				targetPath: args.targetPath as string | undefined,
				overwrite: args.overwrite as boolean | undefined,
				exclude: args.exclude as string[] | undefined,
				repoRoot,
				allowedPaths: safetyPolicy?.allowedPaths,
				deniedPaths: safetyPolicy?.deniedPaths,
			}),
		};
	}

	if (toolName === "import_project") {
		return {
			result: await importProjectTool({
				repoUrl: args.repoUrl as string | undefined,
				templateId: args.templateId as string | undefined,
				variant: args.variant as string | undefined,
				overlays: args.overlays as string[] | undefined,
				targetPath: args.targetPath as string | undefined,
				ref: args.ref as string | undefined,
				depth: args.depth as number | undefined,
				overwrite: args.overwrite as boolean | undefined,
				stripGitDir: args.stripGitDir as boolean | undefined,
				exclude: args.exclude as string[] | undefined,
				initialize: args.initialize as boolean | undefined,
				repoRoot,
				allowedPaths: safetyPolicy?.allowedPaths,
				deniedPaths: safetyPolicy?.deniedPaths,
			}),
		};
	}

	if (toolName === "clone_git_repo") {
		return {
			result: await cloneGitRepoTool({
				repoUrl: args.repoUrl as string,
				targetPath: args.targetPath as string | undefined,
				ref: args.ref as string | undefined,
				depth: args.depth as number | undefined,
				overwrite: args.overwrite as boolean | undefined,
				stripGitDir: args.stripGitDir as boolean | undefined,
				repoRoot,
				allowedPaths: safetyPolicy?.allowedPaths,
				deniedPaths: safetyPolicy?.deniedPaths,
			}),
		};
	}

	if (toolName === "materialize_template") {
		return {
			result: await materializeTemplateTool({
				templateId: args.templateId as string,
				variant: args.variant as string | undefined,
				overlays: args.overlays as string[] | undefined,
				targetPath: args.targetPath as string | undefined,
				overwrite: args.overwrite as boolean | undefined,
				exclude: args.exclude as string[] | undefined,
				repoRoot,
				allowedPaths: safetyPolicy?.allowedPaths,
				deniedPaths: safetyPolicy?.deniedPaths,
			}),
		};
	}

	if (toolName === "apply_patch") {
		return {
			result: await applyPatchTool({
				patchContent: args.patchContent as string,
				repoRoot,
				allowedPaths: safetyPolicy?.allowedPaths,
				deniedPaths: safetyPolicy?.deniedPaths,
			}),
		};
	}

	if (toolName === "replace_content") {
		return {
			result: await replaceContentTool({
				filePath: args.filePath as string,
				needle: args.needle as string,
				replacement: args.replacement as string,
				mode: (args.mode as "literal" | "regex") || "literal",
				allowMultipleOccurrences: args.allowMultipleOccurrences as
					| boolean
					| undefined,
				repoRoot,
				allowedPaths: safetyPolicy?.allowedPaths,
				deniedPaths: safetyPolicy?.deniedPaths,
			}),
		};
	}

	if (toolName === "run_command") {
		return {
			result: await runCommandTool({
				command: args.command as string,
				repoRoot,
				cwd: args.cwd as string | undefined,
				blockedCommands: safetyPolicy?.blockedCommands,
				allowedPaths: safetyPolicy?.allowedPaths,
				deniedPaths: safetyPolicy?.deniedPaths,
				timeoutSeconds: args.timeoutSeconds as number | undefined,
				compressionMode: args.compressionMode as "auto" | "off" | undefined,
				maxCommandSeconds: safetyPolicy?.maxCommandSeconds,
				environment: runtimeEnvironment,
				confinementRequired,
			}),
		};
	}

	if (toolName === "run_background_command") {
		return {
			result: await runBackgroundCommandTool({
				command: args.command as string,
				repoRoot,
				cwd: args.cwd as string | undefined,
				taskId: input.taskId,
				runId: (args.runId as string | undefined) || input.runId,
				repositoryId: args.repositoryId as string | undefined,
				blockedCommands: safetyPolicy?.blockedCommands,
				allowedPaths: safetyPolicy?.allowedPaths,
				deniedPaths: safetyPolicy?.deniedPaths,
				environment: runtimeEnvironment,
				confinementRequired,
			}),
		};
	}

	if (toolName === "run_verification") {
		return {
			result: await runVerificationTool({
				command: args.command as string,
				repoRoot,
				reason: (args.reason as string) || "verification",
				cwd: args.cwd as string | undefined,
				taskId: input.taskId,
				runId: (args.runId as string | undefined) || input.runId,
				verificationDocumentId: args.verificationDocumentId as
					| string
					| undefined,
				blockedCommands: safetyPolicy?.blockedCommands,
				allowedPaths: safetyPolicy?.allowedPaths,
				deniedPaths: safetyPolicy?.deniedPaths,
				timeoutSeconds: args.timeoutSeconds as number | undefined,
				compressionMode: args.compressionMode as "auto" | "off" | undefined,
				maxCommandSeconds: safetyPolicy?.maxCommandSeconds,
				environment: runtimeEnvironment,
				confinementRequired,
			}),
		};
	}

	if (toolName === "run_check") {
		const { runCheckTool } = await import("./run-check");
		return {
			result: await runCheckTool({
				command: args.command as string,
				repoRoot,
				taskId: input.taskId,
				runId: input.runId,
				checkKind: (args.checkKind as never) || "other",
				displayMode: args.displayMode as never,
				cwd: args.cwd as string | undefined,
				blockedCommands: safetyPolicy?.blockedCommands,
				allowedPaths: safetyPolicy?.allowedPaths,
				deniedPaths: safetyPolicy?.deniedPaths,
				timeoutSeconds: args.timeoutSeconds as number | undefined,
				maxCommandSeconds: safetyPolicy?.maxCommandSeconds,
				environment: runtimeEnvironment,
				confinementRequired,
			}),
		};
	}

	if (toolName === "completion_check") {
		const { completionCheckTool } = await import("./run-check");
		return {
			result: await completionCheckTool({
				taskId: (args.taskId as string | undefined) || input.taskId || "",
				runId: (args.runId as string | undefined) || input.runId || "",
				verificationDocumentId: args.verificationDocumentId as
					| string
					| undefined,
				repoRoot,
			}),
		};
	}

	if (toolName === "collect_test_inventory") {
		const { collectTestInventoryTool } = await import(
			"../../modules/codingAgent"
		);
		return {
			result: await collectTestInventoryTool({
				taskId: input.taskId || "",
				runId: input.runId,
				repoRoot,
				cwd: args.cwd as string | undefined,
				cursor: args.cursor as string | undefined,
				limit: args.limit as number | undefined,
				filePaths: args.filePaths as string[] | undefined,
				blockedCommands: safetyPolicy?.blockedCommands,
				allowedPaths: safetyPolicy?.allowedPaths,
				externalAllowedPaths: safetyPolicy?.externalAllowedPaths,
				deniedPaths: safetyPolicy?.deniedPaths,
				maxCommandSeconds: safetyPolicy?.maxCommandSeconds,
				confinementRequired,
			}),
		};
	}

	if (toolName === "record_test_condition_mapping") {
		const { recordTestConditionMappingTool } = await import(
			"../../modules/codingAgent"
		);
		return {
			result: await recordTestConditionMappingTool({
				taskId: input.taskId || "",
				runId: input.runId,
				repoRoot,
				verificationDocumentId: args.verificationDocumentId as string,
				inventoryId: args.inventoryId as string,
				mappings: args.mappings as TestInventoryCaseSelection[],
			}),
		};
	}

	if (toolName === "project_exploration_catalog") {
		if (!input.projectExplorationCatalogAccess) {
			return { result: projectExplorationCatalogUnavailableResult() };
		}
		return {
			result: await projectExplorationCatalogTool({
				serverId: input.projectExplorationCatalogAccess.serverId,
				projectPath: input.projectExplorationCatalogAccess.projectPath,
				executionPath: repoRoot,
				expectedHead: input.projectExplorationCatalogAccess.expectedHead,
				focus: projectExplorationFocus(args),
			}),
		};
	}

	if (toolName === "mcp_call_tool") {
		return {
			result: await mcpCallTool({
				serverId: args.serverId as string,
				toolName: args.toolName as string,
				arguments: args.arguments as Record<string, unknown> | undefined,
			}),
		};
	}

	if (toolName === "git_status")
		return { result: await gitStatusTool({ repoRoot }) };
	if (toolName === "git_diff")
		return { result: await gitDiffTool({ repoRoot }) };

	throw new Error(`Unsupported tool name: ${toolName}`);
}

function projectExplorationFocus(args: Record<string, unknown>) {
	const legacyFocus = args.focus;
	if (
		legacyFocus &&
		typeof legacyFocus === "object" &&
		!Array.isArray(legacyFocus)
	) {
		return legacyFocus;
	}
	return {
		...(args.paths !== undefined ? { paths: args.paths } : {}),
		...(args.modules !== undefined ? { modules: args.modules } : {}),
		...(args.terms !== undefined ? { terms: args.terms } : {}),
	};
}

const WORKSPACE_SIDE_EFFECT_TOOLS = new Set<WorkerToolName>([
	"import_project",
	"clone_git_repo",
	"copy_directory",
	"materialize_template",
	"apply_patch",
	"replace_content",
	"run_command",
	"run_background_command",
	"run_check",
	"run_verification",
	"collect_test_inventory",
]);
