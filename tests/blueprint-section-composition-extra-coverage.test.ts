import { describe, expect, it } from "vitest";
import {
	applyBlueprintSectionOverridesToNode,
	applyBlueprintSectionPatch,
	applyBlueprintSectionPatches,
	applyBlueprintSectionPatchesToBlueprint,
	applyBlueprintSectionPatchesToScreen,
	blueprintSectionPatchToOverride,
} from "../shared/blueprint-section-composition";

describe("blueprint section composition extra coverage", () => {
	it("converts every patch operation and path form to an override", () => {
		expect(
			blueprintSectionPatchToOverride({
				op: "remove",
				target: "target",
			}),
		).toEqual({ target: "target", remove: true });
		expect(
			blueprintSectionPatchToOverride({
				op: "replace",
				target: "target",
				node: node("replacement"),
			}),
		).toEqual({ target: "target", replace: node("replacement") });
		expect(
			blueprintSectionPatchToOverride({
				op: "set",
				target: "target",
				path: "props.title",
				value: "Title",
			}),
		).toEqual({ target: "target", set: { props: { title: "Title" } } });
		expect(
			blueprintSectionPatchToOverride({
				op: "set",
				target: "target",
				path: "title",
				value: "Title",
			}),
		).toEqual({ target: "target", set: { props: { title: "Title" } } });
		expect(
			blueprintSectionPatchToOverride({
				op: "set",
				target: "target",
				path: "layout.",
				value: "odd",
			}),
		).toEqual({
			target: "target",
			set: { props: { "layout.": "odd" } },
		});
	});

	it("applies multiple patches only to matching screens and sections", () => {
		const first = preset("first");
		const second = preset("second");
		const screen = { id: "screen", sections: [first, second] } as never;
		const patchedScreen = applyBlueprintSectionPatchesToScreen(
			screen,
			"first",
			[
				{ op: "remove", target: "a" },
				{ op: "insert", target: "b", node: node("inserted") },
			] as never,
		);
		expect(patchedScreen.sections[0]).not.toBe(first);
		expect(patchedScreen.sections[1]).toBe(second);
		expect(applyBlueprintSectionPatches(first as never, [] as never)).toBe(
			first,
		);

		const blueprint = {
			id: "blueprint",
			screens: [screen, { id: "other", sections: [first] }],
		} as never;
		const patched = applyBlueprintSectionPatchesToBlueprint(blueprint, {
			screenId: "screen",
			sectionId: "second",
			patches: [{ op: "remove", target: "x" }] as never,
		});
		expect(patched.screens[0]).not.toBe(screen);
		expect(patched.screens[1]).toBe(blueprint.screens[1]);
	});

	it("keeps component sections and appends all preset override kinds", () => {
		const component = {
			kind: "component_section",
			id: "component",
			componentName: "Card",
			props: {},
		} as never;
		expect(
			applyBlueprintSectionPatch(component, {
				op: "remove",
				target: "component",
			} as never),
		).toBe(component);

		const patched = applyBlueprintSectionPatches(
			preset("preset") as never,
			[
				{ op: "remove", target: "one" },
				{ op: "replace", target: "two", node: node("replacement") },
				{
					op: "set",
					target: "three",
					path: "layout.width",
					value: "1/2",
				},
			] as never,
		) as { overrides: unknown[] };
		expect(patched.overrides).toHaveLength(3);
	});

	it("removes, replaces, sets, and inserts override nodes", () => {
		const root = tree();
		expect(
			applyBlueprintSectionOverridesToNode(
				root as never,
				[{ target: "root", remove: true }] as never,
			),
		).toBeNull();
		expect(
			applyBlueprintSectionOverridesToNode(
				root as never,
				[{ target: "root", replace: node("replacement") }] as never,
			),
		).toMatchObject({ id: "replacement" });

		const patched = applyBlueprintSectionOverridesToNode(
			root as never,
			[
				{ target: "invalid-child", remove: true },
				{ target: "first", replace: "invalid" },
				{
					target: "first",
					set: {
						props: { title: "Changed" },
						layout: { width: "1/2" },
					},
				},
				{ target: "second", set: { layout: { width: "1/3" } } },
				{
					target: "first",
					position: "before",
					insert: node("before"),
				},
				{
					target: "second",
					position: "after",
					insert: node("after"),
				},
				{
					target: "root",
					position: "start",
					insert: node("start"),
				},
				{
					target: "root",
					position: "end",
					insert: node("end"),
				},
			] as never,
		) as Record<string, unknown>;
		const children = patched.children as Array<Record<string, unknown>>;
		expect(children.map((child) => child.id)).toEqual([
			"start",
			"before",
			"first",
			"second",
			"after",
			"end",
		]);
		expect(children[2]).toMatchObject({
			props: { title: "Changed" },
			layout: "row",
		});
		expect(children[3]).toMatchObject({ layout: { width: "1/3" } });
	});

	it("applies custom patches across root and child paths", () => {
		let section = custom(tree());
		section = applyBlueprintSectionPatch(
			section as never,
			{
				op: "set",
				target: "first",
				path: "props.deep.value",
				value: 3,
			} as never,
		) as never;
		section = applyBlueprintSectionPatch(
			section as never,
			{
				op: "set",
				target: "second",
				path: "layout.width",
				value: "2/3",
			} as never,
		) as never;
		section = applyBlueprintSectionPatch(
			section as never,
			{
				op: "insert",
				target: "root",
				position: "start",
				node: node("start"),
			} as never,
		) as never;
		section = applyBlueprintSectionPatch(
			section as never,
			{
				op: "insert",
				target: "first",
				position: "after",
				node: node("after-first"),
			} as never,
		) as never;
		section = applyBlueprintSectionPatch(
			section as never,
			{
				op: "insert",
				target: "second",
				position: "before",
				node: node("before-second"),
			} as never,
		) as never;
		section = applyBlueprintSectionPatch(
			section as never,
			{
				op: "insert",
				target: "root",
				position: undefined,
				node: node("end"),
			} as never,
		) as never;

		const children = (section as never as { root: { children: unknown[] } })
			.root.children as Array<Record<string, unknown>>;
		expect(children.map((child) => child.id)).toEqual([
			"start",
			"first",
			"after-first",
			"before-second",
			"second",
			"end",
		]);
		expect(children[1]).toMatchObject({ props: { deep: { value: 3 } } });
		expect(children[4]).toMatchObject({ layout: { width: "2/3" } });
	});

	it("handles custom root removal fallback, replacement, and malformed values", () => {
		const originalRoot = tree();
		const removed = applyBlueprintSectionPatch(
			custom(originalRoot) as never,
			{
				op: "remove",
				target: "root",
			} as never,
		) as never as { root: unknown };
		expect(removed.root).toBe(originalRoot);

		const replaced = applyBlueprintSectionPatch(
			custom(originalRoot) as never,
			{
				op: "replace",
				target: "root",
				node: node("new-root"),
			} as never,
		) as never as { root: Record<string, unknown> };
		expect(replaced.root.id).toBe("new-root");

		const malformedRoot = {
			id: "root",
			kind: "layout",
			children: [null, [], "text", node("valid")],
		};
		const malformed = applyBlueprintSectionPatch(
			custom(malformedRoot) as never,
			{
				op: "set",
				target: "valid",
				path: "",
				value: "ignored",
			} as never,
		) as never as { root: { children: unknown[] } };
		expect(malformed.root.children).toHaveLength(1);
	});
});

function node(id: string) {
	return { id, kind: "component", component: "Card", props: {} };
}

function tree() {
	return {
		id: "root",
		kind: "layout",
		layout: "grid",
		props: {},
		children: [
			{ ...node("first"), props: null, layout: "row" },
			{ ...node("second"), layout: null },
			"invalid-child",
		],
	};
}

function preset(id: string) {
	return {
		kind: "preset_section",
		id,
		preset: "search_header",
		props: {},
		overrides: [],
		actions: [],
	};
}

function custom(root: Record<string, unknown>) {
	return {
		kind: "custom_section",
		id: "custom",
		root,
		actions: [],
	};
}
