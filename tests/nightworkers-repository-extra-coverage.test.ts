import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppError } from "../api/lib/errors";
import {
	createBlueprintActivityArtifact,
	createMockBlueprintActivityArtifact,
	createRepository,
	createTaskMessage,
	deleteRepository,
	getRepository,
	listRepositories,
	listTaskMessages,
	updateRepositoryFeatureSettings,
	updateRepositoryProjectMeta,
	updateTaskMessageMetadata,
} from "../api/modules/nightworkers/nightworkers.repository";

const mocks = vi.hoisted(() => {
	const state = {
		selectResults: [] as unknown[],
		insertResults: [] as unknown[],
		transactionInsertResults: [] as unknown[],
		updateResults: [] as unknown[],
		deleteResults: [] as unknown[],
	};
	const take = (values: unknown[]) => values.shift() ?? [];

	const selectFrom = vi.fn();
	const selectWhere = vi.fn();
	const selectOrderBy = vi.fn(async () => take(state.selectResults));
	const selectChain: Record<string, unknown> = {
		from: selectFrom,
		where: selectWhere,
		orderBy: selectOrderBy,
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
	const insertReturning = vi.fn(async () => take(state.insertResults));
	const insertChain = { values: insertValues, returning: insertReturning };
	insertValues.mockImplementation(() => insertChain);

	const transactionInsertValues = vi.fn();
	const transactionInsertReturning = vi.fn(async () =>
		take(state.transactionInsertResults),
	);
	const transactionInsertChain = {
		values: transactionInsertValues,
		returning: transactionInsertReturning,
	};
	transactionInsertValues.mockImplementation(() => transactionInsertChain);

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

	const deleteWhere = vi.fn();
	const deleteReturning = vi.fn(async () => take(state.deleteResults));
	const deleteChain = { where: deleteWhere, returning: deleteReturning };
	deleteWhere.mockImplementation(() => deleteChain);

	const db = {
		select: vi.fn(() => selectChain),
		insert: vi.fn(() => insertChain),
		update: vi.fn(() => updateChain),
		delete: vi.fn(() => deleteChain),
	};
	const transactionDb = {
		insert: vi.fn(() => transactionInsertChain),
	};

	return {
		state,
		db,
		transactionDb,
		selectFrom,
		selectWhere,
		selectOrderBy,
		insertValues,
		insertReturning,
		transactionInsertValues,
		transactionInsertReturning,
		updateSet,
		updateWhere,
		updateReturning,
		deleteWhere,
		deleteReturning,
		inspectIdentity: vi.fn(),
		publish: vi.fn(),
		sanitize: vi.fn((value) => value),
		appendArtifact: vi.fn(async () => null),
		enqueueEvent: vi.fn(async () => undefined),
		flushEvents: vi.fn(async () => undefined),
		getDiffKind: vi.fn(() => null),
		roleToKind: vi.fn((role: string) => `${role}.message`),
		roleToSource: vi.fn((role: string) => role),
	};
});

vi.mock("../api/db/client", () => ({ db: mocks.db }));
vi.mock("../api/services/git/project-repository-identity", () => ({
	inspectProjectRepositoryIdentity: mocks.inspectIdentity,
}));
vi.mock("../api/services/realtime/nightworkers-ws", () => ({
	nightWorkersRealtimeBroker: { publish: mocks.publish },
}));
vi.mock("../api/services/security/secret-persistence-firewall", () => ({
	sanitizePersistenceValue: mocks.sanitize,
}));
vi.mock("../api/modules/nightworkers/nightworkers.activity.repository", () => ({
	appendActivityArtifact: mocks.appendArtifact,
	enqueueActivityEvent: mocks.enqueueEvent,
	flushActivityEventQueue: mocks.flushEvents,
	getToolDiffActivityKind: mocks.getDiffKind,
	taskMessageRoleToActivityKind: mocks.roleToKind,
	taskMessageRoleToActivitySource: mocks.roleToSource,
}));

const originalVitest = process.env.VITEST;

beforeEach(() => {
	vi.clearAllMocks();
	mocks.state.selectResults.length = 0;
	mocks.state.insertResults.length = 0;
	mocks.state.transactionInsertResults.length = 0;
	mocks.state.updateResults.length = 0;
	mocks.state.deleteResults.length = 0;
	mocks.inspectIdentity.mockResolvedValue(readyIdentity());
	mocks.sanitize.mockImplementation((value) => value);
	mocks.appendArtifact.mockResolvedValue(null);
	mocks.enqueueEvent.mockResolvedValue(undefined);
	mocks.flushEvents.mockResolvedValue(undefined);
	mocks.getDiffKind.mockReturnValue(null);
	mocks.roleToKind.mockImplementation((role: string) => `${role}.message`);
	mocks.roleToSource.mockImplementation((role: string) => role);
	process.env.VITEST = originalVitest ?? "true";
});

afterEach(() => {
	if (originalVitest === undefined) delete process.env.VITEST;
	else process.env.VITEST = originalVitest;
});

describe("repository CRUD and identity boundaries", () => {
	it.each([
		"invalid identity",
		"missing failure code",
	])("rejects %s before persistence", async (variant) => {
		mocks.inspectIdentity.mockResolvedValueOnce({
			...readyIdentity(),
			status: "invalid",
			failureCode:
				variant === "invalid identity" ? "project_root_symlink_alias" : null,
		});
		const promise = createRepository(repositoryInput());
		await expect(promise).rejects.toBeInstanceOf(AppError);
		await expect(promise).rejects.toMatchObject({
			statusCode: 409,
			code:
				variant === "invalid identity"
					? "project_root_symlink_alias"
					: "repository_identity_invalid",
		});
		expect(mocks.db.insert).not.toHaveBeenCalled();
	});

	it("rejects a duplicate ready Git identity outside Vitest mode", async () => {
		delete process.env.VITEST;
		mocks.state.selectResults.push([{ id: "existing-repository" }]);
		await expect(createRepository(repositoryInput())).rejects.toMatchObject({
			statusCode: 409,
			code: "repository_identity_duplicate",
		});
		expect(mocks.db.select).toHaveBeenCalledWith(expect.any(Object));
		expect(mocks.db.insert).not.toHaveBeenCalled();
	});

	it("persists canonical identity, optional settings, and returns the inserted row", async () => {
		delete process.env.VITEST;
		const created = { id: "repository-1", name: "Project" };
		mocks.state.selectResults.push([]);
		mocks.state.insertResults.push([created]);
		const input = repositoryInput({
			allowed: false,
			queueEnabled: true,
			maxConcurrentSessions: 4,
			safetyPolicy: { allowedPaths: ["src/**"] },
		});
		await expect(createRepository(input)).resolves.toBe(created);
		expect(mocks.inspectIdentity).toHaveBeenCalledWith("/requested/project");
		expect(mocks.insertValues).toHaveBeenCalledWith({
			...input,
			localPath: "/canonical/project",
			repositoryKind: "git",
			repositoryIdentityStatus: "ready",
			registeredRootCanonical: "/canonical/project",
			gitCommonDirCanonical: "/canonical/project/.git",
			baseWorktreePathCanonical: "/canonical/project",
			baseWorktreeId: "worktree-id",
			baseWorktreeBranch: "main",
			baseWorktreeHeadSha: "abc123",
			baseWorktreeDirty: false,
			repositoryIdentityDigest: "sha256:digest",
			repositoryIdentityRevision: 2,
			repositoryIdentityVerifiedAt: new Date("2026-01-01T00:00:00.000Z"),
		});
	});

	it("skips duplicate probing for pending materialization and in Vitest", async () => {
		mocks.inspectIdentity.mockResolvedValueOnce({
			...readyIdentity(),
			status: "materialization_pending",
			gitCommonDirCanonical: null,
		});
		mocks.state.insertResults.push([{ id: "pending" }]);
		await createRepository(repositoryInput());
		expect(mocks.db.select).not.toHaveBeenCalled();

		mocks.state.insertResults.push([{ id: "vitest-ready" }]);
		await createRepository(repositoryInput());
		expect(mocks.db.select).not.toHaveBeenCalled();
	});

	it("returns undefined when insert produces no repository row", async () => {
		mocks.state.insertResults.push([]);
		await expect(createRepository(repositoryInput())).resolves.toBeUndefined();
	});

	it("gets, lists, updates, and deletes repository rows", async () => {
		const repository = { id: "repository-1" };
		mocks.state.selectResults.push([repository], [repository]);
		await expect(getRepository("repository-1")).resolves.toBe(repository);
		await expect(listRepositories()).resolves.toEqual([repository]);

		const featureUpdated = { ...repository, featureSettings: { review: true } };
		const metaUpdated = { ...repository, projectMeta: { framework: "hono" } };
		mocks.state.updateResults.push([featureUpdated], [metaUpdated]);
		await expect(
			updateRepositoryFeatureSettings("repository-1", { review: true }),
		).resolves.toBe(featureUpdated);
		await expect(
			updateRepositoryProjectMeta("repository-1", { framework: "hono" }),
		).resolves.toBe(metaUpdated);
		expect(mocks.updateSet).toHaveBeenNthCalledWith(
			1,
			expect.objectContaining({
				featureSettings: { review: true },
				updatedAt: expect.any(Date),
			}),
		);
		expect(mocks.updateSet).toHaveBeenNthCalledWith(
			2,
			expect.objectContaining({
				projectMeta: { framework: "hono" },
				updatedAt: expect.any(Date),
			}),
		);

		mocks.state.deleteResults.push([repository]);
		await expect(deleteRepository("repository-1")).resolves.toBe(repository);
		expect(mocks.flushEvents).toHaveBeenCalledTimes(1);
		expect(mocks.deleteWhere).toHaveBeenCalled();
	});

	it("maps absent CRUD rows and nullable settings to undefined", async () => {
		mocks.state.selectResults.push([]);
		await expect(getRepository("missing")).resolves.toBeUndefined();
		mocks.state.updateResults.push([], []);
		await expect(
			updateRepositoryFeatureSettings("missing", null),
		).resolves.toBeUndefined();
		await expect(
			updateRepositoryProjectMeta("missing", null),
		).resolves.toBeUndefined();
		mocks.state.deleteResults.push([]);
		await expect(deleteRepository("missing")).resolves.toBeUndefined();
		expect(mocks.updateSet).toHaveBeenNthCalledWith(
			1,
			expect.objectContaining({ featureSettings: null }),
		);
		expect(mocks.updateSet).toHaveBeenNthCalledWith(
			2,
			expect.objectContaining({ projectMeta: null }),
		);
	});

	it("stops deletion when queued activity flushing fails", async () => {
		mocks.flushEvents.mockRejectedValueOnce(new Error("ledger busy"));
		await expect(deleteRepository("repository-1")).rejects.toThrow(
			"ledger busy",
		);
		expect(mocks.db.delete).not.toHaveBeenCalled();
	});
});

describe("task-message query and persistence", () => {
	it("lists all task messages or filters by trace channel", async () => {
		const all = [{ id: "message-all" }];
		const chat = [{ id: "message-chat", traceChannel: "chat" }];
		mocks.state.selectResults.push(all, chat);
		await expect(listTaskMessages("task-1")).resolves.toBe(all);
		await expect(
			listTaskMessages("task-1", { traceChannel: "chat" }),
		).resolves.toBe(chat);
		expect(mocks.selectWhere).toHaveBeenCalledTimes(2);
		expect(mocks.selectOrderBy).toHaveBeenCalledTimes(2);
	});

	it("returns undefined without side effects when message insertion returns no row", async () => {
		mocks.state.insertResults.push([]);
		await expect(
			createTaskMessage({ taskId: "task-1", role: "user", content: "hello" }),
		).resolves.toBeUndefined();
		expect(mocks.enqueueEvent).not.toHaveBeenCalled();
		expect(mocks.publish).not.toHaveBeenCalled();
	});

	it("uses the supplied transaction without publishing activity", async () => {
		const created = taskMessage("transaction-message");
		mocks.state.transactionInsertResults.push([created]);
		const trace = {
			owner: "mission_pilot",
			channel: "pilot_thought",
			producer: { kind: "runtime" },
		} as const;
		await expect(
			createTaskMessage(
				{
					taskId: "task-1",
					role: "system",
					content: "private",
					trace,
				},
				mocks.transactionDb as never,
			),
		).resolves.toBe(created);
		expect(mocks.transactionInsertValues).toHaveBeenCalledWith(
			expect.objectContaining({
				runId: null,
				messageType: null,
				traceOwner: "mission_pilot",
				traceChannel: "pilot_thought",
				metadataJson: { traceProvenance: trace },
			}),
		);
		expect(mocks.enqueueEvent).not.toHaveBeenCalled();
		expect(mocks.publish).not.toHaveBeenCalled();
	});

	it("sanitizes input, records provenance, maps role activity, and publishes", async () => {
		const created = taskMessage("message-1");
		mocks.state.insertResults.push([created]);
		mocks.sanitize.mockReturnValueOnce({
			taskId: "task-sanitized",
			runId: "run-sanitized",
			role: "assistant",
			content: "[REDACTED]",
			messageType: "text",
			payloadJson: { safe: true },
		});
		await expect(
			createTaskMessage({
				taskId: "task-raw",
				role: "user",
				content: "secret",
			}),
		).resolves.toBe(created);
		expect(mocks.insertValues).toHaveBeenCalledWith(
			expect.objectContaining({
				taskId: "task-sanitized",
				runId: "run-sanitized",
				role: "assistant",
				content: "[REDACTED]",
				messageType: "text",
				traceOwner: "coding_agent",
				traceChannel: "chat",
			}),
		);
		expect(mocks.enqueueEvent).toHaveBeenCalledWith(
			expect.objectContaining({
				taskId: "task-sanitized",
				runId: "run-sanitized",
				turnId: "message-1",
				kind: "assistant.message",
				source: "assistant",
				text: "[REDACTED]",
				externalId: "message-1",
				dedupeKey: "task_message:message-1",
				trace: expect.objectContaining({
					owner: "coding_agent",
					producer: expect.objectContaining({ runId: "run-sanitized" }),
				}),
			}),
		);
		expect(mocks.publish).toHaveBeenCalledWith("task-sanitized", {
			type: "task_message_created",
			runId: "run-sanitized",
			payload: { message: created },
		});
	});

	it("publishes an undefined run id for a normal user message", async () => {
		const created = taskMessage("user-message");
		mocks.state.insertResults.push([created]);
		await createTaskMessage({
			taskId: "task-1",
			role: "user",
			content: "hello",
		});
		expect(mocks.insertValues).toHaveBeenCalledWith(
			expect.objectContaining({ traceOwner: "user", traceChannel: "chat" }),
		);
		expect(mocks.publish).toHaveBeenCalledWith("task-1", {
			type: "task_message_created",
			runId: undefined,
			payload: { message: created },
		});
	});

	it.each([
		["display", { display: { title: "Display title" } }, "Display title"],
		["metadata", { title: "Metadata title" }, "Metadata title"],
		["app", { appBlueprint: { name: "App name" } }, "App name"],
		["mock", { mockBlueprint: { name: "Mock name" } }, "Mock name"],
		[
			"fallback",
			{ display: [], appBlueprint: [], mockBlueprint: [] },
			"Blueprint",
		],
	] as const)("emits an app-blueprint projection using the %s title", async (_name, extra, title) => {
		const created = taskMessage(`projection-${_name}`);
		mocks.state.insertResults.push([created]);
		await createTaskMessage({
			taskId: "task-1",
			role: "assistant",
			content: "blueprint projection",
			messageType: "markdown_document",
			payloadJson: {
				intent: _name === "mock" ? "mock_blueprint" : "app_blueprint",
				artifactRef: { artifactId: `artifact-${_name}` },
				...extra,
			},
		});
		expect(mocks.appendArtifact).not.toHaveBeenCalled();
		expect(mocks.enqueueEvent).toHaveBeenNthCalledWith(
			2,
			expect.objectContaining({
				kind: "system.info",
				text: `Blueprint artifact: ${title}`,
				artifactId: `artifact-${_name}`,
				dedupeKey: `task_message_artifact:projection-${_name}`,
			}),
		);
	});

	it("revalidates a projection artifact id when building its activity", async () => {
		const created = taskMessage("projection-changing-ref");
		mocks.state.insertResults.push([created]);
		let artifactIdReads = 0;
		const artifactRef = new Proxy(
			{},
			{
				get: (_target, property) => {
					if (property !== "artifactId") return undefined;
					artifactIdReads += 1;
					return artifactIdReads === 1 ? "artifact-initial" : null;
				},
			},
		);
		await createTaskMessage({
			taskId: "task-1",
			role: "assistant",
			content: "projection",
			messageType: "markdown_document",
			payloadJson: { intent: "app_blueprint", artifactRef },
		});
		expect(mocks.enqueueEvent).toHaveBeenNthCalledWith(
			2,
			expect.objectContaining({ artifactId: null }),
		);
	});

	it("stores an app blueprint document and maps its artifact id", async () => {
		const created = taskMessage("app-document");
		mocks.state.insertResults.push([created]);
		mocks.appendArtifact.mockResolvedValueOnce({ id: "stored-app" });
		await createTaskMessage({
			taskId: "task-1",
			runId: "run-1",
			role: "assistant",
			content: "document",
			messageType: "markdown_document",
			payloadJson: {
				intent: "app_blueprint",
				title: "App document",
				appBlueprint: { name: "Ignored name" },
				validation: { valid: true },
				generation: { model: "gpt" },
				source: "plan",
			},
		});
		expect(mocks.appendArtifact).toHaveBeenCalledWith(
			expect.objectContaining({
				kind: "app_blueprint",
				path: "app-document.app-blueprint.json",
				contentText: JSON.stringify({ name: "Ignored name" }, null, 2),
			}),
		);
		expect(mocks.enqueueEvent).toHaveBeenNthCalledWith(
			2,
			expect.objectContaining({
				text: "Blueprint artifact: App document",
				artifactId: "stored-app",
			}),
		);
	});

	it.each([
		["named", { name: "Mock document" }, "Mock document"],
		["fallback", {}, "Blueprint"],
	] as const)("stores a %s mock blueprint document with nullable artifact", async (_name, mockBlueprint, title) => {
		const created = taskMessage(`mock-document-${_name}`);
		mocks.state.insertResults.push([created]);
		await createTaskMessage({
			taskId: "task-1",
			role: "assistant",
			content: "mock document",
			messageType: "markdown_document",
			payloadJson: { intent: "mock_blueprint", mockBlueprint },
		});
		expect(mocks.appendArtifact).toHaveBeenCalledWith(
			expect.objectContaining({
				path: `mock-document-${_name}.app-blueprint.json`,
				contentText: undefined,
			}),
		);
		expect(mocks.enqueueEvent).toHaveBeenNthCalledWith(
			2,
			expect.objectContaining({
				text: `Blueprint artifact: ${title}`,
				artifactId: null,
			}),
		);
	});

	it("does not project or store blueprint payloads with the wrong shape", async () => {
		const created = taskMessage("not-blueprint");
		mocks.state.insertResults.push([created]);
		await createTaskMessage({
			taskId: "task-1",
			role: "assistant",
			content: "not a document",
			messageType: "text",
			payloadJson: {
				intent: "app_blueprint",
				artifactRef: [],
				appBlueprint: null,
			},
		});
		expect(mocks.enqueueEvent).toHaveBeenCalledTimes(1);
		expect(mocks.appendArtifact).not.toHaveBeenCalled();
	});

	it("maps a failed patch result to patch artifact and failed activity", async () => {
		const created = taskMessage("patch-message", "patch fallback content");
		mocks.state.insertResults.push([created]);
		mocks.getDiffKind.mockReturnValueOnce("file.patch");
		mocks.appendArtifact.mockResolvedValueOnce({ id: "patch-artifact" });
		await createTaskMessage({
			taskId: "task-1",
			runId: "run-1",
			role: "tool",
			content: "tool content",
			payloadJson: {
				toolName: "apply_patch",
				title: "Patch title",
				iteration: 2,
				codeBlock: { filename: "src/app.ts", code: "new code" },
				toolResult: { ok: false, error: "failed" },
			},
		});
		expect(mocks.appendArtifact).toHaveBeenCalledWith(
			expect.objectContaining({
				kind: "patch",
				path: "src/app.ts",
				contentText: "new code",
			}),
		);
		expect(mocks.enqueueEvent).toHaveBeenNthCalledWith(
			2,
			expect.objectContaining({
				kind: "file.patch",
				status: "failed",
				text: "Patch title",
				artifactId: "patch-artifact",
			}),
		);
	});

	it("falls back for malformed diff metadata and successful status", async () => {
		const longContent = "x".repeat(260);
		const created = taskMessage("diff-message", longContent);
		mocks.state.insertResults.push([created]);
		mocks.getDiffKind.mockReturnValueOnce("file.diff");
		await createTaskMessage({
			taskId: "task-1",
			role: "tool",
			content: longContent,
			payloadJson: {
				toolName: "",
				title: 7,
				codeBlock: [],
				toolResult: null,
			},
		});
		expect(mocks.appendArtifact).toHaveBeenCalledWith(
			expect.objectContaining({
				kind: "diff",
				path: "tool.diff",
				contentText: longContent,
				metadataJson: expect.objectContaining({ toolResult: {} }),
			}),
		);
		expect(mocks.enqueueEvent).toHaveBeenNthCalledWith(
			2,
			expect.objectContaining({
				status: "completed",
				text: longContent.slice(0, 240),
				artifactId: null,
			}),
		);
	});

	it("propagates insert and activity persistence failures", async () => {
		mocks.insertReturning.mockRejectedValueOnce(new Error("insert failed"));
		await expect(
			createTaskMessage({ taskId: "task-1", role: "user", content: "hello" }),
		).rejects.toThrow("insert failed");

		mocks.state.insertResults.push([taskMessage("event-failure")]);
		mocks.enqueueEvent.mockRejectedValueOnce(new Error("event failed"));
		await expect(
			createTaskMessage({ taskId: "task-1", role: "user", content: "hello" }),
		).rejects.toThrow("event failed");
		expect(mocks.publish).not.toHaveBeenCalled();
	});

	it("updates message metadata and maps an absent row", async () => {
		const updated = { id: "message-1", metadataJson: { complete: true } };
		mocks.state.updateResults.push([updated], []);
		await expect(
			updateTaskMessageMetadata("message-1", { complete: true }),
		).resolves.toBe(updated);
		await expect(
			updateTaskMessageMetadata("missing", {}),
		).resolves.toBeUndefined();
		expect(mocks.updateSet).toHaveBeenNthCalledWith(1, {
			metadataJson: { complete: true },
		});
	});
});

describe("standalone blueprint artifacts", () => {
	it("creates an invalid app blueprint with explicit provenance and metadata overrides", async () => {
		const stored = { id: "artifact-1" };
		mocks.appendArtifact.mockResolvedValueOnce(stored);
		await expect(
			createBlueprintActivityArtifact({
				taskId: "task-1",
				runId: "run-1",
				messageId: "message-1",
				title: "Blueprint",
				appBlueprint: { name: "App" },
				validation: { valid: false },
				generation: { model: "gpt" },
				source: "questionnaire",
				metadataJson: { custom: true, status: "overridden" },
			}),
		).resolves.toBe(stored);
		expect(mocks.appendArtifact).toHaveBeenCalledWith({
			taskId: "task-1",
			runId: "run-1",
			kind: "app_blueprint",
			path: "message-1.app-blueprint.json",
			contentText: JSON.stringify({ name: "App" }, null, 2),
			metadataJson: expect.objectContaining({
				messageId: "message-1",
				intent: "app_blueprint",
				schemaName: "app_blueprint",
				schemaVersion: 1,
				status: "overridden",
				custom: true,
			}),
		});
	});

	it.each([
		["valid record", { valid: true }],
		["non-record", []],
		["absent", undefined],
	] as const)("creates a valid generated-path app blueprint for %s validation", async (_name, validation) => {
		await createBlueprintActivityArtifact({
			taskId: "task-1",
			title: "Blueprint",
			appBlueprint: {},
			validation,
		});
		expect(mocks.appendArtifact).toHaveBeenCalledWith(
			expect.objectContaining({
				runId: null,
				path: expect.stringMatching(/^[0-9a-f-]{36}\.app-blueprint\.json$/),
				metadataJson: expect.objectContaining({
					messageId: null,
					status: "valid",
				}),
			}),
		);
	});

	it("creates a mock blueprint with defaults and caller metadata", async () => {
		await createMockBlueprintActivityArtifact({
			taskId: "task-1",
			title: "Mock",
			mockBlueprint: { screens: [] },
			generation: { source: "llm" },
			source: null,
			metadataJson: { custom: "value", schemaVersion: 9 },
		});
		expect(mocks.appendArtifact).toHaveBeenCalledWith({
			taskId: "task-1",
			runId: null,
			kind: "app_blueprint",
			path: expect.stringMatching(/^[0-9a-f-]{36}\.mock-blueprint\.json$/),
			contentText: JSON.stringify({ screens: [] }, null, 2),
			metadataJson: expect.objectContaining({
				messageId: null,
				intent: "mock_blueprint",
				artifactType: "mock_blueprint",
				status: "valid",
				custom: "value",
				schemaVersion: 9,
			}),
		});
	});

	it("uses explicit ids and propagates artifact persistence errors", async () => {
		mocks.appendArtifact.mockRejectedValueOnce(
			new Error("artifact store failed"),
		);
		await expect(
			createMockBlueprintActivityArtifact({
				taskId: "task-1",
				runId: "run-1",
				messageId: "message-1",
				title: "Mock",
				mockBlueprint: {},
			}),
		).rejects.toThrow("artifact store failed");
		expect(mocks.appendArtifact).toHaveBeenCalledWith(
			expect.objectContaining({
				runId: "run-1",
				path: "message-1.mock-blueprint.json",
			}),
		);
	});
});

function readyIdentity() {
	return {
		repositoryKind: "git",
		status: "ready",
		registeredRootCanonical: "/canonical/project",
		gitCommonDirCanonical: "/canonical/project/.git",
		baseWorktreePathCanonical: "/canonical/project",
		baseWorktreeId: "worktree-id",
		digest: "sha256:digest",
		revision: 2,
		verifiedAt: "2026-01-01T00:00:00.000Z",
		observedBranch: "main",
		observedHeadSha: "abc123",
		baseWorktreeDirty: false,
		failureCode: null,
	};
}

function repositoryInput(overrides: Record<string, unknown> = {}) {
	return {
		name: "Project",
		localPath: "/requested/project",
		branch: "main",
		...overrides,
	};
}

function taskMessage(id: string, content = "stored content") {
	return {
		id,
		taskId: "task-1",
		runId: null,
		role: "assistant",
		content,
		messageType: null,
		metadataJson: {},
		createdAt: new Date("2026-01-01T00:00:00.000Z"),
	};
}
