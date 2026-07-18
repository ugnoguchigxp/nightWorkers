import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	getTask: vi.fn(),
	getRepository: vi.fn(),
	getTaskRun: vi.fn(),
	createRunEvent: vi.fn(),
	readArtifactOperatorContent: vi.fn(),
	startTaskRun: vi.fn(),
	resumeTaskRunTodo: vi.fn(),
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

const { handleStartCodingAgentRun } = await import(
	"../api/modules/codingAgent/application/coding-agent-run.handler"
);

const repositoryUpdatedAt = new Date("2026-07-17T00:00:00.000Z");
const command = {
	taskId: "task-1",
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
	mocks.getTask.mockResolvedValue({
		id: "task-1",
		repositoryId: "repository-1",
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

describe("Coding Agent run handler", () => {
	it("starts only when every canonical Artifact field still matches", async () => {
		await expect(handleStartCodingAgentRun(command)).resolves.toEqual({
			runId: "run-1",
			taskId: "task-1",
			status: "running",
		});
		expect(mocks.startTaskRun).toHaveBeenCalledWith(
			"task-1",
			expect.objectContaining({
				executionMode: "implementation",
				runAssociation: {
					kind: "coding_agent_request",
					payload: {
						requestProvenance: command.requestProvenance,
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
});
