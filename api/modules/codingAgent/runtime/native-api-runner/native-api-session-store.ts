import { and, asc, desc, eq } from "drizzle-orm";
import { client, db } from "../../../../db/client";
import { nativeApiToolCalls, nativeApiTurns } from "../../../../db/schema";
import { compactModelVisibleText } from "../../../../services/model-visible-payload";
import type { ProviderToolCall } from "../../../../services/structured-llm/tool-calls";
import type { NativeApiExecutionMode } from "./native-api-mode";
import type {
	NativeApiHistoryItem,
	NativeApiToolResult,
} from "./native-api-tool-history";

export type NativeApiTurnStatus =
	| "running"
	| "completed"
	| "failed"
	| "cancelled";
export type NativeApiToolCallStatus =
	| "pending"
	| "running"
	| "completed"
	| "failed"
	| "cancelled";

export class NativeApiSessionStore {
	private ensureTablesPromise: Promise<void> | null = null;

	async createTurn(input: {
		runId: string;
		taskId: string;
		turnIndex: number;
		agentModeSessionId?: string | null;
		history: readonly NativeApiHistoryItem[];
		provider?: string | null;
		model?: string | null;
		executionMode?: NativeApiExecutionMode | null;
	}) {
		await this.ensureTables();
		const now = new Date();
		const [turn] = await db
			.insert(nativeApiTurns)
			.values({
				runId: input.runId,
				taskId: input.taskId,
				turnIndex: input.turnIndex,
				agentModeSessionId: input.agentModeSessionId ?? null,
				status: "running",
				provider: input.provider ?? null,
				model: input.model ?? null,
				executionMode: input.executionMode ?? null,
				historyJson: [...input.history],
				startedAt: now,
			})
			.returning();
		if (!turn) throw new Error("Failed to create native API turn.");
		return turn;
	}

	async finishTurn(input: {
		turnId: string;
		status: NativeApiTurnStatus;
		history?: readonly NativeApiHistoryItem[];
		providerDebug?: Record<string, unknown>;
		error?: unknown;
		model?: string | null;
	}) {
		await this.ensureTables();
		const [turn] = await db
			.update(nativeApiTurns)
			.set({
				status: input.status,
				...(input.history ? { historyJson: [...input.history] } : {}),
				...(input.providerDebug
					? { providerDebugJson: input.providerDebug }
					: {}),
				...(input.error !== undefined ? { errorJson: input.error } : {}),
				...(input.model !== undefined ? { model: input.model } : {}),
				finishedAt: new Date(),
				updatedAt: new Date(),
			})
			.where(eq(nativeApiTurns.id, input.turnId))
			.returning();
		return turn;
	}

	async recordToolCallPending(input: {
		runId: string;
		taskId: string;
		turnId: string;
		toolCall: ProviderToolCall;
		todoSeq?: number | null;
		source?: "provider_native" | "runtime_gate" | "user_interrupt";
	}) {
		await this.ensureTables();
		const [record] = await db
			.insert(nativeApiToolCalls)
			.values({
				runId: input.runId,
				taskId: input.taskId,
				turnId: input.turnId,
				toolCallId: input.toolCall.id,
				toolName: input.toolCall.name,
				status: "pending",
				argumentsJson: input.toolCall.arguments,
				todoSeq: input.todoSeq ?? null,
				source: input.source ?? "provider_native",
			})
			.returning();
		if (!record) throw new Error("Failed to create native API tool call.");
		return record;
	}

	async markToolCallRunning(input: { id: string }) {
		await this.ensureTables();
		const [record] = await db
			.update(nativeApiToolCalls)
			.set({ status: "running", startedAt: new Date(), updatedAt: new Date() })
			.where(eq(nativeApiToolCalls.id, input.id))
			.returning();
		return record;
	}

	async finishToolCall(input: {
		id: string;
		status: Exclude<NativeApiToolCallStatus, "pending" | "running">;
		result?: NativeApiToolResult;
		error?: unknown;
		modelVisibleOutput?: string;
	}) {
		await this.ensureTables();
		const modelVisibleOutput = compactStoredModelVisibleOutput(
			input.modelVisibleOutput ?? input.result?.content ?? null,
		);
		const [record] = await db
			.update(nativeApiToolCalls)
			.set({
				status: input.status,
				resultJson: input.result ?? null,
				errorJson: input.error ?? null,
				modelVisibleOutput,
				finishedAt: new Date(),
				updatedAt: new Date(),
			})
			.where(eq(nativeApiToolCalls.id, input.id))
			.returning();
		return record;
	}

	async listTurns(runId: string) {
		await this.ensureTables();
		return db
			.select()
			.from(nativeApiTurns)
			.where(eq(nativeApiTurns.runId, runId))
			.orderBy(asc(nativeApiTurns.turnIndex));
	}

