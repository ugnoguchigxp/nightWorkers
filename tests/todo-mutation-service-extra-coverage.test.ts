import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
	class MockTodoMutationAbort extends Error {
		constructor(readonly code: string) {
			super(code);
		}
	}
	const state = {
		run: {} as Record<string, unknown> | null,
		latestRun: {} as Record<string, unknown> | null,
		updatedRun: {} as Record<string, unknown> | null,
		dbRun: {} as Record<string, unknown> | null,
		todos: [] as Array<Record<string, unknown>>,
	};
	return {
		state,
		MockTodoMutationAbort,
		transaction: vi.fn(),
		dbSelect: vi.fn(),
		txSelect: vi.fn(),
		txUpdate: vi.fn(),
		txDelete: vi.fn(),
		txInsert: vi.fn(),
		txUpdateSet: vi.fn(),
		txDeleteWhere: vi.fn(),
		txInsertValues: vi.fn(),
		withBusyRetry: vi.fn(),
		publish: vi.fn(),
		buildCanonicalId: vi.fn(),
		createInitialPlan: vi.fn(),
		replaceRemainingPlan: vi.fn(),
		completeCurrent: vi.fn(),
		blockCurrent: vi.fn(),
		validateCommand: vi.fn(),
		errorMessage: vi.fn(),
		listTodos: vi.fn(),
		lockMutableRun: vi.fn(),
		updateTodoCas: vi.fn(),
		dependenciesTerminal: vi.fn(),
		findTodo: vi.fn(),
		hasCycle: vi.fn(),
		hasOtherCurrent: vi.fn(),
		uniqueCurrent: vi.fn(),
		parseHumanBlocker: vi.fn(),
	};
});

vi.mock("drizzle-orm", () => ({
	and: vi.fn(() => ({})),
	eq: vi.fn(() => ({})),
	inArray: vi.fn(() => ({})),
	sql: vi.fn(() => ({})),
}));
vi.mock("../api/db/schema", () => ({
	taskRuns: {
		id: "run.id",
		status: "run.status",
		todoPlanRevision: "run.todoPlanRevision",
	},
	taskRunTodos: {
		id: "todo.id",
		runId: "todo.runId",
		attemptCount: "todo.attemptCount",
	},
}));
vi.mock("../api/db/client", () => ({
	db: {
		transaction: mocks.transaction,
		select: mocks.dbSelect,
	},
}));
vi.mock("../api/db/retry", () => ({
	withSqliteBusyRetry: mocks.withBusyRetry,
}));
vi.mock("../api/services/realtime/nightworkers-ws", () => ({
	nightWorkersRealtimeBroker: { publish: mocks.publish },
}));
vi.mock("../api/modules/codingAgent/todo/todo-identity", () => ({
	buildCanonicalTodoId: mocks.buildCanonicalId,
}));
vi.mock("../api/modules/codingAgent/todo/todo-minimal-mutation", () => ({
	blockCurrent: mocks.blockCurrent,
	completeCurrent: mocks.completeCurrent,
	createInitialPlan: mocks.createInitialPlan,
	replaceRemainingPlan: mocks.replaceRemainingPlan,
}));
vi.mock("../api/modules/codingAgent/todo/todo-mutation-contract", () => ({
	todoMutationErrorMessage: mocks.errorMessage,
	validateTodoMutationCommand: mocks.validateCommand,
}));
vi.mock("../api/modules/codingAgent/todo/todo-mutation-persistence", () => ({
	listTodos: mocks.listTodos,
	lockMutableRun: mocks.lockMutableRun,
	MUTABLE_RUN_STATUSES: ["running", "context_compiling", "needs_human"],
	TodoMutationAbort: mocks.MockTodoMutationAbort,
	updateTodoCas: mocks.updateTodoCas,
}));
vi.mock("../api/modules/codingAgent/todo/todo-state", () => ({
	dependenciesAreTerminal: mocks.dependenciesTerminal,
	findTodoByReference: mocks.findTodo,
	hasDependencyCycle: mocks.hasCycle,
	hasOtherCurrentTodo: mocks.hasOtherCurrent,
	uniqueCurrentTodo: mocks.uniqueCurrent,
}));
vi.mock("../api/modules/codingAgent/todo/types", () => ({
	humanBlockerSchema: { parse: mocks.parseHumanBlocker },
}));

