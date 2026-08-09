import { describe, expect, it } from "vitest";
import { normalizeCompatibleEditToolArguments } from "../api/modules/codingAgent/runtime/native-api-runner/native-api-compatible-tool-profile";
import { getNativeApiToolDefinitions } from "../api/modules/codingAgent/runtime/native-api-runner/native-api-tool-registry";

describe("native API compatible edit tool profile", () => {
	it("publishes single-line JSON string arguments only for flat profiles", () => {
		const defaults = getNativeApiToolDefinitions();
		const compatible = getNativeApiToolDefinitions({ flatToolArguments: true });
		const defaultPatch = defaults.find((tool) => tool.name === "apply_patch");
		const compatiblePatch = compatible.find(
			(tool) => tool.name === "apply_patch",
		);
		const compatibleReplace = compatible.find(
			(tool) => tool.name === "replace_content",
		);

		expect(defaultPatch?.inputSchema).toHaveProperty("properties.patchContent");
		expect(compatiblePatch?.inputSchema).toHaveProperty("properties.patchJson");
		expect(compatiblePatch?.inputSchema).not.toHaveProperty(
			"properties.patchContent",
		);
		expect(compatibleReplace?.inputSchema).toHaveProperty(
			"properties.needleJson",
		);
		expect(compatibleReplace?.inputSchema).toHaveProperty(
			"properties.replacementJson",
		);
		expect(compatibleReplace?.inputSchema).not.toHaveProperty(
			"properties.replacement",
		);
	});

	it("decodes JSON string literals before worker-tool dispatch", () => {
		const patch = "*** Begin Patch\n*** End Patch";
		expect(
			normalizeCompatibleEditToolArguments("apply_patch", {
				patchJson: JSON.stringify(patch),
			}),
		).toEqual({ ok: true, arguments: { patchContent: patch } });

		const replacement = normalizeCompatibleEditToolArguments(
			"replace_content",
			{
				filePath: "src/a.ts",
				mode: "literal",
				needleJson: JSON.stringify("old\nvalue"),
				replacementJson: JSON.stringify("new\nvalue"),
			},
		);
		expect(replacement).toEqual({
			ok: true,
			arguments: {
				filePath: "src/a.ts",
				mode: "literal",
				needle: "old\nvalue",
				replacement: "new\nvalue",
			},
		});
	});

	it("rejects malformed compatible edit strings", () => {
		expect(
			normalizeCompatibleEditToolArguments("apply_patch", {
				patchJson: "not-json",
			}),
		).toEqual({ ok: false, message: "patchJson is not valid JSON." });
	});
});
