import { enArtifact } from "./en-artifact";
import { enBlueprint } from "./en-blueprint";
import { enComposer } from "./en-composer";
import { enFolderBrowser } from "./en-folderBrowser";
import { enMissionPilot } from "./en-missionPilot";
import { enModelControls } from "./en-modelControls";
import { enOverview } from "./en-overview";
import { enProjectDetail } from "./en-projectDetail";
import { enQueue } from "./en-queue";
import { enReviewStatus } from "./en-reviewStatus";
import { enSettings } from "./en-settings";
import { enSidebar } from "./en-sidebar";
import { enTechStack } from "./en-techStack";
import { enTestMode } from "./en-testMode";
import { enThread } from "./en-thread";
import { enTimeline } from "./en-timeline";
import { enTodoPane } from "./en-todoPane";

export const enDictionary = {
	...enOverview,
	...enProjectDetail,
	...enTechStack,
	...enSidebar,
	...enSettings,
	...enComposer,
	...enQueue,
	...enThread,
	...enTodoPane,
	...enModelControls,
	...enFolderBrowser,
	...enArtifact,
	...enReviewStatus,
	...enTestMode,
	...enBlueprint,
	...enTimeline,
	...enMissionPilot,
} as const;
