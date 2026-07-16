import type { CodingAgentSystemContextSnapshot } from "../../../services/todo-mutation";

export type CodingAgentSystemContext = CodingAgentSystemContextSnapshot;

export type CodingAgentPlanSummaryItem = {
	id: string;
	seq: number;
	title: string;
	status: string;
	revision: number;
};

export type CodingAgentPlanSummary = {
	planRevision: number;
	counts: {
		pending: number;
		running: number;
		terminal: number;
		needsHuman: number;
	};
	todos: CodingAgentPlanSummaryItem[];
};

export type CodingAgentCurrentTodoContext = {
	id: string;
	seq: number;
	revision: number;
	title: string;
	objective: string | null;
	context: string | null;
	nextAction: string;
	acceptanceCriteria: string[];
	dependsOn: string[];
	lastFailure: string | null;
	attemptCount: number;
	statusReason: string | null;
	systemContextVersion: number;
	systemContextSnapshot: unknown;
};

export type CodingAgentContextPacket = {
	systemContext: CodingAgentSystemContext;
	planSummary: CodingAgentPlanSummary;
	currentTodo: CodingAgentCurrentTodoContext | null;
};
