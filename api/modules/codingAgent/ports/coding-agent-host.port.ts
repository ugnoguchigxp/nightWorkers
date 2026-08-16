import type {
	CodingAgentCompletionCheckSnapshot,
	CodingAgentRepositorySnapshot,
	CodingAgentRunContextCasInput,
	CodingAgentRunContextCasResult,
	CodingAgentRunEventInput,
	CodingAgentRunSnapshot,
	CodingAgentRunTodoSnapshot,
	CodingAgentTaskMessageInput,
	CodingAgentTaskSnapshot,
	CodingAgentVerificationDocumentSnapshot,
} from "./coding-agent-host.types";

export type CodingAgentHostPorts = {
	taskReader: {
		getTask(taskId: string): Promise<CodingAgentTaskSnapshot | null>;
		getRepository(
			repositoryId: string,
		): Promise<CodingAgentRepositorySnapshot | null>;
		readArtifactContent(input: {
			taskId: string;
			artifactId: string;
		}): Promise<{
			kind: string;
			revision: number;
			digest: string;
			content: string;
		} | null>;
	};
	runReader: {
		getRun(runId: string): Promise<CodingAgentRunSnapshot | null>;
		listRunTodos(runId: string): Promise<CodingAgentRunTodoSnapshot[]>;
	};
	runLifecycle: {
		startRun(input: {
			taskId: string;
			executionMode: "implementation" | "review";
			planModeRequested: boolean;
			instruction: string | null;
			runAssociation?: { kind: string; payload: unknown };
		}): Promise<CodingAgentRunSnapshot>;
		resumeRunTodo(input: {
			runId: string;
			todoId: string;
			expectedTodoRevision: number;
			userContext: string;
		}): Promise<CodingAgentRunSnapshot>;
		resumeInterruptedRun(input: {
			taskId: string;
			runId: string;
			planModeRequested: boolean;
			expectedInterruptionRevision: number;
			todoId: string | null;
			expectedTodoRevision: number | null;
			userContext: string;
		}): Promise<CodingAgentRunSnapshot>;
		updateRunContext(
			input: CodingAgentRunContextCasInput,
		): Promise<CodingAgentRunContextCasResult>;
	};
	runJournal: {
		appendRunEvent(input: CodingAgentRunEventInput): Promise<void>;
		appendTaskMessage(input: CodingAgentTaskMessageInput): Promise<void>;
		publishRun(run: Pick<CodingAgentRunSnapshot, "id">): Promise<void>;
		appendTaskEvent(input: {
			runId?: string;
			taskRunId?: string;
			type: string;
			message: string;
			actor?: string;
			eventType?: string | null;
			payloadJson?: unknown;
			timestamp?: Date;
		}): Promise<void>;
	};
	verificationReader: {
		getLatestActiveDocument(
			taskId: string,
		): Promise<CodingAgentVerificationDocumentSnapshot | null>;
		runCompletionCheck(input: {
			taskId: string;
			runId: string;
			verificationDocumentId: string;
			repositoryRoot: string;
		}): Promise<CodingAgentCompletionCheckSnapshot>;
	};
};
