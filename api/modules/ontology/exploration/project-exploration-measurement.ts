import {
	projectExplorationCatalogResultSchema,
	projectExplorationCatalogRunPinSchema,
} from "../../../../shared/schemas/project-exploration-catalog.schema";

export type ExplorationReductionMeasurement = {
	runId: string;
	taskId: string;
	repositoryId: string;
	mode: "baseline" | "catalog";
	generationId: string | null;
	catalogCalled: boolean;
	catalogCallCount: number;
	catalogResponseBytes: number;
	catalogFileCount: number;
	catalogTestCount: number;
	catalogVerificationCount: number;
	listDirCallsBeforeMutation: number;
	searchCallsBeforeMutation: number;
	readFileCallsBeforeMutation: number;
	uniqueFilesReadBeforeMutation: number;
	totalInputTokens: number | null;
	totalCachedInputTokens: number | null;
	usageMode: "measured" | "estimated" | "mixed" | "unavailable";
	timeToFirstMutationMs: number | null;
	taskCompleted: boolean;
	verificationPassed: boolean | null;
	replanCount: number;
	warnings: string[];
};

type MeasurementEvent = {
	seq?: number;
	timestamp?: Date | string;
	type?: string;
	payloadJson?: unknown;
	data?: Record<string, unknown>;
};

type MeasurementUsage = {
	inputTokens: number | null;
	cachedInputTokens: number | null;
	usageMode: string;
};

export function measureProjectExplorationRun(input: {
	run: {
		id: string;
		taskId: string;
		repositoryId: string | null;
		startedAt: Date;
		status: string;
		contextSnapshot: unknown;
	};
	events: MeasurementEvent[];
	usageRecords: MeasurementUsage[];
}): ExplorationReductionMeasurement {
	const pin = readPin(input.run.contextSnapshot);
	const warnings = new Set<string>();
	let catalogCallCount = 0;
	let catalogResponseBytes = 0;
	let catalogFileCount = 0;
	let catalogTestCount = 0;
	let catalogVerificationCount = 0;
	let firstCatalogParsed = false;
	let listDirCallsBeforeMutation = 0;
	let searchCallsBeforeMutation = 0;
	let readFileCallsBeforeMutation = 0;
	const filesRead = new Set<string>();
	let mutationAt: Date | null = null;
	let verificationPassed: boolean | null = null;
	let replanCount = 0;

	const events = [...input.events].sort(
		(left, right) =>
			readSeq(left) - readSeq(right) ||
			readTimestamp(left).getTime() - readTimestamp(right).getTime(),
	);
	for (const event of events) {
		if (eventType(event) !== "tool.call_finished") continue;
		const data = eventData(event);
		const toolName = stringValue(data.toolName);
		const ok = data.ok === true;
		const args = recordValue(data.arguments);

		if (toolName === "run_verification" || toolName === "completion_check") {
			verificationPassed = ok;
		}
		if (toolName === "todo_list" && ok && args?.operation === "replace") {
			replanCount += 1;
		}

		if (mutationAt) continue;
		if (ok && (toolName === "apply_patch" || toolName === "replace_content")) {
			mutationAt = readTimestamp(event);
			continue;
		}
		if (!ok) continue;
		if (toolName === "list_dir") listDirCallsBeforeMutation += 1;
		if (toolName === "search_files") searchCallsBeforeMutation += 1;
		if (toolName === "read_file") {
			readFileCallsBeforeMutation += 1;
			const filePath = stringValue(args?.filePath);
			if (filePath) filesRead.add(filePath);
		}
		if (
			toolName === "mcp_call_tool" &&
			args?.toolName === "vuln_get_project_exploration_catalog"
		) {
			catalogCallCount += 1;
			const workerPayload = recordValue(data.result);
			const mcpResult = recordValue(workerPayload?.result);
			const content = Array.isArray(mcpResult?.content)
				? mcpResult.content
				: [];
			const textBlocks = content.flatMap((block) => {
				const record = recordValue(block);
				return record?.type === "text" && typeof record.text === "string"
					? [record.text]
					: [];
			});
			catalogResponseBytes += textBlocks.reduce(
				(total, text) => total + Buffer.byteLength(text, "utf8"),
				0,
			);
			let parsedCatalog: ReturnType<
				typeof projectExplorationCatalogResultSchema.safeParse
			> | null = null;
			try {
				parsedCatalog = projectExplorationCatalogResultSchema.safeParse(
					JSON.parse(textBlocks.join("\n")),
				);
				if (!parsedCatalog.success) throw parsedCatalog.error;
			} catch {
				warnings.add("catalog_result_invalid");
			}
			if (!firstCatalogParsed) {
				firstCatalogParsed = true;
				if (parsedCatalog?.success) {
					const parsed = parsedCatalog;
					catalogFileCount = parsed.data.likelyFiles.length;
					catalogTestCount = parsed.data.relatedTests.length;
					catalogVerificationCount = parsed.data.verificationCandidates.length;
				}
			}
		}
	}

	const totalInputTokens = sumNullable(
		input.usageRecords.map((record) => record.inputTokens),
	);
	const totalCachedInputTokens = sumNullable(
		input.usageRecords.map((record) => record.cachedInputTokens),
	);
	return {
		runId: input.run.id,
		taskId: input.run.taskId,
		repositoryId: input.run.repositoryId ?? "",
		mode: pin?.available ? "catalog" : "baseline",
		generationId: pin?.available ? pin.generationId : null,
		catalogCalled: catalogCallCount > 0,
		catalogCallCount,
		catalogResponseBytes,
		catalogFileCount,
		catalogTestCount,
		catalogVerificationCount,
		listDirCallsBeforeMutation,
		searchCallsBeforeMutation,
		readFileCallsBeforeMutation,
		uniqueFilesReadBeforeMutation: filesRead.size,
		totalInputTokens,
		totalCachedInputTokens,
		usageMode: aggregateUsageMode(input.usageRecords),
		timeToFirstMutationMs: mutationAt
			? Math.max(0, mutationAt.getTime() - input.run.startedAt.getTime())
			: null,
		taskCompleted: input.run.status === "completed",
		verificationPassed,
		replanCount,
		warnings: [...warnings].sort(),
	};
}

