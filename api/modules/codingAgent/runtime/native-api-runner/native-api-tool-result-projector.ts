import {
	compactModelVisibleText,
	type ModelVisiblePayloadSummary,
} from "../../../../services/model-visible-payload";
import type { WorkerToolResult } from "../../../../services/worker-tools/types";
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

export function projectWorkerResultToMcpStructuredPayload(
	result: WorkerToolResult<unknown>,
): unknown {
	return boundStructuredPayload(
		compactWorkerPayload(result.toolName, result.payload),
		result.toolName,
	);
}

function buildWorkerModelVisibleContent(result: WorkerToolResult<unknown>) {
	const compactPayload = projectWorkerResultToMcpStructuredPayload(result);
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
	if (toolName === "project_exploration_catalog")
		return compactProjectExplorationCatalogPayload(payload);
	if (toolName === "run_check") return compactRunCheckPayload(payload);
	if (toolName === "completion_check")
		return compactCompletionCheckPayload(payload);
	if (toolName === "record_test_condition_mapping")
		return compactTestMappingPayload(payload);
	return payload;
}

function compactRunCheckPayload(payload: unknown) {
	const value = toRecord(payload);
	return {
		llmSummary: value.llmSummary,
		checkKind: value.checkKind,
		exitCode: value.exitCode,
		managedEvidence: value.managedEvidence,
		evidenceRunId: value.evidenceRunId,
		evidenceKinds: value.evidenceKinds,
		rawStdoutArtifactId: value.rawStdoutArtifactId,
		rawStderrArtifactId: value.rawStderrArtifactId,
	};
}

function compactCompletionCheckPayload(payload: unknown) {
	const value = toRecord(payload);
	const result = toRecord(value.result);
	const mapping = toRecord(result.mapping);
	const verify = toRecord(result.verify);
	const confirmation = toRecord(result.confirmation);
	return {
		llmSummary: value.llmSummary,
		result: {
			ready: result.ok,
			verificationDocumentId: result.verificationDocumentId,
			sourceStateHash: result.sourceStateHash,
			mapping: {
				status: mapping.status,
				matched: mapping.matched,
				total: mapping.total,
				definitionDigest: mapping.definitionDigest,
			},
			verify: {
				status: verify.status,
				command: verify.command,
				exitCode: verify.exitCode,
				sourceStateHash: verify.sourceStateHash,
			},
			confirmation: {
				status: confirmation.status,
				initialEvidenceRunId: confirmation.initialEvidenceRunId,
				confirmedAt: confirmation.confirmedAt,
			},
			suggestedAction: result.suggestedAction,
			readinessDigest: result.readinessDigest,
			reason: result.reason,
		},
	};
}

function compactTestMappingPayload(payload: unknown) {
	const value = toRecord(payload);
	return {
		inventoryId: value.inventoryId,
		definitionDigest: value.definitionDigest,
		referenceCount: value.referenceCount,
		mappingCount: value.mappingCount,
		matches: value.matches,
	};
}

function compactProjectExplorationCatalogPayload(payload: unknown) {
	const record = toRecord(payload);
	return {
		status: record.status,
		catalog: record.catalog,
		fallbackToRepositoryExploration: record.status === "unavailable",
	};
}

function compactTodoPayload(payload: unknown) {
	const record = toRecord(payload);
	if (isRecord(record.guidance)) {
		return {
			intentStatus: record.intentStatus,
			guidance: record.guidance,
		};
	}
	const todos = toArray(record.todos).map(toRecord);
	const command = toRecord(record.command);
	const operation = typeof command.op === "string" ? command.op : undefined;
	const next = todos.find((todo) => todo.status === "pending") ?? null;
	return {
		operation,
		progress: countTodos(todos),
		currentTodo: compactCurrentTodo(record.currentTodo),
		nextTodo: compactTodo(next),
	};
}

function compactCurrentTodo(value: unknown) {
	if (!isRecord(value)) return null;
	const todo = toRecord(value);
	return {
		title: todo.title,
		status: todo.status,
		systemContext: todo.systemContext ?? todo.context ?? "",
		lastFailure: todo.lastFailure ?? null,
		attemptCount: todo.attemptCount ?? 0,
	};
}

