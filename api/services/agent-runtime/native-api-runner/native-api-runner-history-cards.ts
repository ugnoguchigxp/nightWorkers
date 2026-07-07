import * as repo from "../../../modules/nightworkers/nightworkers.repository";
import { toRecord } from "./native-api-runner-routing";
import type { NativeApiPostImportState } from "./native-api-tool-dispatcher";
import type { NativeApiHistoryItem } from "./native-api-tool-history";

export type NativeApiRuntimeTodoSnapshot = {
	seq: number;
	title: string;
	description?: string | null;
	taskType: string;
	status: string;
	procedureId?: string | null;
};

export async function buildTodoSnapshotHistory(runId: string): Promise<{
	snapshotItem: Extract<NativeApiHistoryItem, { type: "user" }> | null;
	currentTodoItem: Extract<NativeApiHistoryItem, { type: "user" }> | null;
	currentTodo: NativeApiRuntimeTodoSnapshot | null;
} | null> {
	try {
		const todos = await repo.listTaskRunTodosForRun(runId);
		if (todos.length === 0) return null;
		const lines = todos
			.sort((a, b) => a.seq - b.seq)
			.map((todo) => {
				const title = todo.title.replace(/\s+/g, " ").trim();
				return `seq=${todo.seq} status=${todo.status} taskType=${todo.taskType} procedureId=${todo.procedureId ?? "none"} title=${title}`;
			});
		const currentTodo =
			todos
				.filter((todo) => todo.status === "running")
				.sort((a, b) => a.seq - b.seq)
				.map((todo) => ({
					seq: todo.seq,
					title: todo.title,
					description: todo.description,
					taskType: todo.taskType,
					status: todo.status,
					procedureId: todo.procedureId,
				}))[0] ?? null;
		return {
			snapshotItem: {
				type: "user",
				source: "todo",
				content: ["[Native API Runner Todo Snapshot]", ...lines].join("\n"),
			},
			currentTodoItem: currentTodo
				? {
						type: "user",
						source: "todo",
						content: renderRuntimeTodoContext(currentTodo),
					}
				: null,
			currentTodo,
		};
	} catch {
		return null;
	}
}

function renderRuntimeTodoContext(currentTodo: NativeApiRuntimeTodoSnapshot) {
	return [
		"[Current Native API Runner Todo]",
		`seq=${currentTodo.seq}`,
		`title=${currentTodo.title}`,
		...(currentTodo.description
			? [`description=${currentTodo.description.replace(/\s+/g, " ").trim()}`]
			: []),
		`taskType=${currentTodo.taskType}`,
		`procedureId=${currentTodo.procedureId ?? "none"}`,
		`status=${currentTodo.status}`,
	].join("\n");
}

export function buildPostImportHistoryItem(
	postImport: NativeApiPostImportState,
): Extract<NativeApiHistoryItem, { type: "user" }> {
	const manifest = toRecord(postImport.manifest);
	const packageJson = toRecord(manifest?.packageJson);
	const scripts = toRecord(packageJson?.scripts);
	return {
		type: "user",
		source: "state_card",
		content: [
			"[Native API Runner Post Import]",
			`toolCallId=${postImport.toolCallId}`,
			`mode=${postImport.mode}`,
			`templateId=${postImport.templateId ?? "none"}`,
			`variant=${postImport.variant ?? "none"}`,
			`manifestStatus=${typeof manifest?.status === "string" ? manifest.status : "unknown"}`,
			`manifestPath=${typeof manifest?.path === "string" ? manifest.path : "unknown"}`,
			`detectedPackageManager=${
				typeof manifest?.detectedPackageManager === "string"
					? manifest.detectedPackageManager
					: "unknown"
			}`,
			`scripts=${Object.keys(scripts ?? {}).join(", ") || "none"}`,
			`recommendedVerificationCommands=${
				postImport.recommendedVerificationCommands.join(" | ") || "none"
			}`,
			`verifiedCommand=${postImport.verifiedCommand ?? "none"}`,
			postImport.llmContext ? "llmContext=available" : "llmContext=missing",
			"",
			"Use this postImport payload before re-reading package manifests. If recommended verification commands exist, run one successfully before finalize_answer.",
			"When package.json contains a verify script, treat the recommended verify command as the representative final verification. Use typecheck/lint/test/build as focused checks or fallbacks only when verify is unavailable or cannot run.",
		].join("\n"),
	};
}
