import type { MissionPilotAuthorization } from "../../../../shared/schemas/mission-pilot.schema";
import type {
	MissionPilotRuntimeState,
	MissionPilotTaskActionDescriptor,
} from "../../../../shared/schemas/mission-pilot-agent.schema";
import type { ProviderToolDefinition } from "../../../services/structured-llm/public";
import { validateJsonSchemaValue } from "./mission-pilot-json-schema-validator";

type AuthorizationScope = keyof MissionPilotAuthorization["scopes"];

export type MissionPilotActionDefinition = {
	actionId: string;
	toolName: string;
	title: string;
	description: string;
	inputSchema: Record<string, unknown>;
	authorizationScope: AuthorizationScope;
	confirmationRequired?: boolean;
};

const objectSchema = (
	properties: Record<string, unknown>,
	required: string[] = [],
) => ({
	type: "object",
	additionalProperties: false,
	properties,
	...(required.length ? { required } : {}),
});
const string = { type: "string" };
const uuid = { type: "string", format: "uuid" };
const integer = { type: "integer", minimum: 0 };
const boolean = { type: "boolean" };

const definitions: MissionPilotActionDefinition[] = [
	{
		actionId: "task.update",
		toolName: "task_update",
		title: "Taskを更新",
		description: "UIで編集可能なTask fieldをrevision付きで更新する。",
		inputSchema: objectSchema(
			{
				expectedRevision: integer,
				fields: {
					type: "object",
					properties: {
						title: string,
						description: { type: ["string", "null"] },
						objective: { type: ["string", "null"] },
						acceptanceCriteria: { type: ["string", "null"] },
						status: string,
						priority: { type: "number" },
					},
					additionalProperties: false,
				},
			},
			["expectedRevision", "fields"],
		),
		authorizationScope: "plan",
	},
	{
		actionId: "task.message.send",
		toolName: "task_message_send",
		title: "Taskへメッセージを送信",
		description:
			"Task UIと同じメッセージcommandへcontentとmodel optionを渡す。",
		inputSchema: objectSchema(
			{
				content: string,
				intent: string,
				artifactContext: { type: ["object", "null"] },
				providerEndpointId: string,
				model: string,
				thinkingDepth: string,
			},
			["content"],
		),
		authorizationScope: "plan",
	},
	{
		actionId: "task.delete",
		toolName: "task_delete",
		title: "Taskを削除",
		description:
			"UIと同じ確認・authorizationでTaskを削除する。成功時はsessionも終了する。",
		inputSchema: objectSchema({}),
		authorizationScope: "taskArchive",
		confirmationRequired: true,
	},
	{
		actionId: "task.archive",
		toolName: "task_archive",
		title: "Taskをarchive",
		description: "UIと同じarchive commandを実行する。",
		inputSchema: objectSchema({}),
		authorizationScope: "taskArchive",
	},
	{
		actionId: "task.archive.restore",
		toolName: "task_archive_restore",
		title: "Task archiveを復元",
		description: "UIと同じrestore commandを実行する。",
		inputSchema: objectSchema({}),
		authorizationScope: "taskArchive",
	},
	{
		actionId: "questionnaire.create",
		toolName: "questionnaire_create",
		title: "Questionnaireを作成",
		description:
			"明示したBlueprint messageをsourceとしてQuestionnaireを作成する。",
		inputSchema: objectSchema({ sourceBlueprintMessageId: uuid }, [
			"sourceBlueprintMessageId",
		]),
		authorizationScope: "plan",
	},
	{
		actionId: "questionnaire.draft.update",
		toolName: "questionnaire_draft_update",
		title: "Questionnaire回答を更新",
		description: "questionnaire sessionへschema検証済み回答を保存する。",
		inputSchema: objectSchema(
			{ questionnaireSessionId: uuid, answers: { type: "array" } },
			["questionnaireSessionId", "answers"],
		),
		authorizationScope: "plan",
	},
	{
		actionId: "questionnaire.submit",
		toolName: "questionnaire_submit",
		title: "Questionnaireを確定",
		description: "必須回答を検証し、現在のQuestionnaireを確定する。",
		inputSchema: objectSchema(
			{ questionnaireSessionId: uuid, answers: { type: "array" } },
			["questionnaireSessionId", "answers"],
		),
		authorizationScope: "plan",
	},
	{
		actionId: "questionnaire.follow_up.generate",
		toolName: "questionnaire_follow_up_generate",
		title: "追加確認を生成",
		description: "現在のQuestionnaire sessionへfollow-upを生成する。",
		inputSchema: objectSchema({ questionnaireSessionId: uuid }, [
			"questionnaireSessionId",
		]),
		authorizationScope: "plan",
	},
	{
		actionId: "questionnaire.additional.generate",
		toolName: "questionnaire_additional_generate",
		title: "追加質問を生成",
		description: "current decisionsを保持したまま追加質問を生成する。",
		inputSchema: objectSchema(
			{ source: string, reason: string, maxQuestions: integer },
			["source"],
		),
		authorizationScope: "plan",
	},
	{
		actionId: "questionnaire.review.generate",
		toolName: "questionnaire_review_generate",
		title: "Decision Reviewを生成",
		description: "確定候補のQuestionnaire decisionsをreview artifactにする。",
		inputSchema: objectSchema({ questionnaireSessionId: uuid }, [
			"questionnaireSessionId",
		]),
		authorizationScope: "plan",
	},
	{
		actionId: "questionnaire.review.accept",
		toolName: "questionnaire_review_accept",
		title: "Decision Reviewを採用",
		description: "current reviewをユーザー判断正本として採用する。",
		inputSchema: objectSchema({ questionnaireSessionId: uuid }, [
			"questionnaireSessionId",
		]),
		authorizationScope: "plan",
	},
	{
		actionId: "questionnaire.review.leave_unadopted",
		toolName: "questionnaire_review_leave_unadopted",
		title: "Decision Reviewを不採用のまま残す",
		description: "current reviewを採用せず履歴に残す。",
		inputSchema: objectSchema({ questionnaireSessionId: uuid }, [
			"questionnaireSessionId",
		]),
		authorizationScope: "plan",
	},
	{
		actionId: "plan.routing.update",
		toolName: "plan_routing_update",
		title: "Plan routingを更新",
		description: "明示したrouting entriesとreasonをrevision付きで保存する。",
		inputSchema: objectSchema(
			{ entries: { type: "array" }, reason: string, expectedRevision: integer },
			["entries", "reason", "expectedRevision"],
		),
		authorizationScope: "plan",
	},
	{
		actionId: "plan.artifact.generate",
		toolName: "plan_artifact_generate",
		title: "Plan Artifactを生成",
		description:
			"artifact kindとsource IDを明示して通常のPlan generationを実行する。",
		inputSchema: objectSchema(
			{
				artifactKind: string,
				prompt: string,
				sourceIds: { type: "object" },
				questionnaireRevision: integer,
			},
			["artifactKind", "prompt", "sourceIds", "questionnaireRevision"],
		),
		authorizationScope: "plan",
	},
	{
		actionId: "plan.artifact.regenerate",
		toolName: "plan_artifact_regenerate",
		title: "Plan Artifactを再生成",
		description:
			"具体的な欠陥と維持事項を明示して対象Artifactだけを再生成する。",
		inputSchema: objectSchema(
			{
				targetArtifactId: string,
				defect: string,
				preserve: { type: "array", items: string },
				questionnaireRevision: integer,
				sourceRevisions: { type: "object" },
			},
			["targetArtifactId", "defect", "preserve", "questionnaireRevision"],
		),
		authorizationScope: "plan",
	},
	{
		actionId: "task.queue.enqueue",
		toolName: "task_queue_enqueue",
		title: "TaskをQueueへ追加",
		description: "UIと同じqueue admissionとidempotencyを使用する。",
		inputSchema: objectSchema({}),
		authorizationScope: "queue",
	},
	{
		actionId: "task.queue.update",
		toolName: "task_queue_update",
		title: "Queue entryを更新",
		description: "Queue entryのpositionまたはpriorityを更新する。",
		inputSchema: objectSchema(
			{ entryId: uuid, priority: { type: "number" }, queuePosition: integer },
			["entryId"],
		),
		authorizationScope: "queue",
	},
	{
		actionId: "task.queue.cancel",
		toolName: "task_queue_cancel",
		title: "Queue entryをcancel",
		description: "terminalでないQueue entryをUIと同じcommandでcancelする。",
		inputSchema: objectSchema({ entryId: uuid }, ["entryId"]),
		authorizationScope: "queue",
	},
	{
		actionId: "task.queue.requeue",
		toolName: "task_queue_requeue",
		title: "Queue entryを再投入",
		description: "既存entryをnote付きでrequeueする。",
		inputSchema: objectSchema({ entryId: uuid, note: string }, ["entryId"]),
		authorizationScope: "queue",
	},
	{
		actionId: "task.queue.recover",
		toolName: "task_queue_recover",
		title: "Queue entryを復旧",
		description: "typed queue stateに対するUI recovery actionを実行する。",
		inputSchema: objectSchema({ entryId: uuid, action: string, note: string }, [
			"entryId",
			"action",
		]),
		authorizationScope: "queue",
	},
	{
		actionId: "task.queue.archive",
		toolName: "task_queue_archive",
		title: "Queue entryをarchive",
		description: "UIと同じpreconditionでQueue entryをarchiveする。",
		inputSchema: objectSchema({ entryId: uuid }, ["entryId"]),
		authorizationScope: "queue",
	},
	{
		actionId: "run.implementation.start",
		toolName: "run_implementation_start",
		title: "Implementation Runを開始",
		description:
			"coding agentへ一つの実装依頼を渡し、import後も同じRunで継続させる。",
		inputSchema: objectSchema(
			{
				request: string,
				providerEndpointId: string,
				model: string,
				thinkingDepth: string,
			},
			["request"],
		),
		authorizationScope: "implementation",
	},
	{
		actionId: "run.test.start",
		toolName: "run_test_start",
		title: "Test Runを開始",
		description: "通常のTest Mode schemaとpreconditionでRunを開始する。",
		inputSchema: objectSchema(
			{
				projectId: uuid,
				specArtifactId: string,
				verificationDocumentId: { type: ["string", "null"], format: "uuid" },
				action: {
					type: "string",
					enum: [
						"discover_tests",
						"plan_and_implement_tests",
						"run_unit_tests",
					],
				},
				rerun: boolean,
			},
			["projectId", "specArtifactId"],
		),
		authorizationScope: "testMutation",
	},
	{
		actionId: "run.stop",
		toolName: "run_stop",
		title: "Runを停止",
		description: "Task所有の非terminal Runを停止する。",
		inputSchema: objectSchema({ runId: uuid }, ["runId"]),
		authorizationScope: "implementation",
	},
	{
		actionId: "background_process.stop",
		toolName: "background_process_stop",
		title: "Background processを停止",
		description: "Task所有の非terminal background processを停止する。",
		inputSchema: objectSchema({ processId: uuid }, ["processId"]),
		authorizationScope: "implementation",
	},
	{
		actionId: "review.session.start",
		toolName: "review_session_start",
		title: "Review sessionを開始",
		description: "terminal source Runから通常のReview sessionを作成する。",
		inputSchema: objectSchema({ sourceRunId: uuid }, ["sourceRunId"]),
		authorizationScope: "review",
	},
	{
		actionId: "review.run.start",
		toolName: "review_run_start",
		title: "Review Runを開始",
		description: "Review sessionへUIと同じoptionsを渡してRunを開始する。",
		inputSchema: objectSchema(
			{ reviewSessionId: uuid, options: { type: "object" } },
			["reviewSessionId"],
		),
		authorizationScope: "review",
	},
	{
		actionId: "run.review.submit",
		toolName: "run_review_submit",
		title: "Run reviewを確定",
		description:
			"terminal outcomeにcompleteまたはcancelのユーザー判断を記録する。",
		inputSchema: objectSchema(
			{
				runId: uuid,
				action: { type: "string", enum: ["complete", "cancel"] },
				note: string,
			},
			["runId", "action"],
		),
		authorizationScope: "taskComplete",
	},
	{
		actionId: "git.commit",
		toolName: "git_commit",
		title: "Runの変更をcommit",
		description: "UIと同じstage scopeとapprovalでcommitする。",
		inputSchema: objectSchema({ sourceRunId: uuid }, ["sourceRunId"]),
		authorizationScope: "localCommit",
		confirmationRequired: true,
	},
	{
		actionId: "git.push",
		toolName: "git_push",
		title: "Runのcommitをpush",
		description: "現在のpush policyとUI approvalを満たす場合だけpushする。",
		inputSchema: objectSchema({ sourceRunId: uuid }, ["sourceRunId"]),
		authorizationScope: "push",
		confirmationRequired: true,
	},
	...[
		["git.merge.preview", "git_merge_preview", "Mergeをpreview"],
		["git.merge.defer", "git_merge_defer", "Mergeを保留"],
		["git.merge.rework", "git_merge_rework", "Merge前reworkを依頼"],
		["git.merge.execute", "git_merge_execute", "Mergeを実行"],
	].map(
		([actionId, toolName, title]) =>
			({
				actionId,
				toolName,
				title,
				description:
					"UIと同じmerge preconditionとrecord version CASを使用する。",
				inputSchema: objectSchema({ runId: uuid, expectedVersion: integer }, [
					"runId",
					"expectedVersion",
				]),
				authorizationScope: "localCommit",
				confirmationRequired: actionId === "git.merge.execute",
			}) satisfies MissionPilotActionDefinition,
	),
	{
		actionId: "git.merge.target.update",
		toolName: "git_merge_target_update",
		title: "Merge targetを更新",
		description:
			"branch schema、approval、record version CASでtarget branchを更新する。",
		inputSchema: objectSchema(
			{ runId: uuid, targetBranch: string, expectedVersion: integer },
			["runId", "targetBranch", "expectedVersion"],
		),
		authorizationScope: "localCommit",
		confirmationRequired: true,
	},
];

