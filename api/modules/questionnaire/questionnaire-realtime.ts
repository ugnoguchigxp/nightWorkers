import { nightWorkersRealtimeBroker } from "../../services/realtime/nightworkers-ws";
import { registerQuestionnaireStateChangedListener } from "./questionnaire-events";
import { buildQuestionnaireStateChange } from "./questionnaire-state-change";

let questionnaireRealtimeRegistered = false;

export function initializeQuestionnaireRealtime() {
	if (questionnaireRealtimeRegistered) return;
	questionnaireRealtimeRegistered = true;
	registerQuestionnaireStateChangedListener((session) => {
		nightWorkersRealtimeBroker.publish(session.taskId, {
			type: "questionnaire.state_changed",
			payload: buildQuestionnaireStateChange(session),
		});
	});
}
