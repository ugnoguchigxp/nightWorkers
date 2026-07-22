import { describe, expect, it } from "vitest";
import { resolveStarterTemplate } from "../api/services/worker-tools/template-registry";
import { repositoryMaterializationIntentSchema } from "../shared/schemas/git-integration.schema";
import {
	STARTER_STACKS,
	STARTER_VARIANTS_BY_STACK,
} from "../shared/starter-template-contract";

describe("Starter template materialization contract", () => {
	it("keeps every schema variant resolvable by the import registry", () => {
		for (const stack of STARTER_STACKS) {
			for (const variant of STARTER_VARIANTS_BY_STACK[stack]) {
				expect(resolveStarterTemplate({ stack, variant })).toMatchObject({
					ok: true,
					variant: { name: variant },
				});
			}
		}
	});

	it("rejects descriptive aliases and variants owned by another stack", () => {
		for (const variant of ["hono-react-vite-sqlite", "java25-sqlite"]) {
			expect(
				repositoryMaterializationIntentSchema.safeParse({
					kind: "starter_template",
					source: "starter",
					stack: "hono",
					variant,
					initialize: true,
				}).success,
			).toBe(false);
		}
	});
});
