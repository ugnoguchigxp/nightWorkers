/**
 * JSON.parse accepts duplicate object keys and silently keeps the last value.
 * Pilot controls must fail closed instead, because a duplicated approval or
 * fingerprint field could otherwise be replaced without changing the file's
 * apparent structure during review.
 */
export function parseStrictJson(text: string): unknown {
	const parser = new DuplicateKeyJsonParser(text);
	parser.assertDocument();
	return JSON.parse(text);
}

class DuplicateKeyJsonParser {
	private index = 0;

	constructor(private readonly source: string) {}

	assertDocument(): void {
		this.skipWhitespace();
		this.value();
		this.skipWhitespace();
		if (this.index !== this.source.length) {
			throw new Error("Invalid trailing JSON content.");
		}
	}

	private value(): void {
		this.skipWhitespace();
		const current = this.source[this.index];
		if (current === "{") {
			this.object();
			return;
		}
		if (current === "[") {
			this.array();
			return;
		}
		if (current === '"') {
			this.string();
			return;
		}
		if (current === "-" || (current && /[0-9]/.test(current))) {
			this.number();
			return;
		}
		if (this.source.startsWith("true", this.index)) {
			this.index += 4;
			return;
		}
		if (this.source.startsWith("false", this.index)) {
			this.index += 5;
			return;
		}
		if (this.source.startsWith("null", this.index)) {
			this.index += 4;
			return;
		}
		throw new Error("Invalid JSON value.");
	}

	private object(): void {
		this.index += 1;
		this.skipWhitespace();
		const keys = new Set<string>();
		if (this.source[this.index] === "}") {
			this.index += 1;
			return;
		}
		while (true) {
			this.skipWhitespace();
			if (this.source[this.index] !== '"') {
				throw new Error("Invalid JSON object key.");
			}
			const key = this.string();
			if (keys.has(key)) throw new Error(`Duplicate JSON key: ${key}`);
			keys.add(key);
			this.skipWhitespace();
			if (this.source[this.index] !== ":") {
				throw new Error("Invalid JSON object separator.");
			}
			this.index += 1;
			this.value();
			this.skipWhitespace();
			if (this.source[this.index] === "}") {
				this.index += 1;
				return;
			}
			if (this.source[this.index] !== ",") {
				throw new Error("Invalid JSON object delimiter.");
			}
			this.index += 1;
		}
	}

	private array(): void {
		this.index += 1;
		this.skipWhitespace();
		if (this.source[this.index] === "]") {
			this.index += 1;
			return;
		}
		while (true) {
			this.value();
			this.skipWhitespace();
			if (this.source[this.index] === "]") {
				this.index += 1;
				return;
			}
			if (this.source[this.index] !== ",") {
				throw new Error("Invalid JSON array delimiter.");
			}
			this.index += 1;
		}
	}

	private string(): string {
		const start = this.index;
		this.index += 1;
		while (this.index < this.source.length) {
			const current = this.source[this.index];
			if (current === "\\") {
				this.index += 2;
				continue;
			}
			if (current === '"') {
				this.index += 1;
				try {
					return JSON.parse(this.source.slice(start, this.index));
				} catch {
					throw new Error("Invalid JSON string.");
				}
			}
			if (current && current.charCodeAt(0) < 0x20) {
				throw new Error("Invalid JSON string control character.");
			}
			this.index += 1;
		}
		throw new Error("Unterminated JSON string.");
	}

	private number(): void {
		const match = this.source
			.slice(this.index)
			.match(/^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/);
		if (!match) throw new Error("Invalid JSON number.");
		this.index += match[0].length;
	}

	private skipWhitespace(): void {
		while (/[\t\n\r ]/.test(this.source[this.index] ?? "")) {
			this.index += 1;
		}
	}
}