const { TodoMutationService } = await import(
	"../api/modules/codingAgent/todo/todo-mutation.service"
);

const systemContext = {
	version: 2,
	planModeRequested: false,
	todoPolicy: "adaptive",
	roleInstructionsJa: "role",
	taskGoal: "goal",
	projectRulesJa: [],
	todoRequirementJa: "todo",
	failureRecoveryJa: "recover",
	completionRuleJa: "complete",
	toolContractJa: "tools",
	registeredRepositoryRoot: "/tmp/repo",
};
const runId = "run-1";

function run(overrides: Record<string, unknown> = {}) {
	return {
		id: runId,
		taskId: "task-1",
		status: "running",
		todoPlanRevision: 3,
		...overrides,
	};
}

function todo(overrides: Record<string, unknown> = {}) {
	return {
		id: "todo-1",
		runId,
		todoKey: "todo-key-1",
		seq: 1,
		title: "Implement",
		description: null,
		objective: null,
		context: "existing context",
		nextAction: "continue",
		acceptanceCriteriaJson: [],
		taskType: "coding",
		status: "running",
		dependsOn: [],
		systemContextVersion: 1,
		systemContextSnapshot: systemContext,
		contextSnapshot: systemContext,
		createdBy: "agent",
		revision: 4,
		startedAt: new Date("2026-01-01"),
		createdAt: new Date("2026-01-01"),
		updatedAt: new Date("2026-01-01"),
		...overrides,
	};
}

function setTodos(todos: Array<Record<string, unknown>>) {
	mocks.state.todos = todos;
	mocks.listTodos.mockResolvedValue(todos);
}

function success(todos = mocks.state.todos) {
	return {
		ok: true,
		planRevision: 3,
		todos,
		currentTodo: null,
	};
}

function chain(value: () => unknown) {
	return {
		from: () => ({
			where: async () => value(),
		}),
	};
}

const tx = {
	select: mocks.txSelect,
	update: mocks.txUpdate,
	delete: mocks.txDelete,
	insert: mocks.txInsert,
};

function service() {
	return new TodoMutationService(systemContext as never, "agent");
}

async function execute(command: Record<string, unknown>, id = runId) {
	return service().execute(id, command as never);
}

