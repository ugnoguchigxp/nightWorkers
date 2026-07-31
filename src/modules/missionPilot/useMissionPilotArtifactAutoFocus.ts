import { useEffect, useRef } from "react";
import type { WorkbenchRouteState } from "../nightworkers/routing/workbench-route-state";
import type {
	Task,
	TaskRun,
	WorkbenchArtifactRef,
} from "../nightworkers/types";
import { resolveMissionPilotArtifactFocus } from "./missionPilotArtifactFocus";
import { useMissionPilotControl } from "./missionPilotQueries";

export function useMissionPilotArtifactAutoFocus(input: {
	activeSession: Task | null;
	activeArtifactRefs: WorkbenchArtifactRef[];
	latestRun?: TaskRun;
	routeState: WorkbenchRouteState;
	onNavigate: (routeState: WorkbenchRouteState) => void;
}) {
	const lastAutoFocusKeyRef = useRef<string | null>(null);
	const { data: missionPilot } = useMissionPilotControl(
		input.activeSession?.id ?? "",
	);
	const target = resolveMissionPilotArtifactFocus({
		...input,
		missionPilot: missionPilot ?? null,
	});

	useEffect(() => {
		const sessionId = input.activeSession?.id;
		if (!target || !sessionId) {
			lastAutoFocusKeyRef.current = null;
			return;
		}
		if (lastAutoFocusKeyRef.current === target.key) return;
		lastAutoFocusKeyRef.current = target.key;
		if (target.kind === "plan_mode_workspace") {
			input.onNavigate({
				kind: "session",
				sessionId,
				artifact: { kind: "plan_mode_workspace", tab: target.tab },
			});
			return;
		}
		input.onNavigate({
			kind: "session",
			sessionId,
			artifact: { kind: target.kind },
		});
	}, [input.activeSession?.id, input.onNavigate, target]);
}
