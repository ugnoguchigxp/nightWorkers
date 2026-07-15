import { z } from "@hono/zod-openapi";
import type { MissionPilotRuntimeKind } from "../../../../shared/schemas/mission-pilot-agent.schema";
import {
	readApplicationSetting,
	writeApplicationSetting,
} from "../../../services/settings/application-settings-store";

const settingsSchema = z.object({
	version: z.literal(1),
	defaultRuntimeKind: z.enum(["legacy", "agent"]),
});

export type MissionPilotRuntimeSettings = z.infer<typeof settingsSchema>;

const DEFAULT_SETTINGS: MissionPilotRuntimeSettings = {
	version: 1,
	defaultRuntimeKind: "agent",
};

export function readMissionPilotRuntimeSettings(): MissionPilotRuntimeSettings {
	const parsed = settingsSchema.safeParse(
		readApplicationSetting("mission-pilot-runtime"),
	);
	return parsed.success ? parsed.data : DEFAULT_SETTINGS;
}

export function readMissionPilotDefaultRuntimeKind(): MissionPilotRuntimeKind {
	return readMissionPilotRuntimeSettings().defaultRuntimeKind;
}

export async function writeMissionPilotDefaultRuntimeKind(
	defaultRuntimeKind: MissionPilotRuntimeKind,
) {
	return writeApplicationSetting("mission-pilot-runtime", {
		version: 1,
		defaultRuntimeKind,
	} satisfies MissionPilotRuntimeSettings);
}
