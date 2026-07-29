import type { ArtifactExportDescriptor } from "../nightworkers/artifactExport";
import type {
	ActivityArtifact,
	TaskMessage,
	WorkbenchArtifactContext,
} from "../nightworkers/types";
import type { PlanWorkspaceTab } from "../specification";

export type PlanModeWorkspaceViewerProps = {
	sessionId: string | null;
	taskMessages: TaskMessage[];
	activityArtifacts?: ActivityArtifact[];
	initialTab?: PlanWorkspaceTab;
	onTabChange?: (tab: PlanWorkspaceTab) => void;
	onArtifactContextChange?: (context: WorkbenchArtifactContext | null) => void;
	onExportDescriptorChange?: (
		descriptor: ArtifactExportDescriptor | null,
	) => void;
	onQueueSession?: () => Promise<void>;
	onAddToQueue?: () => Promise<void>;
	isImplementationLocked?: boolean;
};
