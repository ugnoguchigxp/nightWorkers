export type TaskOperatorCapability =
	| "plan"
	| "queue"
	| "implementation"
	| "testMutation"
	| "review"
	| "localCommit"
	| "taskComplete"
	| "taskArchive"
	| "push";
export type TaskOperatorActionExecutionMetadata = {
	effect: "read" | "mutation";
	completion: "immediate" | "wait_for_event" | "finish_candidate";
	expectedEventTypes: string[];
	reconciliation: "none" | "query_receipt" | "query_resource";
};
export type TaskOperatorActionDefinition = {
	actionId: string;
	title: string;
	description: string;
	inputSchema: Record<string, unknown>;
	capability: TaskOperatorCapability;
	execution: TaskOperatorActionExecutionMetadata;
};
const object = (
	properties: Record<string, unknown> = {},
	required: string[] = [],
): Record<string, unknown> => ({
	type: "object",
	properties,
	additionalProperties: false,
	required,
});
const string = { type: "string" };
const uuid = { type: "string", format: "uuid" };
const integer = { type: "integer", minimum: 0 };
const nullableInteger = { type: ["integer", "null"], minimum: 0 };
const stringEnum = (...values: string[]) => ({ type: "string", enum: values });
const openRecord = { type: "object", additionalProperties: true };
const planRoutingChange = {
	type: "object",
	properties: {
		view: stringEnum(
			"user_flow",
			"blueprint",
			"data_model",
			"api_io_contract",
			"activity_flow",
			"sequence_flow",
			"zod_schema_design",
		),
		decision: stringEnum("include", "omit"),
		reason: { type: "string", minLength: 1, maxLength: 1_000 },
	},
	additionalProperties: false,
	required: ["view", "decision", "reason"],
};
const taskFields = {
	type: "object",
	properties: {
		title: string,
		description: { type: ["string", "null"] },
		objective: { type: ["string", "null"] },
		acceptanceCriteria: { type: ["string", "null"] },
		status: stringEnum(...taskStatusSchema.options),
		priority: integer,
	},
	additionalProperties: false,
};
const questionnaireId = {
	type: "string",
	pattern: "^[a-z0-9]+(?:-[a-z0-9]+)*$",
};
const questionnaireIdArray = {
	type: "array",
	items: questionnaireId,
};
const questionnaireAnswer = {
	type: "object",
	properties: {
		questionId: questionnaireId,
		selectedOptionIds: questionnaireIdArray,
		booleanValue: { type: "boolean" },
		freeText: { type: "string" },
		rankedOptionIds: questionnaireIdArray,
		deferred: { type: "boolean" },
	},
	required: ["questionId"],
	additionalProperties: false,
};
type DefinitionTuple = [
	string,
	string,
	string,
	TaskOperatorCapability,
	Record<string, unknown>,
];
const definitions: TaskOperatorActionDefinition[] = (
	[
		[
			"task.update",
			"Taskを更新",
			"Task fieldをrevision付きで更新する。",
			"plan",
			object({ fields: taskFields }, ["fields"]),
		],
		[
			"task.message.send",
			"Taskへメッセージを送信",
			"Task UIと同じmessage commandを使う。",
			"plan",
			object({ content: string }, ["content"]),
		],
		[
			"task.archive",
			"Taskをarchive",
			"Taskの既存archive commandを実行する。",
			"taskArchive",
			object({ discardPendingCloseouts: { type: "boolean" } }),
		],
		[
			"task.archive.restore",
			"Task archiveを復元",
			"Taskの既存restore commandを実行する。",
			"taskArchive",
			object(),
		],
		[
			"questionnaire.create",
			"Questionnaireを作成",
			"明示したsourceからQuestionnaireを作成する。",
			"plan",
			object({ prompt: string, sourceBlueprintMessageId: uuid }, ["prompt"]),
		],
		[
			"questionnaire.submit",
			"Questionnaireを確定",
			"現在のQuestionnaireを既存commandで確定する。",
			"plan",
			object(
				{
					questionnaireSessionId: uuid,
					answers: { type: "array", items: questionnaireAnswer },
				},
				["questionnaireSessionId", "answers"],
			),
		],
		[
			"questionnaire.follow_up.generate",
			"追加確認を生成",
			"Questionnaireのfollow-upを生成する。",
			"plan",
			object({ questionnaireSessionId: uuid }, ["questionnaireSessionId"]),
		],
		[
			"questionnaire.additional.generate",
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
			"Questionnaire reviewを生成",
			"確定候補をreview artifactにする。",
			"plan",
			object({ questionnaireSessionId: uuid }, ["questionnaireSessionId"]),
		],
		[
			"questionnaire.review.accept",
			"Questionnaire reviewを採用",
			"current reviewを採用する。",
			"plan",
			object({ questionnaireSessionId: uuid }, ["questionnaireSessionId"]),
		],
		[
			"questionnaire.review.leave_unadopted",
			"Questionnaire reviewを保留",
			"current reviewを採用せず履歴に残す。",
			"plan",
			object({ questionnaireSessionId: uuid }, ["questionnaireSessionId"]),
		],
		[
			"plan.routing.update",
			"Plan routingを更新",
			"routing entriesをrevision付きで保存する。",
			"plan",
			object(
				{
					expectedRevision: integer,
					idempotencyKey: uuid,
					changes: { type: "array", items: planRoutingChange, minItems: 1 },
				},
				["expectedRevision", "idempotencyKey", "changes"],
			),
		],
		[
			"plan.artifact.feature_plan.generate",
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
			"task.queue.enqueue",
			"TaskをQueueへ追加",
			"UIと同じqueue admissionを使う。",
			"queue",
			object(),
		],
		[
			"task.queue.update",
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
			"Queue entryをcancel",
			"terminalでないentryをcancelする。",
			"queue",
			object({ entryId: uuid }, ["entryId"]),
		],
		[
			"task.queue.requeue",
			"Queue entryを再投入",
			"既存entryを再投入する。",
			"queue",
			object({ entryId: uuid, note: string }, ["entryId"]),
		],
		[
			"task.queue.recover",
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
			"Queue entryをarchive",
			"Queue entryをarchiveする。",
			"queue",
			object({ entryId: uuid }, ["entryId"]),
		],
		[
			"run.implementation.start",
			"Implementation Runを開始",
			"Coding Agentへ、ユーザーが直接開始するときと同じ明示的な実装・検証依頼を送る。",
			"implementation",
			object({ request: string }, ["request"]),
		],
		[
			"run.todo.resume",
			"Coding Agent Todoを再開",
			"userContextをユーザーメッセージとして送信し、needs_humanのTodoをUIと同じcommand contractで再開する。",
			"implementation",
			object(
				{
					runId: uuid,
					todoId: uuid,
					expectedTodoRevision: integer,
					userContext: string,
				},
				["runId", "todoId", "expectedTodoRevision", "userContext"],
			),
		],
		[
			"run.stop",
			"Runを停止",
			"Task所有のRunを既存commandで停止する。",
			"implementation",
			object({ runId: uuid }, ["runId"]),
		],
		[
			"background_process.stop",
			"Background processを停止",
			"Task所有のprocessを停止する。",
			"implementation",
			object({ processId: uuid }, ["processId"]),
		],
		[
			"run.review.submit",
			"Run reviewを確定",
			"terminal outcomeへの判断を記録する。",
			"taskComplete",
			object(
				{
					runId: uuid,
					action: stringEnum("complete", "cancel"),
					note: string,
				},
				["runId", "action"],
			),
		],
		[
			"task.complete",
			"Taskを完了",
			"Task completeの既存application commandを実行する。",
			"taskComplete",
			object({ sourceRunId: uuid }, ["sourceRunId"]),
		],
		[
			"git.commit",
			"変更をcommit",
			"UIと同じownership検証でcommitする。",
			"localCommit",
			object({ sourceRunId: uuid }, ["sourceRunId"]),
		],
		[
			"git.push",
			"変更をpush",
			"Playで許可された場合だけpushする。",
			"push",
			object({ sourceRunId: uuid }, ["sourceRunId"]),
		],
		[
			"git.merge.preview",
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
			"Mergeを実行",
			"Mergeの既存preconditionを使う。",
			"localCommit",
			object({ runId: uuid, expectedVersion: integer }, [
				"runId",
				"expectedVersion",
			]),
		],
	] as DefinitionTuple[]
).map(([actionId, title, description, capability, inputSchema]) => ({
	actionId,
	title,
	description,
	capability,
	execution: taskOperatorActionExecutionMetadata(actionId),
	inputSchema,
}));
export const TASK_OPERATOR_ACTION_DEFINITIONS = Object.freeze(definitions);
const byActionId = new Map(definitions.map((entry) => [entry.actionId, entry]));
export function getTaskOperatorActionDefinition(actionId: string) {
	return byActionId.get(actionId) ?? null;
}
export function taskOperatorActionExecutionMetadata(
	actionId: string,
): TaskOperatorActionExecutionMetadata {
	const eventDrivenActions = new Set([
		"questionnaire.follow_up.generate",
		"questionnaire.review.generate",
		"questionnaire.review.accept",
		"questionnaire.review.leave_unadopted",
		"task.queue.enqueue",
		"run.implementation.start",
	]);
	const completion =
		actionId === "task.complete" || actionId === "task.archive"
			? "finish_candidate"
			: eventDrivenActions.has(actionId)
				? "wait_for_event"
				: "immediate";
	const expectedEventTypes =
		completion !== "wait_for_event"
			? []
			: actionId.startsWith("questionnaire.")
				? [
						"questionnaire.state_changed",
						"questionnaire.submission_failed",
						"questionnaire.follow_up_failed",
					]
				: [
						"task_run.started",
						"task_run.terminal",
						"task_run.failed",
						"task_queue.failed",
					];
	return {
		effect: "mutation",
		completion,
		expectedEventTypes,
		reconciliation:
			completion === "wait_for_event" ? "query_resource" : "query_receipt",
	};
}

import { taskStatusSchema } from "../../../../shared/schemas/nightworkers/repository-task.schema";
