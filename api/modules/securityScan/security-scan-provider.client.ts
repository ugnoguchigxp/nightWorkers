import crypto from "node:crypto";
import { z } from "zod";
import {
	SECURITY_SCAN_PROVIDER_BASE_PATH,
	securityScanProviderEnvelopeSchema,
	securityScanSelectionSchema,
	securityScanTargetSchema,
} from "../../../shared/schemas/security-scan.schema";
import { AppError } from "../../lib/errors";
import { redactSecretText } from "../../services/security/secret-redaction";
import {
	localCliCancel,
	localCliCapabilities,
	localCliFindings,
	localCliPreview,
	localCliReportContent,
	localCliReports,
	localCliScanDetail,
	localCliStartReport,
	localCliStartScan,
} from "./security-scan-local-cli.service";
import { getSecurityScanProviderConnection } from "./security-scan-settings.service";

const JSON_RESPONSE_LIMIT_BYTES = 6 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 20_000;

const providerErrorSchema = z
	.object({
		contractVersion: z.literal(1),
		requestId: z.string().min(1).max(64).optional(),
		error: z
			.object({
				code: z
					.string()
					.regex(/^[a-z0-9_]+$/i)
					.max(128),
				message: z.string().min(1).max(1024),
				retryable: z.boolean().optional(),
				details: z.record(z.string(), z.unknown()).optional(),
			})
			.strict(),
	})
	.strict();

type ProviderRequest = {
	method?: "GET" | "POST";
	body?: unknown;
	idempotencyKey?: string;
};

const localStartInputSchema = z
	.object({
		previewRef: z.string().uuid(),
		selection: securityScanSelectionSchema,
		target: securityScanTargetSchema,
		expectedTargetDigest: z.string().regex(/^[0-9a-f]{64}$/),
	})
	.strict();

function providerStatus(status: number): number {
	if (status === 401 || status === 403) return status;
	if (status === 404 || status === 409 || status === 422 || status === 429) {
		return status;
	}
	return status >= 500 ? 503 : 502;
}

function selectedConnectionOrThrow() {
	const connection = getSecurityScanProviderConnection();
	if (!connection.enabled) {
		throw new AppError(
			409,
			"SECURITY_SCAN_PROVIDER_DISABLED",
			"vulnWorkbench 連携が無効です。設定画面で有効にしてください。",
		);
	}
	if (connection.transport === "local_cli" && !connection.localCliConfigured) {
		throw new AppError(
			409,
			"SECURITY_SCAN_LOCAL_CLI_NOT_CONFIGURED",
			"vulnWorkbench CLIが見つかりません。NIGHTWORKERS_VULNWORKBENCH_CWDを確認してください。",
		);
	}
	if (connection.transport === "http" && !connection.token) {
		throw new AppError(
			409,
			"SECURITY_SCAN_PROVIDER_TOKEN_MISSING",
			"vulnWorkbench の service token が設定されていません。",
		);
	}
	return connection;
}

function httpConnectionOrThrow() {
	const connection = selectedConnectionOrThrow();
	if (connection.transport !== "http") {
		throw new AppError(
			500,
			"SECURITY_SCAN_TRANSPORT_MISMATCH",
			"vulnWorkbench HTTP transportが選択されていません。",
		);
	}
	return connection;
}

async function readBoundedBody(response: Response): Promise<string> {
	const declaredLength = Number(response.headers.get("content-length") ?? "0");
	if (
		Number.isFinite(declaredLength) &&
		declaredLength > JSON_RESPONSE_LIMIT_BYTES
	) {
		throw new AppError(
			502,
			"SECURITY_SCAN_PROVIDER_RESPONSE_TOO_LARGE",
			"vulnWorkbench の応答が許容サイズを超えています。",
		);
	}
	if (!response.body) return "";
	const reader = response.body.getReader();
	const chunks: Buffer[] = [];
	let totalBytes = 0;
	while (true) {
		const chunk = await reader.read();
		if (chunk.done) break;
		const bytes = Buffer.from(chunk.value);
		totalBytes += bytes.length;
		if (totalBytes > JSON_RESPONSE_LIMIT_BYTES) {
			await reader.cancel().catch(() => undefined);
			throw new AppError(
				502,
				"SECURITY_SCAN_PROVIDER_RESPONSE_TOO_LARGE",
				"vulnWorkbench の応答が許容サイズを超えています。",
			);
		}
		chunks.push(bytes);
	}
	return Buffer.concat(chunks, totalBytes).toString("utf8");
}