	async getLatestCompletedTurnForRun(runId: string) {
		await this.ensureTables();
		const [turn] = await db
			.select()
			.from(nativeApiTurns)
			.where(
				and(
					eq(nativeApiTurns.runId, runId),
					eq(nativeApiTurns.status, "completed"),
				),
			)
			.orderBy(desc(nativeApiTurns.finishedAt), desc(nativeApiTurns.updatedAt))
			.limit(1);
		return turn ?? null;
	}

	async listToolCalls(runId: string) {
		await this.ensureTables();
		return db
			.select()
			.from(nativeApiToolCalls)
			.where(eq(nativeApiToolCalls.runId, runId))
			.orderBy(asc(nativeApiToolCalls.createdAt));
	}

	async getToolCall(runId: string, toolCallId: string) {
		await this.ensureTables();
		const [record] = await db
			.select()
			.from(nativeApiToolCalls)
			.where(
				and(
					eq(nativeApiToolCalls.runId, runId),
					eq(nativeApiToolCalls.toolCallId, toolCallId),
				),
			)
			.limit(1);
		return record ?? null;
	}

	private async ensureTables() {
		this.ensureTablesPromise ??= ensureNativeApiRunnerTables();
		await this.ensureTablesPromise;
	}
}

function compactStoredModelVisibleOutput(value: string | null) {
	if (value === null) return null;
	return compactModelVisibleText({
		content: value,
		strategy: "json_summary",
		omittedReason: "large_native_api_model_visible_output",
	}).content;
}

async function ensureNativeApiRunnerTables() {
	await client.execute(`
    CREATE TABLE IF NOT EXISTS native_api_turns (
      id text PRIMARY KEY NOT NULL,
      created_at integer NOT NULL,
      updated_at integer NOT NULL,
      run_id text NOT NULL,
      task_id text NOT NULL,
      agent_mode_session_id text,
      turn_index integer NOT NULL,
      status text DEFAULT 'running' NOT NULL,
      provider text,
      model text,
      execution_mode text,
      history_json text,
      provider_debug_json text,
      error_json text,
      started_at integer NOT NULL,
      finished_at integer,
      FOREIGN KEY (run_id) REFERENCES task_runs(id) ON DELETE cascade,
      FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE cascade
    )
  `);
	await client.execute(
		"CREATE UNIQUE INDEX IF NOT EXISTS native_api_turns_run_turn_uidx ON native_api_turns (run_id, turn_index)",
	);
	await client.execute(
		"CREATE INDEX IF NOT EXISTS native_api_turns_run_status_idx ON native_api_turns (run_id, status)",
	);
	await ensureNativeApiTurnsExecutionModeColumn();
	await client
		.execute(
			"ALTER TABLE native_api_turns ADD COLUMN agent_mode_session_id text",
		)
		.catch(() => undefined);
	await client.execute(
		"CREATE INDEX IF NOT EXISTS native_api_turns_resume_idx ON native_api_turns (task_id, status, provider, model, execution_mode, finished_at)",
	);
	await client.execute(
		"CREATE INDEX IF NOT EXISTS native_api_turns_agent_mode_session_resume_idx ON native_api_turns (agent_mode_session_id, status, finished_at)",
	);
	await client.execute(`
    CREATE TABLE IF NOT EXISTS native_api_tool_calls (
      id text PRIMARY KEY NOT NULL,
      created_at integer NOT NULL,
      updated_at integer NOT NULL,
      run_id text NOT NULL,
      task_id text NOT NULL,
      turn_id text NOT NULL,
      tool_call_id text NOT NULL,
      tool_name text NOT NULL,
      status text DEFAULT 'pending' NOT NULL,
      arguments_json text,
      result_json text,
      error_json text,
      model_visible_output text,
      todo_seq integer,
      source text DEFAULT 'provider_native' NOT NULL,
      started_at integer,
      finished_at integer,
      FOREIGN KEY (run_id) REFERENCES task_runs(id) ON DELETE cascade,
      FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE cascade,
      FOREIGN KEY (turn_id) REFERENCES native_api_turns(id) ON DELETE cascade
    )
  `);
	await client.execute(
		"CREATE UNIQUE INDEX IF NOT EXISTS native_api_tool_calls_run_call_uidx ON native_api_tool_calls (run_id, tool_call_id)",
	);
	await client.execute(
		"CREATE INDEX IF NOT EXISTS native_api_tool_calls_run_status_idx ON native_api_tool_calls (run_id, status)",
	);
	await client.execute(
		"CREATE INDEX IF NOT EXISTS native_api_tool_calls_turn_idx ON native_api_tool_calls (turn_id)",
	);
}

async function ensureNativeApiTurnsExecutionModeColumn() {
	const columns = await client.execute("PRAGMA table_info(native_api_turns)");
	const hasExecutionMode = columns.rows.some(
		(row) => row.name === "execution_mode",
	);
	if (columns.rows.length > 0 && !hasExecutionMode) {
		await client.execute(
			"ALTER TABLE native_api_turns ADD COLUMN execution_mode text",
		);
	}
}
