import type { TaskOperatorActionDefinition } from "./task-operator-action.registry";

const string = { type: "string" };
const integer = { type: "integer", minimum: 0 };
const openRecord = { type: "object", additionalProperties: true };
const object = (
	properties: Record<string, unknown>,
	required: string[],
): Record<string, unknown> => ({
	type: "object",
	properties,
	additionalProperties: false,
	required,
});

function mutation(
	actionId: string,
	title: string,
	description: string,
	capability: TaskOperatorActionDefinition["capability"],
	inputSchema: Record<string, unknown>,
): TaskOperatorActionDefinition {
	return {
		actionId,
		title,
		description,
		capability,
		inputSchema,
		execution: {
			effect: "mutation",
			completion: "immediate",
			expectedEventTypes: [],
			reconciliation: "query_receipt",
		},
	};
}

export const SECURITY_INTELLIGENCE_TASK_OPERATOR_ACTIONS = Object.freeze([
	mutation(
		"security.assessment.pre.bind",
		"実装前assessmentをTaskへ関連付け",
		"受領済みassessmentをcurrent Task Revision Snapshotへimmutableにbindingする。",
		"plan",
		object(
			{
				repositoryId: string,
				taskRevisionSnapshotId: string,
				assessmentReceiptRef: string,
				expectedRepositoryIdentityRevision: integer,
				expectedBaseWorktreeId: string,
				expectedBaseHeadSha: string,
			},
			[
				"repositoryId",
				"taskRevisionSnapshotId",
				"assessmentReceiptRef",
				"expectedRepositoryIdentityRevision",
				"expectedBaseWorktreeId",
				"expectedBaseHeadSha",
			],
		),
	),
	mutation(
		"security.contract.write",
		"Security Contractを保存",
		"pre assessmentにbindingしたContractをhead CAS付きで保存する。",
		"plan",
		object(
			{
				taskRevisionSnapshotId: string,
				expectedCurrentContractRef: { type: ["string", "null"] },
				expectedHeadRevision: integer,
				semantic: openRecord,
			},
			[
				"taskRevisionSnapshotId",
				"expectedCurrentContractRef",
				"expectedHeadRevision",
				"semantic",
			],
		),
	),
	mutation(
		"security.condition.write",
		"Security completion conditionを保存",
		"明示source revisionを持つconditionをhead CAS付きで保存する。",
		"plan",
		object(
			{
				taskRevisionSnapshotId: string,
				expectedCurrentConditionRef: { type: ["string", "null"] },
				expectedHeadRevision: integer,
				semantic: openRecord,
			},
			[
				"taskRevisionSnapshotId",
				"expectedCurrentConditionRef",
				"expectedHeadRevision",
				"semantic",
			],
		),
	),
	mutation(
		"security.assessment.post.request",
		"実装後assessmentを要求",
		"Runのauthoritative workspaceをserver側で解決してpost assessmentを要求する。",
		"implementation",
		object(
			{
				runId: string,
				expectedTaskRevisionSnapshotId: string,
				expectedWorkspaceId: string,
				expectedWorkspaceAllocationVersion: integer,
				selection: openRecord,
			},
			[
				"runId",
				"expectedTaskRevisionSnapshotId",
				"expectedWorkspaceId",
				"expectedWorkspaceAllocationVersion",
				"selection",
			],
		),
	),
	mutation(
		"security.knowledge.candidates.propose",
		"Security Knowledge candidateを提案",
		"Final Judgmentへbindingしたcandidate proposalをdurable outboxへ保存する。",
		"review",
		object(
			{
				runId: string,
				expectedFinalJudgmentDigest: string,
				commandRef: string,
				items: { type: "array", items: openRecord, minItems: 1, maxItems: 10 },
			},
			["runId", "expectedFinalJudgmentDigest", "commandRef", "items"],
		),
	),
	mutation(
		"security.knowledge.feedback.propose",
		"Security Knowledge feedbackを提案",
		"retrievalと実利用と検証結果を区別したappend-only feedbackを保存する。",
		"review",
		object(
			{
				runId: string,
				commandRef: string,
				events: {
					type: "array",
					items: openRecord,
					minItems: 1,
					maxItems: 100,
				},
			},
			["runId", "commandRef", "events"],
		),
	),
] satisfies TaskOperatorActionDefinition[]);
