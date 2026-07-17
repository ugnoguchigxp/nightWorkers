import type { MissionPilotAgentRunProvenance } from "../../../../shared/modules/missionPilot";
import type { StructuredLlmModelTarget } from "../../../services/structured-llm/settings";
import type { ImplementationTodoInput } from "../../../services/todo-runtime";
import type { TaskRunAssociationRequest } from "../../agentsShare";
import type {
	CodingAgentPlanModeRuntimeThreadHandoff,
	NativeApiExecutionMode,
} from "../../codingAgent";

export type ImplementationPlanConstraint = {
	sourceMessageId: string;
	digest: string;
};

export type StartTaskRunOptions = {
	executionMode?: NativeApiExecutionMode;
	executionModeSource?:
		| "message_history"
		| "workbench_intake"
		| "workbench_run"
		| "workbench_run_task"
		| "implementation_queue"
		| "session_queue"
		| "review_run"
		| "test_mode"
		| "explicit";
	/** ユーザー直結RunとMission Pilot handoffを意味的なmodeにせず、起動元のprovenanceとして保持する。 */
	codingAgentInvocationSource?: "user" | "mission_pilot";
	/** 単一Coding Agent runtimeを、明示されたPlan Modeの計画Todoから開始する。 */
	planModeRequested?: boolean;
	/** 直前のintake gateで初期化済みのCodex threadを、最初のCoding Agent Runへ一度だけ渡す。 */
	intakeRuntimeThreadHandoff?: CodingAgentPlanModeRuntimeThreadHandoff;
	initialTodos?: ImplementationTodoInput[];
	implementationPlanConstraint?: ImplementationPlanConstraint;
	/** 同じ needs_human Run を同じ provider session / Todo で再開する。 */
	resumeRunId?: string;
	resumeCommand?: {
		kind: "todo" | "runtime_pause";
		todoId: string;
		expectedTodoRevision: number;
		userContext: string;
	};
	latestUserMessageOverride?: string;
	runtimeOptionsPatch?: Record<string, unknown>;
	missionPilotAgent?: MissionPilotAgentRunProvenance;
	routeOverride?: StructuredLlmModelTarget | null;
	/** 起動元roleがRunを関連付けるための、agentsShare経由の中立request。 */
	runAssociation?: TaskRunAssociationRequest;
	/** repository bootstrapなど、割り当て前workspaceでの限定実行を明示する。 */
	allowUnassignedWorkspace?: boolean;
};
