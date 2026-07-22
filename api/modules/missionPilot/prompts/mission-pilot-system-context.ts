import type { MissionPilotAuthorization } from "../../../../shared/modules/missionPilot";
import {
	bindSystemContextTextCatalog,
	type SystemContextP,
} from "../../../systemContexts/catalog";

export function getMissionPilotPlanSystemContext(
	p: SystemContextP = bindSystemContextTextCatalog().p,
) {
	return p("missionPilot.plan-system", {});
}

export function getMissionPilotPlanReviewThresholdContext(
	p: SystemContextP = bindSystemContextTextCatalog().p,
) {
	return p("missionPilot.plan-review-threshold", {});
}

export function getMissionPilotPlanEntryContext(
	p: SystemContextP = bindSystemContextTextCatalog().p,
) {
	return p("missionPilot.plan-entry", {});
}

export function getMissionPilotSystemContext(
	p: SystemContextP = bindSystemContextTextCatalog().p,
) {
	return p("missionPilot.system-base", {
		baseSystem: p("missionPilot.base-system", {}).trimEnd(),
		planEntry: getMissionPilotPlanEntryContext(p).trimEnd(),
		baseSystemSuffix: p("missionPilot.base-system-suffix", {}).trimEnd(),
	});
}

export function applyCurrentMissionPilotSystemContext(
	systemContext: string,
	p: SystemContextP = bindSystemContextTextCatalog().p,
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
	const { p } = bindSystemContextTextCatalog();
	const pushKey =
		input.pushPolicy === "allowed"
			? "missionPilot.push-allowed"
			: "missionPilot.push-denied";
	return p("missionPilot.system-with-push", {
		systemBase: getMissionPilotSystemContext(p).trimEnd(),
		pushInstruction: p(pushKey, {}).trimEnd(),
	});
}
