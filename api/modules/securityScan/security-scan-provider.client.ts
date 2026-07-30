import { z } from "zod";
import {
	SECURITY_SCAN_PROVIDER_BASE_PATH,
	securityScanProviderEnvelopeSchema,
} from "../../../shared/schemas/security-scan.schema";
import { AppError } from "../../lib/errors";
import { getSecurityScanProviderConnection } from "./security-scan-settings.service";

const JSON_RESPONSE_LIMIT_BYTES = 6 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 20_000;

const providerErrorSchema = z
	.object({
		contractVersion: z.literal(1),
		requestId: z.string().optional(),
		error: z
			.object({
				code: z.string().min(1).max(128),
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

function providerStatus(status: number): number {
	if (status === 401 || status === 403) return status;
	if (status === 404 || status === 409 || status === 422 || status === 429) {
		return status;
	}
	return status >= 500 ? 503 : 502;
}

function connectionOrThrow() {
	const connection = getSecurityScanProviderConnection();
	if (!connection.enabled) {
		throw new AppError(
			409,
			"SECURITY_SCAN_PROVIDER_DISABLED",
			"vulnWorkbench 連携が無効です。設定画面で有効にしてください。",
		);
	}
	if (!connection.token) {
		throw new AppError(
			409,
			"SECURITY_SCAN_PROVIDER_TOKEN_MISSING",
			"vulnWorkbench の service token が設定されていません。",
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
	const text = await response.text();
	if (Buffer.byteLength(text, "utf8") > JSON_RESPONSE_LIMIT_BYTES) {
		throw new AppError(
			502,
			"SECURITY_SCAN_PROVIDER_RESPONSE_TOO_LARGE",
			"vulnWorkbench の応答が許容サイズを超えています。",
		);
	}
	return text;
}

async function requestProvider<T>(
	path: string,
	schema: z.ZodType<T>,
	input: ProviderRequest = {},
): Promise<T> {
	const connection = connectionOrThrow();
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
				providerError.data.error.message,
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

export function providerCapabilities<T>(
	projectPath: string,
	schema: z.ZodType<T>,
) {
	return requestProvider("/capabilities", schema, {
		method: "POST",
		body: { projectPath },
	});
}

export function providerPreview<T>(
	projectPath: string,
	selection: unknown,
	target: unknown,
	schema: z.ZodType<T>,
) {
	return requestProvider("/scans/preview", schema, {
		method: "POST",
		body: { projectPath, selection, target },
	});
}

export function providerStartScan<T>(
	projectPath: string,
	body: Record<string, unknown>,
	idempotencyKey: string,
	schema: z.ZodType<T>,
) {
	return requestProvider("/scans", schema, {
		method: "POST",
		body: { ...body, projectPath },
		idempotencyKey,
	});
}

export function providerScanDetail<T>(
	scanRunRef: string,
	schema: z.ZodType<T>,
) {
	return requestProvider(`/scans/${encodeURIComponent(scanRunRef)}`, schema);
}

export function providerFindings<T>(
	scanRunRef: string,
	query: URLSearchParams,
	schema: z.ZodType<T>,
) {
	const suffix = query.size > 0 ? `?${query.toString()}` : "";
	return requestProvider(
		`/scans/${encodeURIComponent(scanRunRef)}/findings${suffix}`,
		schema,
	);
}

export function providerCancel<T>(scanRunRef: string, schema: z.ZodType<T>) {
	return requestProvider(
		`/scans/${encodeURIComponent(scanRunRef)}/cancel`,
		schema,
		{ method: "POST" },
	);
}

export function providerReports<T>(scanRunRef: string, schema: z.ZodType<T>) {
	return requestProvider(
		`/scans/${encodeURIComponent(scanRunRef)}/reports`,
		schema,
	);
}

export function providerStartReport<T>(
	scanRunRef: string,
	idempotencyKey: string,
	schema: z.ZodType<T>,
) {
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
	const connection = connectionOrThrow();
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
		contentType:
			response.headers.get("content-type") ?? "text/markdown; charset=utf-8",
		contentDisposition:
			response.headers.get("content-disposition") ??
			`attachment; filename="security-report-${reportRef.slice(0, 8)}.md"`,
	};
}