beforeEach(() => {
	for (const [name, mock] of Object.entries(mocks)) {
		if (
			name !== "state" &&
			name !== "MockTodoMutationAbort" &&
			typeof mock === "function" &&
			"mockReset" in mock
		) {
			mock.mockReset();
		}
	}
	mocks.state.run = run();
	mocks.state.latestRun = run();
	mocks.state.updatedRun = run({ todoPlanRevision: 4 });
	mocks.state.dbRun = run();
	setTodos([todo()]);
	mocks.txSelect.mockImplementation((selection?: unknown) =>
		chain(() =>
			selection
				? mocks.state.latestRun
					? [mocks.state.latestRun]
					: []
				: mocks.state.run
					? [mocks.state.run]
					: [],
		),
	);
	mocks.txUpdateSet.mockImplementation(() => ({
		where: () => ({
			returning: async () =>
				mocks.state.updatedRun ? [mocks.state.updatedRun] : [],
		}),
	}));
	mocks.txUpdate.mockReturnValue({ set: mocks.txUpdateSet });
	mocks.txDeleteWhere.mockResolvedValue(undefined);
	mocks.txDelete.mockReturnValue({ where: mocks.txDeleteWhere });
	mocks.txInsertValues.mockResolvedValue(undefined);
	mocks.txInsert.mockReturnValue({ values: mocks.txInsertValues });
	mocks.transaction.mockImplementation(async (callback) => callback(tx));
	mocks.dbSelect.mockImplementation(() =>
		chain(() => (mocks.state.dbRun ? [mocks.state.dbRun] : [])),
	);
	mocks.withBusyRetry.mockImplementation(async (callback) => callback());
	mocks.validateCommand.mockReturnValue(null);
	mocks.errorMessage.mockImplementation((code) => `message:${code}`);
	mocks.lockMutableRun.mockResolvedValue(true);
	mocks.updateTodoCas.mockResolvedValue(todo());
	mocks.dependenciesTerminal.mockReturnValue(true);
	mocks.findTodo.mockImplementation((todos, reference) =>
		todos.find(
			(item: Record<string, unknown>) =>
				item.id === reference || item.todoKey === reference,
		),
	);
	mocks.hasCycle.mockReturnValue(false);
	mocks.hasOtherCurrent.mockReturnValue(false);
	mocks.uniqueCurrent.mockImplementation(
		(todos) =>
			todos.find(
				(item: Record<string, unknown>) => item.status === "running",
			) ?? null,
	);
	mocks.parseHumanBlocker.mockImplementation((value) => value);
	mocks.buildCanonicalId.mockImplementation(
		(currentRunId, key) => `${currentRunId}:${key}`,
	);
	mocks.createInitialPlan.mockResolvedValue(success());
	mocks.replaceRemainingPlan.mockResolvedValue(success());
	mocks.completeCurrent.mockResolvedValue(success());
	mocks.blockCurrent.mockResolvedValue(success());
});

describe("TodoMutationService entry and operation coverage", () => {
	it("rejects a blank run id without touching persistence", async () => {
		const result = await execute({ op: "complete_current" }, "   ");
		expect(result).toMatchObject({
			ok: false,
			error: { code: "RUN_NOT_FOUND" },
			planRevision: 0,
			todos: [],
		});
		expect(mocks.validateCommand).not.toHaveBeenCalled();
	});

	it("loads current state for validation failures and missing runs", async () => {
		mocks.validateCommand.mockReturnValueOnce("INVALID_TODO_COMMAND");
		const invalid = await execute({ op: "start" });
		expect(invalid).toMatchObject({
			ok: false,
			error: { code: "INVALID_TODO_COMMAND" },
			planRevision: 3,
		});
		mocks.validateCommand.mockReturnValueOnce("INVALID_TODO_COMMAND");
		mocks.state.dbRun = null;
		const missing = await execute({ op: "start" });
		expect(missing).toMatchObject({
			ok: false,
			error: { code: "RUN_NOT_FOUND" },
			planRevision: 0,
		});
	});

	it("returns run-not-found from inside the transaction", async () => {
		mocks.state.run = null;
		await expect(execute({ op: "complete_current" })).resolves.toMatchObject({
			ok: false,
			error: { code: "RUN_NOT_FOUND" },
		});
	});

	it("delegates minimal plan operations with ownership metadata", async () => {
		const steps = [{ title: "one" }];
		await execute({ op: "plan", steps });
		expect(mocks.createInitialPlan).toHaveBeenCalledWith(
			tx,
			expect.objectContaining({ id: runId }),
			steps,
			{ systemContext, createdBy: "agent" },
		);
		await execute({ op: "replace_remaining", steps });
		expect(mocks.replaceRemainingPlan).toHaveBeenCalledWith(
			tx,
			expect.objectContaining({ id: runId }),
			steps,
			{ systemContext, createdBy: "agent" },
		);
	});

	it("delegates complete and structured block operations", async () => {
		await execute({ op: "complete_current", note: "done" });
		expect(mocks.completeCurrent).toHaveBeenCalledWith(
			tx,
			expect.any(Object),
			mocks.state.todos,
			"done",
		);
		const blocker = { question: "Choose", requiredInput: "decision" };
		await execute({ op: "block_current", humanBlocker: blocker });
		expect(mocks.blockCurrent).toHaveBeenCalledWith(
			tx,
			expect.any(Object),
			mocks.state.todos,
			blocker,
		);
	});

	it("fails block when validation permits but normalization establishes no blocker", async () => {
		mocks.parseHumanBlocker.mockReturnValueOnce(null);
		await expect(
			execute({ op: "block_current", humanBlocker: {} }),
		).resolves.toMatchObject({
			ok: false,
			error: { code: "TODO_HUMAN_BLOCKER_NOT_ESTABLISHED" },
		});
	});

	it("rejects non-mutable runs before target lookup", async () => {
		mocks.lockMutableRun.mockResolvedValueOnce(false);
		await expect(
			execute({ op: "start", todoId: "todo-1", expectedTodoRevision: 4 }),
		).resolves.toMatchObject({
			ok: false,
			error: { code: "RUN_NOT_MUTABLE" },
		});
		expect(mocks.findTodo).not.toHaveBeenCalled();
	});

	it("rejects missing and stale target references", async () => {
		mocks.findTodo.mockReturnValueOnce(undefined);
		await expect(
			execute({ op: "start", todoId: "missing", expectedTodoRevision: 0 }),
		).resolves.toMatchObject({
			ok: false,
			error: { code: "TODO_NOT_FOUND" },
		});
		await expect(
			execute({ op: "start", todoId: "todo-1", expectedTodoRevision: 3 }),
		).resolves.toMatchObject({
			ok: false,
			error: { code: "TODO_REVISION_CONFLICT" },
		});
	});
});