const byActionId = new Map(definitions.map((entry) => [entry.actionId, entry]));
const byToolName = new Map(definitions.map((entry) => [entry.toolName, entry]));

export const MISSION_PILOT_ACTION_DEFINITIONS = Object.freeze(definitions);

export function getMissionPilotActionDefinition(actionId: string) {
	return byActionId.get(actionId) ?? null;
}

export function getMissionPilotActionByToolName(toolName: string) {
	return byToolName.get(toolName) ?? null;
}

export function missionPilotActionToolDefinitions(): ProviderToolDefinition[] {
	return definitions.map((entry) => ({
		name: entry.toolName,
		description: entry.description,
		inputSchema: entry.inputSchema,
	}));
}

export function describeMissionPilotActions(input: {
	authorization: MissionPilotAuthorization | null;
	taskRevision: number;
	runtimeState: MissionPilotRuntimeState;
}): MissionPilotTaskActionDescriptor[] {
	return definitions.map((entry) => {
		const authorized = Boolean(
			input.authorization?.scopes[entry.authorizationScope],
		);
		const unavailableReason = !authorized
			? `authorization scope ${entry.authorizationScope} is not granted`
			: input.runtimeState === "completed" &&
					entry.actionId !== "task.archive.restore"
				? "Mission Pilot session is completed"
				: null;
		return {
			actionId: entry.actionId,
			title: entry.title,
			description: entry.description,
			inputSchema: entry.inputSchema,
			availability: unavailableReason
				? "unavailable"
				: entry.confirmationRequired
					? "confirmation_required"
					: "available",
			unavailableReason,
			expectedTaskRevision: input.taskRevision,
		};
	});
}

export function validateMissionPilotActionArguments(
	definition: MissionPilotActionDefinition,
	value: unknown,
):
	| { success: true; data: Record<string, unknown> }
	| { success: false; message: string } {
	const validated = validateJsonSchemaValue(definition.inputSchema, value);
	return validated.success
		? { success: true, data: value as Record<string, unknown> }
		: validated;
}
