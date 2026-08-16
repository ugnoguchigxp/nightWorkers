import { NotFoundError } from "@api/lib/errors";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
	return {
		getTask: vi.fn(),
		listActiveTaskRunsForTask: vi.fn(),
		listTaskRunTodosForRun: vi.fn(),
		createRunEvent: vi.fn(),
		updateTaskRun: vi.fn(),
		transitionTaskRunIfCurrent: vi.fn(),
		transitionRunOutcome: vi.fn(),
		publishTaskRunUpdate: vi.fn(),
		updateTaskStatus: vi.fn(),
		createTaskMessage: vi.fn(),
		getTaskRun: vi.fn(),
		listTaskEventsForRun: vi.fn(),
		listActivityEventsForRun: vi.fn(),
		listActivityArtifactsForTask: vi.fn(),
		listTaskRunsForTask: vi.fn(),
		getRepository: vi.fn(),
		getTaskRunCommitRecord: vi.fn(),
		nativeLocalRunner: {
			getStatus: vi.fn(),
		},
	};
});

vi.mock("@api/modules/nightworkers/nightworkers.repository", () => ({
	getTask: mocks.getTask,
	listActiveTaskRunsForTask: mocks.listActiveTaskRunsForTask,
	listTaskRunTodosForRun: mocks.listTaskRunTodosForRun,
	createRunEvent: mocks.createRunEvent,
	updateTaskRun: mocks.updateTaskRun,
	transitionTaskRunIfCurrent: mocks.transitionTaskRunIfCurrent,
	publishTaskRunUpdate: mocks.publishTaskRunUpdate,
	updateTaskStatus: mocks.updateTaskStatus,
	createTaskMessage: mocks.createTaskMessage,
	getTaskRun: mocks.getTaskRun,
	listTaskEventsForRun: mocks.listTaskEventsForRun,
	listActivityEventsForRun: mocks.listActivityEventsForRun,
	listActivityArtifactsForTask: mocks.listActivityArtifactsForTask,
	listTaskRunsForTask: mocks.listTaskRunsForTask,
	getRepository: mocks.getRepository,
	getTaskRunCommitRecord: mocks.getTaskRunCommitRecord,
}));

vi.mock("@api/modules/codingAgent", async (importOriginal) => ({
	...(await importOriginal<typeof import("@api/modules/codingAgent")>()),
	nativeLocalRunner: mocks.nativeLocalRunner,
}));
vi.mock("@api/modules/run/run-outcome-transition.repository", () => ({
	transitionRunOutcome: mocks.transitionRunOutcome,
}));

import {
	getActiveTaskRun,
	getOntologyRunDebugReport,
	getTaskRun,
	getTaskRunsForTask,
	listTaskRunActivityEvents,
	listTaskRunEvents,
	listTaskRunEventsForReplay,
	recoverStaleActiveRuns,
} from "@api/modules/nightworkers/nightworkers.run-query.service";

