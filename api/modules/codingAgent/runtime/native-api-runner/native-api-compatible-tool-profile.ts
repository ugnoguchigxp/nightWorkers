import type { ProviderToolDefinition } from "../../../../services/structured-llm/tool-calls";
import { objectSchema } from "./native-api-tool-schema";

const jsonStringLiteralSchema = {
	type: "string",
	minLength: 2,
	pattern: '^"(?:[^"\\\\]|\\\\.)*"$',
	description:
		"JSON string literalを1物理行で指定します。先頭末尾の引用符を含め、改行やtabは\\nや\\tとしてescapeし、生の改行を含めません。",
};

const compatibleEditToolDefinitions: Record<string, ProviderToolDefinition> = {
	apply_patch: {
		name: "apply_patch",
		description:
			"unified patchを適用します。patchJsonにはpatch全体をJSON string literalとして1物理行で指定し、生の改行を含めません。",
		inputSchema: objectSchema({ patchJson: jsonStringLiteralSchema }, [
			"patchJson",
		]),
	},
	replace_content: {
		name: "replace_content",
		description:
			"literalまたはregexで内容を置換します。needleJsonとreplacementJsonは引用符を含むJSON string literalを1物理行で指定し、生の改行を含めません。",
		inputSchema: objectSchema(
			{
				filePath: { type: "string" },
				needleJson: jsonStringLiteralSchema,
				replacementJson: jsonStringLiteralSchema,
				mode: { type: "string", enum: ["literal", "regex"] },
				allowMultipleOccurrences: { type: "boolean" },
			},
			["filePath", "needleJson", "replacementJson"],
		),
	},
};

export function getCompatibleEditToolDefinition(name: string) {
	return compatibleEditToolDefinitions[name] ?? null;
}

export function normalizeCompatibleEditToolArguments(
	toolName: string,
	args: Record<string, unknown>,
):
	| { ok: true; arguments: Record<string, unknown> }
	| { ok: false; message: string } {
	if (toolName === "apply_patch" && "patchJson" in args) {
		const decoded = decodeJsonStringLiteral(args.patchJson, "patchJson");
		if (!decoded.ok) return decoded;
		const { patchJson: _patchJson, ...rest } = args;
		return { ok: true, arguments: { ...rest, patchContent: decoded.value } };
	}
	if (
		toolName === "replace_content" &&
		("needleJson" in args || "replacementJson" in args)
	) {
		const needle = decodeJsonStringLiteral(args.needleJson, "needleJson");
		if (!needle.ok) return needle;
		const replacement = decodeJsonStringLiteral(
			args.replacementJson,
			"replacementJson",
		);
		if (!replacement.ok) return replacement;
		const {
			needleJson: _needleJson,
			replacementJson: _replacementJson,
			...rest
		} = args;
		return {
			ok: true,
			arguments: {
				...rest,
				needle: needle.value,
				replacement: replacement.value,
			},
		};
	}
	return { ok: true, arguments: args };
}

function decodeJsonStringLiteral(
	value: unknown,
	name: string,
): { ok: true; value: string } | { ok: false; message: string } {
	if (typeof value !== "string") {
		return { ok: false, message: `${name} must be a JSON string literal.` };
	}
	try {
		const decoded: unknown = JSON.parse(value);
		return typeof decoded === "string"
			? { ok: true, value: decoded }
			: { ok: false, message: `${name} must decode to a string.` };
	} catch {
		return { ok: false, message: `${name} is not valid JSON.` };
	}
}
