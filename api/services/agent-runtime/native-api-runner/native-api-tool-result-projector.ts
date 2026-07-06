import type { WorkerToolResult } from "../../worker-tools/types";
import {
	compactModelVisibleText,
	type ModelVisiblePayloadSummary,
} from "../model-visible-payload";
import type { NativeApiToolResult } from "./native-api-tool-history";

export function projectWorkerResultToNativeApiToolResult(
	result: WorkerToolResult<unknown>,
	options: { contentLimitChars?: number } = {},
): NativeApiToolResult {
	const content = buildWorkerModelVisibleContent(result);
	return capNativeApiToolResultContent(
		{
			ok: result.ok,
			content,
			payload: result.payload,
			...(result.error
				? {
						error: {
							code: result.error.code,
							message: result.error.message,
						},
					}
				: {}),
		},
		options,
	);
}

function buildWorkerModelVisibleContent(result: WorkerToolResult<unknown>) {
	const compactPayload = compactWorkerPayload(result.toolName, result.payload);
	return JSON.stringify({
		ok: result.ok,
		toolName: result.toolName,
		payload: compactPayload,
		error: result.error,
		modelVisiblePayload: compactPayload === result.payload ? "full" : "compact",
	});
}

function compactWorkerPayload(toolName: string, payload: unknown): unknown {
	if (toolName === "todo_list") return compactTodoPayload(payload);
	if (toolName === "import_project")
		return compactImportProjectPayload(payload);
	if (toolName === "read_current_specification")
		return compactSpecificationPayload(payload);
	if (toolName === "git_diff") return compactGitDiffPayload(payload);
	return payload;
}

function compactTodoPayload(payload: unknown) {
	const record = toRecord(payload);
	const todos = toArray(record.todos).map(toRecord);
	const operation =
		typeof record.operation === "string" ? record.operation : undefined;
	if (operation === "list") return payload;
	const transition = toRecord(record.transition);
	const diagnostics = toRecord(record.diagnostics);
	const changedSeq =
		readNumber(transition.completedSeq) ??
		readNumber(transition.nextCurrentSeq) ??
		readNumber(toRecord(diagnostics.attemptedAction).seq);
	const changedTodo = changedSeq
		? (todos.find((todo) => readNumber(todo.seq) === changedSeq) ?? null)
		: null;
	return {
		runId: record.runId,
		taskId: record.taskId,
		action: record.action,
		operation,
		changedTodo: compactTodo(changedTodo),
		currentTodo: compactTodo(record.currentTodo),
		nextTodo: compactTodo(record.nextTodo),
		counts: countTodos(todos),
		transition: record.transition,
		diagnostics: record.diagnostics,
		fullListAvailableVia: "todo_list operation=list",
	};
}

function compactTodo(value: unknown) {
	if (!isRecord(value)) return null;
	const todo = toRecord(value);
	return {
		id: todo.id,
		seq: todo.seq,
		title: todo.title,
		status: todo.status,
		taskType: todo.taskType,
		procedureId: todo.procedureId ?? null,
	};
}

function countTodos(todos: Record<string, unknown>[]) {
	const count = (status: string) =>
		todos.filter(
			(todo) => typeof todo.status === "string" && todo.status === status,
		).length;
	return {
		total: todos.length,
		pending: count("pending"),
		running: count("running"),
		passed: count("passed"),
		failed: count("failed"),
		needsHuman: count("needs_human"),
	};
}

function compactImportProjectPayload(payload: unknown) {
	const record = toRecord(payload);
	const postImport = isRecord(record.postImport) ? record.postImport : null;
	const manifest = toRecord(postImport?.manifest);
	const initialization = toRecord(postImport?.initialization);
	const gitInitialization = toRecord(postImport?.gitInitialization);
	const llmContext = toRecord(postImport?.llmContext);
	return {
		mode: record.mode,
		template: compactTemplateImport(record.template),
		git: compactGitImport(record.git),
		postImport:
			postImport !== null
				? {
						targetPath: postImport.targetPath,
						manifest: {
							status: manifest.status,
							packageName: manifest.packageName,
							scripts: manifest.scripts,
							recommendedVerificationCommands:
								manifest.recommendedVerificationCommands,
							notableFiles: manifest.notableFiles,
						},
						llmContext: llmContext
							? {
									status: llmContext.status,
									path: llmContext.path,
									rawContentDigest:
										typeof llmContext.rawContent === "string"
											? `chars:${llmContext.rawContent.length}`
											: null,
									preview:
										typeof llmContext.rawContent === "string"
											? llmContext.rawContent.slice(0, 1200)
											: null,
									errorMessage: llmContext.errorMessage,
								}
							: null,
						gitInitialization: {
							status: gitInitialization.status,
							command: gitInitialization.command,
							baselineCommit: toRecord(gitInitialization.baselineCommit).status,
						},
						initialization: {
							status: initialization.status,
							command: initialization.command,
							skippedReason: initialization.skippedReason,
							errorMessage: initialization.errorMessage,
						},
						fullPostImportRetainedInPayload: true,
					}
				: null,
	};
}

