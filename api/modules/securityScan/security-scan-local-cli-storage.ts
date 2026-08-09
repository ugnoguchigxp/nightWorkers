import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import type {
	SecurityScanFindingPage,
	SecurityScanReportDetail,
	SecurityScanRunDetail,
	SecurityScanSelection,
	SecurityScanTarget,
} from "../../../shared/schemas/security-scan.schema";
import {
	securityScanFindingPageSchema,
	securityScanReportDetailSchema,
	securityScanRunDetailSchema,
	securityScanSelectionSchema,
	securityScanTargetSchema,
} from "../../../shared/schemas/security-scan.schema";
import { AppError } from "../../lib/errors";
import { getRuntimePaths } from "../../runtime/paths";

const LOCAL_SCAN_DIRECTORY = "vulnworkbench-local-cli";
const LOCAL_SCAN_REF_PATTERN =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const localScanRecordSchema = z
	.object({
		version: z.literal(1),
		idempotencyKey: z.string().uuid(),
		projectPath: z.string().min(1).max(4096),
		request: z
			.object({
				previewRef: z.string().uuid(),
				selection: securityScanSelectionSchema,
				target: securityScanTargetSchema,
				expectedTargetDigest: z.string().regex(/^[0-9a-f]{64}$/),
			})
			.strict()
			.optional(),
		execution: z
			.object({ timeoutSeconds: z.number().int().positive() })
			.strict()
			.optional(),
		detail: securityScanRunDetailSchema,
		findings: securityScanFindingPageSchema.shape.items,
		report: securityScanReportDetailSchema.nullable(),
		reportContent: z
			.string()
			.max(5 * 1024 * 1024)
			.nullable(),
		updatedAt: z.string().datetime(),
	})
	.strict();

export type LocalScanRecord = {
	version: 1;
	idempotencyKey: string;
	projectPath: string;
	request?: {
		previewRef: string;
		selection: SecurityScanSelection;
		target: SecurityScanTarget;
		expectedTargetDigest: string;
	};
	execution?: { timeoutSeconds: number };
	detail: SecurityScanRunDetail;
	findings: SecurityScanFindingPage["items"];
	report: SecurityScanReportDetail | null;
	reportContent: string | null;
	updatedAt: string;
};

export async function requireLocalScanRecord(scanRunRef: string) {
	const record = await readLocalScanRecord(scanRunRef);
	if (!record) {
		throw new AppError(
			404,
			"SECURITY_SCAN_NOT_FOUND",
			"ローカルCLIスキャンが見つかりません。",
		);
	}
	return record;
}

export async function readLocalScanRecord(
	scanRunRef: string,
): Promise<LocalScanRecord | null> {
	try {
		const parsed = localScanRecordSchema.safeParse(
			JSON.parse(await fs.readFile(localScanRecordPath(scanRunRef), "utf8")),
		);
		if (!parsed.success) {
			throw new AppError(
				500,
				"SECURITY_SCAN_ARTIFACT_INVALID",
				"ローカルCLIスキャンの保存データが破損しています。",
			);
		}
		return parsed.data;
	} catch (error) {
		if (
			error &&
			typeof error === "object" &&
			"code" in error &&
			error.code === "ENOENT"
		) {
			return null;
		}
		throw error;
	}
}

export async function writeLocalScanRecord(record: LocalScanRecord) {
	const validated = localScanRecordSchema.parse(record);
	const target = localScanRecordPath(record.detail.scanRunRef);
	await fs.mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
	const temporary = `${target}.${process.pid}.${crypto.randomUUID()}.tmp`;
	await fs.writeFile(temporary, `${JSON.stringify(validated)}\n`, {
		mode: 0o600,
	});
	try {
		await fs.rename(temporary, target);
	} finally {
		await fs.rm(temporary, { force: true }).catch(() => undefined);
	}
}

export async function findLocalScanRecordByIdempotency(
	projectPath: string,
	idempotencyKey: string,
) {
	let entries: string[];
	try {
		entries = await fs.readdir(localScanDirectory());
	} catch (error) {
		if (isMissingFileError(error)) return null;
		throw error;
	}
	const expectedPath = path.resolve(projectPath);
	for (const entry of entries) {
		if (!entry.endsWith(".json")) continue;
		const scanRunRef = entry.slice(0, -".json".length);
		if (!LOCAL_SCAN_REF_PATTERN.test(scanRunRef)) continue;
		const record = await readLocalScanRecord(scanRunRef).catch((error) => {
			if (
				error instanceof AppError &&
				error.code === "SECURITY_SCAN_ARTIFACT_INVALID"
			) {
				return null;
			}
			throw error;
		});
		if (
			record?.idempotencyKey === idempotencyKey &&
			path.resolve(record.projectPath) === expectedPath
		) {
			return record;
		}
	}
	return null;
}

export function localScanRecordPath(scanRunRef: string) {
	if (!LOCAL_SCAN_REF_PATTERN.test(scanRunRef)) {
		throw new AppError(
			404,
			"SECURITY_SCAN_NOT_FOUND",
			"ローカルCLIスキャンが見つかりません。",
		);
	}
	return path.join(localScanDirectory(), `${scanRunRef}.json`);
}

function localScanDirectory() {
	return path.join(getRuntimePaths().artifactsDir, LOCAL_SCAN_DIRECTORY);
}

function isMissingFileError(error: unknown) {
	return (
		error !== null &&
		typeof error === "object" &&
		"code" in error &&
		error.code === "ENOENT"
	);
}
