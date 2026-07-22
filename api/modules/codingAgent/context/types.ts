import type { CodingAgentSystemContextSnapshot } from "../../../../shared/modules/codingAgent";

export type CodingAgentSystemContext = CodingAgentSystemContextSnapshot;

export type CodingAgentPlanSummaryItem = {
	id: string;
	todoKey: string;
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
	todoKey: string;
	seq: number;
	revision: number;
	title: string;
	taskType: string;
	objective: string | null;
	systemContext: string;
	/** @deprecated systemContextの互換alias。 */
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
