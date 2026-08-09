import { configureRuntimeLogRetention } from "../lib/logger";
import { createOpenApiRouter } from "../lib/openapi";
import { readCodexSdkStatus } from "../services/codex-global-config/status";
import { runStartupPreflight } from "../services/preflight/preflight";
import {
	importPublicPricingRows,
	listPricingRowsPage,
	seedCodexPricingRows,
	upsertPricingRow,
} from "../services/pricing";
import {
	executeRuntimeRecordCleanup,
	notifyRuntimeRetentionSettingsChanged,
	previewRuntimeRecordCleanup,
} from "../services/runtime-retention/runtime-retention.service";
import {
	type GeneralSettings,
	readFxRateCache,
	readGeneralSettings,
	refreshEcbFxRates,
	writeGeneralSettings,
} from "../services/settings/general-settings";
import { callSupervisorLLM } from "../services/structured-llm";
import { checkStructuredLlmProviderExecutionReadiness } from "../services/structured-llm/provider-health";
import { buildRound1JobTypePrompt } from "../services/supervisor/prompt";
import {
	executeDataRetentionCleanupRoute,
	getCodexSdkStatusRoute,
	getFxRatesRoute,
	getGeneralSettingsRoute,
	getLlmModelsRoute,
	getLlmSettingsRoute,
	getStartupPreflightRoute,
	importPublicPricingRoute,
	listPricingRoute,
	previewDataRetentionCleanupRoute,
	refreshFxRatesRoute,
	saveGeneralSettingsRoute,
	saveLlmSettingsRoute,
	savePricingRoute,
	seedCodexPricingRoute,
	smokeLlmRoute,
	testLlmProviderHealthRoute,
} from "./settings-route-definitions";
import {
	applySettingsToProcessEnv,
	llmProviderEndpointSchema,
	MASKED_SECRET,
	maskLlmSettings,
	mergeMaskedSecrets,
	providerModelOptions,
	getCurrentSettings as readCurrentSettings,
	writeRuntimeSettings,
} from "./settings-runtime";
export const getCurrentSettings = readCurrentSettings;
export { maskLlmSettings, mergeMaskedSecrets };

export const settingsRouter = createOpenApiRouter()
	.openapi(getLlmSettingsRoute, (c) => {
		return c.json(maskLlmSettings(getCurrentSettings()));
	})
	.openapi(saveLlmSettingsRoute, async (c) => {
		const settings = {
			...mergeMaskedSecrets(c.req.valid("json"), getCurrentSettings()),
			settingsRevision: new Date().toISOString(),
		};
		await writeRuntimeSettings(settings);

		// Update in-memory environment variables instantly!
		applySettingsToProcessEnv(settings);

		return c.json({ success: true }, 200);
	})
	.openapi(getLlmModelsRoute, (c) => {
		const activeProvider = getCurrentSettings()
			.ACTIVE_LLM_PROVIDER as keyof typeof providerModelOptions;
		const options =
			providerModelOptions[activeProvider] || providerModelOptions.azure;
		return c.json({
			activeProvider,
			options: options.map((value: string) => ({ value, label: value })),
		});
	})
	.openapi(getCodexSdkStatusRoute, (c) => {
		const settings = getCurrentSettings();
		return c.json(
			readCodexSdkStatus({
				accessToken: settings.CODEX_ACCESS_TOKEN,
				configuredModel: settings.CODEX_MODEL,
			}),
			200,
		);
	})
	.openapi(getGeneralSettingsRoute, (c) => {
		return c.json(readGeneralSettings(), 200);
	})
	.openapi(saveGeneralSettingsRoute, async (c) => {
		const settings = await writeGeneralSettings(
			c.req.valid("json") as GeneralSettings,
		);
		configureRuntimeLogRetention(settings.dataRetention);
		notifyRuntimeRetentionSettingsChanged();
		return c.json(settings, 200);
	})
	.openapi(previewDataRetentionCleanupRoute, async (c) => {
		return c.json(await previewRuntimeRecordCleanup(), 200);
	})
	.openapi(executeDataRetentionCleanupRoute, async (c) => {
		return c.json(await executeRuntimeRecordCleanup(c.req.valid("json")), 200);
	})
	.openapi(getFxRatesRoute, (c) => {
		return c.json(readFxRateCache(), 200);
	})
	.openapi(refreshFxRatesRoute, async (c) => {
		try {
			const cache = await refreshEcbFxRates();
			return c.json(cache, 200);
		} catch (err) {
			return c.json(
				{ error: err instanceof Error ? err.message : String(err) },
				500,
			);
		}
	})
	.openapi(getStartupPreflightRoute, (c) => {
		return c.json(runStartupPreflight(), 200);
	})
	.openapi(listPricingRoute, async (c) => {
		const query = c.req.valid("query");
		const page = await listPricingRowsPage({
			provider: query.provider,
			model: query.model,
			limit: query.limit,
			offset: query.cursor ? Number(query.cursor) : 0,
		});
		return c.json(page, 200);
	})
	.openapi(savePricingRoute, async (c) => {
		const row = await upsertPricingRow(c.req.valid("json"));
		return c.json(row, 200);
	})
	.openapi(seedCodexPricingRoute, async (c) => {
		const rows = await seedCodexPricingRows();
		return c.json(rows, 200);
	})
	.openapi(importPublicPricingRoute, async (c) => {
		try {
			const result = await importPublicPricingRows();
			return c.json(result, 200);
		} catch (err) {
			return c.json(
				{ error: err instanceof Error ? err.message : String(err) },
				500,
			);
		}
	})
	.openapi(smokeLlmRoute, async (c) => {
		const provider = getCurrentSettings().ACTIVE_LLM_PROVIDER || "azure";
		try {
			await callSupervisorLLM(
				buildRound1JobTypePrompt(process.cwd()),
				"LLM smoke check: answer this as a general lightweight request.",
				{ round: 1, schemaFirst: true },
			);
			return c.json({ ok: true, provider, message: "smoke ok" }, 200);
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			return c.json({ ok: false, provider, message }, 200);
		}
	})
	.openapi(testLlmProviderHealthRoute, async (c) => {
		const settings = getCurrentSettings();
		const body = await c.req.json().catch(() => null);
		const parsedBodyEndpoint = llmProviderEndpointSchema.safeParse(
			body && typeof body === "object" && "endpoint" in body
				? body.endpoint
				: null,
		);
		const parsedEndpoint =
			parsedBodyEndpoint.success &&
			parsedBodyEndpoint.data.id === c.req.param("id")
				? parsedBodyEndpoint.data
				: null;
		const savedEndpoint = (settings.providerEndpoints || []).find(
			(item) => item.id === c.req.param("id"),
		);
		const bodyEndpoint =
			parsedEndpoint && parsedEndpoint.apiKey === MASKED_SECRET
				? { ...parsedEndpoint, apiKey: savedEndpoint?.apiKey || "" }
				: parsedEndpoint;
		const endpoint = bodyEndpoint || savedEndpoint;
		if (!endpoint)
			return c.json(
				{
					error: {
						code: "NOT_FOUND",
						message: "LLM provider endpoint not found",
					},
				},
				404,
			);
		const result = await checkStructuredLlmProviderExecutionReadiness(endpoint);
		return c.json(result, 200);
	});
