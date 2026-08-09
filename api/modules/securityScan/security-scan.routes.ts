import { bodyLimit } from "hono/body-limit";
import { z } from "zod";
import {
	securityScanCapabilitiesSchema,
	securityScanFindingPageSchema,
	securityScanPreviewSchema,
	securityScanReportListSchema,
	securityScanResourceRefSchema,
	securityScanRunDetailSchema,
	securityScanSelectionSchema,
	securityScanStartReportResponseSchema,
	securityScanStartResponseSchema,
	securityScanTargetSchema,
} from "../../../shared/schemas/security-scan.schema";
import { AppError, NotFoundError, ValidationError } from "../../lib/errors";
import { createOpenApiRouter } from "../../lib/openapi";
import * as nightworkersRepository from "../nightworkers/nightworkers.repository";
import {
	providerCancel,
	providerCapabilities,
	providerFindings,
	providerPreview,
	providerReportContent,
	providerReports,
	providerScanDetail,
	providerStartReport,
	providerStartScan,
} from "./security-scan-provider.client";
import {
	getSecurityScanProviderSettings,
	listSecurityScanBindings,
	recordSecurityScanBinding,
	saveSecurityScanProviderSettings,
} from "./security-scan-settings.service";

const resourceRefSchema = securityScanResourceRefSchema;
const idempotencyKeySchema = z.string().uuid();
const previewRequestSchema = z
	.object({
		selection: securityScanSelectionSchema,
		target: securityScanTargetSchema,
	})
	.strict();
const startRequestSchema = previewRequestSchema
	.extend({
		previewRef: z.string().min(1).max(256),
		expectedTargetDigest: z.string().regex(/^[0-9a-f]{64}$/),
	})
	.strict();
const findingsQuerySchema = z
	.object({
		cursor: z.string().max(4096).optional(),
		limit: z.coerce.number().int().positive().max(100).default(100),
		severity: z
			.enum(["critical", "high", "medium", "low", "info", "unknown"])
			.optional(),
		tool: z.string().trim().min(1).max(128).optional(),
	})
	.strict();

async function requireRepository(repositoryId: string) {
	const repository = await nightworkersRepository.getRepository(repositoryId);
	if (!repository?.allowed) throw new NotFoundError("Project not found");
	return repository;
}

function parseResourceRef(value: string) {
	const parsed = resourceRefSchema.safeParse(value);
	if (!parsed.success) throw new ValidationError("scan ref が不正です。");
	return parsed.data;
}

function requireBoundScan(repositoryId: string, scanRunRef: string) {
	const bound = listSecurityScanBindings(repositoryId).some(
		(item) => item.scanRunRef === scanRunRef,
	);
	if (!bound) {
		throw new AppError(
			404,
			"SECURITY_SCAN_BINDING_NOT_FOUND",
			"このProjectに紐づくスキャンが見つかりません。",
		);
	}
}

async function parseJson<T>(
	request: { json(): Promise<unknown> },
	schema: z.ZodType<T>,
): Promise<T> {
	const body = await request.json().catch(() => null);
	const parsed = schema.safeParse(body);
	if (!parsed.success) {
		throw new ValidationError("リクエストが不正です。", {
			issues: parsed.error.issues,
		});
	}
	return parsed.data;
}

const router = createOpenApiRouter();
router.use(
	"*",
	bodyLimit({
		maxSize: 64 * 1024,
		onError: (c) =>
			c.json(
				{
					error: {
						code: "REQUEST_BODY_TOO_LARGE",
						message: "Request body exceeds the security scan API limit.",
					},
				},
				413,
			),
	}),
);

