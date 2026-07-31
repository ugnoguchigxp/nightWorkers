import type { MissionPilotPrincipal } from "./principal";

export type MissionPilotProvenance = {
	principal: MissionPilotPrincipal;
	sourceTaskId: string;
	sourceEventId: string;
	idempotencyKey: string;
	occurredAt: string;
};
