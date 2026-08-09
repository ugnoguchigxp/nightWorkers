import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	createOrStartReviewSession,
	createReviewFindings,
	createReviewPromptSuggestion,
	createReviewSecurityHandoff,
	getLatestReviewSessionForTask,
	getReviewArtifact,
	getReviewFinding,
	getReviewPromptSuggestion,
	getReviewPromptSuggestionByFinding,
	getReviewRecommendationByRun,
	getReviewSecurityHandoffByFinding,
	getReviewSession,
	getReviewSessionByRun,
	listReviewArtifacts,
	listReviewFindings,
	listReviewPromptSuggestions,
	listReviewSecurityHandoffs,
	markReviewSessionStarted,
	updateReviewFindingDisposition,
	updateReviewPromptSuggestion,
	updateReviewSession,
	upsertReviewArtifact,
	upsertReviewRecommendation,
} from "../api/modules/review/review-mode.repository";

const mocks = vi.hoisted(() => {
	const state = {
		selectResults: [] as unknown[],
		insertResults: [] as unknown[],
		updateResults: [] as unknown[],
	};
	const take = (values: unknown[]) => values.shift() ?? [];

	const selectFrom = vi.fn();
	const selectWhere = vi.fn();
	const selectOrderBy = vi.fn(async () => take(state.selectResults));
	const selectLimit = vi.fn(async () => take(state.selectResults));
	const selectChain: Record<string, unknown> = {
		from: selectFrom,
		where: selectWhere,
		orderBy: selectOrderBy,
		limit: selectLimit,
		// biome-ignore lint/suspicious/noThenProperty: Drizzle query builders are intentionally awaitable thenables.
		then: (
			onFulfilled: (value: unknown) => unknown,
			onRejected: (reason: unknown) => unknown,
		) =>
			Promise.resolve(take(state.selectResults)).then(onFulfilled, onRejected),
	};
	selectFrom.mockImplementation(() => selectChain);
	selectWhere.mockImplementation(() => selectChain);

	const insertValues = vi.fn();
	const insertConflict = vi.fn();
	const insertReturning = vi.fn(async () => take(state.insertResults));
	const insertChain = {
		values: insertValues,
		onConflictDoUpdate: insertConflict,
		returning: insertReturning,
	};
	insertValues.mockImplementation(() => insertChain);
	insertConflict.mockImplementation(() => insertChain);

	const updateSet = vi.fn();
	const updateWhere = vi.fn();
	const updateReturning = vi.fn(async () => take(state.updateResults));
	const updateChain = {
		set: updateSet,
		where: updateWhere,
		returning: updateReturning,
	};
	updateSet.mockImplementation(() => updateChain);
	updateWhere.mockImplementation(() => updateChain);

	const db = {
		select: vi.fn(() => selectChain),
		insert: vi.fn(() => insertChain),
		update: vi.fn(() => updateChain),
	};
	return {
		state,
		db,
		selectFrom,
		selectWhere,
		selectOrderBy,
		selectLimit,
		insertValues,
		insertConflict,
		insertReturning,
		updateSet,
		updateWhere,
		updateReturning,
	};
});

vi.mock("../api/db/client", () => ({ db: mocks.db }));

beforeEach(() => {
	vi.clearAllMocks();
	mocks.state.selectResults.length = 0;
	mocks.state.insertResults.length = 0;
	mocks.state.updateResults.length = 0;
});

