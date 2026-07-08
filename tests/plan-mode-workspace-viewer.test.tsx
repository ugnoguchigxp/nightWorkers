import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import "../src/i18n/setup";
import type { PlanModeWorkspace } from "../src/modules/nightworkers/types";
import { PlanModeWorkspaceViewer } from "../src/modules/planMode/PlanModeWorkspaceViewer";

function createDummyWorkspace(): PlanModeWorkspace {
	return {
		taskId: "task-1",
		repositoryId: "repo-1",
		generatedAt: "2026-07-08T00:00:00Z",
		featurePlanArtifacts: [
			{
				id: "fp-1",
				kind: "feature_plan",
				title: "Feature Plan Spec",
				sourceMessageId: "msg-1",
				createdAt: "2026-07-08T00:00:00Z",
			},
		],
		blueprintArtifacts: [],
		dataModelArtifacts: [],
		dedicatedViewArtifacts: [],
		questionnaireSessions: [],
		decisionReviews: [],
		implementationReferences: [],
	};
}

describe("PlanModeWorkspaceViewer", () => {
	it("renders plan mode workspace state and tabs", () => {
		const workspace = createDummyWorkspace();
		const markup = renderToStaticMarkup(
			<PlanModeWorkspaceViewer
				workspace={workspace}
				taskMessages={[]}
				isImplementationLocked={false}
				isTodoArtifactOpen={false}
				hasTodoArtifact={false}
				onAddToQueue={async () => undefined}
				onQueueSession={async () => undefined}
				onOpenTodoArtifact={() => undefined}
				startSessionAndFocusTodo={async () => undefined}
				queueActiveSessionAndFocusTodo={async () => undefined}
				addActiveSessionToQueue={async () => undefined}
			/>,
		);

		expect(markup).not.toContain("Plan Mode Workspace");
		expect(markup).toContain("Questionnaire");
	});
});