async function requestProvider<T>(
	path: string,
	schema: z.ZodType<T>,
	input: ProviderRequest = {},
): Promise<T> {
	const connection = httpConnectionOrThrow();
	const url = new URL(
		`${SECURITY_SCAN_PROVIDER_BASE_PATH}${path}`,
		connection.baseUrl,
	);
	const headers = new Headers({
		Accept: "application/json",
		Authorization: `Bearer ${connection.token}`,
	});
	if (input.body !== undefined) headers.set("Content-Type", "application/json");
	if (input.idempotencyKey) {
		headers.set("Idempotency-Key", input.idempotencyKey);
	}

	let response: Response;
	try {
		response = await fetch(url, {
			method: input.method ?? (input.body === undefined ? "GET" : "POST"),
			headers,
			body: input.body === undefined ? undefined : JSON.stringify(input.body),
			redirect: "error",
			signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
		});
	} catch (error) {
		throw new AppError(
			503,
			"SECURITY_SCAN_PROVIDER_UNREACHABLE",
			"vulnWorkbench に接続できません。起動状態と Base URL を確認してください。",
			{ cause: error instanceof Error ? error.name : "unknown" },
		);
	}

	const text = await readBoundedBody(response);
	let json: unknown;
	try {
		json = JSON.parse(text);
	} catch {
		throw new AppError(
			502,
			"SECURITY_SCAN_PROVIDER_INVALID_RESPONSE",
			response.ok
				? "vulnWorkbench から不正な応答を受信しました。"
				: `vulnWorkbench が HTTP ${response.status} を返しました。provider API の有効化を確認してください。`,
		);
	}
	if (!response.ok) {
		const providerError = providerErrorSchema.safeParse(json);
		if (providerError.success) {
			throw new AppError(
				providerStatus(response.status),
				`VULNWORKBENCH_${providerError.data.error.code.toUpperCase()}`,
				redactSecretText(providerError.data.error.message),
				{
					requestId: providerError.data.requestId,
					retryable: providerError.data.error.retryable ?? false,
				},
			);
		}
		throw new AppError(
			providerStatus(response.status),
			"SECURITY_SCAN_PROVIDER_REQUEST_FAILED",
			`vulnWorkbench request が HTTP ${response.status} で失敗しました。`,
		);
	}
	const envelope = securityScanProviderEnvelopeSchema(schema).safeParse(json);
	if (!envelope.success) {
		throw new AppError(
			502,
			"SECURITY_SCAN_PROVIDER_CONTRACT_MISMATCH",
			"vulnWorkbench の contractVersion または応答形式が一致しません。",
		);
	}
	return envelope.data.data;
}

export async function providerCapabilities<T>(
	projectPath: string,
	schema: z.ZodType<T>,
) {
	if (selectedConnectionOrThrow().transport === "local_cli") {
		return schema.parse(await localCliCapabilities(projectPath));
	}
	return requestProvider("/capabilities", schema, {
		method: "POST",
		body: { projectPath },
	});
}

export async function providerPreview<T>(
	projectPath: string,
	selection: unknown,
	target: unknown,
	schema: z.ZodType<T>,
) {
	if (selectedConnectionOrThrow().transport === "local_cli") {
		return schema.parse(
			await localCliPreview(
				projectPath,
				securityScanSelectionSchema.parse(selection),
				securityScanTargetSchema.parse(target),
			),
		);
	}
	return requestProvider("/scans/preview", schema, {
		method: "POST",
		body: { projectPath, selection, target },
	});
}