describe("recommendations and review sessions", () => {
	it.each([
		["recommendation", getReviewRecommendationByRun, "run-1"],
		["session by run", getReviewSessionByRun, "run-1"],
		["session by id", getReviewSession, "session-1"],
	] as const)("maps %s row and absent result", async (_name, query, id) => {
		const row = { id: `${_name}-row` };
		mocks.state.selectResults.push([row], []);
		await expect(query(id)).resolves.toBe(row);
		await expect(query(id)).resolves.toBeNull();
	});

	it("returns the latest task review session or null", async () => {
		const row = { id: "latest-session" };
		mocks.state.selectResults.push([row], []);
		await expect(getLatestReviewSessionForTask("task-1")).resolves.toBe(row);
		await expect(getLatestReviewSessionForTask("task-1")).resolves.toBeNull();
		expect(mocks.selectOrderBy).toHaveBeenCalledTimes(2);
	});

	it("upserts a recommendation with conflict fields and timestamps", async () => {
		const data = {
			runId: "run-1",
			taskId: "task-1",
			repositoryId: "repository-1",
			level: "required",
			defaultAction: "start_review",
			reasonsJson: [{ code: "large_diff" }],
		};
		const row = { id: "recommendation-1", ...data };
		mocks.state.insertResults.push([row]);
		await expect(upsertReviewRecommendation(data)).resolves.toBe(row);
		expect(mocks.insertValues).toHaveBeenCalledWith({
			...data,
			createdAt: expect.any(Date),
			updatedAt: expect.any(Date),
		});
		expect(mocks.insertConflict).toHaveBeenCalledWith({
			target: expect.anything(),
			set: {
				taskId: "task-1",
				repositoryId: "repository-1",
				level: "required",
				defaultAction: "start_review",
				reasonsJson: [{ code: "large_diff" }],
				updatedAt: expect.any(Date),
			},
		});
	});

	it("maps absent recommendation upsert and insert failures", async () => {
		mocks.state.insertResults.push([]);
		await expect(
			upsertReviewRecommendation({
				runId: "run-1",
				taskId: "task-1",
				repositoryId: "repository-1",
				level: "none",
				defaultAction: "skip",
				reasonsJson: [],
			}),
		).resolves.toBeUndefined();
		mocks.insertReturning.mockRejectedValueOnce(
			new Error("recommendation conflict"),
		);
		await expect(
			upsertReviewRecommendation({
				runId: "run-1",
				taskId: "task-1",
				repositoryId: "repository-1",
				level: "none",
				defaultAction: "skip",
				reasonsJson: [],
			}),
		).rejects.toThrow("recommendation conflict");
	});

	it.each([
		null,
		"recommendation-1",
	])("creates or restarts a session with recommendation %s", async (recommendationId) => {
		const data = {
			runId: "run-1",
			taskId: "task-1",
			repositoryId: "repository-1",
			recommendationId,
		};
		const row = { id: "session-1", ...data };
		mocks.state.insertResults.push([row]);
		await expect(createOrStartReviewSession(data)).resolves.toBe(row);
		expect(mocks.insertValues).toHaveBeenCalledWith({
			...data,
			status: "not_started",
			startedAt: null,
			createdAt: expect.any(Date),
			updatedAt: expect.any(Date),
		});
		expect(mocks.insertConflict).toHaveBeenCalledWith({
			target: expect.anything(),
			set: { recommendationId, updatedAt: expect.any(Date) },
		});
	});

	it("maps absent session creation", async () => {
		mocks.state.insertResults.push([]);
		await expect(
			createOrStartReviewSession({
				runId: "run-1",
				taskId: "task-1",
				repositoryId: "repository-1",
				recommendationId: null,
			}),
		).resolves.toBeUndefined();
	});

	it("marks a review session in progress or maps a missing row", async () => {
		const row = { id: "session-1", status: "in_progress" };
		mocks.state.updateResults.push([row], []);
		await expect(markReviewSessionStarted("session-1")).resolves.toBe(row);
		expect(mocks.updateSet).toHaveBeenNthCalledWith(1, {
			status: "in_progress",
			startedAt: expect.any(Date),
			updatedAt: expect.any(Date),
		});
		await expect(markReviewSessionStarted("missing")).resolves.toBeNull();
	});

	it("updates optional status, completion, and final decision fields", async () => {
		const completedAt = new Date("2026-01-01T00:00:00.000Z");
		const data = {
			status: "approved",
			completedAt,
			finalAction: "merge",
			finalNote: null,
		};
		const row = { id: "session-1", ...data };
		mocks.state.updateResults.push([row], []);
		await expect(updateReviewSession("session-1", data)).resolves.toBe(row);
		expect(mocks.updateSet).toHaveBeenNthCalledWith(1, {
			...data,
			updatedAt: expect.any(Date),
		});
		await expect(updateReviewSession("missing", {})).resolves.toBeNull();
		expect(mocks.updateSet).toHaveBeenNthCalledWith(2, {
			updatedAt: expect.any(Date),
		});
	});
});

