import {
	buildVerificationEvidenceHistory,
	type VerificationEvidenceHistoryContext,
	type VerificationEvidenceObservation,
} from "../../codingAgent";
import type { ActivityEvent, TaskEvent } from "../types";
import { getCodexToolCardModel } from "./ThreadTimelineCodexToolCard";
import { asRecord, toMs } from "./ThreadTimelineEventModel";

type VerificationTimelineEvent = ActivityEvent | TaskEvent;

export function buildChatVerificationEvidenceHistory(
	events: VerificationTimelineEvent[],
): Map<string, VerificationEvidenceHistoryContext> {
	const observations = [...events]
		.sort(compareVerificationTimelineEvents)
		.flatMap((event): VerificationEvidenceObservation[] => {
			const card = getCodexToolCardModel(event);
			if (isCodeChangeTimelineEvent(event, card)) {
				return [
					{
						id: event.id,
						occurredAt: verificationTimelineEventTime(event),
						kind: "code_change",
					},
				];
			}
			if (!card?.verification) return [];
			return [
				{
					id: event.id,
					occurredAt: verificationTimelineEventTime(event),
					kind: "verification",
					verification: {
						state: card.verification.state,
						full: card.verification.checkKind === "verify",
						affectsFreshness:
							card.verification.checkKind !== "completion_check",
					},
				},
			];
		});
	return buildVerificationEvidenceHistory(observations);
}

function isCodeChangeTimelineEvent(
	event: VerificationTimelineEvent,
	card: ReturnType<typeof getCodexToolCardModel>,
) {
	if (card?.codexKind === "edit_command" || card?.codexKind === "file_change")
		return true;
	if ("kind" in event && event.kind.startsWith("file.")) return true;
	const payload = asRecord(event.payloadJson);
	const runEvent = asRecord(payload.runEvent);
	return (
		("eventType" in event && event.eventType === "git.diff_collected") ||
		runEvent.type === "git.diff_collected"
	);
}

function compareVerificationTimelineEvents(
	left: VerificationTimelineEvent,
	right: VerificationTimelineEvent,
) {
	const leftSeq = typeof left.seq === "number" ? left.seq : 0;
	const rightSeq = typeof right.seq === "number" ? right.seq : 0;
	return (
		leftSeq - rightSeq ||
		toMs(verificationTimelineEventTime(left)) -
			toMs(verificationTimelineEventTime(right))
	);
}

function verificationTimelineEventTime(event: VerificationTimelineEvent) {
	return "timestamp" in event && event.timestamp
		? event.timestamp
		: event.createdAt;
}
