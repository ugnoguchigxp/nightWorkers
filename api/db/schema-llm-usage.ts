import {
	index,
	integer,
	real,
	sqliteTable,
	text,
	uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { commonColumns, repositories, tasks } from "./schema-base";
import { taskRuns } from "./schema-task-execution";

export const llmUsageRecords = sqliteTable(
	"llm_usage_records",
	{
		...commonColumns,
		taskId: text("task_id")
			.notNull()
			.references(() => tasks.id, { onDelete: "cascade" }),
		runId: text("run_id").references(() => taskRuns.id, {
			onDelete: "set null",
		}),
		callId: text("call_id").notNull(),
		provider: text("provider").notNull(),
		model: text("model"),
		label: text("label").notNull(),
		round: integer("round"),
		usageMode: text("usage_mode").notNull(),
		inputTokens: integer("input_tokens"),
		outputTokens: integer("output_tokens"),
		cachedInputTokens: integer("cached_input_tokens"),
		reasoningOutputTokens: integer("reasoning_output_tokens"),
		totalTokens: integer("total_tokens"),
		systemPromptTokens: integer("system_prompt_tokens"),
		userPromptTokens: integer("user_prompt_tokens"),
		stateCardTokens: integer("state_card_tokens"),
		responseTokensEstimate: integer("response_tokens_estimate"),
		durationMs: integer("duration_ms").notNull(),
		rawUsageJson: text("raw_usage_json", { mode: "json" }),
		metadataJson: text("metadata_json", { mode: "json" }),
	},
	(table) => ({
		taskCreatedIdx: index("llm_usage_records_task_created_idx").on(
			table.taskId,
			table.createdAt,
		),
		runCreatedIdx: index("llm_usage_records_run_created_idx").on(
			table.runId,
			table.createdAt,
		),
		callIdUniqueIdx: uniqueIndex("llm_usage_records_call_id_uidx").on(
			table.callId,
		),
		providerCreatedIdx: index("llm_usage_records_provider_created_idx").on(
			table.provider,
			table.createdAt,
		),
	}),
);

export const llmModelPricing = sqliteTable(
	"llm_model_pricing",
	{
		...commonColumns,
		provider: text("provider").notNull(),
		model: text("model").notNull(),
		currencyCode: text("currency_code").default("USD").notNull(),
		inputPer1m: real("input_per_1m"),
		cachedInputPer1m: real("cached_input_per_1m"),
		outputPer1m: real("output_per_1m"),
		reasoningOutputPer1m: real("reasoning_output_per_1m"),
		sourceUrl: text("source_url"),
		sourceLabel: text("source_label"),
		effectiveFrom: integer("effective_from", { mode: "timestamp" })
			.$defaultFn(() => new Date(0))
			.notNull(),
		fetchedAt: integer("fetched_at", { mode: "timestamp" }),
		manualOverride: integer("manual_override", { mode: "boolean" })
			.default(false)
			.notNull(),
		enabled: integer("enabled", { mode: "boolean" }).default(true).notNull(),
	},
	(table) => ({
		providerModelIdx: index("llm_model_pricing_provider_model_idx").on(
			table.provider,
			table.model,
		),
		enabledIdx: index("llm_model_pricing_enabled_idx").on(table.enabled),
		providerModelCurrencyEffectiveUniqueIdx: uniqueIndex(
			"llm_model_pricing_provider_model_currency_effective_uidx",
		).on(table.provider, table.model, table.currencyCode, table.effectiveFrom),
	}),
);

export const llmUsageSummaryBuckets = sqliteTable(
	"llm_usage_summary_buckets",
	{
		...commonColumns,
		bucketHourUtc: integer("bucket_hour_utc", { mode: "timestamp" }).notNull(),
		repositoryId: text("repository_id").references(() => repositories.id, {
			onDelete: "cascade",
		}),
		repositoryKey: text("repository_key").notNull(),
		provider: text("provider").notNull(),
		model: text("model"),
		modelKey: text("model_key").notNull(),
		pricingCurrencyCode: text("pricing_currency_code"),
		pricingCurrencyKey: text("pricing_currency_key").notNull(),
		pricingStatus: text("pricing_status").notNull(),
		inputTokens: integer("input_tokens").default(0).notNull(),
		outputTokens: integer("output_tokens").default(0).notNull(),
		cachedInputTokens: integer("cached_input_tokens").default(0).notNull(),
		reasoningOutputTokens: integer("reasoning_output_tokens")
			.default(0)
			.notNull(),
		systemPromptTokens: integer("system_prompt_tokens").default(0).notNull(),
		userPromptTokens: integer("user_prompt_tokens").default(0).notNull(),
		stateCardTokens: integer("state_card_tokens").default(0).notNull(),
		totalTokens: integer("total_tokens").default(0).notNull(),
		totalDurationMs: integer("total_duration_ms").default(0).notNull(),
		outputDurationMs: integer("output_duration_ms").default(0).notNull(),
		measuredDurationCallCount: integer("measured_duration_call_count")
			.default(0)
			.notNull(),
		callCount: integer("call_count").default(0).notNull(),
		measuredCallCount: integer("measured_call_count").default(0).notNull(),
		estimatedCallCount: integer("estimated_call_count").default(0).notNull(),
		mixedCallCount: integer("mixed_call_count").default(0).notNull(),
		unavailableCallCount: integer("unavailable_call_count")
			.default(0)
			.notNull(),
		pricedCallCount: integer("priced_call_count").default(0).notNull(),
		unpricedCallCount: integer("unpriced_call_count").default(0).notNull(),
		manualPricedCallCount: integer("manual_priced_call_count")
			.default(0)
			.notNull(),
		estimatedCost: real("estimated_cost").default(0).notNull(),
		inputCost: real("input_cost").default(0).notNull(),
		cachedInputCost: real("cached_input_cost").default(0).notNull(),
		outputCost: real("output_cost").default(0).notNull(),
		reasoningOutputCost: real("reasoning_output_cost").default(0).notNull(),
		pricingUpdatedAt: integer("pricing_updated_at", { mode: "timestamp" }),
	},
	(table) => ({
		bucketUniqueIdx: uniqueIndex("llm_usage_summary_buckets_uidx").on(
			table.bucketHourUtc,
			table.repositoryKey,
			table.provider,
			table.modelKey,
			table.pricingCurrencyKey,
			table.pricingStatus,
		),
		bucketIdx: index("llm_usage_summary_buckets_hour_idx").on(
			table.bucketHourUtc,
		),
		repositoryBucketIdx: index(
			"llm_usage_summary_buckets_repository_hour_idx",
		).on(table.repositoryKey, table.bucketHourUtc),
		modelBucketIdx: index("llm_usage_summary_buckets_model_hour_idx").on(
			table.provider,
			table.modelKey,
			table.bucketHourUtc,
		),
	}),
);

export const llmUsageSummaryWarnings = sqliteTable(
	"llm_usage_summary_warnings",
	{
		...commonColumns,
		bucketHourUtc: integer("bucket_hour_utc", { mode: "timestamp" }).notNull(),
		repositoryId: text("repository_id").references(() => repositories.id, {
			onDelete: "cascade",
		}),
		repositoryKey: text("repository_key").notNull(),
		provider: text("provider").notNull(),
		model: text("model"),
		modelKey: text("model_key").notNull(),
		code: text("code").notNull(),
		detailKey: text("detail_key").notNull(),
		detailJson: text("detail_json", { mode: "json" }).$type<
			Record<string, unknown>
		>(),
		callCount: integer("call_count").default(0).notNull(),
	},
	(table) => ({
		warningUniqueIdx: uniqueIndex("llm_usage_summary_warnings_uidx").on(
			table.bucketHourUtc,
			table.repositoryKey,
			table.provider,
			table.modelKey,
			table.code,
			table.detailKey,
		),
		repositoryBucketIdx: index(
			"llm_usage_summary_warnings_repository_hour_idx",
		).on(table.repositoryKey, table.bucketHourUtc),
		codeIdx: index("llm_usage_summary_warnings_code_idx").on(table.code),
	}),
);

export const llmUsageSummaryTaskBuckets = sqliteTable(
	"llm_usage_summary_task_buckets",
	{
		...commonColumns,
		bucketHourUtc: integer("bucket_hour_utc", { mode: "timestamp" }).notNull(),
		repositoryId: text("repository_id").references(() => repositories.id, {
			onDelete: "cascade",
		}),
		repositoryKey: text("repository_key").notNull(),
		taskId: text("task_id")
			.notNull()
			.references(() => tasks.id, { onDelete: "cascade" }),
		pricingCurrencyCode: text("pricing_currency_code"),
		pricingCurrencyKey: text("pricing_currency_key").notNull(),
		pricingStatus: text("pricing_status").notNull(),
		inputTokens: integer("input_tokens").default(0).notNull(),
		outputTokens: integer("output_tokens").default(0).notNull(),
		cachedInputTokens: integer("cached_input_tokens").default(0).notNull(),
		reasoningOutputTokens: integer("reasoning_output_tokens")
			.default(0)
			.notNull(),
		systemPromptTokens: integer("system_prompt_tokens").default(0).notNull(),
		userPromptTokens: integer("user_prompt_tokens").default(0).notNull(),
		stateCardTokens: integer("state_card_tokens").default(0).notNull(),
		totalTokens: integer("total_tokens").default(0).notNull(),
		totalDurationMs: integer("total_duration_ms").default(0).notNull(),
		outputDurationMs: integer("output_duration_ms").default(0).notNull(),
		measuredDurationCallCount: integer("measured_duration_call_count")
			.default(0)
			.notNull(),
		callCount: integer("call_count").default(0).notNull(),
		pricedCallCount: integer("priced_call_count").default(0).notNull(),
		estimatedCost: real("estimated_cost").default(0).notNull(),
	},
	(table) => ({
		taskBucketUniqueIdx: uniqueIndex("llm_usage_summary_task_buckets_uidx").on(
			table.bucketHourUtc,
			table.repositoryKey,
			table.taskId,
			table.pricingCurrencyKey,
			table.pricingStatus,
		),
		taskRepositoryIdx: index(
			"llm_usage_summary_task_buckets_repository_idx",
		).on(table.repositoryKey, table.taskId),
		taskBucketIdx: index("llm_usage_summary_task_buckets_hour_idx").on(
			table.bucketHourUtc,
		),
	}),
);

export const runtimeRetentionAuditEvents = sqliteTable(
	"runtime_retention_audit_events",
	{
		...commonColumns,
		eventType: text("event_type").notNull(),
		status: text("status").notNull(),
		startedAt: integer("started_at", { mode: "timestamp" }).notNull(),
		finishedAt: integer("finished_at", { mode: "timestamp" }),
		settingsSnapshotJson: text("settings_snapshot_json", {
			mode: "json",
		}).$type<Record<string, unknown>>(),
		rowsDeletedJson: text("rows_deleted_json", { mode: "json" }).$type<
			Record<string, number>
		>(),
		errorSummary: text("error_summary"),
	},
	(table) => ({
		createdAtIdx: index("runtime_retention_audit_events_created_idx").on(
			table.createdAt,
		),
		eventTypeCreatedAtIdx: index(
			"runtime_retention_audit_events_type_created_idx",
		).on(table.eventType, table.createdAt),
	}),
);