describe("review artifacts and findings", () => {
	it("upserts review artifacts and maps an absent result", async () => {
		const data = artifactInput();
		const row = { id: "artifact-1", ...data };
		mocks.state.insertResults.push([row], []);
		await expect(upsertReviewArtifact(data)).resolves.toBe(row);
		expect(mocks.insertValues).toHaveBeenNthCalledWith(1, {
			...data,
			createdAt: expect.any(Date),
			updatedAt: expect.any(Date),
		});
		expect(mocks.insertConflict).toHaveBeenNthCalledWith(1, {
			target: expect.any(Array),
			set: {
				status: data.status,
				artifactJson: data.artifactJson,
				sourceEvidenceRefsJson: data.sourceEvidenceRefsJson,
				updatedAt: expect.any(Date),
			},
		});
		await expect(upsertReviewArtifact(data)).resolves.toBeUndefined();
	});

	it("lists artifacts and gets an artifact by composite identity", async () => {
		const rows = [{ id: "artifact-1" }];
		mocks.state.selectResults.push(rows, [rows[0]], []);
		await expect(listReviewArtifacts("session-1")).resolves.toBe(rows);
		await expect(getReviewArtifact("session-1", "review_status")).resolves.toBe(
			rows[0],
		);
		await expect(getReviewArtifact("session-1", "missing")).resolves.toBeNull();
		expect(mocks.selectLimit).toHaveBeenCalledTimes(2);
	});

	it("lists findings and gets a scoped finding", async () => {
		const rows = [{ id: "finding-1" }];
		mocks.state.selectResults.push(rows, [rows[0]], []);
		await expect(listReviewFindings("session-1")).resolves.toBe(rows);
		await expect(getReviewFinding("session-1", "finding-1")).resolves.toBe(
			rows[0],
		);
		await expect(getReviewFinding("session-1", "missing")).resolves.toBeNull();
	});

	it("returns immediately for an empty findings batch", async () => {
		await expect(createReviewFindings([])).resolves.toEqual([]);
		expect(mocks.db.select).not.toHaveBeenCalled();
	});

	it("updates existing findings and falls back to the existing row after an empty update", async () => {
		const existingOne = { id: "existing-1", title: "One" };
		const existingTwo = { id: "existing-2", title: "Two" };
		const updatedOne = { ...existingOne, severity: "blocking" };
		mocks.state.selectResults.push([existingOne], [existingTwo]);
		mocks.state.updateResults.push([updatedOne], []);
		const result = await createReviewFindings([
			findingInput({ title: "One", body: "body", sourceSection: "security" }),
			findingInput({ title: "Two", body: undefined, sourceSection: undefined }),
		]);
		expect(result).toEqual([updatedOne, existingTwo]);
		expect(mocks.updateSet).toHaveBeenNthCalledWith(
			1,
			expect.objectContaining({ body: "body" }),
		);
		expect(mocks.updateSet).toHaveBeenNthCalledWith(
			2,
			expect.objectContaining({ body: null }),
		);
	});

	it("creates new findings with optional values and preserves missing DB rows", async () => {
		const created = { id: "created-1", title: "One" };
		mocks.state.selectResults.push([], []);
		mocks.state.insertResults.push([created], []);
		const result = await createReviewFindings([
			findingInput({ title: "One", body: "body", sourceSection: "findings" }),
			findingInput({ title: "Two", body: undefined, sourceSection: undefined }),
		]);
		expect(result).toEqual([created, undefined]);
		expect(mocks.insertValues).toHaveBeenNthCalledWith(
			1,
			expect.objectContaining({
				body: "body",
				sourceSection: "findings",
				dispositionStatus: "unresolved",
			}),
		);
		expect(mocks.insertValues).toHaveBeenNthCalledWith(
			2,
			expect.objectContaining({ body: null, sourceSection: null }),
		);
	});

	it("propagates finding query and persistence exceptions", async () => {
		mocks.state.selectResults.push(
			Promise.reject(new Error("finding query failed")),
		);
		await expect(createReviewFindings([findingInput()])).rejects.toThrow(
			"finding query failed",
		);
		mocks.state.selectResults.push([]);
		mocks.insertReturning.mockRejectedValueOnce(
			new Error("finding insert failed"),
		);
		await expect(createReviewFindings([findingInput()])).rejects.toThrow(
			"finding insert failed",
		);
	});

	it("updates every optional finding disposition field", async () => {
		const data = {
			disposition: "converted",
			dispositionStatus: "converted",
			dispositionNote: null,
			evidenceRefsJson: [{ kind: "event" }],
			createdGoalId: "goal-1",
			createdTaskProposalId: "proposal-1",
			contextStillCandidateId: "candidate-1",
		};
		const row = { id: "finding-1", ...data };
		mocks.state.updateResults.push([row]);
		await expect(
			updateReviewFindingDisposition("finding-1", data),
		).resolves.toBe(row);
		expect(mocks.updateSet).toHaveBeenCalledWith({
			...data,
			updatedAt: expect.any(Date),
		});
	});

	it("omits absent disposition fields and maps a missing row", async () => {
		mocks.state.updateResults.push([]);
		await expect(
			updateReviewFindingDisposition("missing", {
				disposition: "accepted",
				dispositionStatus: "accepted",
			}),
		).resolves.toBeNull();
		expect(mocks.updateSet).toHaveBeenCalledWith({
			disposition: "accepted",
			dispositionStatus: "accepted",
			updatedAt: expect.any(Date),
		});
	});
});

