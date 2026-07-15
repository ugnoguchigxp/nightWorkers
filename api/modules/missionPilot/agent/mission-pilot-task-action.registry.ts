import type { MissionPilotAuthorization } from "../../../../shared/schemas/mission-pilot.schema";
import type {
	MissionPilotRuntimeState,
	MissionPilotTaskActionDescriptor,
} from "../../../../shared/schemas/mission-pilot-agent.schema";
import type { ProviderToolDefinition } from "../../../services/structured-llm/public";

type Scope = keyof MissionPilotAuthorization["scopes"];
export type MissionPilotActionDefinition = {
	actionId: string;
	toolName: string;
	title: string;
	description: string;
	inputSchema: Record<string, unknown>;
	authorizationScope: Scope;
};
const object = (
	properties: Record<string, unknown> = {},
	required: string[] = [],
): Record<string, unknown> => ({
	type: "object",
	properties: { expectedTaskRevision: integer, ...properties },
	additionalProperties: false,
	required: [
		"expectedTaskRevision",
		...required.filter((key) => key !== "expectedTaskRevision"),
	],
});
const string = { type: "string" };
const uuid = { type: "string", format: "uuid" };
const integer = { type: "integer", minimum: 0 };
const array = { type: "array" };
const boolean = { type: "boolean" };
const nullableInteger = { type: ["integer", "null"], minimum: 0 };
const stringEnum = (...values: string[]) => ({ type: "string", enum: values });
const openRecord = { type: "object", additionalProperties: true };
const taskFields = {
	type: "object",
	properties: {
		title: string,
		description: { type: ["string", "null"] },
		objective: { type: ["string", "null"] },
		acceptanceCriteria: { type: ["string", "null"] },
		priority: integer,
	},
	additionalProperties: false,
};
type DefinitionTuple = [
	string,
	string,
	string,
	string,
	Scope,
	Record<string, unknown>,
];
const definitions: MissionPilotActionDefinition[] = (
	[
		[
			"task.update",
			"task_update",
			"Taskを更新",
			"Task fieldをrevision付きで更新する。",
			"plan",
			object({ fields: taskFields }, ["fields"]),
		],
		[
			"task.message.send",
			"task_message_send",
			"Taskへメッセージを送信",
			"Task UIと同じmessage commandを使う。",
			"plan",
			object({ content: string }, ["content"]),
		],
		[
			"task.archive",
			"task_archive",
			"Taskをarchive",
			"Taskの既存archive commandを実行する。",
			"taskArchive",
			object(),
		],
		[
			"task.archive.restore",
			"task_archive_restore",
			"Task archiveを復元",
			"Taskの既存restore commandを実行する。",
			"taskArchive",
			object(),
		],
		[
			"questionnaire.create",
			"questionnaire_create",
			"Questionnaireを作成",
			"明示したsourceからQuestionnaireを作成する。",
			"plan",
			object({ prompt: string, sourceBlueprintMessageId: uuid }, ["prompt"]),
		],
		[
			"questionnaire.draft.update",
			"questionnaire_draft_update",
			"Questionnaire回答案を保存",
			"schema検証済み回答案を保存する。",
			"plan",
			object({ questionnaireSessionId: uuid, answers: array }, [
				"questionnaireSessionId",
				"answers",
			]),
		],
		[
			"questionnaire.draft.save",
			"questionnaire_draft_save",
			"Questionnaire回答案を保存",
			"Questionnaire回答案と回答根拠を既存commandで保存する。",
			"plan",
			object(
				{
					questionnaireSessionId: uuid,
					answers: array,
					answerEvidence: array,
				},
				["questionnaireSessionId", "answers"],
			),
		],
		[
			"questionnaire.submit",
			"questionnaire_submit",
			"Questionnaireを確定",
			"現在のQuestionnaireを既存commandで確定する。",
			"plan",
			object({ questionnaireSessionId: uuid, answers: array }, [
				"questionnaireSessionId",
				"answers",
			]),
		],
		[
			"questionnaire.follow_up.generate",
			"questionnaire_follow_up_generate",
			"追加確認を生成",
			"Questionnaireのfollow-upを生成する。",
			"plan",
			object({ questionnaireSessionId: uuid }, ["questionnaireSessionId"]),
		],
		[
			"questionnaire.additional.generate",
			"questionnaire_additional_generate",
			"追加質問を生成",
			"現在の判断を保持して追加質問を生成する。",
			"plan",
			object(
				{
					source: stringEnum(
						"user_requested",
						"artifact_triggered",
						"pre_feature_plan_gate",
					),
					reason: string,
				},
				["source"],
			),
		],
		[
			"questionnaire.review.generate",
			"questionnaire_review_generate",
			"Questionnaire reviewを生成",
			"確定候補をreview artifactにする。",
			"plan",
			object({ questionnaireSessionId: uuid }, ["questionnaireSessionId"]),
		],
		[
			"questionnaire.review.accept",
			"questionnaire_review_accept",
			"Questionnaire reviewを採用",
			"current reviewを採用する。",
			"plan",
			object({ questionnaireSessionId: uuid }, ["questionnaireSessionId"]),
		],
		[
			"questionnaire.review.leave_unadopted",
			"questionnaire_review_leave_unadopted",
			"Questionnaire reviewを保留",
			"current reviewを採用せず履歴に残す。",
			"plan",
			object({ questionnaireSessionId: uuid }, ["questionnaireSessionId"]),
		],
		[
			"plan.routing.update",
			"plan_routing_update",
			"Plan routingを更新",
			"routing entriesをrevision付きで保存する。",
			"plan",
			object(
				{
					expectedRevision: integer,
					idempotencyKey: uuid,
					changes: array,
				},
				["expectedRevision", "idempotencyKey", "changes"],
			),
		],
		[
			"plan.artifact.generate",
			"plan_artifact_generate",
			"Plan Artifactを生成",
			"指定されたsourceからArtifactを生成する。",
			"plan",
			object({ artifactKind: string, prompt: string, sourceIds: openRecord }, [
				"artifactKind",
				"sourceIds",
			]),
		],
		[
			"plan.artifact.feature_plan.generate",
			"plan_artifact_feature_plan_generate",
			"Feature Planを生成",
			"指定したpromptとsource selectionからFeature Planを生成する。",
			"plan",
			object(
				{
					prompt: string,
					questionnaireSessionId: uuid,
					sourceSelection: openRecord,
				},
				["prompt"],
			),
		],
		[
			"plan.artifact.blueprint.generate",
			"plan_artifact_blueprint_generate",
			"Blueprintを生成",
			"指定したpromptとsource selectionからBlueprintを生成する。",
			"plan",
			object(
				{
					prompt: string,
					questionnaireSessionId: uuid,
					sourceSelection: openRecord,
				},
				["prompt"],
			),
		],
		[
			"plan.artifact.data_model.generate",
			"plan_artifact_data_model_generate",
			"Data Modelを生成",
			"指定したpromptとsource selectionからData Modelを生成する。",
			"plan",
			object(
				{
					prompt: string,
					questionnaireSessionId: uuid,
					sourceSelection: openRecord,
				},
				["prompt"],
			),
		],
		[
			"plan.artifact.view.generate",
			"plan_artifact_view_generate",
			"Plan Viewを生成",
			"指定したview、prompt、source selectionからPlan Viewを生成する。",
			"plan",
			object(
				{
					view: stringEnum(
						"user_flow",
						"api_io_contract",
						"activity_flow",
						"sequence_flow",
						"zod_schema_design",
					),
					prompt: string,
					questionnaireSessionId: uuid,
					sourceSelection: openRecord,
				},
				["view", "prompt"],
			),
		],
		[
			"plan.artifact.regenerate",
			"plan_artifact_regenerate",
			"Plan Artifactを再生成",
			"欠陥と維持事項を明示して対象だけを再生成する。",
			"plan",
			object({ targetArtifactId: string, defect: string, preserve: array }, [
				"targetArtifactId",
				"defect",
				"preserve",
			]),
		],
		[
			"task.queue.enqueue",
			"task_queue_enqueue",
			"TaskをQueueへ追加",
			"UIと同じqueue admissionを使う。",
			"queue",
			object(),
		],
		[
			"task.queue.update",
			"task_queue_update",
			"Queue entryを更新",
			"Queue entryを更新する。",
			"queue",
			object(
				{
					entryId: uuid,
					action: stringEnum("cancel", "resume"),
					priority: integer,
					queuePosition: nullableInteger,
				},
				["entryId"],
			),
		],
		[
			"task.queue.cancel",
			"task_queue_cancel",
			"Queue entryをcancel",
			"terminalでないentryをcancelする。",
			"queue",
			object({ entryId: uuid }, ["entryId"]),
		],
		[
			"task.queue.requeue",
			"task_queue_requeue",
			"Queue entryを再投入",
			"既存entryを再投入する。",
			"queue",
			object({ entryId: uuid, note: string }, ["entryId"]),
		],
		[
			"task.queue.recover",
			"task_queue_recover",
			"Queue entryを復旧",
			"typed queue recoveryを実行する。",
			"queue",
			object(
				{
					entryId: uuid,
					action: stringEnum(
						"archive",
						"cancel",
						"complete",
						"retry",
						"mark_needs_human",
					),
					note: string,
				},
				["entryId", "action"],
			),
		],
		[
			"task.queue.archive",
			"task_queue_archive",
			"Queue entryをarchive",
			"Queue entryをarchiveする。",
			"queue",
			object({ entryId: uuid }, ["entryId"]),
		],
		[
			"run.implementation.start",
			"run_implementation_start",
			"Implementation Runを開始",
			"Coding Agentへ明示した依頼を送る。repairRequestがある場合は修正依頼の正本も保存する。",
			"implementation",
			object({ request: string, repairRequest: openRecord }, ["request"]),
		],
		[
			"run.test.start",
			"run_test_start",
			"Test Runを開始",
			"Test Modeの既存commandを使う。",
			"testMutation",
			object(
				{
					projectId: uuid,
					specArtifactId: string,
					action: stringEnum(
						"discover_tests",
						"plan_and_implement_tests",
						"run_unit_tests",
					),
					rerun: boolean,
				},
				["projectId", "specArtifactId"],
			),
		],
		[
			"run.stop",
			"run_stop",
			"Runを停止",
			"Task所有のRunを既存commandで停止する。",
			"implementation",
			object({ runId: uuid }, ["runId"]),
		],
		[
			"background_process.stop",
			"background_process_stop",
			"Background processを停止",
			"Task所有のprocessを停止する。",
			"implementation",
			object({ processId: uuid }, ["processId"]),
		],
		[
			"review.session.start",
			"review_session_start",
			"Review sessionを開始",
			"terminal RunからReview sessionを作る。",
			"review",
			object({ sourceRunId: uuid }, ["sourceRunId"]),
		],
		[
			"review.run.start",
			"review_run_start",
			"Review Runを開始",
			"Reviewの既存commandを使う。",
			"review",
			object({ reviewSessionId: uuid }, ["reviewSessionId"]),
		],
		[
			"run.review.submit",
			"run_review_submit",
			"Run reviewを確定",
			"terminal outcomeへの判断を記録する。",
			"taskComplete",
			object({ runId: uuid, action: stringEnum("complete", "cancel") }, [
				"runId",
				"action",
			]),
		],
		[
			"task.complete",
			"task_complete",
			"Taskを完了",
			"Task completeの既存application commandを実行する。",
			"taskComplete",
			object({ sourceRunId: uuid }, ["sourceRunId"]),
		],
		[
			"git.commit",
			"git_commit",
			"変更をcommit",
			"UIと同じownership検証でcommitする。",
			"localCommit",
			object({ sourceRunId: uuid }, ["sourceRunId"]),
		],
		[
			"git.push",
			"git_push",
			"変更をpush",
			"Playで許可された場合だけpushする。",
			"push",
			object({ sourceRunId: uuid }, ["sourceRunId"]),
		],
		[
			"git.merge.preview",
			"git_merge_preview",
			"Mergeをpreview",
			"Mergeの既存preconditionを使う。",
			"localCommit",
			object({ runId: uuid, expectedVersion: integer }, [
				"runId",
				"expectedVersion",
			]),
		],
		[
			"git.merge.defer",
			"git_merge_defer",
			"Mergeを保留",
			"Mergeの既存preconditionを使う。",
			"localCommit",
			object({ runId: uuid, expectedVersion: integer }, [
				"runId",
				"expectedVersion",
			]),
		],
		[
			"git.merge.rework",
			"git_merge_rework",
			"Merge前reworkを依頼",
			"Mergeの既存preconditionを使う。",
			"localCommit",
			object({ runId: uuid, expectedVersion: integer }, [
				"runId",
				"expectedVersion",
			]),
		],
		[
			"git.merge.target.update",
			"git_merge_target_update",
			"Merge targetを更新",
			"target branchをCAS付きで更新する。",
			"localCommit",
			object({ runId: uuid, targetBranch: string, expectedVersion: integer }, [
				"runId",
				"targetBranch",
				"expectedVersion",
			]),
		],
		[
			"git.merge.execute",
			"git_merge_execute",
			"Mergeを実行",
			"Mergeの既存preconditionを使う。",
			"localCommit",
			object({ runId: uuid, expectedVersion: integer }, [
				"runId",
				"expectedVersion",
			]),
		],
	] as DefinitionTuple[]
).map(
	([
		actionId,
		toolName,
		title,
		description,
		authorizationScope,
		inputSchema,
	]) => ({
		actionId,
		toolName,
		title,
		description,
		authorizationScope,
		inputSchema,
	}),
);

