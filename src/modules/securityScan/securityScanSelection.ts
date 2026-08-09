import type {
	SecurityScanCapabilities,
	SecurityScanSelection,
	SecurityScanTarget,
} from "../../../shared/schemas/security-scan.schema";

export function preferredSecurityScanSelection(
	capabilities: SecurityScanCapabilities,
): {
	selection: SecurityScanSelection;
	target: SecurityScanTarget;
} | null {
	const preset =
		capabilities.presets.find((item) => item.recommended) ??
		capabilities.presets[0];
	if (!preset) return null;
	const target =
		preset.targets.find((item) => item.kind === "working_tree") ??
		preset.targets[0];
	if (!target) return null;
	return {
		selection: { mode: "preset", presetId: preset.id },
		target: { kind: target.kind },
	};
}
