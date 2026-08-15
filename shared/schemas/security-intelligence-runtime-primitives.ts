import { createHash } from "node:crypto";
import { z } from "zod";
import { canonicalStringifySecurityIntelligenceValue } from "../security-intelligence-assessment-contract";

export const sha256Schema = z.string().regex(/^sha256:[a-f0-9]{64}$/);
export const rawSha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
export const safeRefSchema = z
	.string()
	.regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,511}$/);
export const timestampSchema = z.iso.datetime({ offset: true });

const hasForbiddenControlCharacter = (value: string) =>
	[...value].some((character) => {
		const code = character.codePointAt(0) ?? 0;
		return (
			code <= 0x08 ||
			code === 0x0b ||
			code === 0x0c ||
			(code >= 0x0e && code <= 0x1f) ||
			code === 0x7f
		);
	});

export const safeTextSchema = (max: number) =>
	z
		.string()
		.max(max)
		.refine((value) => value.normalize("NFC") === value)
		.refine((value) => !hasForbiddenControlCharacter(value));

export const boundedRefArraySchema = z
	.array(safeRefSchema)
	.max(1_000)
	.superRefine((values, ctx) => {
		if (
			values.some(
				(value, index) => index > 0 && (values[index - 1] ?? "") >= value,
			)
		) {
			ctx.addIssue({
				code: "custom",
				message:
					"security_intelligence:array_must_be_unique_and_canonically_sorted",
			});
		}
	});

export function digestValue(value: unknown): `sha256:${string}` {
	return `sha256:${createHash("sha256")
		.update(canonicalStringifySecurityIntelligenceValue(value))
		.digest("hex")}`;
}

export function ensureCanonicalBytes(
	value: unknown,
	maxBytes: number,
	code: string,
) {
	if (
		Buffer.byteLength(
			canonicalStringifySecurityIntelligenceValue(value),
			"utf8",
		) > maxBytes
	) {
		throw new Error(code);
	}
}