describe("Todo start and resume transition coverage", () => {
	it("enforces start status, uniqueness, and dependency guards", async () => {
		setTodos([todo({ status: "passed" })]);
		await expect(
			execute({ op: "start", todoId: "todo-1", expectedTodoRevision: 4 }),
		).resolves.toMatchObject({ error: { code: "TODO_NOT_STARTABLE" } });

		setTodos([todo({ status: "pending" })]);
		mocks.findTodo.mockReturnValue(todo({ status: "pending" }));
		mocks.hasOtherCurrent.mockReturnValueOnce(true);
		await expect(
			execute({ op: "start", todoId: "todo-1", expectedTodoRevision: 4 }),
		).resolves.toMatchObject({ error: { code: "CURRENT_TODO_EXISTS" } });

		mocks.dependenciesTerminal.mockReturnValueOnce(false);
		await expect(
			execute({ op: "start", todoId: "todo-1", expectedTodoRevision: 4 }),
		).resolves.toMatchObject({ error: { code: "TODO_DEPENDENCY_OPEN" } });
	});

	it("starts an eligible pending Todo and publishes the mutation", async () => {
		const pending = todo({ status: "pending", startedAt: null });
		setTodos([pending]);
		mocks.findTodo.mockReturnValue(pending);
		const result = await execute({
			op: "start",
			todoId: "todo-1",
			expectedTodoRevision: 4,
		});
		expect(result.ok).toBe(true);
		expect(mocks.updateTodoCas).toHaveBeenCalledWith(
			tx,
			expect.any(Object),
			expect.objectContaining({
				status: "running",
				completedAt: null,
				humanBlockerJson: null,
			}),
		);
		expect(mocks.publish).toHaveBeenCalledWith(
			"task-1",
			expect.objectContaining({ type: "task_run_updated", runId }),
		);
	});

	it("enforces resume status and current Todo uniqueness", async () => {
		await expect(
			execute({
				op: "resume",
				todoId: "todo-1",
				expectedTodoRevision: 4,
				userContext: "answer",
			}),
		).resolves.toMatchObject({ error: { code: "TODO_NOT_RESUMABLE" } });
		setTodos([todo({ status: "needs_human" })]);
		mocks.findTodo.mockReturnValue(todo({ status: "needs_human" }));
		mocks.hasOtherCurrent.mockReturnValueOnce(true);
		await expect(
			execute({
				op: "resume",
				todoId: "todo-1",
				expectedTodoRevision: 4,
				userContext: "answer",
			}),
		).resolves.toMatchObject({ error: { code: "CURRENT_TODO_EXISTS" } });
	});

	it("resumes Todo context and a needs_human run", async () => {
		mocks.state.run = run({ status: "needs_human" });
		setTodos([
			todo({ status: "needs_human", context: " old ", startedAt: null }),
		]);
		mocks.findTodo.mockReturnValue(
			todo({ status: "needs_human", context: " old ", startedAt: null }),
		);
		await execute({
			op: "resume",
			todoId: "todo-1",
			expectedTodoRevision: 4,
			userContext: "  answer  ",
		});
		expect(mocks.updateTodoCas).toHaveBeenCalledWith(
			tx,
			expect.any(Object),
			expect.objectContaining({
				status: "running",
				context: "old\n\nユーザー回答:\nanswer",
				startedAt: expect.any(Date),
			}),
		);
		expect(mocks.txUpdateSet).toHaveBeenCalledWith(
			expect.objectContaining({
				status: "running",
				endedAt: null,
				finalJudgment: null,
			}),
		);
	});

	it("maps a failed needs_human run CAS to RUN_NOT_MUTABLE", async () => {
		mocks.state.run = run({ status: "needs_human" });
		setTodos([todo({ status: "needs_human" })]);
		mocks.findTodo.mockReturnValue(todo({ status: "needs_human" }));
		mocks.state.updatedRun = null;
		await expect(
			execute({
				op: "resume",
				todoId: "todo-1",
				expectedTodoRevision: 4,
				userContext: "answer",
			}),
		).resolves.toMatchObject({ error: { code: "RUN_NOT_MUTABLE" } });
	});
});

