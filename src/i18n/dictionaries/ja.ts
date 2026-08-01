import { jaMissionPilot } from "../../composition/mission-pilot/i18n";
import { jaArtifact } from "./ja-artifact";
import { jaBlueprint } from "./ja-blueprint";
import { jaComposer } from "./ja-composer";
import { jaEvidenceCheck } from "./ja-evidenceCheck";
import { jaFolderBrowser } from "./ja-folderBrowser";
import { jaModelControls } from "./ja-modelControls";
import { jaOverview } from "./ja-overview";
import { jaProjectDetail } from "./ja-projectDetail";
import { jaQueue } from "./ja-queue";
import { jaReviewStatus } from "./ja-reviewStatus";
import { jaSettings } from "./ja-settings";
import { jaSidebar } from "./ja-sidebar";
import { jaTechStack } from "./ja-techStack";
import { jaThread } from "./ja-thread";
import { jaTimeline } from "./ja-timeline";
import { jaTodoPane } from "./ja-todoPane";

export const jaDictionary = {
	...jaOverview,
	...jaProjectDetail,
	...jaTechStack,
	...jaSidebar,
	...jaSettings,
	...jaComposer,
	...jaQueue,
	...jaThread,
	...jaTodoPane,
	...jaModelControls,
	...jaFolderBrowser,
	...jaArtifact,
	...jaReviewStatus,
	...jaEvidenceCheck,
	...jaBlueprint,
	...jaTimeline,
	...jaMissionPilot,
} as const;
