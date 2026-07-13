import { z } from "zod";
import {
	type MissionPilotPlanReview,
	missionPilotPlanReviewSchema,
	normalizeMissionPilotPlanReview,
} from "../../../shared/schemas/mission-pilot-plan-review.schema";
import { callStructuredJsonLLM } from "../../services/structured-llm";
import { normalizeStructuredOutputJsonSchema } from "../../services/structured-llm/json-schema";
import * as nightworkersRepo from "../nightworkers/nightworkers.repository";
import { missionPilotThoughtTrace } from "../nightworkers/nightworkers.trace-provenance";
import { resolvePlanModeProjectStackContext } from "../specification/plan-mode-project-stack-context";
import { getPlanModeWorkspace } from "../specification/plan-mode-workspace.service";
import * as missionPilotRepo from "./mission-pilot.repository";
import {
	collectCurrentReviewArtifacts,
	latestContext,
} from "./mission-pilot-plan-support";
import { assertMissionPilotPreQueueMutable } from "./mission-pilot-pre-queue-recovery.service";

function toRecord(value: unknown): Record<string, unknown> {
	return value && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: {};
}

function compactCanonicalReviewContext(value: unknown) {
	const context = toRecord(value);
	const plan = toRecord(context.plan);
	const { artifacts: _artifacts, reviews: _reviews, ...currentPlan } = plan;
	return { ...context, plan: currentPlan };
}

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
	const projectStackContext = await resolvePlanModeProjectStackContext(
		task.repositoryId,
	);
	const featurePlan = workspace.featurePlanArtifacts.at(-1);
	if (!featurePlan) throw new Error("Feature Plan is missing");
	const featurePlanMessage = messages.find(
		(message) => message.id === featurePlan.sourceMessageId,
	);
	if (!featurePlanMessage) throw new Error("Feature Plan message is missing");
	const reviewArtifacts = collectCurrentReviewArtifacts(workspace);
	const reviewArtifactPayloads = reviewArtifacts.map((artifact) => {
		const message = messages.find(
			(candidate) => candidate.id === artifact.sourceMessageId,
		);
		if (!message) {
			throw new Error(
				`Review Artifact message is missing: ${artifact.artifactKind}`,
			);
		}
		return { ...artifact, content: message.content };
	});
	const raw = await callStructuredJsonLLM(
		[
			"あなたはMission PilotのQueue投入前・一括実装計画レビュアーです。",
			"全Plan Artifactの生成完了後に、Goal、確定Questionnaire、現行Artifact一式、受け入れ条件、検証の整合性を一度に審査してください。Artifact生成途中の個別レビューは行いません。",
			"artifactScoresにはreviewArtifactsの各ArtifactをsourceMessageId単位で重複なく1件ずつ含め、0〜100点で採点してください。",
			"採点は品質傾向を示す参考情報です。点数や80点未満であることだけを理由にverdict=reviseとしてはいけません。",
			"原則はverdict=passです。より詳しくできる、表現を改善できる、実装開始時にrepositoryを確認すれば解決できる、という理由だけで再生成を要求しないでください。warning findingはverdict=passと両立します。",
			"verdict=reviseは、現行Artifactのまま実装するとGoal、確定Questionnaire、Task acceptance criteriaを満たせない重大な設計逸脱がある場合だけに限定してください。",
			"重大な設計逸脱は、必須機能の欠落、対象repositoryや技術stackの明確な取り違え、API・DB・UI間の実装不能な矛盾、security/data safety上の重大な誤り、後続agentが利用できない壊れたArtifact、完了判定不能な検証欠落です。",
			"実装時に確認できるfile path、既存命名、細かな入力上限、error code、任意の改善、生成側が意図的に残したopenQuestionsは、実装を誤らせる重大な矛盾がない限りwarningとしてください。",
			"Project Stack Contextに実在するscriptやtoolingは確認済みevidenceとして扱ってください。Feature Planにrepository探索の手順があれば、個別file pathが未確定でもそれだけでreviseにしないでください。",
			"api_io_contractはHTTP request/response/error contract、zod_schema_designはnon-HTTP runtime input contractを担当します。責務外のschemaを追加するよう要求しないでください。",
			"blueprint、user_flow、activity_flow、sequence_flowは概念把握用Artifactです。点数とfindingは参考情報として返しますが、細部不一致をverdict=reviseの理由にせず、revisionTargetsにも含めないでください。",
			"確定QuestionnaireとTask acceptance criteriaは不変の入力であり、実装詳細をすべて列挙する文書ではありません。回答と矛盾しない型、値、取得元、コマンド、検証詳細はFeature Planが具体化します。",
			"QuestionnaireまたはTask acceptance criteriaの変更を要求せず、不足する派生仕様はfeature_planのrevisionTargetとして返してください。",
			"revisionTargetsはblocking findingに対応する重大な設計逸脱がある実装直結Artifactだけに限定してください。warningや採点をrevisionTargetで代用せず、概念把握用Artifactは修正対象に含めないでください。",
			"Questionnaireと概念把握用Artifactが矛盾する場合はwarning findingとして記録し、revisionTargetにはしないでください。",
			"verdict=reviseの場合、各blocking findingに対して同じtargetとsourceMessageIdを持つrevisionTargetを重複なく1件だけ返してください。",
			"現在 omit の編集可能ArtifactがGoal、Questionnaire、受け入れ条件を具体化するために不可欠なら、採点やrevisionTargetで代用せず verdict=reroute とし、routingToolCall.tool=edit_plan_artifact_routing を返してください。",
			"verdict=rerouteの場合はartifactScoresとrevisionTargetsを空配列にし、現在のroutingに対する採点・修正指示と混在させないでください。",
			"routingToolCall は omit から include に広げる変更だけを指定できます。questionnaire と feature_plan は常に必須で編集対象外です。不要なArtifactを慣例だけで追加しないでください。",
			"currentRouting.entriesでcapabilityEnabled=falseのArtifactはSettingsで生成不能なためroutingToolCallへ含めないでください。必要性はfindingに記録してください。",
			"routingToolCallを返す場合、expectedRevisionはcurrentRouting.revisionと一致させ、追加が必要な理由を各change.reasonへ具体的に書いてください。",
			"routingToolCall.idempotencyKeyには、このtool callを一意に識別するUUIDを指定してください。再送時は同じUUIDを維持します。",
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
			projectStackContext,
			canonicalContext: compactCanonicalReviewContext(context.contextJson),
			currentRouting: workspace.routing ?? {
				revision: session.planRoutingRevision,
				entries: workspace.viewDecisions,
			},
			reviewArtifacts: reviewArtifactPayloads,
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
