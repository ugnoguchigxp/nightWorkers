import type { MissionPilotAuthorization } from "../../../../shared/modules/missionPilot";
import {
	p as defaultP,
	type SystemContextP,
} from "../../../systemContexts/catalog";

export function getMissionPilotPlanSystemContext(p: SystemContextP = defaultP) {
	return p("missionPilot.plan-system", {});
}

export function getMissionPilotPlanReviewThresholdContext(
	p: SystemContextP = defaultP,
) {
	return p("missionPilot.plan-review-threshold", {});
}

export function getMissionPilotPlanEntryContext(p: SystemContextP = defaultP) {
	return p("missionPilot.plan-entry", {});
}

export function getMissionPilotSystemContext(p: SystemContextP = defaultP) {
	return p("missionPilot.system-base", {
		baseSystem: p("missionPilot.base-system", {}).trimEnd(),
		planEntry: getMissionPilotPlanEntryContext(p).trimEnd(),
		baseSystemSuffix: p("missionPilot.base-system-suffix", {}).trimEnd(),
	});
}

export function applyCurrentMissionPilotSystemContext(
	systemContext: string,
	p: SystemContextP = defaultP,
) {
	const planEntry = getMissionPilotPlanEntryContext(p);
	return systemContext.includes(planEntry.trim())
		? p("missionPilot.stored-context-current", {
				storedContext: systemContext.trimEnd(),
			})
		: p("missionPilot.stored-context-upgrade", {
				storedContext: systemContext.trimEnd(),
				planEntry: planEntry.trimEnd(),
			});
}

export function buildMissionPilotSystemContext(
	input: {
		authorization?: MissionPilotAuthorization | null;
		pushPolicy?: string | null;
	} = {},
) {
	const pushKey =
		input.pushPolicy === "allowed"
			? "missionPilot.push-allowed"
			: "missionPilot.push-denied";
	return defaultP("missionPilot.system-with-push", {
		systemBase: getMissionPilotSystemContext(defaultP).trimEnd(),
		pushInstruction: defaultP(pushKey, {}).trimEnd(),
	});
}
