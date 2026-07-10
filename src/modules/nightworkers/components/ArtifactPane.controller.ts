import { useEffect, useRef } from "react";
import type { PlanWorkspaceTab } from "../../specification";
import type { TestModeWorkflowStepView } from "../testModeWorkflowView";

export type ProjectArtifactMode = "tree" | "diff";

export function resolveArtifactWorkspaceInitialTab(
	value: unknown,
): PlanWorkspaceTab | undefined {
	const legacyDataModelTab = ["db", "design"].join("-");
	if (value === "design-doc" || value === "specification")
		return "feature-plan";
	if (value === "specification-status") return "status";
	if (value === "blueprints") return "blueprint";
	if (value === legacyDataModelTab) return "data-model";
	return value === "feature-plan" ||
		value === "blueprint" ||
		value === "data-model" ||
		value === "user-flow" ||
		value === "api-io-contract" ||
		value === "activity-flow" ||
		value === "sequence-flow" ||
		value === "zod-schema-design" ||
		value === "questionnaire" ||
		value === "status"
		? value
		: undefined;
}

export function parseArtifactContentJson(
	content: string | null | undefined,
): unknown {
	if (!content?.trim()) return null;
	try {
		return JSON.parse(content);
	} catch {
		return null;
	}
}

export function asArtifactRecord(value: unknown): Record<string, unknown> {
	return value && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: {};
}

export function cloneTestModeWorkflowSteps(steps: TestModeWorkflowStepView[]) {
	return steps.map((step) => ({ ...step }));
}

export function testModeWorkflowSignature(steps: TestModeWorkflowStepView[]) {
	return steps.map((step) => `${step.id}:${step.status}`).join("|");
}

export function isMockBlueprintCandidate(value: unknown) {
	return asArtifactRecord(value).artifactKind === "mock_blueprint";
}

export function useProjectArtifactRefresh(input: {
	isProjectTreeVisible: boolean;
	mode: ProjectArtifactMode;
	onRefreshFiles: () => Promise<void>;
	onRefreshDiff: () => Promise<void>;
}) {
	const refreshFilesRef = useRef(input.onRefreshFiles);
	const refreshDiffRef = useRef(input.onRefreshDiff);
	useEffect(() => {
		refreshFilesRef.current = input.onRefreshFiles;
	}, [input.onRefreshFiles]);
	useEffect(() => {
		refreshDiffRef.current = input.onRefreshDiff;
	}, [input.onRefreshDiff]);
	useEffect(() => {
		if (!input.isProjectTreeVisible) return;
		const refresh = () => {
			if (document.visibilityState === "hidden") return;
			if (input.mode === "diff") {
				void refreshDiffRef.current();
				return;
			}
			void refreshFilesRef.current();
		};
		refresh();
		window.addEventListener("focus", refresh);
		document.addEventListener("visibilitychange", refresh);
		return () => {
			window.removeEventListener("focus", refresh);
			document.removeEventListener("visibilitychange", refresh);
		};
	}, [input.isProjectTreeVisible, input.mode]);
}