export async function providerStartScan<T>(
	projectPath: string,
	body: Record<string, unknown>,
	idempotencyKey: string,
	schema: z.ZodType<T>,
) {
	if (selectedConnectionOrThrow().transport === "local_cli") {
		const parsed = localStartInputSchema.parse(body);
		return schema.parse(
			await localCliStartScan(projectPath, parsed, idempotencyKey),
		);
	}
	return requestProvider("/scans", schema, {
		method: "POST",
		body: { ...body, projectPath },
		idempotencyKey,
	});
}

export async function providerScanDetail<T>(
	scanRunRef: string,
	schema: z.ZodType<T>,
) {
	if (selectedConnectionOrThrow().transport === "local_cli") {
		return schema.parse(await localCliScanDetail(scanRunRef));
	}
	return requestProvider(`/scans/${encodeURIComponent(scanRunRef)}`, schema);
}

export async function providerFindings<T>(
	scanRunRef: string,
	query: URLSearchParams,
	schema: z.ZodType<T>,
) {
	if (selectedConnectionOrThrow().transport === "local_cli") {
		return schema.parse(await localCliFindings(scanRunRef, query));
	}
	const suffix = query.size > 0 ? `?${query.toString()}` : "";
	return requestProvider(
		`/scans/${encodeURIComponent(scanRunRef)}/findings${suffix}`,
		schema,
	);
}

export async function providerCancel<T>(
	scanRunRef: string,
	schema: z.ZodType<T>,
) {
	if (selectedConnectionOrThrow().transport === "local_cli") {
		return schema.parse(await localCliCancel(scanRunRef));
	}
	return requestProvider(
		`/scans/${encodeURIComponent(scanRunRef)}/cancel`,
		schema,
		{ method: "POST" },
	);
}

export async function providerReports<T>(
	scanRunRef: string,
	schema: z.ZodType<T>,
) {
	if (selectedConnectionOrThrow().transport === "local_cli") {
		return schema.parse(await localCliReports(scanRunRef));
	}
	return requestProvider(
		`/scans/${encodeURIComponent(scanRunRef)}/reports`,
		schema,
	);
}

export async function providerStartReport<T>(
	scanRunRef: string,
	idempotencyKey: string,
	schema: z.ZodType<T>,
) {
	if (selectedConnectionOrThrow().transport === "local_cli") {
		return schema.parse(await localCliStartReport(scanRunRef));
	}
	return requestProvider(
		`/scans/${encodeURIComponent(scanRunRef)}/reports`,
		schema,
		{
			method: "POST",
			body: { summaryMode: "deterministic_with_llm_summary" },
			idempotencyKey,
		},
	);
}

export async function providerReportContent(
	scanRunRef: string,
	reportRef: string,
): Promise<{
	content: string;
	contentType: string;
	contentDisposition: string;
}> {
	const selected = selectedConnectionOrThrow();
	if (selected.transport === "local_cli") {
		return await localCliReportContent(scanRunRef, reportRef);
	}
	const connection = httpConnectionOrThrow();
	const url = new URL(
		`${SECURITY_SCAN_PROVIDER_BASE_PATH}/scans/${encodeURIComponent(
			scanRunRef,
		)}/reports/${encodeURIComponent(reportRef)}/content`,
		connection.baseUrl,
	);
	let response: Response;
	try {
		response = await fetch(url, {
			headers: {
				Accept: "text/markdown",
				Authorization: `Bearer ${connection.token}`,
			},
			redirect: "error",
			signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
		});
	} catch {
		throw new AppError(
			503,
			"SECURITY_SCAN_PROVIDER_UNREACHABLE",
			"vulnWorkbench に接続できません。",
		);
	}
	const content = await readBoundedBody(response);
	if (!response.ok) {
		throw new AppError(
			providerStatus(response.status),
			"SECURITY_SCAN_REPORT_DOWNLOAD_FAILED",
			`レポートの取得が HTTP ${response.status} で失敗しました。`,
		);
	}
	return {
		content,
		contentType: "text/markdown; charset=utf-8",
		contentDisposition: `attachment; filename="security-report-${crypto
			.createHash("sha256")
			.update(reportRef)
			.digest("hex")
			.slice(0, 12)}.md"`,
	};
}
