export type CodingAgentArtifactRef = {
	kind: string;
	id: string;
	revision: number;
	digest: string;
};

export type CodingAgentRequestProvenance = {
	requestedBy: {
		kind: "human" | "automation";
		actorId: string;
	};
	orchestrationRef: { kind: string; id: string } | null;
};

export type StartCodingAgentRunCommand = {
	taskId: string;
	taskRef: { id: string; revision: number };
	instruction: string;
	artifactRefs: CodingAgentArtifactRef[];
	repositoryRef: { id: string; revision: number };
	requestProvenance: CodingAgentRequestProvenance;
};

export type ResumeCodingAgentRunTodoCommand = {
	runId: string;
	todoId: string;
	expectedTodoRevision: number;
	userContext: string;
	requestProvenance: CodingAgentRequestProvenance;
};

export type CodingAgentRunCommandResult = {
	runId: string;
	taskId: string;
	status: string;
};
