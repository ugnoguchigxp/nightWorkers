import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import { promisify } from "node:util";
import type { RuntimePromptSnapshot } from "../../../services/todo-context";
import { STARTER_STACKS } from "../../../services/worker-tools/template-registry";
import { requireCodingAgentHost } from "../ports/coding-agent-host.binding";

const execFileAsync = promisify(execFile);
const DIRECTORY_ENTRY_PAGE_LIMIT = 200;

export type CodexRepositoryPreflight = {
	version: 1;
	ready: boolean;
	workingDirectory: {
		requested: string;
		resolved: string;
	};
	directoryEntries: string[];
	directoryEntryPage: {
		offset: 0;
		limit: number;
		total: number;
		hasMore: boolean;
		digest: string;
	};
	gitHead: string | null;
	materialization: unknown;
	importTemplateRegistry: {
		available: true;
		starterStacks: string[];
	};
	checks: Array<{
		name: "pwd" | "ls" | "git_head" | "import_template_registry";
		status: "passed" | "failed";
	}>;
};

/**
 * Codexへ処理を渡す前に、registered workspaceそのものを固定手順で確認する。
 * ユーザー文言の解釈やstack選択は行わず、観測結果だけをtraceへ残す。
 */
export async function inspectCodexRepositoryPreflight(input: {
	repositoryRoot: string;
	materialization: unknown;
}): Promise<CodexRepositoryPreflight> {
	const resolved = await fs.realpath(input.repositoryRoot);
	const allDirectoryEntries = (
		await fs.readdir(resolved, { withFileTypes: true })
	)
		.map((entry) => `${entry.name}${entry.isDirectory() ? "/" : ""}`)
		.sort((left, right) => left.localeCompare(right));
	const directoryEntries = allDirectoryEntries.slice(
		0,
		DIRECTORY_ENTRY_PAGE_LIMIT,
	);
	const gitHead = await execFileAsync(
		"git",
		["rev-parse", "--verify", "HEAD^{commit}"],
		{ cwd: resolved },
	)
		.then((result) => result.stdout.trim() || null)
		.catch(() => null);
	return {
		version: 1,
		ready: Boolean(gitHead),
		workingDirectory: {
			requested: input.repositoryRoot,
			resolved,
		},
		directoryEntries,
		directoryEntryPage: {
			offset: 0,
			limit: DIRECTORY_ENTRY_PAGE_LIMIT,
			total: allDirectoryEntries.length,
			hasMore: allDirectoryEntries.length > directoryEntries.length,
			digest: createHash("sha256")
				.update(JSON.stringify(allDirectoryEntries))
				.digest("hex"),
		},
		gitHead,
		materialization: input.materialization,
		importTemplateRegistry: {
			available: true,
			starterStacks: [...STARTER_STACKS],
		},
		checks: [
			{ name: "pwd", status: "passed" },
			{ name: "ls", status: "passed" },
			{ name: "git_head", status: gitHead ? "passed" : "failed" },
			{ name: "import_template_registry", status: "passed" },
		],
	};
}

export async function prepareCodexRepositoryRuntimeContext(input: {
	runId: string;
	taskId: string;
	repositoryRoot: string;
	contextSnapshot: RuntimePromptSnapshot;
}) {
	const repositoryPreflight = await inspectCodexRepositoryPreflight({
		repositoryRoot: input.repositoryRoot,
		materialization: input.contextSnapshot.repositoryMaterialization,
	});
	const contextSnapshot = {
		...input.contextSnapshot,
		repositoryPreflight,
	};
	const host = requireCodingAgentHost();
	const current = await host.runReader.getRun(input.runId);
	if (!current) throw new Error("CODEX_REPOSITORY_PREFLIGHT_RUN_NOT_FOUND");
	const updated = await host.runLifecycle.updateRunContext({
		runId: input.runId,
		expectedUpdatedAt: current.updatedAt,
		expectedStatuses: [current.status],
		contextSnapshot,
	});
	if (updated.kind !== "applied")
		throw new Error("CODEX_REPOSITORY_PREFLIGHT_CONTEXT_CONFLICT");
	await host.runJournal.appendRunEvent({
		version: 1,
		runId: input.runId,
		taskId: input.taskId,
		timestamp: new Date().toISOString(),
		type: "system.info",
		severity: repositoryPreflight.ready ? "info" : "error",
		actor: "runtime",
		message: repositoryPreflight.ready
			? "Codex repository preflight passed (pwd, ls, Git HEAD, import template registry)."
			: "Codex repository preflight failed before provider execution.",
		data: {
			action: "codex.repository_preflight",
			repositoryPreflight,
		},
	});
	if (!repositoryPreflight.ready) {
		throw new Error(
			"CODEX_REPOSITORY_PREFLIGHT_FAILED: Git HEAD is missing. Apply the stored repository materialization intent before starting Codex.",
		);
	}
	return contextSnapshot;
}
