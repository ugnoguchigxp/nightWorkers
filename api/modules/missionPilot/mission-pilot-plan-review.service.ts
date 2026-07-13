import { z } from "zod";
import {
	type MissionPilotPlanReview,
	missionPilotArtifactScoreThreshold,
	missionPilotPlanReviewSchema,
	normalizeMissionPilotPlanReview,
} from "../../../shared/schemas/mission-pilot-plan-review.schema";
import { callStructuredJsonLLM } from "../../services/structured-llm";
import { normalizeStructuredOutputJsonSchema } from "../../services/structured-llm/json-schema";
import * as nightworkersRepo from "../nightworkers/nightworkers.repository";
import { missionPilotThoughtTrace } from "../nightworkers/nightworkers.trace-provenance";
import { getPlanModeWorkspace } from "../specification/plan-mode-workspace.service";
import * as missionPilotRepo from "./mission-pilot.repository";
import {
	collectCurrentReviewArtifacts,
	latestContext,
} from "./mission-pilot-plan-support";
import { assertMissionPilotPreQueueMutable } from "./mission-pilot-pre-queue-recovery.service";

export async function reviewCurrentPlan(
	taskId: string,
	sessionId: string,
	attempt: number,
): Promise<{
	review: MissionPilotPlanReview;
	featurePlanMessageId: string;
	contextRevision: number;
	contextDigest: string;
	routingRevision: number;
}> {
	await assertMissionPilotPreQueueMutable(taskId);
	const [session, context, workspace, messages, task] = await Promise.all([
		missionPilotRepo.getSessionByTaskId(taskId),
		latestContext(sessionId),
		getPlanModeWorkspace(taskId),
		nightworkersRepo.listTaskMessages(taskId),
		nightworkersRepo.getTask(taskId),
	]);
	if (!session || !context || !task)
		throw new Error("Review context is missing");
	const featurePlan = workspace.featurePlanArtifacts.at(-1);
	if (!featurePlan) throw new Error("Feature Plan is missing");
	const featurePlanMessage = messages.find(
		(message) => message.id === featurePlan.sourceMessageId,
	);
	if (!featurePlanMessage) throw new Error("Feature Plan message is missing");
	const reviewArtifacts = collectCurrentReviewArtifacts(workspace);
	const raw = await callStructuredJsonLLM(
		[
			"あなたはMission PilotのQueue投入前・一括実装計画レビュアーです。",
			"全Plan Artifactの生成完了後に、Goal、確定Questionnaire、現行Artifact一式、受け入れ条件、検証の整合性を一度に審査してください。Artifact生成途中の個別レビューは行いません。",
			"artifactScoresにはreviewArtifactsの各ArtifactをsourceMessageId単位で重複なく1件ずつ含め、0〜100点で採点してください。",
			"feature_plan、data_model、api_io_contract、zod_schema_designは実装直結Artifactとして80点以上を合格とします。",
			"blueprint、user_flow、activity_flow、sequence_flowは概念把握用Artifactです。点数とfindingは参考情報として返しますが、低得点や細部不一致をverdict=reviseの理由にせず、revisionTargetsにも含めないでください。",
			"実装直結Artifactがすべて80点以上ならverdict=pass、1件でも80点未満ならverdict=reviseとしてください。findingのseverityだけで合否を決めないでください。",
			"確定QuestionnaireとTask acceptance criteriaは不変の入力であり、実装詳細をすべて列挙する文書ではありません。回答と矛盾しない型、値、取得元、コマンド、検証詳細はFeature Planが具体化します。",
			"QuestionnaireまたはTask acceptance criteriaの変更を要求せず、不足する派生仕様はfeature_planのrevisionTargetとして返してください。",
			"revisionTargetsは80点未満の実装直結Artifactだけに限定してください。概念把握用Artifactは修正対象に含めないでください。",
			"Questionnaireと概念把握用Artifactが矛盾する場合はwarning findingとして記録し、revisionTargetにはしないでください。",
			"80点未満の各実装直結Artifactには、同じtargetとsourceMessageIdを持つrevisionTargetをちょうど1件返してください。",
			"現在 omit の編集可能ArtifactがGoal、Questionnaire、受け入れ条件を具体化するために不可欠なら、採点やrevisionTargetで代用せず verdict=reroute とし、routingToolCall.tool=edit_plan_artifact_routing を返してください。",
			"routingToolCall は omit から include に広げる変更だけを指定できます。questionnaire と feature_plan は常に必須で編集対象外です。不要なArtifactを慣例だけで追加しないでください。",
			"routingToolCallを返す場合、expectedRevisionはcurrentRouting.revisionと一致させ、追加が必要な理由を各change.reasonへ具体的に書いてください。",
		].join("\n"),
		JSON.stringify({
			reviewAttempt: attempt,
			task: {
				title: task.title,
				objective: task.objective,
				acceptanceCriteria: task.acceptanceCriteria,
			},
			contextRevision: session.contextRevision,
			contextDigest: session.contextDigest,
			canonicalContext: context.contextJson,
			currentRouting: workspace.routing ?? {
				revision: session.planRoutingRevision,
				entries: workspace.viewDecisions,
			},
			featurePlan: featurePlanMessage.content,
			reviewArtifacts: reviewArtifacts.map((artifact) => ({
				...artifact,
				threshold: missionPilotArtifactScoreThreshold(artifact.artifactKind),
			})),
		}),
		{
			taskId,
			role: "mission_pilot",
			usageTrace: missionPilotThoughtTrace({ sessionId }),
			schemaName: "mission_pilot_plan_review",
			schema: buildMissionPilotPlanReviewResponseJsonSchema(),
		},
	);
	return {
		review: normalizeMissionPilotPlanReview(JSON.parse(raw), reviewArtifacts),
		featurePlanMessageId: featurePlanMessage.id,
		contextRevision: session.contextRevision,
		contextDigest: session.contextDigest,
		routingRevision: session.planRoutingRevision,
	};
}

export function buildMissionPilotPlanReviewResponseJsonSchema() {
	return normalizeStructuredOutputJsonSchema(
		z.toJSONSchema(missionPilotPlanReviewSchema),
	);
}