export function summarizeProjectExplorationPair(input: {
	baseline: ExplorationReductionMeasurement;
	catalog: ExplorationReductionMeasurement;
}) {
	const exploratoryCalls = (measurement: ExplorationReductionMeasurement) =>
		measurement.listDirCallsBeforeMutation +
		measurement.searchCallsBeforeMutation +
		measurement.readFileCallsBeforeMutation +
		(measurement.mode === "catalog" ? measurement.catalogCallCount : 0);
	return {
		baselineRunId: input.baseline.runId,
		catalogRunId: input.catalog.runId,
		exploratoryToolCalls: comparison(
			exploratoryCalls(input.baseline),
			exploratoryCalls(input.catalog),
		),
		uniqueFilesReadBeforeMutation: comparison(
			input.baseline.uniqueFilesReadBeforeMutation,
			input.catalog.uniqueFilesReadBeforeMutation,
		),
		totalInputTokens: nullableComparison(
			input.baseline.totalInputTokens,
			input.catalog.totalInputTokens,
		),
		totalCachedInputTokens: nullableComparison(
			input.baseline.totalCachedInputTokens,
			input.catalog.totalCachedInputTokens,
		),
		timeToFirstMutationMs: nullableComparison(
			input.baseline.timeToFirstMutationMs,
			input.catalog.timeToFirstMutationMs,
		),
		quality: {
			baselineCompleted: input.baseline.taskCompleted,
			catalogCompleted: input.catalog.taskCompleted,
			baselineVerificationPassed: input.baseline.verificationPassed,
			catalogVerificationPassed: input.catalog.verificationPassed,
			baselineReplanCount: input.baseline.replanCount,
			catalogReplanCount: input.catalog.replanCount,
		},
	};
}

function readPin(contextSnapshot: unknown) {
	const snapshot = recordValue(contextSnapshot);
	const parsed = projectExplorationCatalogRunPinSchema.safeParse(
		snapshot?.projectExplorationCatalog,
	);
	return parsed.success ? parsed.data : null;
}

function eventData(event: MeasurementEvent): Record<string, unknown> {
	if (event.data) return event.data;
	const payload = recordValue(event.payloadJson);
	const runEvent = recordValue(payload?.runEvent);
	return recordValue(runEvent?.data) ?? {};
}

function eventType(event: MeasurementEvent): string {
	const payload = recordValue(event.payloadJson);
	const runEvent = recordValue(payload?.runEvent);
	return stringValue(runEvent?.type) ?? event.type ?? "";
}

function readSeq(event: MeasurementEvent): number {
	const payload = recordValue(event.payloadJson);
	const runEvent = recordValue(payload?.runEvent);
	const value = runEvent?.seq ?? event.seq;
	return typeof value === "number" ? value : Number.MAX_SAFE_INTEGER;
}

function readTimestamp(event: MeasurementEvent): Date {
	const payload = recordValue(event.payloadJson);
	const runEvent = recordValue(payload?.runEvent);
	const value = runEvent?.timestamp ?? event.timestamp;
	const date = value instanceof Date ? value : new Date(String(value ?? 0));
	return Number.isNaN(date.getTime()) ? new Date(0) : date;
}

function recordValue(value: unknown): Record<string, unknown> | null {
	return value && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: null;
}

function stringValue(value: unknown): string | null {
	return typeof value === "string" && value.length > 0 ? value : null;
}

function sumNullable(values: Array<number | null>): number | null {
	const available = values.filter((value): value is number => value !== null);
	return available.length > 0
		? available.reduce((sum, value) => sum + value, 0)
		: null;
}

function aggregateUsageMode(
	records: MeasurementUsage[],
): ExplorationReductionMeasurement["usageMode"] {
	if (records.length === 0) return "unavailable";
	const modes = new Set(records.map((record) => record.usageMode));
	if (modes.size === 1 && modes.has("measured")) return "measured";
	if (modes.size === 1 && modes.has("estimated")) return "estimated";
	return "mixed";
}

function comparison(baseline: number, catalog: number) {
	return {
		baseline,
		catalog,
		reductionRate: baseline === 0 ? null : (baseline - catalog) / baseline,
	};
}

function nullableComparison(baseline: number | null, catalog: number | null) {
	return baseline === null || catalog === null
		? { baseline, catalog, reductionRate: null }
		: comparison(baseline, catalog);
}
