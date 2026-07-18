import { and, desc, eq, isNull } from "drizzle-orm";
import { client, db } from "../db/client";
import { runtimeSessionStates } from "../db/schema";

export type RuntimeSessionStateStatus =
	| "active"
	| "superseded"
	| "invalid"
	| "resume_failed";

export type RuntimeSessionState = typeof runtimeSessionStates.$inferSelect;

export type RuntimeSessionStateLookup = {
	taskId: string;
	agentModeSessionId?: string | null;
	repositoryId?: string | null;
	runtimeLane: string;
	provider: string;
	executionMode?: string | null;
};

export class RuntimeSessionStateStore {
	private ensureTablesPromise: Promise<void> | null = null;

	async upsertRuntimeSessionState(
		input: RuntimeSessionStateLookup & {
			runId?: string | null;
			providerSessionId?: string | null;
			model?: string | null;
			status?: RuntimeSessionStateStatus;
			metadata?: unknown;
		},
	) {
		await this.ensureTables();
		const now = new Date();
		await this.markMatchingActiveStates(input, "superseded");
		const [state] = await db
			.insert(runtimeSessionStates)
			.values({
				taskId: input.taskId,
				agentModeSessionId: input.agentModeSessionId ?? null,
				repositoryId: input.repositoryId ?? null,
				runId: input.runId ?? null,
				runtimeLane: input.runtimeLane,
				provider: input.provider,
				providerSessionId: input.providerSessionId ?? null,
				executionMode: input.executionMode ?? null,
				model: input.model ?? null,
				status: input.status ?? "active",
				lastSeenAt: now,
				metadataJson: input.metadata ?? null,
			})
			.returning();
		if (!state) throw new Error("Failed to persist runtime session state.");
		return state;
	}

	async getLatestRuntimeSessionStateForTask(input: RuntimeSessionStateLookup) {
		await this.ensureTables();
		const [state] = await db
			.select()
			.from(runtimeSessionStates)
			.where(
				and(
					input.agentModeSessionId
						? eq(
								runtimeSessionStates.agentModeSessionId,
								input.agentModeSessionId,
							)
						: isNull(runtimeSessionStates.agentModeSessionId),
					eq(runtimeSessionStates.taskId, input.taskId),
					input.repositoryId
						? eq(runtimeSessionStates.repositoryId, input.repositoryId)
						: isNull(runtimeSessionStates.repositoryId),
					eq(runtimeSessionStates.runtimeLane, input.runtimeLane),
					eq(runtimeSessionStates.provider, input.provider),
					input.executionMode
						? eq(runtimeSessionStates.executionMode, input.executionMode)
						: isNull(runtimeSessionStates.executionMode),
					eq(runtimeSessionStates.status, "active"),
				),
			)
			.orderBy(
				desc(runtimeSessionStates.lastSeenAt),
				desc(runtimeSessionStates.createdAt),
			)
			.limit(1);
		return state ?? null;
	}

	async markRuntimeSessionStateInvalid(input: { id: string }) {
		return this.markRuntimeSessionStateStatus(input.id, "invalid");
	}

	async markRuntimeSessionStateSuperseded(input: { id: string }) {
		return this.markRuntimeSessionStateStatus(input.id, "superseded");
	}

	async markRuntimeSessionStateResumeFailed(input: {
		id: string;
		error?: unknown;
	}) {
		await this.ensureTables();
		const [state] = await db
			.update(runtimeSessionStates)
			.set({
				status: "resume_failed",
				metadataJson:
					input.error === undefined
						? undefined
						: { resumeError: String(input.error) },
				updatedAt: new Date(),
			})
			.where(eq(runtimeSessionStates.id, input.id))
			.returning();
		return state ?? null;
	}

	private async markRuntimeSessionStateStatus(
		id: string,
		status: RuntimeSessionStateStatus,
	) {
		await this.ensureTables();
		const [state] = await db
			.update(runtimeSessionStates)
			.set({ status, updatedAt: new Date() })
			.where(eq(runtimeSessionStates.id, id))
			.returning();
		return state ?? null;
	}

	private async markMatchingActiveStates(
		input: RuntimeSessionStateLookup,
		status: RuntimeSessionStateStatus,
	) {
		await db
			.update(runtimeSessionStates)
			.set({ status, updatedAt: new Date() })
			.where(
				and(
					input.agentModeSessionId
						? eq(
								runtimeSessionStates.agentModeSessionId,
								input.agentModeSessionId,
							)
						: isNull(runtimeSessionStates.agentModeSessionId),
					eq(runtimeSessionStates.taskId, input.taskId),
					input.repositoryId
						? eq(runtimeSessionStates.repositoryId, input.repositoryId)
						: isNull(runtimeSessionStates.repositoryId),
					eq(runtimeSessionStates.runtimeLane, input.runtimeLane),
					eq(runtimeSessionStates.provider, input.provider),
					input.executionMode
						? eq(runtimeSessionStates.executionMode, input.executionMode)
						: isNull(runtimeSessionStates.executionMode),
					eq(runtimeSessionStates.status, "active"),
				),
			);
	}

	private async ensureTables() {
		this.ensureTablesPromise ??= ensureRuntimeSessionStateTables();
		await this.ensureTablesPromise;
	}
}

async function ensureRuntimeSessionStateTables() {
	await client.execute(`
    CREATE TABLE IF NOT EXISTS runtime_session_states (
      id text PRIMARY KEY NOT NULL,
      created_at integer NOT NULL,
      updated_at integer NOT NULL,
      task_id text NOT NULL,
      repository_id text,
      run_id text,
      agent_mode_session_id text,
      runtime_lane text NOT NULL,
      provider text NOT NULL,
      provider_session_id text,
      execution_mode text,
      model text,
      status text NOT NULL,
      last_seen_at integer NOT NULL,
      metadata_json text,
      FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE cascade,
      FOREIGN KEY (repository_id) REFERENCES repositories(id) ON DELETE cascade,
      FOREIGN KEY (run_id) REFERENCES task_runs(id) ON DELETE set null
    )
  `);
	await client.execute(`
    CREATE INDEX IF NOT EXISTS runtime_session_states_lookup_idx
    ON runtime_session_states (
      task_id,
      repository_id,
      runtime_lane,
      provider,
      execution_mode,
      status,
      last_seen_at
    )
  `);
	await client.execute(
		"CREATE INDEX IF NOT EXISTS runtime_session_states_run_idx ON runtime_session_states (run_id)",
	);
	await client
		.execute(
			"ALTER TABLE runtime_session_states ADD COLUMN agent_mode_session_id text",
		)
		.catch(() => undefined);
	await client.execute(
		"CREATE INDEX IF NOT EXISTS runtime_session_states_agent_mode_session_lookup_idx ON runtime_session_states (agent_mode_session_id, status, last_seen_at)",
	);
}
