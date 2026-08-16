import { describe, expect, it } from "vitest";
import type {
	CodingAgentHostPorts,
	CodingAgentRunSnapshot,
} from "../api/modules/codingAgent";

const run: CodingAgentRunSnapshot = {
	id: "run-1",
	taskId: "task-1",
	repositoryId: "repository-1",
	status: "running",
	todoPlanRevision: 1,
	workerKind: "native-local-worker",
	agentModeSessionId: null,
	contextSnapshot: null,
	summary: null,
	finalReport: null,
	startedAt: new Date(0),
	updatedAt: new Date(0),
};

function createCodingAgentHostPortsFake(): CodingAgentHostPorts {
	return {
		taskReader: {
			getTask: async () => null,
			getRepository: async () => null,
			readArtifactContent: async () => null,
		},
		runReader: {
			getRun: async () => run,
			listRunTodos: async () => [],
		},
		runLifecycle: {
			startRun: async () => run,
			resumeRunTodo: async () => run,
			resumeInterruptedRun: async () => run,
			updateRunContext: async () => ({ kind: "applied", run }),
		},
		runJournal: {
			appendRunEvent: async () => {},
			appendTaskMessage: async () => {},
			publishRun: async () => {},
		},
		verificationReader: {
			getLatestActiveDocument: async () => null,
			runCompletionCheck: async () => ({
				ok: true,
				reason: null,
				suggestedAction: null,
				sourceStateHash: null,
				verify: { status: "passed" },
				confirmation: { status: "not_required" },
			}),
		},
	};
}

describe("Coding Agent host port contract", () => {
	it("allows Coding Agent behavior to depend on a host fake instead of repository rows", async () => {
		const host = createCodingAgentHostPortsFake();
		await expect(host.runReader.getRun("run-1")).resolves.toEqual(run);
		await expect(
			host.runLifecycle.updateRunContext({
				runId: "run-1",
				expectedUpdatedAt: run.updatedAt,
				expectedStatuses: ["running"],
				contextSnapshot: { source: "fake-host" },
			}),
		).resolves.toEqual({ kind: "applied", run });
	});
});