function compactTodo(value: unknown) {
	if (!isRecord(value)) return null;
	const todo = toRecord(value);
	return {
		title: todo.title,
		status: todo.status,
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
		skipped: count("skipped"),
		needsHuman: count("needs_human"),
		terminal: count("passed") + count("skipped"),
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
						fullPostImportRetainedInAuditPayload: true,
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
		view: record.view,
		generatedAt: record.generatedAt,
		digest,
		contentChars: fullContentChars,
		compactContent:
			record.view === "verification"
				? compactVerificationSpecificationContent(content)
				: buildSpecificationCompactContent(content),
		verification: compactSpecificationVerification(record.verification),
		assembledDesignContext:
			record.view === "verification"
				? undefined
				: compactAssembledDesignContext(record.assembledDesignContext),
		sources: record.sources,
		fullViewAvailableVia: "read_current_specification view='full'",
	};
}

function compactSpecificationVerification(value: unknown) {
	const verification = toRecord(value);
	if (Object.keys(verification).length === 0) return undefined;
	const document = toRecord(verification.document);
	const conditions = toArray(document.conditions).map(toRecord);
	const detailChars = Math.max(
		80,
		Math.min(400, Math.floor(5_400 / Math.max(1, conditions.length * 3))),
	);
	const checklistTextChars = conditions.length > 0 ? 80 : detailChars;
	return {
		verificationDocumentId: verification.verificationDocumentId,
		verificationArtifactId: verification.verificationArtifactId,
		summary: verification.summary,
		document: {
			version: document.version,
			specId: document.specId,
			specPath: document.specPath,
			generatedAt: document.generatedAt,
			conditions: conditions.map((condition) => ({
				id: condition.id,
				text: compactField(condition.text, detailChars),
				category: condition.category,
				verificationKind: condition.verificationKind,
				expectedEvidence: condition.expectedEvidence,
				expectedResult: compactField(condition.expectedResult, detailChars),
				failureMeaning: compactField(condition.failureMeaning, detailChars),
				testCase: compactVerificationTestCase(condition.testCase, detailChars),
				required: condition.required,
			})),
			commands: toArray(document.commands).map((value) => {
				const command = toRecord(value);
				return {
					id: command.id,
					label: command.label,
					command: command.command,
					cwd: command.cwd,
					conditionIds: command.conditionIds,
				};
			}),
		},
		checklist: toArray(verification.checklist).map((value) => {
			const item = toRecord(value);
			const evidenceIds = toArray(item.evidenceIds);
			return {
				conditionId: item.conditionId,
				text: compactField(item.text, checklistTextChars),
				required: item.required,
				status: item.status,
				evidenceIds: evidenceIds.slice(-5),
				evidenceCount: evidenceIds.length,
				lastCheckedAt: item.lastCheckedAt,
				reason: item.reason,
			};
		}),
	};
}

function compactVerificationTestCase(value: unknown, maxChars: number) {
	const testCase = toRecord(value);
	if (Object.keys(testCase).length === 0) return undefined;
	return {
		target: compactField(testCase.target, maxChars),
		preconditions: toArray(testCase.preconditions).map((item) =>
			compactField(item, maxChars),
		),
		action: compactField(testCase.action, maxChars),
		assertions: toArray(testCase.assertions).map((item) =>
			compactField(item, maxChars),
		),
	};
}

function compactVerificationSpecificationContent(content: string) {
	if (content.length <= 1_500) return content;
	return `${content.slice(0, 1_500)}\n[verification-spec-content-truncated]`;
}

function compactField(value: unknown, limit: number) {
	if (typeof value !== "string" || value.length <= limit) return value;
	return `${value.slice(0, Math.max(1, limit - 12))}[truncated]`;
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
		fullDiffRetainedInAuditPayload: true,
	};
}

function boundStructuredPayload(payload: unknown, toolName: string) {
	const serialized = JSON.stringify(payload);
	const limitChars = 12_000;
	if (serialized.length <= limitChars) return payload;
	const projection = compactModelVisibleText({
		content: serialized,
		limitChars,
		strategy: "json_summary",
		omittedReason: `large_${toolName}_structured_payload`,
	});
	return {
		modelVisiblePayload: "compact",
		toolName,
		truncated: true,
		originalChars: projection.summary.originalChars,
		returnedChars: projection.summary.returnedChars,
		contentHash: projection.summary.contentHash,
		excerpt: projection.content,
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
