export type BlueprintArtifactAdoption = { adopted: boolean };
export type BlueprintArtifactAdoptionReader = (
	taskId: string,
	messageId: string,
) => Promise<BlueprintArtifactAdoption | null>;

let reader: BlueprintArtifactAdoptionReader | null = null;

export function registerBlueprintArtifactAdoptionReader(
	nextReader: BlueprintArtifactAdoptionReader,
) {
	reader = nextReader;
	return () => {
		if (reader === nextReader) reader = null;
	};
}

export async function readBlueprintArtifactAdoption(
	taskId: string,
	messageId: string,
) {
	return reader?.(taskId, messageId) ?? null;
}
