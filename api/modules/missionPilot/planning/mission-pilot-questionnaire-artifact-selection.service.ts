import { missionPilotThoughtTrace } from "../../nightworkers/nightworkers.trace-provenance";
import { selectQuestionnaireArtifactRouting } from "../../questionnaire/questionnaire-artifact-selection.service";
import { missionPilotArtifactProviderExecutionPolicy } from "../adapters/mission-pilot-provider.adapter";

export async function selectQuestionnaireArtifacts(
	input: Parameters<typeof selectQuestionnaireArtifactRouting>[0] & {
		sessionId: string;
	},
) {
	return selectQuestionnaireArtifactRouting(input, {
		scope: "unresolved_omissions",
		role: "mission_pilot",
		executionPolicy: missionPilotArtifactProviderExecutionPolicy,
		usageTrace: missionPilotThoughtTrace({ sessionId: input.sessionId }),
	});
}