describe("Todo transition operation coverage", () => {
	const transition = (
		status: string,
		overrides: Record<string, unknown> = {},
	) => ({
		op: "transition",
		todoId: "todo-1",
		expectedTodoRevision: 4,
		status,
		reason: " completed ",
		...overrides,
	});

	it("rejects non-running targets and permits pending skip", async () => {
		setTodos([todo({ status: "passed" })]);
		mocks.findTodo.mockReturnValue(todo({ status: "passed" }));
		await expect(execute(transition("failed"))).resolves.toMatchObject({
			error: { code: "TODO_TERMINAL_REOPEN_FORBIDDEN" },
		});
		setTodos([todo({ status: "pending" })]);
		mocks.findTodo.mockReturnValue(todo({ status: "pending" }));
		await expect(execute(transition("passed"))).resolves.toMatchObject({
			error: { code: "TODO_NOT_RUNNING" },
		});
		await expect(execute(transition("skipped"))).resolves.toMatchObject({
			ok: true,
		});
	});

	it("rejects invalid or missing next Todo transitions", async () => {
		const blocker = { question: "Need input" };
		await expect(
			execute(
				transition("needs_human", {
					reason: undefined,
					nextTodoId: "todo-2",
					humanBlocker: blocker,
				}),
			),
		).resolves.toMatchObject({ error: { code: "INVALID_TODO_COMMAND" } });
		await expect(
			execute(transition("passed", { nextTodoId: "missing" })),
		).resolves.toMatchObject({ error: { code: "TODO_NOT_FOUND" } });
	});

	it("enforces next Todo status, dependencies, identity, and uniqueness", async () => {
		const next = todo({
			id: "todo-2",
			todoKey: "todo-key-2",
			revision: 0,
			status: "passed",
		});
		setTodos([todo(), next]);
		mocks.findTodo.mockReturnValueOnce(todo()).mockReturnValueOnce(next);
		await expect(
			execute(transition("passed", { nextTodoId: "todo-2" })),
		).resolves.toMatchObject({ error: { code: "TODO_NOT_STARTABLE" } });

		next.status = "pending";
		mocks.dependenciesTerminal.mockReturnValueOnce(false);
		mocks.findTodo.mockReturnValueOnce(todo()).mockReturnValueOnce(next);
		await expect(
			execute(transition("passed", { nextTodoId: "todo-2" })),
		).resolves.toMatchObject({ error: { code: "TODO_DEPENDENCY_OPEN" } });

		mocks.findTodo
			.mockReturnValueOnce(todo())
			.mockReturnValueOnce(todo({ status: "pending" }));
		await expect(
			execute(transition("passed", { nextTodoId: "todo-1" })),
		).resolves.toMatchObject({ error: { code: "INVALID_TODO_COMMAND" } });

		mocks.hasOtherCurrent.mockReturnValueOnce(true);
		mocks.findTodo.mockReturnValueOnce(todo()).mockReturnValueOnce(next);
		await expect(
			execute(transition("passed", { nextTodoId: "todo-2" })),
		).resolves.toMatchObject({ error: { code: "CURRENT_TODO_EXISTS" } });
	});

	it("transitions to needs_human with structured blocker", async () => {
		const blocker = { question: "Need approval" };
		await execute(
			transition("needs_human", {
				reason: undefined,
				humanBlocker: blocker,
			}),
		);
		expect(mocks.updateTodoCas).toHaveBeenCalledWith(
			tx,
			expect.any(Object),
			expect.objectContaining({
				status: "needs_human",
				statusReason: "Need approval",
				humanBlockerJson: blocker,
				completedAt: null,
			}),
		);
	});

	it("completes a target and atomically starts the requested next Todo", async () => {
		const next = todo({
			id: "todo-2",
			todoKey: "todo-key-2",
			revision: 0,
			status: "pending",
		});
		setTodos([todo({ startedAt: null }), next]);
		mocks.findTodo
			.mockReturnValueOnce(todo({ startedAt: null }))
			.mockReturnValueOnce(next);
		await execute(transition("passed", { nextTodoId: "todo-2" }));
		expect(mocks.updateTodoCas).toHaveBeenNthCalledWith(
			1,
			tx,
			expect.objectContaining({ id: "todo-1" }),
			expect.objectContaining({
				status: "passed",
				statusReason: "completed",
				completedAt: expect.any(Date),
				startedAt: expect.any(Date),
			}),
		);
		expect(mocks.updateTodoCas).toHaveBeenNthCalledWith(
			2,
			tx,
			expect.objectContaining({ id: "todo-2" }),
			expect.objectContaining({ status: "running" }),
		);
	});
});