describe("prompt suggestions and security handoffs", () => {
	it("lists and gets prompt suggestions through both identities", async () => {
		const rows = [{ id: "suggestion-1" }];
		mocks.state.selectResults.push(rows, [rows[0]], [], [rows[0]], []);
		await expect(listReviewPromptSuggestions("session-1")).resolves.toBe(rows);
		await expect(
			getReviewPromptSuggestion("session-1", "suggestion-1"),
		).resolves.toBe(rows[0]);
		await expect(
			getReviewPromptSuggestion("session-1", "missing"),
		).resolves.toBeNull();
		await expect(getReviewPromptSuggestionByFinding("finding-1")).resolves.toBe(
			rows[0],
		);
		await expect(
			getReviewPromptSuggestionByFinding("missing"),
		).resolves.toBeNull();
	});

	it("creates or updates a draft prompt suggestion", async () => {
		const data = suggestionInput();
		const row = { id: "suggestion-1", ...data };
		mocks.state.insertResults.push([row], []);
		await expect(createReviewPromptSuggestion(data)).resolves.toBe(row);
		expect(mocks.insertValues).toHaveBeenNthCalledWith(1, {
			...data,
			status: "draft",
			useCount: 0,
			createdAt: expect.any(Date),
			updatedAt: expect.any(Date),
		});
		expect(mocks.insertConflict).toHaveBeenNthCalledWith(1, {
			target: expect.anything(),
			set: {
				title: data.title,
				prompt: data.prompt,
				expectedOutcome: data.expectedOutcome,
				acceptanceCriteria: data.acceptanceCriteria,
				verificationHint: data.verificationHint,
				evidenceRefsJson: data.evidenceRefsJson,
				updatedAt: expect.any(Date),
			},
		});
		await expect(createReviewPromptSuggestion(data)).resolves.toBeUndefined();
	});

	it("updates every optional prompt-suggestion field", async () => {
		const now = new Date("2026-01-01T00:00:00.000Z");
		const data = {
			status: "used",
			useCount: 2,
			lastUsedAt: now,
			dismissedAt: null,
			createdMessageId: "message-1",
		};
		const row = { id: "suggestion-1", ...data };
		mocks.state.updateResults.push([row]);
		await expect(
			updateReviewPromptSuggestion("suggestion-1", data),
		).resolves.toBe(row);
		expect(mocks.updateSet).toHaveBeenCalledWith({
			...data,
			updatedAt: expect.any(Date),
		});
	});

	it("omits absent prompt fields and maps a missing update", async () => {
		mocks.state.updateResults.push([]);
		await expect(
			updateReviewPromptSuggestion("missing", {}),
		).resolves.toBeNull();
		expect(mocks.updateSet).toHaveBeenCalledWith({
			updatedAt: expect.any(Date),
		});
	});

	it("lists security handoffs and gets one by finding", async () => {
		const rows = [{ id: "handoff-1" }];
		mocks.state.selectResults.push(rows, [rows[0]], []);
		await expect(listReviewSecurityHandoffs("session-1")).resolves.toBe(rows);
		await expect(getReviewSecurityHandoffByFinding("finding-1")).resolves.toBe(
			rows[0],
		);
		await expect(
			getReviewSecurityHandoffByFinding("missing"),
		).resolves.toBeNull();
	});

	it.each([
		undefined,
		null,
		"github",
	])("creates a security handoff with requested integration %s", async (requestedIntegration) => {
		const data = securityHandoffInput({ requestedIntegration });
		const row = { id: "handoff-1", ...data };
		mocks.state.insertResults.push([row]);
		await expect(createReviewSecurityHandoff(data)).resolves.toBe(row);
		expect(mocks.insertValues).toHaveBeenCalledWith(
			expect.objectContaining({
				requestedIntegration: requestedIntegration ?? null,
				createdAt: expect.any(Date),
				updatedAt: expect.any(Date),
			}),
		);
		expect(mocks.insertConflict).toHaveBeenCalledWith({
			target: expect.anything(),
			set: expect.objectContaining({
				requestedIntegration: requestedIntegration ?? null,
				updatedAt: expect.any(Date),
			}),
		});
	});

	it("maps an absent security-handoff insert and propagates DB failures", async () => {
		mocks.state.insertResults.push([]);
		await expect(
			createReviewSecurityHandoff(securityHandoffInput()),
		).resolves.toBeUndefined();
		mocks.insertReturning.mockRejectedValueOnce(new Error("handoff conflict"));
		await expect(
			createReviewSecurityHandoff(securityHandoffInput()),
		).rejects.toThrow("handoff conflict");
	});
});

