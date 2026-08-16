import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	clearCodingAgentHostForTest,
	configureCodingAgentHost,
} from "../api/modules/codingAgent/ports/coding-agent-host.binding";
import type { CodingAgentHostPorts } from "../api/modules/codingAgent/ports/coding-agent-host.port";

const mocks = vi.hoisted(() => ({
	getTask: vi.fn(),
	getRepository: vi.fn(),
	getTaskRun: vi.fn(),
	createRunEvent: vi.fn(),
	readArtifactOperatorContent: vi.fn(),
	startTaskRun: vi.fn(),
	resumeTaskRunTodo: vi.fn(),
	findInterruptedCodingAgentRunCandidate: vi.fn(),
}));

vi.mock("../api/modules/nightworkers/nightworkers.repository", () => ({
	getTask: mocks.getTask,
	getRepository: mocks.getRepository,
	getTaskRun: mocks.getTaskRun,
	createRunEvent: mocks.createRunEvent,
}));
vi.mock("../api/modules/specification", () => ({
	readArtifactOperatorContent: mocks.readArtifactOperatorContent,
}));
vi.mock(
	"../api/modules/nightworkers/run-orchestration/start-task-run-entry",
	() => ({ startTaskRun: mocks.startTaskRun }),
);
vi.mock(
	"../api/modules/nightworkers/run-orchestration/resume-task-run",
	() => ({ resumeTaskRunTodo: mocks.resumeTaskRunTodo }),
);
vi.mock(
	"../api/modules/codingAgent/application/runtime-execution-ownership.service",
	() => ({
		findInterruptedCodingAgentRunCandidate:
			mocks.findInterruptedCodingAgentRunCandidate,
	}),
);

const { handleResumeInterruptedCodingAgentRun, handleStartCodingAgentRun } =
	await import(
		"../api/modules/codingAgent/application/coding-agent-run.handler"
	);

const repositoryUpdatedAt = new Date("2026-07-17T00:00:00.000Z");
const command = {
	taskId: "task-1",
	taskRef: { id: "task-1", revision: 4 },
	instruction: "確定済み設計を実装する",
	artifactRefs: [
		{
			id: "artifact-1",
			kind: "api_io_contract",
			revision: 10,
			digest: "sha256:artifact",
		},
	],
	repositoryRef: {
		id: "repository-1",
		revision: repositoryUpdatedAt.getTime(),
	},
	requestProvenance: {
		requestedBy: { kind: "human" as const, actorId: "user-1" },
		orchestrationRef: { kind: "task_operator_command", id: "request-1" },
	},
};

beforeEach(() => {
	for (const mock of Object.values(mocks)) mock.mockReset();
	configureCodingAgentHost(hostFake());
	mocks.getTask.mockResolvedValue({
		id: "task-1",
		repositoryId: "repository-1",
		revision: 4,
	});
	mocks.getRepository.mockResolvedValue({
		id: "repository-1",
		updatedAt: repositoryUpdatedAt,
	});
	mocks.readArtifactOperatorContent.mockResolvedValue({
		id: "artifact-1",
		kind: "api_io_contract",
		revision: 10,
		digest: "sha256:artifact",
		status: "ready",
		content: "contract",
	});
	mocks.startTaskRun.mockResolvedValue({
		id: "run-1",
		taskId: "task-1",
		status: "running",
	});
	mocks.getTaskRun.mockResolvedValue(null);
});

afterEach(() => {
	clearCodingAgentHostForTest();
});

function hostFake(): CodingAgentHostPorts {
	return {
		taskReader: {
			getTask: mocks.getTask,
			getRepository: mocks.getRepository,
			readArtifactContent: mocks.readArtifactOperatorContent,
		},
		runReader: {
			getRun: mocks.getTaskRun,
			listRunTodos: async () => [],
		},
		runLifecycle: {
			startRun: mocks.startTaskRun,
			resumeRunTodo: mocks.resumeTaskRunTodo,
			resumeInterruptedRun: mocks.startTaskRun,
			updateRunContext: async () => ({ kind: "not_found" }),
		},
		runJournal: {
			appendRunEvent: mocks.createRunEvent,
			appendTaskMessage: async () => {},
			publishRun: async () => {},
			appendTaskEvent: async () => {},
		},
		verificationReader: {
			getLatestActiveDocument: async () => null,
			runCompletionCheck: async () => completionCheckNotRun(),
		},
	};
}

function completionCheckNotRun() {
	return {
		ok: false,
		reason: null,
		suggestedAction: null,
		sourceStateHash: null,
		verify: { status: "not_run" as const },
		confirmation: { status: "not_required" as const },
	};
}

