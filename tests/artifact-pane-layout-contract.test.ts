import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const artifactPaneSource = readFileSync(
	new URL(
		"../src/modules/nightworkers/components/ArtifactPane.tsx",
		import.meta.url,
	),
	"utf8",
);

describe("ArtifactPane layout contract", () => {
	it("does not reserve a deferred loading column beside artifact content", () => {
		expect(artifactPaneSource).not.toContain("bodyRenderArtifactId");
		expect(artifactPaneSource).not.toContain("shouldDeferArtifactBody");

		const bodyStart = artifactPaneSource.indexOf(
			'<div className="flex min-h-0 flex-1" data-artifact-export-expand>',
		);
		const contentStart = artifactPaneSource.indexOf(
			'className="min-w-0 flex-1 overflow-hidden bg-[#1e1e2e]"',
			bodyStart,
		);
		const leadingColumnSource = artifactPaneSource.slice(
			bodyStart,
			contentStart,
		);

		expect(bodyStart).toBeGreaterThanOrEqual(0);
		expect(contentStart).toBeGreaterThan(bodyStart);
		expect(leadingColumnSource).not.toContain('t("artifact.loading")');
	});
});