function artifactInput() {
	return {
		reviewSessionId: "session-1",
		runId: "run-1",
		taskId: "task-1",
		kind: "review_status",
		status: "done",
		artifactJson: { approved: true },
		sourceEvidenceRefsJson: [{ kind: "event", id: "event-1" }],
	};
}

function findingInput(overrides: Record<string, unknown> = {}) {
	return {
		reviewSessionId: "session-1",
		runId: "run-1",
		taskId: "task-1",
		severity: "warning",
		title: "Finding",
		body: null,
		evidenceRefsJson: [],
		sourceSection: null,
		...overrides,
	};
}

function suggestionInput() {
	return {
		reviewSessionId: "session-1",
		findingId: "finding-1",
		runId: "run-1",
		taskId: "task-1",
		repositoryId: "repository-1",
		title: "Improve prompt",
		prompt: "Add a regression test.",
		expectedOutcome: "Regression is prevented.",
		acceptanceCriteria: "Focused test passes.",
		verificationHint: "Run Vitest.",
		evidenceRefsJson: [],
	};
}

function securityHandoffInput(overrides: Record<string, unknown> = {}) {
	return {
		reviewSessionId: "session-1",
		findingId: "finding-1",
		runId: "run-1",
		taskId: "task-1",
		repositoryId: "repository-1",
		title: "Security review",
		summary: "Review authentication changes.",
		status: "pending",
		changedPathsJson: ["api/auth.ts"],
		evidenceRefsJson: [],
		handoffArtifactJson: { version: 1 },
		...overrides,
	};
}
