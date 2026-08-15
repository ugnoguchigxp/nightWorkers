import { z } from "zod";
import {
	nightworkersSecurityIntelligenceBindingProofEnvelopeSchema,
	nightworkersSecurityIntelligenceCapabilitiesEnvelopeSchema,
	nightworkersSecurityIntelligenceSuccessEnvelopeSchema,
} from "../../../shared/schemas/nightworkers-security-intelligence.schema";
import {
	providerWorkspaceTargetGrantEnvelopeSchema,
	providerWorkspaceTargetPreviewEnvelopeSchema,
	providerWorkspaceTargetStartEnvelopeSchema,
} from "../../../shared/schemas/security-intelligence-runtime.schema";
import { AppError } from "../../lib/errors";
import { redactSecretText } from "../../services/security/secret-redaction";
import { getSecurityScanProviderConnection } from "../securityScan/security-scan-settings.service";

const BASE_PATH = "/api/integrations/nightworkers/security-intelligence/v1";
const ABSOLUTE_RESPONSE_LIMIT_BYTES = 2 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 30_000;
const providerErrorSchema = z
	.object({
		contractVersion: z.literal(1),
		requestId: z.string().min(1).max(64),
		error: z
			.object({
				code: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_]{0,127}$/),
				message: z.string().max(2_048),
				retryable: z.boolean().optional(),
			})
			.strict(),
	})
	.strict();

function requireHttpConnection() {
	const connection = getSecurityScanProviderConnection();
	if (
		!connection.enabled ||
		connection.transport !== "http" ||
		!connection.token
	) {
		throw new AppError(
			503,
			"SECURITY_INTELLIGENCE_PROVIDER_UNAVAILABLE",
			"Security Intelligence producer のHTTP接続が利用できません。",
		);
	}
	return connection;
}

async function readBoundedBody(response: Response, limit: number) {
	const contentLength = Number(response.headers.get("content-length") ?? "0");
	if (Number.isFinite(contentLength) && contentLength > limit) {
		await response.body?.cancel().catch(() => undefined);
		throw new AppError(
			502,
			"SECURITY_INTELLIGENCE_RESPONSE_TOO_LARGE",
			"Security Intelligence producer の応答が上限を超えています。",
		);
	}
	if (!response.body) return "";
	const reader = response.body.getReader();
	const chunks: Uint8Array[] = [];
	let total = 0;
	try {
		while (true) {
			const chunk = await reader.read();
			if (chunk.done) break;
			total += chunk.value.byteLength;
			if (total > limit) {
				await reader.cancel().catch(() => undefined);
				throw new AppError(
					502,
					"SECURITY_INTELLIGENCE_RESPONSE_TOO_LARGE",
					"Security Intelligence producer の応答が上限を超えています。",
				);
			}
			chunks.push(chunk.value);
		}
	} finally {
		reader.releaseLock();
	}
	return Buffer.concat(
		chunks.map((chunk) => Buffer.from(chunk)),
		total,
	).toString("utf8");
}

async function request<T>(input: {
	path: string;
	schema: z.ZodType<T>;
	method?: "GET" | "POST";
	body?: unknown;
	idempotencyKey?: string;
	responseLimit?: number;
}): Promise<T> {
	const connection = requireHttpConnection();
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
		response = await fetch(
			new URL(`${BASE_PATH}${input.path}`, connection.baseUrl),
			{
				method: input.method ?? "GET",
				headers,
				body: input.body === undefined ? undefined : JSON.stringify(input.body),
				redirect: "manual",
				signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
			},
		);
	} catch (error) {
		throw new AppError(
			503,
			"SECURITY_INTELLIGENCE_PROVIDER_UNREACHABLE",
			"Security Intelligence producerへ接続できません。",
			{
				cause: error instanceof Error ? error.name : "unknown",
				retryable: true,
			},
		);
	}
	const text = await readBoundedBody(
		response,
		Math.min(
			input.responseLimit ?? ABSOLUTE_RESPONSE_LIMIT_BYTES,
			ABSOLUTE_RESPONSE_LIMIT_BYTES,
		),
	);
	let json: unknown;
	try {
		json = JSON.parse(text);
	} catch {
		throw new AppError(
			502,
			"SECURITY_INTELLIGENCE_INVALID_RESPONSE",
			"Security Intelligence producerから不正なJSON応答を受信しました。",
		);
	}
	if (!response.ok) {
		const parsed = providerErrorSchema.safeParse(json);
		throw new AppError(
			response.status === 409 || response.status === 422
				? response.status
				: response.status >= 500
					? 503
					: 502,
			parsed.success
				? `SECURITY_INTELLIGENCE_PROVIDER_${parsed.data.error.code.toUpperCase()}`
				: "SECURITY_INTELLIGENCE_PROVIDER_REQUEST_FAILED",
			parsed.success
				? redactSecretText(parsed.data.error.message)
				: `Security Intelligence producer request が HTTP ${response.status} で失敗しました。`,
			parsed.success
				? {
						requestId: parsed.data.requestId,
						retryable: parsed.data.error.retryable ?? false,
					}
				: undefined,
		);
	}
	const parsed = input.schema.safeParse(json);
	if (!parsed.success) {
		throw new AppError(
			502,
			"SECURITY_INTELLIGENCE_CONTRACT_MISMATCH",
			"Security Intelligence producer のcontractが一致しません。",
			{ issues: parsed.error.issues },
		);
	}
	return parsed.data;
}

export async function securityIntelligenceCapabilities() {
	return (
		await request({
			path: "/capabilities",
			schema: nightworkersSecurityIntelligenceCapabilitiesEnvelopeSchema,
		})
	).data;
}

export async function securityIntelligenceBindingProof(scanRunRef: string) {
	return (
		await request({
			path: `/scans/${encodeURIComponent(scanRunRef)}/binding-proof`,
			schema: nightworkersSecurityIntelligenceBindingProofEnvelopeSchema,
		})
	).data;
}

export async function securityIntelligenceAssessment(
	scanRunRef: string,
	responseLimit: number,
) {
	return (
		await request({
			path: `/scans/${encodeURIComponent(scanRunRef)}/assessment`,
			schema: nightworkersSecurityIntelligenceSuccessEnvelopeSchema,
			responseLimit,
		})
	).data;
}

export async function createSecurityIntelligenceWorkspaceGrant(body: unknown) {
	return (
		await request({
			path: "/workspace-target-grants",
			method: "POST",
			body,
			schema: providerWorkspaceTargetGrantEnvelopeSchema,
		})
	).data;
}

export async function previewSecurityIntelligenceWorkspaceGrant(
	grantRef: string,
	selection: unknown,
) {
	return (
		await request({
			path: `/workspace-target-grants/${encodeURIComponent(grantRef)}/preview`,
			method: "POST",
			body: { version: 1, selection },
			schema: providerWorkspaceTargetPreviewEnvelopeSchema,
		})
	).data;
}

export async function startSecurityIntelligenceWorkspaceGrantScan(input: {
	grantRef: string;
	previewRef: string;
	selection: unknown;
	expectedTargetDigest: string;
	idempotencyKey: string;
}) {
	return (
		await request({
			path: `/workspace-target-grants/${encodeURIComponent(input.grantRef)}/scans`,
			method: "POST",
			body: {
				version: 1,
				previewRef: input.previewRef,
				selection: input.selection,
				expectedTargetDigest: input.expectedTargetDigest,
			},
			idempotencyKey: input.idempotencyKey,
			schema: providerWorkspaceTargetStartEnvelopeSchema,
		})
	).data;
}
