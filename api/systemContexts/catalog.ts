import type {
	CatalogBindingV2,
	RequestAuditV2,
	SystemContextInvocationV2,
} from "@s11t/runtime";
import { readGeneralSettings } from "../services/settings/general-settings";
import {
	createAppCatalog,
	type SystemContextKey,
} from "./generated/catalog.generated";
import catalogArtifact from "./generated/catalog.json" with { type: "json" };

export type { SystemContextKey } from "./generated/catalog.generated";

const catalog = createAppCatalog(catalogArtifact as unknown);

export type SystemContextP = ReturnType<typeof catalog.bindText>["p"];
export type SystemContextManifest =
	SystemContextInvocationV2<SystemContextKey>["manifest"];
export type SystemContextPromptAudit = Readonly<{
	promptPart: "system" | "developer" | "user";
	manifest: SystemContextManifest;
	requestAudit: RequestAuditV2;
}>;
export type SystemContextBindingSnapshot = Readonly<{
	version: 1;
	instructionLocale: "ja-JP" | "en-US";
	fallbackLocales: readonly ("ja-JP" | "en-US")[];
}>;
export type BoundSystemContextCatalog = Readonly<{
	binding: SystemContextBindingSnapshot;
	p: ReturnType<typeof catalog.bindRequest>["p"];
	byKey: ReturnType<typeof catalog.bindRequest>["byKey"];
	invoke: ReturnType<typeof catalog.bindRequest>["invoke"];
	finalize: ReturnType<typeof catalog.bindRequest>["finalize"];
}>;

export const p = catalog.createTextRenderer(resolveCatalogBinding);

export function bindSystemContextTextCatalog(
	input?: SystemContextBindingSnapshot,
) {
	const binding =
		input === undefined
			? createSystemContextBindingSnapshot()
			: assertSystemContextBindingSnapshot(input);
	return catalog.bindText(toRuntimeBinding(binding));
}

export function bindSystemContextCatalog() {
	return catalog.bind(resolveCatalogBinding());
}

export function bindSystemContextCatalogSnapshot(
	input?: SystemContextBindingSnapshot,
): BoundSystemContextCatalog {
	const binding =
		input === undefined
			? createSystemContextBindingSnapshot()
			: assertSystemContextBindingSnapshot(input);
	const runtimeBinding = toRuntimeBinding(binding);
	const request = catalog.bindRequest(runtimeBinding);
	return Object.freeze({
		binding,
		p: request.p,
		byKey: request.byKey,
		invoke: request.invoke,
		finalize: request.finalize,
	});
}

export function createSystemContextBindingSnapshot(
	input?: unknown,
): SystemContextBindingSnapshot {
	if (input !== undefined) {
		return assertSystemContextBindingSnapshot(input);
	}
	const binding = resolveCatalogBinding();
	return Object.freeze({
		version: 1,
		instructionLocale: binding.instructionLocale,
		fallbackLocales: Object.freeze([...binding.fallbackLocales]),
	});
}

export function readSystemContextBindingSnapshot(
	contextSnapshot: unknown,
): SystemContextBindingSnapshot | null {
	const context = record(contextSnapshot);
	if (!context || context.systemContextBinding === undefined) return null;
	return assertSystemContextBindingSnapshot(context.systemContextBinding);
}

export function systemContextPromptAudit(
	promptPart: SystemContextPromptAudit["promptPart"],
	request: BoundSystemContextCatalog,
	invocation: SystemContextInvocationV2<SystemContextKey>,
): SystemContextPromptAudit {
	const requestAudit = request.finalize(invocation);
	return Object.freeze({
		promptPart,
		manifest: requestAudit.finalManifest,
		requestAudit,
	});
}

export function describeSystemContext(key: SystemContextKey) {
	return catalog.describe(key);
}

function resolveCatalogBinding(): Pick<
	SystemContextBindingSnapshot,
	"instructionLocale" | "fallbackLocales"
> {
	return readGeneralSettings().language === "en"
		? {
				instructionLocale: "en-US",
				fallbackLocales: ["ja-JP"],
			}
		: {
				instructionLocale: "ja-JP",
				fallbackLocales: [],
			};
}

function assertSystemContextBindingSnapshot(
	value: unknown,
): SystemContextBindingSnapshot {
	const snapshot = record(value);
	if (
		snapshot?.version !== 1 ||
		(snapshot.instructionLocale !== "ja-JP" &&
			snapshot.instructionLocale !== "en-US") ||
		!Array.isArray(snapshot.fallbackLocales) ||
		snapshot.fallbackLocales.some(
			(locale) => locale !== "ja-JP" && locale !== "en-US",
		) ||
		new Set(snapshot.fallbackLocales).size !==
			snapshot.fallbackLocales.length ||
		snapshot.fallbackLocales.includes(snapshot.instructionLocale)
	) {
		throw new Error("Invalid persisted SystemContext binding snapshot.");
	}
	return Object.freeze({
		version: 1,
		instructionLocale: snapshot.instructionLocale,
		fallbackLocales: Object.freeze([...snapshot.fallbackLocales]),
	});
}

function toRuntimeBinding(
	snapshot: SystemContextBindingSnapshot,
): CatalogBindingV2 {
	return {
		instructionLocale: snapshot.instructionLocale,
		fallbackLocales: snapshot.fallbackLocales,
	};
}

function record(value: unknown): Record<string, unknown> | null {
	return value && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: null;
}