describe("failure recording and context update coverage", () => {
	it("requires running status for record_failure and update_context", async () => {
		setTodos([todo({ status: "pending" })]);
		mocks.findTodo.mockReturnValue(todo({ status: "pending" }));
		for (const command of [
			{
				op: "record_failure",
				todoId: "todo-1",
				expectedTodoRevision: 4,
				failureSummary: "failed",
				nextAction: "retry",
			},
			{
				op: "update_context",
				todoId: "todo-1",
				expectedTodoRevision: 4,
				systemContext: "context",
				nextAction: "continue",
			},
		]) {
			await expect(execute(command)).resolves.toMatchObject({
				error: { code: "TODO_NOT_RUNNING" },
			});
		}
	});

	it("records failure details and trims context aliases", async () => {
		await execute({
			op: "record_failure",
			todoId: "todo-1",
			expectedTodoRevision: 4,
			failureSummary: " failed ",
			nextAction: " retry ",
		});
		expect(mocks.updateTodoCas).toHaveBeenLastCalledWith(
			tx,
			expect.any(Object),
			expect.objectContaining({
				lastFailure: "failed",
				nextAction: "retry",
			}),
		);

		await execute({
			op: "update_context",
			todoId: "todo-1",
			expectedTodoRevision: 4,
			context: " legacy context ",
			nextAction: " next ",
		});
		expect(mocks.updateTodoCas).toHaveBeenLastCalledWith(
			tx,
			expect.any(Object),
			{ context: "legacy context", nextAction: "next" },
		);
		await execute({
			op: "update_context",
			todoId: "todo-1",
			expectedTodoRevision: 4,
			systemContext: undefined,
			context: undefined,
			nextAction: "next",
		});
		expect(mocks.updateTodoCas).toHaveBeenLastCalledWith(
			tx,
			expect.any(Object),
			{ context: "", nextAction: "next" },
		);
	});
});