function compactTemplateImport(value: unknown) {
	if (!isRecord(value)) return null;
	const record = toRecord(value);
	return {
		templateId: record.templateId,
		variant: record.variant,
		targetPath: record.targetPath,
		fileCount: toArray(record.files).length,
		files: toArray(record.files).slice(0, 20),
	};
}

function compactGitImport(value: unknown) {
	if (!isRecord(value)) return null;
	const record = toRecord(value);
	return {
		repoUrl: record.repoUrl,
		ref: record.ref,
		targetPath: record.targetPath,
		command: record.command,
	};
}

function compactSpecificationPayload(payload: unknown) {
	const record = toRecord(payload);
	if (record.view === "full") return payload;
	const content = typeof record.content === "string" ? record.content : "";
	const digest = typeof record.digest === "string" ? record.digest : null;
	const fullContentChars =
		readNumber(record.fullContentChars) ?? content.length;
	return {
		taskId: record.taskId,
		found: record.found,
		messageId: record.messageId,
		title: record.title,
		generatedAt: record.generatedAt,
		digest,
		contentChars: fullContentChars,
		compactContent: buildSpecificationCompactContent(content),
		assembledDesignContext: compactAssembledDesignContext(
			record.assembledDesignContext,
		),
		sources: record.sources,
		fullViewAvailableVia: "read_current_specification view='full'",
	};
}

function compactAssembledDesignContext(value: unknown) {
	const record = toRecord(value);
	if (Object.keys(record).length === 0) return undefined;
	const sections = Array.isArray(record.sections) ? record.sections : [];
	return {
		taskId: record.taskId,
		generatedAt: record.generatedAt,
		questionnaireSessionId: record.questionnaireSessionId,
		summary:
			typeof record.summary === "string" && record.summary.length > 1200
				? `${record.summary.slice(0, 1200)}\n[summary-truncated]`
				: record.summary,
		sections: sections.slice(0, 12).map((section) => {
			const sectionRecord = toRecord(section);
			const content =
				typeof sectionRecord.content === "string" ? sectionRecord.content : "";
			return {
				kind: sectionRecord.kind,
				title: sectionRecord.title,
				sourceMessageId: sectionRecord.sourceMessageId,
				digest: sectionRecord.digest,
				content:
					content.length > 1600
						? `${content.slice(0, 1600)}\n[section-truncated]`
						: content,
			};
		}),
		omittedViews: record.omittedViews,
		warnings: record.warnings,
		sourceMessageIds: record.sourceMessageIds,
	};
}

function buildSpecificationCompactContent(content: string) {
	if (content.length <= 8000) return content;
	const headings = content
		.split(/\r?\n/)
		.filter((line) => /^#{1,3}\s+/.test(line))
		.slice(0, 80);
	return [
		"[specification-compact-view]",
		...headings,
		"",
		"## Head",
		content.slice(0, 3000),
		"",
		"## Tail",
		content.slice(-3000),
	].join("\n");
}

function compactGitDiffPayload(payload: unknown) {
	const record = toRecord(payload);
	const diff = typeof record.diff === "string" ? record.diff : "";
	const files = Array.from(
		diff.matchAll(/^diff --git a\/(.+?) b\/(.+)$/gm),
	).map((match) => ({
		oldPath: match[1],
		path: match[2],
	}));
	const hunkCount = (diff.match(/^@@ /gm) ?? []).length;
	const insertions = (diff.match(/^\+/gm) ?? []).length;
	const deletions = (diff.match(/^-/gm) ?? []).length;
	return {
		hasChanges: record.hasChanges,
		diffStat: record.diffStat,
		files: files.slice(0, 100),
		fileCount: files.length,
		hunkCount,
		insertions,
		deletions,
		diffChars: diff.length,
		compactDiff:
			diff.length <= 8000
				? diff
				: [
						"[git-diff-compact-view]",
						diff.slice(0, 3000),
						diff.slice(-3000),
					].join("\n"),
		fullDiffRetainedInPayload: true,
	};
}

function toRecord(value: unknown): Record<string, unknown> {
	return isRecord(value) ? value : {};
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function toArray(value: unknown): unknown[] {
	return Array.isArray(value) ? value : [];
}

function readNumber(value: unknown) {
	return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function capNativeApiToolResultContent(
	result: NativeApiToolResult,
	options: { contentLimitChars?: number; omittedReason?: string } = {},
): NativeApiToolResult {
	const projection = compactModelVisibleText({
		content: result.content,
		limitChars: options.contentLimitChars,
		strategy: "json_summary",
		omittedReason:
			options.omittedReason ?? "large_native_api_tool_result_content",
	});
	return {
		...result,
		content: projection.content,
		modelVisibleSummary: projection.summary,
	};
}

export function buildNativeApiModelVisibleSummary(input: {
	content: string;
	contentLimitChars?: number;
	omittedReason?: string;
}): ModelVisiblePayloadSummary {
	return compactModelVisibleText({
		content: input.content,
		limitChars: input.contentLimitChars,
		strategy: "json_summary",
		omittedReason:
			input.omittedReason ?? "large_native_api_tool_result_content",
	}).summary;
}
