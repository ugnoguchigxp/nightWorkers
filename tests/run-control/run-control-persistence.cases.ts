import { afterEach, describe, expect, it } from "vitest";
import {
	createRepository,
	createTask,
	createTaskRun,
	createTaskRunTodo,
	deleteRepository,
	updateTaskRunTodo,
} from "../../api/modules/nightworkers/nightworkers.repository";
import { RunStateCardProjector } from "../../api/services/run-control/context-projector";
import { RunFinalizeController } from "../../api/services/run-control/finalize-controller";
import { RunControlRepository } from "../../api/services/run-control/run-control-repository";
import { RunControlService } from "../../api/services/run-control/run-control-service";
import { todoListTool } from "../../api/services/worker-tools/todo-list";
import type { WorkerToolResult } from "../../api/services/worker-tools/types";
import { buildContext } from "../codex-agent-runtime/helpers";

const repositoryIds: string[] = [];

afterEach(async () => {
	for (const id of repositoryIds.splice(0)) await deleteRepository(id);
});

async function createRunFixture() {
	const repository = await createRepository({
		name: `run-control-${crypto.randomUUID()}`,
		localPath: "/tmp/run-control-fixture",
		branch: "main",
		allowed: true,
	});
	repositoryIds.push(repository.id);
	const task = await createTask({
		repositoryId: repository.id,
		title: "Run control fixture",
		status: "running",
	});
	const run = await createTaskRun({
		taskId: task.id,
		repositoryId: repository.id,
		status: "running",
	});
	return { repository, task, run };
}

function workerResult(input: {
	toolName: string;
	ok: boolean;
	payload: unknown;
}): WorkerToolResult<unknown> {
	return {
		ok: input.ok,
		toolName: input.toolName,
		startedAt: new Date(0).toISOString(),
		finishedAt: new Date(0).toISOString(),
		payload: input.payload,
		...(input.ok
			? {}
			: { error: { code: "CHECK_FAILED", message: "verification failed" } }),
	};
}

