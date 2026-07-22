import { readGeneralSettings } from "../services/settings/general-settings";
import {
	createAppCatalog,
	type SystemContextKey,
} from "./generated/catalog.generated";
import catalogArtifact from "./generated/catalog.json" with { type: "json" };

export type { SystemContextKey } from "./generated/catalog.generated";

const catalog = createAppCatalog(catalogArtifact as unknown);

export type SystemContextP = ReturnType<typeof catalog.bindText>["p"];

export const p = catalog.createTextRenderer(resolveCatalogBinding);

export function bindSystemContextTextCatalog() {
	return catalog.bindText(resolveCatalogBinding());
}

export function bindSystemContextCatalog() {
	return catalog.bind(resolveCatalogBinding());
}

export function describeSystemContext(key: SystemContextKey) {
	return catalog.describe(key);
}

function resolveCatalogBinding() {
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
