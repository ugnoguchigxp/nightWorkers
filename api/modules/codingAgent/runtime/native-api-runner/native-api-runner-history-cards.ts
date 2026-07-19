import * as repo from "../../../nightworkers/nightworkers.repository";
import { toRecord } from "./native-api-runner-routing";
import type { NativeApiPostImportState } from "./native-api-tool-dispatcher";
import type { NativeApiHistoryItem } from "./native-api-tool-history";

export type NativeApiRuntimeTodoSnapshot = {
	id: string;
	todoKey: string;
	seq: number;
	revision: number;
	title: string;
	objective: string | null;
	context: string | null;
	nextAction: string;
	acceptanceCriteria: string[];
	dependsOn: string[];
	lastFailure: string | null;
	attemptCount: number;
	statusReason: string | null;
	systemContextVersion: number;
	systemContextSnapshot: unknown;
	status: string;
};

export async function buildTodoSnapshotHistory(runId: string): Promise<{
	planRevision: number;
	todoRevisions: Record<string, number>;
	snapshotItem: Extract<NativeApiHistoryItem, { type: "user" }> | null;
	currentTodoItem: Extract<NativeApiHistoryItem, { type: "user" }> | null;
	currentTodo: NativeApiRuntimeTodoSnapshot | null;
} | null> {
	try {
		const [run, todos] = await Promise.all([
			repo.getTaskRun(runId),
			repo.listTaskRunTodosForRun(runId),
		]);
		if (todos.length === 0) return null;
		const lines = todos
			.sort((a, b) => a.seq - b.seq)
			.map((todo) => {
				const title = todo.title.replace(/\s+/g, " ").trim();
				return `id=${todo.id} todoKey=${todo.todoKey} seq=${todo.seq} revision=${todo.revision} status=${todo.status} title=${title}`;
			});
		const currentTodo =
			todos
				.filter((todo) => todo.status === "running")
				.sort((a, b) => a.seq - b.seq)
				.map((todo) => ({
					id: todo.id,
					todoKey: todo.todoKey,
					seq: todo.seq,
					revision: todo.revision,
					title: todo.title,
					objective: todo.objective ?? todo.description ?? null,
					context: todo.context,
					nextAction: todo.nextAction,
					acceptanceCriteria: Array.isArray(todo.acceptanceCriteriaJson)
						? todo.acceptanceCriteriaJson
						: [],
					dependsOn: Array.isArray(todo.dependsOn)
						? todo.dependsOn.filter(
								(value): value is string => typeof value === "string",
							)
						: [],
					lastFailure: todo.lastFailure,
					attemptCount: todo.attemptCount,
					statusReason: todo.statusReason,
					systemContextVersion: todo.systemContextVersion,
					systemContextSnapshot: todo.systemContextSnapshot,
					status: todo.status,
				}))[0] ?? null;
		return {
			planRevision: run?.todoPlanRevision ?? 0,
			todoRevisions: Object.fromEntries(
				todos.map((todo) => [todo.id, todo.revision]),
			),
			snapshotItem: {
				type: "user",
				source: "todo",
				content: [
					"[Native API Runner Todo Snapshot]",
					`planRevision=${run?.todoPlanRevision ?? 0}`,
					...lines,
				].join("\n"),
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
		`id=${currentTodo.id}`,
		`todoKey=${currentTodo.todoKey}`,
		`seq=${currentTodo.seq}`,
		`revision=${currentTodo.revision}`,
		`title=${currentTodo.title}`,
		`objective=${currentTodo.objective ?? ""}`,
		`context=${currentTodo.context ?? ""}`,
		`nextAction=${currentTodo.nextAction}`,
		`acceptanceCriteria=${JSON.stringify(currentTodo.acceptanceCriteria)}`,
		`dependsOn=${JSON.stringify(currentTodo.dependsOn)}`,
		`lastFailure=${currentTodo.lastFailure ?? ""}`,
		`attemptCount=${currentTodo.attemptCount}`,
		`statusReason=${currentTodo.statusReason ?? ""}`,
		`systemContextVersion=${currentTodo.systemContextVersion}`,
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
			postImport.llmContext ? "llmContext=available" : "llmContext=missing",
			"",
			"Use this postImport payload before re-reading package manifests. Recommended verification commands are available as facts for the Coding Agent to evaluate.",
			"When package.json contains a verify script, treat the recommended verify command as the representative final verification. Use typecheck/lint/test/build as focused checks or fallbacks only when verify is unavailable or cannot run.",
		].join("\n"),
	};
}