describe("run control persistence", () => {
	it("reuses observations at the same revision and unlocks verification after mutation", async () => {
		const { run, repository } = await createRunFixture();
		const service = new RunControlService(new RunControlRepository());
		const observationInput = {
			runId: run.id,
			toolName: "todo_list",
			arguments: { operation: "list" },
			workspaceIdentity: repository.localPath,
		};
		const firstObservation = await service.prepare(observationInput);
		expect(firstObservation.kind).toBe("execute");
		if (firstObservation.kind !== "execute") return;
		await service.completeWorkerAction({
			prepared: {
				state: firstObservation.state,
				action: firstObservation.action,
				persisted: firstObservation.persisted,
			},
			result: workerResult({
				toolName: "todo_list",
				ok: true,
				payload: { todos: [] },
			}),
			modelView: { todos: [] },
		});
		const repeatedObservation = await service.prepare(observationInput);
		expect(repeatedObservation.kind).toBe("reuse");
		expect(repeatedObservation.state.phase).toBe("active");
		const repeatedObservationAgain = await service.prepare(observationInput);
		expect(repeatedObservationAgain.kind).toBe("reuse");
		expect(repeatedObservationAgain.state.phase).toBe("recovery");

		const verificationInput = {
			runId: run.id,
			toolName: "run_check",
			arguments: { command: "bun test" },
			workspaceIdentity: repository.localPath,
		};
		const firstVerification = await service.prepare(verificationInput);
		expect(firstVerification.kind).toBe("execute");
		if (firstVerification.kind !== "execute") return;
		await service.completeWorkerAction({
			prepared: {
				state: firstVerification.state,
				action: firstVerification.action,
				persisted: firstVerification.persisted,
			},
			result: workerResult({
				toolName: "run_check",
				ok: false,
				payload: { exitCode: 1 },
			}),
			modelView: { exitCode: 1 },
			evidenceRefs: ["verification:failed"],
		});
		expect((await service.prepare(verificationInput)).kind).toBe("reuse");

		const mutation = await service.prepare({
			runId: run.id,
			toolName: "write_file",
			arguments: { filePath: "src/app.ts", content: "changed" },
			workspaceIdentity: repository.localPath,
		});
		expect(mutation.kind).toBe("execute");
		if (mutation.kind !== "execute") return;
		await service.completeWorkerAction({
			prepared: {
				state: mutation.state,
				action: mutation.action,
				persisted: mutation.persisted,
			},
			result: workerResult({
				toolName: "write_file",
				ok: true,
				payload: { changed: true },
			}),
			modelView: { changed: true, path: "src/app.ts" },
		});
		expect((await service.prepare(verificationInput)).kind).toBe("execute");
	});

	it("blocks finalize for open Todos and makes terminalization idempotent", async () => {
		const { run } = await createRunFixture();
		const todo = await createTaskRunTodo({
			runId: run.id,
			seq: 1,
			title: "Implement",
			taskType: "implementation",
			status: "running",
		});
		const controller = new RunFinalizeController(new RunControlRepository());
		const blocked = await controller.evaluateCandidate({ runId: run.id });
		expect(blocked).toMatchObject({
			allowFinalize: false,
			code: "FINALIZE_GUARD_NOT_MET",
			missingConditions: ["open_todos:1"],
		});

		await updateTaskRunTodo(todo.id, {
			status: "passed",
			completedAt: new Date(),
		});
		const allowed = await controller.evaluateCandidate({ runId: run.id });
		expect(allowed.allowFinalize).toBe(true);
		await controller.terminalize(run.id, "completed");
		const repeated = await controller.evaluateCandidate({ runId: run.id });
		expect(repeated).toMatchObject({
			allowFinalize: true,
			code: "RUN_ALREADY_TERMINAL",
			idempotent: true,
		});
	});

	it("allows only the final completion report Todo during finalization", async () => {
		const { run } = await createRunFixture();
		await createTaskRunTodo({
			runId: run.id,
			seq: 5,
			title: "完了報告を行う",
			taskType: "completion_report",
			procedureId: "final_completion_report",
			status: "pending",
		});
		const controller = new RunFinalizeController(new RunControlRepository());

		const allowed = await controller.evaluateCandidate({
			runId: run.id,
			allowedOpenTodoProcedureIds: ["final_completion_report"],
		});

		expect(allowed).toMatchObject({
			allowFinalize: true,
			code: "FINALIZE_ALLOWED",
		});
	});

	it("projects the latest persisted Todo instead of the launch snapshot", async () => {
		const { repository, task, run } = await createRunFixture();
		await createTaskRunTodo({
			runId: run.id,
			seq: 1,
			title: "コーディング準備を行う",
			taskType: "coding_preparation",
			status: "passed",
			completedAt: new Date(),
		});
		await createTaskRunTodo({
			runId: run.id,
			seq: 5,
			title: "完了報告を行う",
			taskType: "completion_report",
			procedureId: "final_completion_report",
			status: "pending",
		});
		const context = {
			...buildContext({
				currentTodo: {
					id: "stale-todo-1",
					seq: 1,
					title: "コーディング準備を行う",
					taskType: "coding_preparation",
					status: "running",
				},
			}),
			runId: run.id,
			taskId: task.id,
			repositoryId: repository.id,
		};

		const result = await new RunStateCardProjector().build(context);

		expect(result.card.activeTodoSummary).toMatchObject({
			seq: 5,
			status: "pending",
			procedureId: "final_completion_report",
		});
	});

	it("validates evidence-bound Todo completion without treating domain failure as transport failure", async () => {
		const { run, repository } = await createRunFixture();
		const service = new RunControlService(new RunControlRepository());
		const verification = await service.prepare({
			runId: run.id,
			toolName: "run_check",
			arguments: { command: "bun test" },
			workspaceIdentity: repository.localPath,
		});
		expect(verification.kind).toBe("execute");
		if (verification.kind !== "execute") return;
		const evidenceRef = `verification:${run.id}:${verification.action.id}`;
		await service.completeWorkerAction({
			prepared: {
				state: verification.state,
				action: verification.action,
				persisted: verification.persisted,
			},
			result: workerResult({
				toolName: "run_check",
				ok: true,
				payload: { exitCode: 0 },
			}),
			modelView: { exitCode: 0 },
			evidenceRefs: [evidenceRef],
		});
		await createTaskRunTodo({
			runId: run.id,
			seq: 1,
			title: "Verify",
			taskType: "verification",
			procedureId: "quality_gate_verify",
			status: "running",
			startedAt: new Date(0),
			evidenceRequirementsJson: [
				{ kind: "verification", freshness: "after_last_mutation" },
			],
		});
		const previousMode = process.env.NIGHTWORKERS_EVIDENCE_TODO_MODE;
		process.env.NIGHTWORKERS_EVIDENCE_TODO_MODE = "managed";
		try {
			const rejected = await todoListTool({
				runId: run.id,
				operation: "done",
				seq: 1,
				evidenceRefs: ["verification:unknown"],
			});
			expect(rejected).toMatchObject({
				ok: false,
				error: { code: "TODO_EVIDENCE_NOT_MET" },
			});
			const completed = await todoListTool({
				runId: run.id,
				operation: "done",
				seq: 1,
				evidenceRefs: [evidenceRef],
			});
			expect(completed.ok).toBe(true);
			expect(completed.payload.currentTodo).toBeNull();
		} finally {
			if (previousMode === undefined)
				delete process.env.NIGHTWORKERS_EVIDENCE_TODO_MODE;
			else process.env.NIGHTWORKERS_EVIDENCE_TODO_MODE = previousMode;
		}
	});
});
