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

function render(sourceLoc: number | null, securityOracleEnabled = true) {
	const eligible = sourceLoc !== null && sourceLoc >= 50_000;
	const securityEffective = eligible && securityOracleEnabled;
	return renderToStaticMarkup(
		<SettingsOntologyPanel
			activeProject={project}
			value={{
				settings: {
					securityOracleEnabled,
					ontologyToolsEnabled: true,
					securityMaxIterations: 3,
				},
				eligibility: {
					thresholdSourceLoc: 50_000,
					measuredSourceLoc: sourceLoc,
					eligible,
					reason: eligible ? "enabled" : "below_threshold",
					scannedAt: "2026-07-10T00:00:00.000Z",
				},
				securityOracle: {
					configured: true,
					effectiveEnabled: securityEffective,
					reason: securityEffective
						? "enabled"
						: eligible
							? "user_disabled"
							: "below_threshold",
				},
				ontology: {
					effectiveEnabled: securityEffective,
					toolProfile: securityEffective ? "ontology_extended" : "standard",
					reason: securityEffective
						? "enabled"
						: eligible
							? "oracle_disabled"
							: "below_threshold",
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
	it("shows both controls as disabled below the threshold", () => {
		const markup = render(49_999);
		expect(markup).toContain("Security Oracle: OFF");
		expect(markup).toContain("standard");
		expect(markup.match(/type="checkbox"[^>]*disabled/g)).toHaveLength(2);
		expect(markup).toContain("49,999");
	});

	it("exposes both controls at exactly 50,000 LOC", () => {
		const markup = render(50_000);
		expect(markup).toContain("Security Oracle: ON");
		expect(markup).toContain("ontology_extended");
		expect(markup).not.toMatch(/type="checkbox"[^>]*disabled/);
	});

	it("disables the ontology control while Security Oracle is off", () => {
		const markup = render(50_000, false);
		expect(markup).toContain("Security Oracle: OFF");
		expect(markup.match(/type="checkbox"[^>]*disabled/g)).toHaveLength(1);
		expect(markup).toContain("Security Oracle が OFF");
	});
});