describe("replace_plan coverage", () => {
	function replacePlan(
		todos: Array<Record<string, unknown>>,
		expectedPlanRevision?: number,
	) {
		return execute({
			op: "replace_plan",
			expectedPlanRevision,
			todos,
		});
	}

	it("rejects plan revision, duplicate key, missing dependency, and cycle", async () => {
		await expect(
			replacePlan([{ todoKey: "a", title: "A", systemContext: "ctx" }], 2),
		).resolves.toMatchObject({
			error: { code: "TODO_PLAN_REVISION_CONFLICT" },
		});
		setTodos([]);
		await expect(
			replacePlan([
				{ todoKey: "a", title: "A", systemContext: "ctx" },
				{ todoKey: "a", title: "B", systemContext: "ctx" },
			]),
		).resolves.toMatchObject({ error: { code: "TODO_KEY_DUPLICATED" } });
		await expect(
			replacePlan([
				{
					todoKey: "a",
					title: "A",
					systemContext: "ctx",
					dependsOnKeys: ["missing"],
				},
			]),
		).resolves.toMatchObject({
			error: { code: "TODO_DEPENDENCY_NOT_FOUND" },
		});
		mocks.hasCycle.mockReturnValueOnce(true);
		await expect(
			replacePlan([{ todoKey: "a", title: "A", systemContext: "ctx" }]),
		).resolves.toMatchObject({ error: { code: "TODO_DEPENDENCY_CYCLE" } });
	});

	it("rejects canonical identity conflicts and terminal reopening", async () => {
		setTodos([]);
		mocks.buildCanonicalId.mockReturnValue("same-id");
		await expect(
			replacePlan([
				{ todoKey: "a", title: "A", systemContext: "ctx" },
				{ todoKey: "b", title: "B", systemContext: "ctx" },
			]),
		).resolves.toMatchObject({ error: { code: "TODO_IDENTITY_CONFLICT" } });

		mocks.buildCanonicalId.mockImplementation(
			(currentRunId, key) => `${currentRunId}:${key}`,
		);
		const terminalTodo = todo({
			status: "passed",
			todoKey: "done",
			id: "terminal-id",
		});
		setTodos([terminalTodo]);
		mocks.listTodos
			.mockResolvedValueOnce([terminalTodo])
			.mockResolvedValueOnce([terminalTodo]);
		await expect(
			replacePlan([{ todoKey: "done", title: "Again", systemContext: "ctx" }]),
		).resolves.toMatchObject({
			error: { code: "TODO_TERMINAL_REOPEN_FORBIDDEN" },
		});
	});

	it("maps failed run revision CAS using latest run status", async () => {
		setTodos([]);
		mocks.state.updatedRun = null;
		mocks.state.latestRun = run({ status: "running" });
		await expect(
			replacePlan([{ todoKey: "a", title: "A", systemContext: "ctx" }]),
		).resolves.toMatchObject({
			error: { code: "TODO_PLAN_REVISION_CONFLICT" },
		});
		mocks.state.latestRun = run({ status: "succeeded" });
		await expect(
			replacePlan([{ todoKey: "a", title: "A", systemContext: "ctx" }]),
		).resolves.toMatchObject({ error: { code: "RUN_NOT_MUTABLE" } });
	});

	it("replaces open Todos while preserving terminal sequence and metadata", async () => {
		const terminal = todo({
			id: "terminal",
			todoKey: "terminal",
			status: "passed",
			seq: 5,
			createdBy: "human",
		});
		const previous = todo({
			id: "existing",
			todoKey: "existing",
			status: "pending",
			seq: 6,
			revision: 2,
			createdBy: "human",
		});
		setTodos([terminal, previous]);
		mocks.listTodos
			.mockResolvedValueOnce([terminal, previous])
			.mockResolvedValueOnce([terminal, previous]);
		await replacePlan([
			{
				todoKey: "existing",
				title: " Existing ",
				objective: " Objective ",
				context: " Context ",
				acceptanceCriteria: ["done"],
				taskType: " docs ",
				dependsOn: ["terminal"],
			},
			{
				id: "new-key",
				title: "New",
				systemContext: "New context",
			},
		]);
		expect(mocks.txDeleteWhere).toHaveBeenCalled();
		expect(mocks.txInsertValues).toHaveBeenNthCalledWith(
			1,
			expect.objectContaining({
				id: "existing",
				seq: 6,
				title: "Existing",
				description: "Objective",
				context: "Context",
				nextAction: "Context",
				taskType: "docs",
				dependsOn: ["terminal"],
				createdBy: "human",
				revision: 3,
				createdAt: previous.createdAt,
			}),
		);
		expect(mocks.txInsertValues).toHaveBeenNthCalledWith(
			2,
			expect.objectContaining({
				id: "run-1:new-key",
				seq: 7,
				description: null,
				taskType: "coding",
				createdBy: "agent",
				revision: 0,
			}),
		);
	});
});

