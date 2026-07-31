import type { DesignQuestionnaireSession } from "../contracts";
import { callMissionPilotHost } from "./host-bindings";

export const buildQuestionnaireStateChange = (...args: unknown[]) =>
	callMissionPilotHost("buildQuestionnaireStateChange", ...args);
export function registerQuestionnaireStateChangedListener(
	listener: (questionnaire: DesignQuestionnaireSession) => void | Promise<void>,
) {
	return callMissionPilotHost(
		"registerQuestionnaireStateChangedListener",
		listener,
	);
}
export const getDesignQuestionnaireSession = (...args: unknown[]) =>
	callMissionPilotHost("getDesignQuestionnaireSession", ...args);
export const createDesignQuestionnaireQuestionSet = (...args: unknown[]) =>
	callMissionPilotHost("createDesignQuestionnaireQuestionSet", ...args);
export const createDesignQuestionnaireSession = (...args: unknown[]) =>
	callMissionPilotHost("createDesignQuestionnaireSession", ...args);
export const updateDesignQuestionnaireSessionStatus = (...args: unknown[]) =>
	callMissionPilotHost("updateDesignQuestionnaireSessionStatus", ...args);
