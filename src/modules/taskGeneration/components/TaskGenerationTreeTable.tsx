import { Loader2, Minus, Plus, Sparkles, Target, Zap } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/Button";
import type { Mission } from "../../../../shared/schemas/mission-planner.schema";
import type { MissionGoal } from "../../../../shared/schemas/task-generation.schema";
import {
	EmptyTableRow,
	IconActionButton,
	SectionHeading,
	SectionLabel,
} from "../../nightworkers/components/project-detail/ProjectDetailCommon";
import {
	controlStyle,
	panelStyle,
	primaryButtonStyle,
	subtleTextStyle,
	tableBorderStyle,
} from "../../nightworkers/components/project-detail/styles";
import type {
	ExpandedState,
	TaskGenerationTreeRow,
	UnifiedTaskCandidate,
} from "../types";
import { TaskGenerationTreeRowView } from "./TaskGenerationTreeRow";

export type TaskGenerationTreeTableProps = {
	rows: TaskGenerationTreeRow[];
	expanded: ExpandedState;
	selectedIds: string[];
	selectedCount: number;
	busy: boolean;
	busyAction: string | null;
	onAddGoal: () => void;
	onCreateSelected: () => void;
	onGenerateTaskCandidates: () => void;
	onExpandAll: () => void;
	onCollapseAll: () => void;
	onToggleGoal: (goalId: string) => void;
	onToggleMission: (missionId: string) => void;
	onToggleSelected: (candidateId: string) => void;
	onOpenGoal: (goal: MissionGoal | null) => void;
	onOpenMission: (mission: Mission) => void;
	onOpenCandidate: (candidate: UnifiedTaskCandidate) => void;
	onEditGoal: (goal: MissionGoal) => void;
	onToggleGoalActive: (goal: MissionGoal) => void;
	onDeleteGoal: (goal: MissionGoal) => void;
	onDecomposeMission: (mission: Mission) => void;
	onDeleteMission: (mission: Mission) => void;
	onCreateCandidate: (candidate: UnifiedTaskCandidate) => void;
	onDismissCandidate: (candidate: UnifiedTaskCandidate) => void;
};

export function TaskGenerationTreeTable({
	rows,
	expanded,
	selectedIds,
	selectedCount,
	busy,
	busyAction,
	onAddGoal,
	onCreateSelected,
	onGenerateTaskCandidates,
	onExpandAll,
	onCollapseAll,
	onToggleGoal,
	onToggleMission,
	onToggleSelected,
	onOpenGoal,
	onOpenMission,
	onOpenCandidate,
	onEditGoal,
	onToggleGoalActive,
	onDeleteGoal,
	onDecomposeMission,
	onDeleteMission,
	onCreateCandidate,
	onDismissCandidate,
}: TaskGenerationTreeTableProps) {
	const { t } = useTranslation();
	return (
		<section className="space-y-3">
			<SectionHeading
				icon={<Sparkles className="h-4 w-4" />}
				title={t("projectDetail.mission.treeTitle")}
			/>
			<div className="overflow-hidden border" style={panelStyle}>
				<div
					className="flex flex-wrap items-center justify-between gap-3 border-b p-3"
					style={tableBorderStyle}
				>
					<SectionLabel
						icon={<Target className="h-4 w-4" />}
						title={t("projectDetail.mission.candidates")}
					/>
					<div className="flex flex-wrap items-center justify-end gap-2">
						<div className="flex items-center gap-1">
							<IconActionButton
								label={t("projectDetail.mission.collapseAll")}
								onClick={onCollapseAll}
								disabled={rows.length === 0}
							>
								<Minus className="h-3.5 w-3.5" />
							</IconActionButton>
							<IconActionButton
								label={t("projectDetail.mission.expandAll")}
								onClick={onExpandAll}
								disabled={rows.length === 0}
							>
								<Plus className="h-3.5 w-3.5" />
							</IconActionButton>
						</div>
						<Button
							type="button"
							onClick={onAddGoal}
							disabled={busy}
							className="h-8 px-3 text-xs font-semibold"
							style={controlStyle}
						>
							<Target className="h-3.5 w-3.5" />
							{t("projectDetail.goals.add")}
						</Button>
						<Button
							type="button"
							onClick={onCreateSelected}
							disabled={busy || selectedCount === 0}
							className="h-8 px-3 text-xs font-semibold"
							style={controlStyle}
						>
							{t("projectDetail.mission.createTasks", { count: selectedCount })}
						</Button>
						<Button
							type="button"
							onClick={onGenerateTaskCandidates}
							disabled={busy}
							className="h-8 px-3 text-xs font-semibold"
							style={primaryButtonStyle}
						>
							{busyAction === "goal:generate-task-candidates" ? (
								<Loader2 className="h-3.5 w-3.5 animate-spin" />
							) : (
								<Zap className="h-3.5 w-3.5" />
							)}
							{t("projectDetail.mission.generate")}
						</Button>
					</div>
				</div>
				<div className="overflow-x-hidden overflow-y-visible">
					<table className="w-full table-fixed text-xs">
						<colgroup>
							<col className="w-14" />
							<col className="w-14" />
							<col />
							<col className="w-24" />
							<col className="w-20" />
							<col className="w-24" />
							<col className="w-24" />
							<col className="w-20" />
							<col className="w-20" />
							<col className="w-24" />
							<col className="w-[116px]" />
						</colgroup>
						<thead style={subtleTextStyle}>
							<tr>
								<th className="py-2 pl-4 text-left">
									{t("projectDetail.mission.open")}
								</th>
								<th className="py-2 text-left">
									{t("projectDetail.mission.select")}
								</th>
								<th className="py-2 text-left">
									{t("projectDetail.field.candidate")}
								</th>
								<th className="py-2 text-left">
									{t("projectDetail.field.kind")}
								</th>
								<th className="py-2 text-right">
									{t("projectDetail.field.status")}
								</th>
								<th className="py-2 text-right">
									{t("projectDetail.field.evalContribution")}
								</th>
								<th className="py-2 text-right">
									{t("projectDetail.field.tokenSize")}
								</th>
								<th className="py-2 text-right">
									{t("projectDetail.field.importance")}
								</th>
								<th className="py-2 text-right">
									{t("projectDetail.field.confidence")}
								</th>
								<th className="py-2 text-right">
									{t("projectDetail.field.complexity")}
								</th>
								<th className="py-2 pr-4 text-right">
									{t("projectDetail.field.actions")}
								</th>
							</tr>
						</thead>
						<tbody>
							{rows.length > 0 ? (
								rows.map((row) => (
									<TaskGenerationTreeRowView
										key={`${row.kind}:${row.id}`}
										row={row}
										expanded={expanded}
										selectedIds={selectedIds}
										busy={busy}
										onToggleGoal={onToggleGoal}
										onToggleMission={onToggleMission}
										onToggleSelected={onToggleSelected}
										onOpenGoal={onOpenGoal}
										onOpenMission={onOpenMission}
										onOpenCandidate={onOpenCandidate}
										onEditGoal={onEditGoal}
										onToggleGoalActive={onToggleGoalActive}
										onDeleteGoal={onDeleteGoal}
										onDecomposeMission={onDecomposeMission}
										onDeleteMission={onDeleteMission}
										onCreateCandidate={onCreateCandidate}
										onDismissCandidate={onDismissCandidate}
									/>
								))
							) : (
								<EmptyTableRow
									colSpan={11}
									message={t("projectDetail.empty.goals")}
								/>
							)}
						</tbody>
					</table>
				</div>
			</div>
		</section>
	);
}