describe("run-query.service", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	describe("getActiveTaskRun", () => {
		it("throws NotFoundError when task is not found", async () => {
			mocks.getTask.mockResolvedValue(null);
			await expect(getActiveTaskRun("task-1")).rejects.toThrow(NotFoundError);
		});

		it("returns null when there are no active runs", async () => {
			mocks.getTask.mockResolvedValue({ id: "task-1" });
			mocks.listActiveTaskRunsForTask.mockResolvedValue([]);
			const result = await getActiveTaskRun("task-1");
			expect(result).toBeNull();
		});

		it("returns the first active run", async () => {
			mocks.getTask.mockResolvedValue({ id: "task-1" });
			mocks.listActiveTaskRunsForTask.mockResolvedValue([
				{ id: "run-1", status: "running" },
			]);
			const result = await getActiveTaskRun("task-1");
			expect(result).toEqual({ id: "run-1", status: "running" });
		});
	});

	describe("getTaskRun", () => {
		it("returns null if run does not exist", async () => {
			mocks.getTaskRun.mockResolvedValue(null);
			const result = await getTaskRun("run-1");
			expect(result).toBeNull();
		});

		it("returns run details with todos, events, and parsed reviews", async () => {
			mocks.getTaskRun.mockResolvedValue({ id: "run-1", taskId: "task-1" });
			mocks.listTaskRunTodosForRun.mockResolvedValue([{ id: "todo-1" }]);
			mocks.listTaskEventsForRun.mockResolvedValue([
				{ id: "event-1", payloadJson: { reviewResult: { passed: true } } },
				{ id: "event-2", payloadJson: null },
			]);

			const result = await getTaskRun("run-1");
			expect(result).toMatchObject({
				id: "run-1",
				taskId: "task-1",
				todos: [{ id: "todo-1" }],
				events: [
					{ id: "event-1", payloadJson: { reviewResult: { passed: true } } },
					{ id: "event-2", payloadJson: null },
				],
				reviews: [{ passed: true }],
			});
		});
	});

	describe("getOntologyRunDebugReport", () => {
		it("returns null if run does not exist", async () => {
			mocks.getTaskRun.mockResolvedValue(null);
			const result = await getOntologyRunDebugReport("run-1");
			expect(result).toBeNull();
		});

		it("summarizes ontology snapshot and boundary audit without reading raw logs", async () => {
			mocks.getTaskRun.mockResolvedValue({
				id: "run-1",
				taskId: "task-1",
				repositoryId: "repo-1",
				status: "completed",
				contextSnapshot: {
					ontologyContext: {
						available: true,
						runtimeLane: "codex-sdk",
						primaryModule: "task-generation",
						secondaryModules: ["agent-runtime"],
						taskGenerationEvidence: true,
						warnings: ["low confidence routing"],
					},
					ontologyBoundaryAudit: {
						available: true,
						decision: "allow_with_crossing",
						touchedFiles: [
							"api/modules/task-generation/service.ts",
							"api/shared/types.ts",
						],
						boundaryCrossings: [
							{
								module: "agent-runtime",
								paths: ["api/shared/types.ts"],
								declaredSecondary: true,
							},
						],
						needsConfirmation: [],
						forbiddenTouched: [],
						verificationSelection: {
							focused: ["bunx vitest run tests/agent-ontology.test.ts"],
						},
						warnings: ["secondary crossing recorded"],
					},
				},
			});
			mocks.listTaskEventsForRun.mockResolvedValue([
				{
					payloadJson: {
						runEvent: {
							data: { action: "ontology.runtime_context_snapshot" },
						},
					},
				},
			]);

			const result = await getOntologyRunDebugReport("run-1");

			expect(result).toMatchObject({
				runId: "run-1",
				taskId: "task-1",
				repositoryId: "repo-1",
				status: "completed",
				runtimeLane: "codex-sdk",
				evidenceSources: {
					contextSnapshot: true,
					runtimeContextEvent: true,
					boundaryAuditEvent: false,
				},
				summary: {
					available: true,
					primaryModule: "task-generation",
					secondaryModules: ["agent-runtime"],
					taskGenerationEvidence: true,
					boundaryDecision: "allow_with_crossing",
					touchedFilesCount: 2,
					unexplainedCrossingsCount: 0,
					focusedVerificationCount: 1,
					focusedVerificationState: "selected",
				},
				warnings: ["low confidence routing", "secondary crossing recorded"],
			});
		});

		it("falls back to structured ontology events when snapshot fields are absent", async () => {
			mocks.getTaskRun.mockResolvedValue({
				id: "run-1",
				taskId: "task-1",
				status: "completed",
				contextSnapshot: {},
			});
			mocks.listTaskEventsForRun.mockResolvedValue([
				{
					payloadJson: {
						runEvent: {
							data: {
								action: "ontology.runtime_context_snapshot",
								ontologyContext: {
									available: true,
									primaryModule: "agent-runtime",
									secondaryModules: [],
									taskGenerationEvidence: false,
									focusedVerification: [],
								},
							},
						},
					},
				},
				{
					payloadJson: {
						runEvent: {
							data: {
								action: "ontology.boundary_closeout_audit",
								ontologyBoundaryAudit: {
									available: true,
									decision: "needs_confirmation",
									touchedFiles: ["api/unknown.ts"],
									boundaryCrossings: [
										{ paths: ["api/unknown.ts"], declaredSecondary: false },
									],
									needsConfirmation: [
										{ path: "api/unknown.ts", reason: "unknown path" },
									],
									forbiddenTouched: [],
									verificationSelection: { focused: [] },
								},
							},
						},
					},
				},
			]);

			const result = await getOntologyRunDebugReport("run-1");

			expect(result).toMatchObject({
				evidenceSources: {
					contextSnapshot: false,
					runtimeContextEvent: true,
					boundaryAuditEvent: true,
				},
				summary: {
					primaryModule: "agent-runtime",
					boundaryDecision: "needs_confirmation",
					touchedFilesCount: 1,
					unexplainedCrossingsCount: 1,
					focusedVerificationState: "not_selected",
				},
			});
		});
	});

	describe("listTaskRunEvents", () => {
		it("throws NotFoundError if run is not found", async () => {
			mocks.getTaskRun.mockResolvedValue(null);
			await expect(listTaskRunEvents("run-1")).rejects.toThrow(NotFoundError);
		});

		it("returns list of task events", async () => {
			mocks.getTaskRun.mockResolvedValue({ id: "run-1" });
			mocks.listTaskEventsForRun.mockResolvedValue([{ id: "event-1" }]);
			const result = await listTaskRunEvents("run-1", { afterSeq: 10 });
			expect(mocks.listTaskEventsForRun).toHaveBeenCalledWith("run-1", {
				afterSeq: 10,
			});
			expect(result).toEqual([{ id: "event-1" }]);
		});
	});

	describe("listTaskRunActivityEvents", () => {
		it("throws NotFoundError if run is not found", async () => {
			mocks.getTaskRun.mockResolvedValue(null);
			await expect(listTaskRunActivityEvents("run-1")).rejects.toThrow(
				NotFoundError,
			);
		});

		it("returns activity events and referenced artifacts", async () => {
			mocks.getTaskRun.mockResolvedValue({ id: "run-1", taskId: "task-1" });
			mocks.listActivityEventsForRun.mockResolvedValue([
				{ id: "evt-1", artifactId: "art-1" },
				{ id: "evt-2", artifactId: null },
			]);
			mocks.listActivityArtifactsForTask.mockResolvedValue([
				{ id: "art-1", content: "test-artifact" },
				{ id: "art-2", content: "unreferenced" },
			]);

			const result = await listTaskRunActivityEvents("run-1");
			expect(result.events).toEqual([
				{ id: "evt-1", artifactId: "art-1" },
				{ id: "evt-2", artifactId: null },
			]);
			expect(result.artifacts).toEqual([
				{ id: "art-1", content: "test-artifact" },
			]);
		});
	});

	describe("listTaskRunEventsForReplay", () => {
		it("throws NotFoundError if run is not found", async () => {
			mocks.getTaskRun.mockResolvedValue(null);
			await expect(
				listTaskRunEventsForReplay({ taskId: "task-1", runId: "run-1" }),
			).rejects.toThrow(NotFoundError);
		});

		it("throws NotFoundError if run is found but associated with different task", async () => {
			mocks.getTaskRun.mockResolvedValue({ id: "run-1", taskId: "task-other" });
			await expect(
				listTaskRunEventsForReplay({ taskId: "task-1", runId: "run-1" }),
			).rejects.toThrow(NotFoundError);
		});

		it("returns task events if task ID matches", async () => {
			mocks.getTaskRun.mockResolvedValue({ id: "run-1", taskId: "task-1" });
			mocks.listTaskEventsForRun.mockResolvedValue([{ id: "event-1" }]);
			const result = await listTaskRunEventsForReplay({
				taskId: "task-1",
				runId: "run-1",
				afterSeq: 5,
			});
			expect(mocks.listTaskEventsForRun).toHaveBeenCalledWith("run-1", {
				afterSeq: 5,
			});
			expect(result).toEqual([{ id: "event-1" }]);
		});
	});

	describe("getTaskRunsForTask", () => {
		it("returns all runs for task", async () => {
			mocks.listTaskRunsForTask.mockResolvedValue([{ id: "run-1" }]);
			const result = await getTaskRunsForTask("task-1");
			expect(mocks.listTaskRunsForTask).toHaveBeenCalledWith("task-1");
			expect(result).toEqual([{ id: "run-1" }]);
		});
	});

	describe("recoverStaleActiveRuns", () => {
		it("throws NotFoundError if task is not found", async () => {
			mocks.getTask.mockResolvedValue(null);
			await expect(recoverStaleActiveRuns("task-1")).rejects.toThrow(
				NotFoundError,
			);
		});

		it("returns hasRunning: false when no active runs found", async () => {
			mocks.getTask.mockResolvedValue({ id: "task-1" });
			mocks.listActiveTaskRunsForTask.mockResolvedValue([]);
			const result = await recoverStaleActiveRuns("task-1");
			expect(result).toEqual({ hasRunning: false, recoveredRunIds: [] });
		});

		it("returns hasRunning: true if at least one active run is still running in native runner", async () => {
			mocks.getTask.mockResolvedValue({ id: "task-1" });
			mocks.listActiveTaskRunsForTask.mockResolvedValue([{ id: "run-1" }]);
			mocks.nativeLocalRunner.getStatus.mockResolvedValue({
				status: "running",
			});

			const result = await recoverStaleActiveRuns("task-1");
			expect(result).toEqual({ hasRunning: true, recoveredRunIds: [] });
		});

		it("keeps a cross-process run active while its durable heartbeat is fresh", async () => {
			mocks.getTask.mockResolvedValue({ id: "task-1" });
			mocks.listActiveTaskRunsForTask.mockResolvedValue([
				{ id: "run-1", updatedAt: new Date() },
			]);
			mocks.nativeLocalRunner.getStatus.mockResolvedValue({
				status: "stopped",
			});

			const result = await recoverStaleActiveRuns("task-1");
			expect(result).toEqual({ hasRunning: true, recoveredRunIds: [] });
			expect(mocks.updateTaskRun).not.toHaveBeenCalled();
		});

		it("recovers a stale run without implicitly mutating Todos", async () => {
			mocks.getTask.mockResolvedValue({ id: "task-1" });
			mocks.listActiveTaskRunsForTask.mockResolvedValue([
				{ id: "run-1", finalReport: "report", diffPatch: "patch" },
			]);
			mocks.nativeLocalRunner.getStatus.mockResolvedValue({
				status: "stopped",
			});
			mocks.transitionRunOutcome.mockResolvedValue({
				kind: "applied",
				run: { id: "run-1", taskId: "task-1", status: "failed" },
				task: { id: "task-1", status: "failed" },
				queueEntry: null,
			});
			mocks.listTaskRunTodosForRun.mockResolvedValue([
				{
					id: "todo-1",
					seq: 1,
					procedureId: "proc-1",
					title: "Todo 1",
					status: "running",
					startedAt: "2026-06-10T12:00:00Z",
					taskType: "code",
				},
				{
					id: "todo-2",
					seq: 2,
					procedureId: "proc-2",
					title: "Todo 2",
					status: "queued",
					taskType: "code",
				},
				{
					id: "todo-3",
					seq: 3,
					procedureId: "proc-3",
					title: "Todo 3",
					status: "passed",
					taskType: "code",
				},
			]);

			const result = await recoverStaleActiveRuns("task-1");
			expect(result).toEqual({ hasRunning: false, recoveredRunIds: ["run-1"] });

			// Run, Task, and Queue are projected by the same stale-snapshot command.
			expect(mocks.transitionRunOutcome).toHaveBeenCalledWith(
				expect.objectContaining({
					run: expect.objectContaining({
						id: "run-1",
						targetStatus: "failed",
					}),
				}),
			);

			expect(mocks.updateTaskStatus).not.toHaveBeenCalled();

			// Task system message is registered
			expect(mocks.createTaskMessage).toHaveBeenCalledWith({
				taskId: "task-1",
				runId: "run-1",
				role: "system",
				content: expect.any(String),
				messageType: "text",
			});
		});

		it("does not project or emit recovery side effects after a stale CAS conflict", async () => {
			mocks.getTask.mockResolvedValue({ id: "task-1" });
			mocks.listActiveTaskRunsForTask.mockResolvedValue([
				{
					id: "run-1",
					status: "running",
					updatedAt: new Date("2026-08-16T00:00:00.000Z"),
				},
			]);
			mocks.nativeLocalRunner.getStatus.mockResolvedValue({
				status: "stopped",
			});
			mocks.transitionRunOutcome.mockResolvedValue({
				kind: "conflict",
				run: { id: "run-1", status: "completed" },
				task: { id: "task-1", status: "completed" },
				queueEntry: null,
			});

			await expect(
				recoverStaleActiveRuns("task-1", { force: true }),
			).resolves.toEqual({
				hasRunning: false,
				recoveredRunIds: [],
			});
			expect(mocks.publishTaskRunUpdate).not.toHaveBeenCalled();
			expect(mocks.updateTaskStatus).not.toHaveBeenCalled();
			expect(mocks.createRunEvent).not.toHaveBeenCalled();
			expect(mocks.createTaskMessage).not.toHaveBeenCalled();
		});
	});
});