describe("repository failure and realtime coverage", () => {
	it.each([
		[
			new mocks.MockTodoMutationAbort("TODO_REVISION_CONFLICT"),
			"TODO_REVISION_CONFLICT",
		],
		[
			new Error("UNIQUE constraint failed: task_run_todos.id"),
			"TODO_IDENTITY_CONFLICT",
		],
		[
			new Error(
				"UNIQUE constraint failed: task_run_todos.run_id, task_run_todos.todo_key",
			),
			"TODO_KEY_DUPLICATED",
		],
		[
			new Error(
				"UNIQUE constraint failed: task_run_todos.run_id, task_run_todos.seq",
			),
			"TODO_MUTATION_CONFLICT",
		],
		[
			new Error("UNIQUE constraint failed: task_run_todos.run_id"),
			"CURRENT_TODO_EXISTS",
		],
		[new Error("UNIQUE constraint failed: other"), "TODO_MUTATION_CONFLICT"],
		["repository unavailable", "TODO_MUTATION_CONFLICT"],
	] as const)("maps repository error %# to %s", async (error, code) => {
		mocks.transaction.mockRejectedValueOnce(error);
		await expect(execute({ op: "complete_current" })).resolves.toMatchObject({
			ok: false,
			error: { code },
		});
	});

	it("does not publish failures or successful mutations with a missing run", async () => {
		mocks.lockMutableRun.mockResolvedValueOnce(false);
		await execute({ op: "start", todoId: "todo-1", expectedTodoRevision: 4 });
		expect(mocks.publish).not.toHaveBeenCalled();

		mocks.state.dbRun = null;
		setTodos([todo({ status: "pending" })]);
		mocks.findTodo.mockReturnValue(todo({ status: "pending" }));
		await execute({ op: "start", todoId: "todo-1", expectedTodoRevision: 4 });
		expect(mocks.publish).not.toHaveBeenCalled();
	});

	it("does not fail a persisted mutation when realtime lookup throws", async () => {
		setTodos([todo({ status: "pending" })]);
		mocks.findTodo.mockReturnValue(todo({ status: "pending" }));
		mocks.dbSelect.mockImplementationOnce(() => ({
			from: () => ({
				where: async () => {
					throw new Error("realtime lookup failed");
				},
			}),
		}));
		await expect(
			execute({ op: "start", todoId: "todo-1", expectedTodoRevision: 4 }),
		).resolves.toMatchObject({ ok: true });
	});
});