export const MISSION_PILOT_ACTION_DEFINITIONS = Object.freeze(definitions);
const byActionId = new Map(definitions.map((entry) => [entry.actionId, entry]));
const byToolName = new Map(definitions.map((entry) => [entry.toolName, entry]));
const unavailableActionReasons = new Map<string, string>([
	[
		"plan.artifact.generate",
		"Artifact kindごとの明示actionを使用してください。",
	],
	[
		"plan.artifact.regenerate",
		"対象Artifactのsource revisionを含む再生成contractが必要です。",
	],
]);
export function getMissionPilotActionDefinition(actionId: string) {
	return byActionId.get(actionId) ?? null;
}
export function getMissionPilotActionByToolName(toolName: string) {
	return byToolName.get(toolName) ?? null;
}
export function missionPilotActionToolDefinitions(): ProviderToolDefinition[] {
	return definitions
		.filter((entry) => !unavailableActionReasons.has(entry.actionId))
		.map(({ toolName, description, inputSchema }) => ({
			name: toolName,
			description,
			inputSchema,
		}));
}
export function getMissionPilotActionUnavailableReason(actionId: string) {
	return unavailableActionReasons.get(actionId) ?? null;
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
		const unavailableReason =
			unavailableActionReasons.get(entry.actionId) ??
			(!authorized
				? `authorization scope ${entry.authorizationScope} is not granted`
				: input.runtimeState === "completed" &&
						entry.actionId !== "task.archive.restore"
					? "Mission Pilot session is completed"
					: null);
		return {
			actionId: entry.actionId,
			title: entry.title,
			description: entry.description,
			inputSchema: entry.inputSchema,
			availability: unavailableReason ? "unavailable" : "available",
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
	const result = validateSchema(definition.inputSchema, value, "arguments");
	return result === null &&
		value &&
		typeof value === "object" &&
		!Array.isArray(value)
		? { success: true, data: value as Record<string, unknown> }
		: { success: false, message: result ?? "arguments must be an object" };
}
function validateSchema(
	schema: Record<string, unknown>,
	value: unknown,
	path: string,
): string | null {
	if (Array.isArray(schema.type)) {
		const errors = schema.type.map((type) =>
			validateSchema({ ...schema, type }, value, path),
		);
		if (errors.some((error) => error === null)) return null;
		return errors[0] ?? `${path} has an invalid type`;
	}
	if (
		Array.isArray(schema.enum) &&
		!schema.enum.some((candidate) => Object.is(candidate, value))
	)
		return `${path} must be one of the allowed values`;
	if (schema.type === "null")
		return value === null ? null : `${path} must be null`;
	if (schema.type === "object") {
		if (!value || typeof value !== "object" || Array.isArray(value))
			return `${path} must be an object`;
		const record = value as Record<string, unknown>;
		for (const required of Array.isArray(schema.required)
			? schema.required
			: [])
			if (!((required as string) in record))
				return `${path}.${String(required)} is required`;
		const properties =
			schema.properties && typeof schema.properties === "object"
				? (schema.properties as Record<string, Record<string, unknown>>)
				: {};
		if (schema.additionalProperties === false)
			for (const key of Object.keys(record))
				if (!properties[key]) return `${path}.${key} is not allowed`;
		for (const [key, child] of Object.entries(properties))
			if (key in record) {
				const error = validateSchema(child, record[key], `${path}.${key}`);
				if (error) return error;
			}
		return null;
	}
	if (schema.type === "string") {
		if (typeof value !== "string") return `${path} must be a string`;
		if (
			schema.format === "uuid" &&
			!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
				value,
			)
		)
			return `${path} must be a UUID`;
	}
	if (schema.type === "boolean" && typeof value !== "boolean")
		return `${path} must be a boolean`;
	if (
		schema.type === "integer" &&
		(!Number.isInteger(value) ||
			(typeof schema.minimum === "number" &&
				(value as number) < schema.minimum))
	)
		return `${path} must be a non-negative integer`;
	if (schema.type === "array" && !Array.isArray(value))
		return `${path} must be an array`;
	return null;
}
