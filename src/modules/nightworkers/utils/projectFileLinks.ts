const PROJECT_FILE_EXTENSION_PATTERN =
	/\.(?:[cm]?[jt]sx?|tsx?|json|mdx?|markdown|ya?ml|toml|css|scss|sass|less|html?|sql|graphql|gql|prisma|py|rb|go|rs|java|kt|kts|swift|php|cs|cpp|cxx|cc|c|h|hpp|sh|bash|zsh|fish|env|lock|txt)$/i;

export function normalizeProjectFileLinkTarget(
	target: string | null | undefined,
): string | null {
	const rawTarget = String(target || "").trim();
	if (!rawTarget || rawTarget.startsWith("#")) return null;
	if (/^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(rawTarget)) return null;

	let filePath = rawTarget;
	try {
		filePath = decodeURIComponent(filePath);
	} catch {
		return null;
	}

	filePath = filePath
		.replace(/^\.\/+/, "")
		.replace(/#L\d+(?:-L?\d+)?$/i, "")
		.replace(/[?#].*$/, "")
		.replace(/:(\d+)(?::\d+)?$/, "")
		.trim();

	if (!filePath) return null;
	if (filePath.startsWith("/") || filePath.startsWith("../")) return null;
	if (filePath.includes("\\") || filePath.includes("\0")) return null;
	if (filePath.split("/").some((segment) => segment === "..")) return null;
	if (!PROJECT_FILE_EXTENSION_PATTERN.test(filePath)) return null;

	return filePath;
}