export const securityScanRouter = router
	.get("/settings/vulnerability-scan-provider", (c) =>
		c.json(getSecurityScanProviderSettings(), 200),
	)
	.put("/settings/vulnerability-scan-provider", async (c) => {
		const body = await c.req.json().catch(() => null);
		return c.json(await saveSecurityScanProviderSettings(body), 200);
	})
	.get("/repositories/:repositoryId/security-scans", async (c) => {
		const repositoryId = c.req.param("repositoryId");
		await requireRepository(repositoryId);
		return c.json({ items: listSecurityScanBindings(repositoryId) }, 200);
	})
	.get("/repositories/:repositoryId/security-scans/capabilities", async (c) => {
		const repository = await requireRepository(c.req.param("repositoryId"));
		const capabilities = await providerCapabilities(
			repository.localPath,
			securityScanCapabilitiesSchema,
		);
		return c.json(capabilities, 200);
	})
	.post("/repositories/:repositoryId/security-scans/preview", async (c) => {
		const repository = await requireRepository(c.req.param("repositoryId"));
		const input = await parseJson(c.req, previewRequestSchema);
		const preview = await providerPreview(
			repository.localPath,
			input.selection,
			input.target,
			securityScanPreviewSchema,
		);
		return c.json(preview, 200);
	})
	.post("/repositories/:repositoryId/security-scans", async (c) => {
		const repositoryId = c.req.param("repositoryId");
		const repository = await requireRepository(repositoryId);
		const input = await parseJson(c.req, startRequestSchema);
		const key = idempotencyKeySchema.safeParse(c.req.header("idempotency-key"));
		if (!key.success) {
			throw new ValidationError("Idempotency-Key header が必要です。");
		}
		const started = await providerStartScan(
			repository.localPath,
			input,
			key.data,
			securityScanStartResponseSchema,
		);
		await recordSecurityScanBinding(repositoryId, {
			scanRunRef: started.scanRunRef,
			selection: input.selection,
			target: input.target,
			createdAt: started.createdAt,
		});
		return c.json(started, 202);
	})
	.get("/repositories/:repositoryId/security-scans/:scanRunRef", async (c) => {
		const repositoryId = c.req.param("repositoryId");
		await requireRepository(repositoryId);
		const scanRunRef = parseResourceRef(c.req.param("scanRunRef"));
		requireBoundScan(repositoryId, scanRunRef);
		return c.json(
			await providerScanDetail(scanRunRef, securityScanRunDetailSchema),
			200,
		);
	})
	.post(
		"/repositories/:repositoryId/security-scans/:scanRunRef/cancel",
		async (c) => {
			const repositoryId = c.req.param("repositoryId");
			await requireRepository(repositoryId);
			const scanRunRef = parseResourceRef(c.req.param("scanRunRef"));
			requireBoundScan(repositoryId, scanRunRef);
			return c.json(
				await providerCancel(scanRunRef, securityScanRunDetailSchema),
				200,
			);
		},
	)
	.get(
		"/repositories/:repositoryId/security-scans/:scanRunRef/findings",
		async (c) => {
			const repositoryId = c.req.param("repositoryId");
			await requireRepository(repositoryId);
			const scanRunRef = parseResourceRef(c.req.param("scanRunRef"));
			requireBoundScan(repositoryId, scanRunRef);
			const parsed = findingsQuerySchema.safeParse({
				cursor: c.req.query("cursor"),
				limit: c.req.query("limit"),
				severity: c.req.query("severity"),
				tool: c.req.query("tool"),
			});
			if (!parsed.success) {
				throw new ValidationError("finding query が不正です。");
			}
			const query = new URLSearchParams();
			query.set("limit", String(parsed.data.limit));
			if (parsed.data.cursor) query.set("cursor", parsed.data.cursor);
			if (parsed.data.severity) query.set("severity", parsed.data.severity);
			if (parsed.data.tool) query.set("tool", parsed.data.tool);
			return c.json(
				await providerFindings(
					scanRunRef,
					query,
					securityScanFindingPageSchema,
				),
				200,
			);
		},
	)
	.get(
		"/repositories/:repositoryId/security-scans/:scanRunRef/reports",
		async (c) => {
			const repositoryId = c.req.param("repositoryId");
			await requireRepository(repositoryId);
			const scanRunRef = parseResourceRef(c.req.param("scanRunRef"));
			requireBoundScan(repositoryId, scanRunRef);
			return c.json(
				await providerReports(scanRunRef, securityScanReportListSchema),
				200,
			);
		},
	)
	.post(
		"/repositories/:repositoryId/security-scans/:scanRunRef/reports",
		async (c) => {
			const repositoryId = c.req.param("repositoryId");
			await requireRepository(repositoryId);
			const scanRunRef = parseResourceRef(c.req.param("scanRunRef"));
			requireBoundScan(repositoryId, scanRunRef);
			const key = idempotencyKeySchema.safeParse(
				c.req.header("idempotency-key"),
			);
			if (!key.success) {
				throw new ValidationError("Idempotency-Key header が必要です。");
			}
			return c.json(
				await providerStartReport(
					scanRunRef,
					key.data,
					securityScanStartReportResponseSchema,
				),
				202,
			);
		},
	)
	.get(
		"/repositories/:repositoryId/security-scans/:scanRunRef/reports/:reportRef/content",
		async (c) => {
			const repositoryId = c.req.param("repositoryId");
			await requireRepository(repositoryId);
			const scanRunRef = parseResourceRef(c.req.param("scanRunRef"));
			const reportRef = parseResourceRef(c.req.param("reportRef"));
			requireBoundScan(repositoryId, scanRunRef);
			const report = await providerReportContent(scanRunRef, reportRef);
			return c.body(report.content, 200, {
				"Content-Type": report.contentType,
				"Content-Disposition": report.contentDisposition,
			});
		},
	);
