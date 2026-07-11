import { Loader2, Sparkles, Trash2, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/Button";
import type { Mission } from "../../../../shared/schemas/mission-planner.schema";
import type { MissionGoal } from "../../../../shared/schemas/task-generation.schema";
import { MissionPilotCreateButton } from "../../missionPilot";
import {
	IconActionButton,
	KpiTile,
} from "../../nightworkers/components/project-detail/ProjectDetailCommon";
import {
	controlStyle,
	mutedTextStyle,
	panelStyle,
	primaryButtonStyle,
} from "../../nightworkers/components/project-detail/styles";
import { isMissionDeleteInProgress } from "../taskGenerationModel";
import type { UnifiedTaskCandidate } from "../types";
import { DrawerSection } from "./TaskGenerationDialogSection";

export function MissionCandidateModal({
	mission,
	goals,
	taskCandidateCount = 0,
	busy,
	onClose,
	onDecompose,
	onDelete,
}: {
	mission: Mission;
	goals: MissionGoal[];
	taskCandidateCount?: number;
	busy: boolean;
	onClose: () => void;
	onDecompose: (mission: Mission) => void;
	onDelete: (mission: Mission) => void;
}) {
	const { t } = useTranslation();
	const canDeleteMission =
		!isMissionDeleteInProgress(mission.status) && taskCandidateCount === 0;
	const sourceGoals = mission.sourceGoalIds
		.map((goalId) => goals.find((goal) => goal.id === goalId))
		.filter((goal): goal is MissionGoal => Boolean(goal));
	return (
		<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
			<div
				role="dialog"
				aria-modal="true"
				aria-labelledby="task-generation-mission-detail-title"
				className="flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden border"
				style={panelStyle}
			>
				<div className="flex shrink-0 items-start justify-between gap-3 p-4 pb-0">
					<div className="min-w-0">
						<div
							id="task-generation-mission-detail-title"
							className="text-base font-bold"
						>
							{mission.title}
						</div>
						<div className="mt-1 text-xs" style={mutedTextStyle}>
							{t(`projectDetail.mission.status.${mission.status}`, {
								defaultValue: mission.status,
							})}
						</div>
					</div>
					<IconActionButton
						label={t("projectDetail.mission.close")}
						onClick={onClose}
						disabled={busy}
					>
						<X className="h-3.5 w-3.5" />
					</IconActionButton>
				</div>
				<div className="nightworkers-scrollbar min-h-0 overflow-y-auto px-4 pb-4">
					<DrawerSection
						title={t("projectDetail.mission.goalText")}
						body={mission.goalText}
					/>
					{mission.statusReason ? (
						<DrawerSection
							title={t("projectDetail.mission.rationale")}
							body={mission.statusReason}
						/>
					) : null}
					{mission.nonGoals.length > 0 ? (
						<DrawerSection
							title={t("projectDetail.mission.nonGoals")}
							body={mission.nonGoals.join("\n")}
						/>
					) : null}
					<section className="mt-4">
						<div className="text-xs font-bold">
							{t("projectDetail.mission.linkedGoals")}
						</div>
						<div className="mt-2 space-y-2">
							{sourceGoals.length > 0 ? (
								sourceGoals.map((goal) => (
									<div
										key={goal.id}
										className="border p-2 text-xs"
										style={controlStyle}
									>
										<div className="font-semibold">{goal.title}</div>
										<div className="mt-1" style={mutedTextStyle}>
											{goal.goalText}
										</div>
									</div>
								))
							) : (
								<div className="text-xs" style={mutedTextStyle}>
									{t("projectDetail.mission.noLinkedGoal")}
								</div>
							)}
						</div>
					</section>
					<div className="mt-4 flex justify-end gap-2">
						<Button
							type="button"
							onClick={() => onDelete(mission)}
							disabled={busy || !canDeleteMission}
							title={
								taskCandidateCount > 0
									? t("projectDetail.mission.deleteMissionBlockedByChildren")
									: undefined
							}
							style={controlStyle}
						>
							<Trash2 className="h-3.5 w-3.5" />
							{t("projectDetail.mission.deleteMission")}
						</Button>
						<Button
							type="button"
							onClick={onClose}
							disabled={busy}
							style={controlStyle}
						>
							{t("projectDetail.mission.close")}
						</Button>
						<Button
							type="button"
							onClick={() => onDecompose(mission)}
							disabled={
								busy ||
								mission.status === "review_pending" ||
								mission.status === "active"
							}
							style={primaryButtonStyle}
						>
							{busy ? (
								<Loader2 className="h-3.5 w-3.5 animate-spin" />
							) : (
								<Sparkles className="h-3.5 w-3.5" />
							)}
							{t("projectDetail.mission.decomposeToTaskCandidates")}
						</Button>
					</div>
				</div>
			</div>
		</div>
	);
}

export function TaskCandidateDetailModal({
	candidate,
	goals,
	busy,
	missionPilotBusy,
	onClose,
	onCreateTask,
	onCreateMissionPilot,
	onDismiss,
}: {
	candidate: UnifiedTaskCandidate;
	goals: MissionGoal[];
	busy: boolean;
	missionPilotBusy: boolean;
	onClose: () => void;
	onCreateTask: (candidate: UnifiedTaskCandidate) => void;
	onCreateMissionPilot: (candidate: UnifiedTaskCandidate) => void;
	onDismiss: (candidate: UnifiedTaskCandidate) => void;
}) {
	const { t } = useTranslation();
	const constraintGoalLabels = candidate.constraintGoalIds.map((goalId) => {
		const goal = goals.find((item) => item.id === goalId);
		return goal?.title ?? goalId.slice(0, 8);
	});
	return (
		<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
			<div
				role="dialog"
				aria-modal="true"
				aria-labelledby="task-generation-candidate-detail-title"
				className="flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden border"
				style={panelStyle}
			>
				<div className="flex shrink-0 items-start justify-between gap-3 p-4 pb-0">
					<div className="min-w-0">
						<div
							id="task-generation-candidate-detail-title"
							className="text-base font-bold"
						>
							{candidate.title}
						</div>
						<div className="mt-1 text-xs" style={mutedTextStyle}>
							{candidate.goalTitle ||
								candidate.goalId ||
								t("projectDetail.mission.noLinkedGoal")}
						</div>
					</div>
					<IconActionButton
						label={t("projectDetail.mission.close")}
						onClick={onClose}
						disabled={busy}
					>
						<X className="h-3.5 w-3.5" />
					</IconActionButton>
				</div>
				<div className="nightworkers-scrollbar min-h-0 overflow-y-auto px-4 pb-4">
					<div className="mt-4 grid gap-2 text-xs sm:grid-cols-2">
						<KpiTile
							label={t("projectDetail.field.kind")}
							value={t(
								`projectDetail.mission.candidateKind.${candidate.candidateKind}`,
							)}
							sub={t("projectDetail.mission.candidateKindSub")}
						/>
						<KpiTile
							label={t("projectDetail.mission.primaryModule")}
							value={candidate.moduleRouting.primaryModule ?? "—"}
							sub={
								candidate.moduleRouting.confidencePercent > 0
									? `${candidate.moduleRouting.confidencePercent}%`
									: "—"
							}
						/>
					</div>
					{candidate.moduleRouting.secondaryModules.length > 0 ||
					candidate.moduleRouting.reason ||
					candidate.constraintGoalIds.length > 0 ? (
						<div className="mt-4 border p-2 text-xs" style={controlStyle}>
							{candidate.moduleRouting.secondaryModules.length > 0 ? (
								<div>
									<span className="font-semibold">
										{t("projectDetail.mission.secondaryModules")}:
									</span>{" "}
									{candidate.moduleRouting.secondaryModules.join(", ")}
								</div>
							) : null}
							{candidate.constraintGoalIds.length > 0 ? (
								<div className="mt-1">
									<span className="font-semibold">
										{t("projectDetail.mission.constraintGoals")}:
									</span>{" "}
									{constraintGoalLabels.join(", ")}
								</div>
							) : null}
							{candidate.moduleRouting.reason ? (
								<div className="mt-1" style={mutedTextStyle}>
									{candidate.moduleRouting.reason}
								</div>
							) : null}
						</div>
					) : null}
					<DrawerSection
						title={t("projectDetail.mission.summary")}
						body={candidate.summary}
					/>
					<DrawerSection
						title={t("projectDetail.mission.rationale")}
						body={candidate.rationale}
					/>
					<DrawerSection
						title={t("projectDetail.mission.taskPrompt")}
						body={candidate.taskPrompt}
					/>
					<DrawerSection
						title={t("projectDetail.mission.acceptanceCriteria")}
						body={candidate.acceptanceCriteria}
					/>
					<DrawerSection
						title={t("projectDetail.mission.verificationPlan")}
						body={candidate.verificationPlan}
					/>
					{candidate.planModeOpenQuestions.length > 0 ? (
						<section className="mt-4">
							<div className="text-xs font-bold">
								{t("projectDetail.mission.planModeOpenQuestions")}
							</div>
							<ul className="mt-2 space-y-1 text-xs" style={mutedTextStyle}>
								{candidate.planModeOpenQuestions.map((item) => (
									<li key={item}>- {item}</li>
								))}
							</ul>
						</section>
					) : null}
					<div className="mt-4">
						<div className="text-xs font-bold">
							{t("projectDetail.mission.evidence")}
						</div>
						<div className="mt-2 space-y-2">
							{candidate.evidence.length > 0 ? (
								candidate.evidence.map((item) => (
									<div
										key={`${item.source}-${item.label}-${item.value}`}
										className="border p-2 text-xs"
										style={controlStyle}
									>
										<div className="font-semibold">{item.label}</div>
										<div className="mt-1" style={mutedTextStyle}>
											{item.value}
										</div>
									</div>
								))
							) : (
								<div className="text-xs" style={mutedTextStyle}>
									—
								</div>
							)}
						</div>
					</div>
					<div className="mt-4 grid grid-cols-2 gap-2 text-xs">
						<KpiTile
							label={t("projectDetail.field.importance")}
							value={
								candidate.importancePercent === null
									? "—"
									: `${candidate.importancePercent}%`
							}
							sub={t("projectDetail.mission.importanceSub")}
						/>
						<KpiTile
							label={t("projectDetail.field.confidence")}
							value={
								candidate.confidencePercent === null
									? "—"
									: `${candidate.confidencePercent}%`
							}
							sub={t("projectDetail.mission.confidenceSub")}
						/>
					</div>
					<div className="mt-4 flex justify-end gap-2">
						<Button
							type="button"
							onClick={() => onDismiss(candidate)}
							disabled={busy || candidate.status !== "candidate"}
							style={controlStyle}
						>
							{t("projectDetail.mission.deleteCandidate")}
						</Button>
						<MissionPilotCreateButton
							disabled={busy || candidate.status !== "candidate"}
							busy={missionPilotBusy}
							onClick={() => onCreateMissionPilot(candidate)}
						/>
						<Button
							type="button"
							onClick={() => onCreateTask(candidate)}
							disabled={busy || candidate.status !== "candidate"}
							style={primaryButtonStyle}
						>
							{t("projectDetail.mission.createSingleTask")}
						</Button>
					</div>
				</div>
			</div>
		</div>
	);
}
