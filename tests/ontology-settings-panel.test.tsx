import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import "../src/i18n/setup";
import { SettingsOntologyPanel } from "../src/modules/ontology";

const project = {
	id: "11111111-1111-4111-8111-111111111111",
	name: "large-project",
	localPath: "/tmp/large-project",
	branch: "main",
	allowed: true,
	queueEnabled: true,
	maxConcurrentSessions: 1,
	createdAt: "2026-07-10T00:00:00.000Z",
	updatedAt: "2026-07-10T00:00:00.000Z",
};

function render(sourceLoc: number | null, eligible: boolean) {
	return renderToStaticMarkup(
		<SettingsOntologyPanel
			activeProject={project}
			value={{
				settings: {
					ontologyToolsEnabled: true,
					securityMaxIterations: 3,
				},
				securityOracle: { alwaysEnabled: true, configured: true },
				ontology: {
					thresholdSourceLoc: 50_000,
					measuredSourceLoc: sourceLoc,
					eligible,
					effectiveEnabled: eligible,
					toolProfile: eligible ? "ontology_extended" : "standard",
					reason: eligible ? "enabled" : "below_threshold",
					scannedAt: "2026-07-10T00:00:00.000Z",
				},
			}}
			message=""
			messageStatus="idle"
			isSaving={false}
			onChange={vi.fn()}
			onSave={vi.fn()}
		/>,
	);
}

describe("SettingsOntologyPanel", () => {
	it("shows Security Oracle as always on and disables ontology below threshold", () => {
		const markup = render(49_999, false);
		expect(markup).toContain("Security Oracle");
		expect(markup).toContain("standard");
		expect(markup).toContain("disabled");
		expect(markup).toContain("49,999");
	});

	it("exposes the ontology toggle at exactly 50,000 LOC", () => {
		const markup = render(50_000, true);
		expect(markup).toContain("ontology_extended");
		expect(markup).not.toMatch(/type="checkbox"[^>]*disabled/);
		expect(markup).toContain("50,000");
	});
});