describe("Coding Agent run handler", () => {
	it("starts only when every canonical Artifact field still matches", async () => {
		await expect(handleStartCodingAgentRun(command)).resolves.toEqual({
			runId: "run-1",
			taskId: "task-1",
			status: "running",
		});
		expect(mocks.startTaskRun).toHaveBeenCalledWith(
			expect.objectContaining({
				taskId: "task-1",
				executionMode: "implementation",
				runAssociation: {
					kind: "coding_agent_request",
					payload: {
						requestProvenance: command.requestProvenance,
						taskRef: command.taskRef,
						artifactRefs: command.artifactRefs,
					},
				},
			}),
		);
	});

	it("rejects a stale Artifact revision even when its digest is unchanged", async () => {
		mocks.readArtifactOperatorContent.mockResolvedValueOnce({
			id: "artifact-1",
			kind: "api_io_contract",
			revision: 11,
			digest: "sha256:artifact",
			status: "ready",
			content: "contract",
		});

		await expect(handleStartCodingAgentRun(command)).rejects.toMatchObject({
			code: "ARTIFACT_REVISION_CONFLICT",
		});
		expect(mocks.startTaskRun).not.toHaveBeenCalled();
	});

	it("resumes the structurally selected interrupted Run without allocating a new Run", async () => {
		const resumeCommand = {
			runId: "run-interrupted",
			expectedInterruptionRevision: 2,
			todoId: "todo-running",
			expectedTodoRevision: 7,
			routingSnapshotDigest: "sha256:routing-snapshot",
			userContext: "再開してください",
			requestProvenance: {
				requestedBy: { kind: "human" as const, actorId: "workbench" },
				orchestrationRef: null,
			},
		};
		mocks.getTaskRun.mockResolvedValue({
			id: resumeCommand.runId,
			taskId: "task-1",
			status: "needs_human",
			contextSnapshot: { planModeRequested: false },
		});
		mocks.findInterruptedCodingAgentRunCandidate.mockResolvedValue({
			runId: resumeCommand.runId,
			taskId: "task-1",
			agentModeSessionId: "session-existing",
			interruptionRevision: resumeCommand.expectedInterruptionRevision,
			executionLeaseVersion: 3,
			todoId: resumeCommand.todoId,
			todoKey: "todo-key",
			todoRevision: resumeCommand.expectedTodoRevision,
			workspaceId: null,
			workspaceAllocationVersion: null,
			repositoryIdentityRevision: null,
			attestationDigest: null,
			routingSnapshotDigest: resumeCommand.routingSnapshotDigest,
		});
		mocks.startTaskRun.mockResolvedValue({
			id: resumeCommand.runId,
			taskId: "task-1",
			status: "running",
		});

		await expect(
			handleResumeInterruptedCodingAgentRun(resumeCommand),
		).resolves.toEqual({
			runId: resumeCommand.runId,
			taskId: "task-1",
			status: "running",
		});
		expect(mocks.startTaskRun).toHaveBeenCalledTimes(1);
		expect(mocks.startTaskRun).toHaveBeenCalledWith({
			taskId: "task-1",
			runId: resumeCommand.runId,
			planModeRequested: false,
			expectedInterruptionRevision: resumeCommand.expectedInterruptionRevision,
			todoId: resumeCommand.todoId,
			expectedTodoRevision: resumeCommand.expectedTodoRevision,
			userContext: resumeCommand.userContext,
		});
	});

	it("rejects a stale interrupted Run routing snapshot before launch", async () => {
		mocks.getTaskRun.mockResolvedValue({
			id: "run-interrupted",
			taskId: "task-1",
			status: "needs_human",
		});
		mocks.findInterruptedCodingAgentRunCandidate.mockResolvedValue({
			runId: "run-interrupted",
			interruptionRevision: 2,
			todoId: "todo-running",
			todoRevision: 7,
			routingSnapshotDigest: "sha256:new-snapshot",
		});

		await expect(
			handleResumeInterruptedCodingAgentRun({
				runId: "run-interrupted",
				expectedInterruptionRevision: 2,
				todoId: "todo-running",
				expectedTodoRevision: 7,
				routingSnapshotDigest: "sha256:stale-snapshot",
				userContext: "再開してください",
				requestProvenance: {
					requestedBy: { kind: "human", actorId: "workbench" },
					orchestrationRef: null,
				},
			}),
		).rejects.toMatchObject({ code: "RUN_RESUME_SNAPSHOT_CONFLICT" });
		expect(mocks.startTaskRun).not.toHaveBeenCalled();
	});
});
