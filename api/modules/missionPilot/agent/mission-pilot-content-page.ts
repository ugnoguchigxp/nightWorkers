import { contentDigest, sliceUtf8ContentPage } from "../../agentsShare";

export function sliceMissionPilotUtf8Page(
	content: string,
	options: { cursor?: number; maxChars?: number; maxBytes?: number } = {},
) {
	return sliceUtf8ContentPage(content, options);
}

export const missionPilotDigest = contentDigest;
