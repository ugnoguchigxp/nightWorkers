import type { Repository, Task, WorkbenchSessionView } from "../../types";

export type ProjectDetailScreenProps = {
	project: Repository;
	sessionViews: WorkbenchSessionView[];
	activeTab: ProjectDetailTab;
	onActiveTabChange: (tab: ProjectDetailTab) => void;
	onOpenProjectOverview: () => void;
	onOpenSession: (sessionId: string) => void;
	onEvaluationTasksCreated?: (tasks: Task[]) => Promise<void> | void;
	onMissionTaskCandidatesCreated?: (tasks: Task[]) => Promise<void> | void;
};

export type ProjectDetailTab =
	| "overview"
	| "mission"
	| "evaluation"
	| "quality"
	| "stack"
	| "worktrees";

export const projectDetailTabs = [
	{ id: "overview", labelKey: "projectDetail.tab.overview" },
	{ id: "mission", labelKey: "projectDetail.tab.mission" },
	{ id: "evaluation", labelKey: "projectDetail.tab.evaluation" },
	{ id: "quality", labelKey: "projectDetail.tab.quality" },
	{ id: "stack", labelKey: "projectDetail.tab.stack" },
	{ id: "worktrees", labelKey: "projectDetail.tab.worktrees" },
] satisfies { id: ProjectDetailTab; labelKey: string }[];
