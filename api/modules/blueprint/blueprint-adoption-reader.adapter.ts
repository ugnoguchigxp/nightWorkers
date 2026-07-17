import { registerBlueprintArtifactAdoptionReader } from "../agentsShare";
import { getBlueprintArtifactAdoption } from "./blueprint.repository";

registerBlueprintArtifactAdoptionReader(async (taskId, messageId) => {
	const adoption = await getBlueprintArtifactAdoption(taskId, messageId);
	return adoption ? { adopted: adoption.adopted } : null;
});
