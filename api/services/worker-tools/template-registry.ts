export type StandardTemplateId =
	| "hono-standard"
	| "python-standard"
	| "java-template"
	| "rust-template";
export const STARTER_STACKS = ["hono", "python", "java", "rust"] as const;
export type StarterStack = (typeof STARTER_STACKS)[number];
export const STARTER_VARIANTS = [
	"sqlite",
	"baseline",
	"postgres",
	"pgvector",
	"rag",
	"turso",
	"cloudflare",
	"api-only",
	"java8-sqlite",
	"java8-postgres",
	"java25-sqlite",
	"java25-postgres",
	"pgsql",
] as const;

export type TemplateRef = {
	name: string;
	ref: string;
	description: string;
};

export type TemplateDefinition = {
	id: StandardTemplateId;
	repoUrl: string;
	defaultVariant: string;
	variants: Record<string, TemplateRef>;
	overlays: Record<string, TemplateRef>;
};

export type TemplateRegistry = Partial<
	Record<StandardTemplateId, TemplateDefinition>
>;

export const standardTemplateRegistry: Record<
	StandardTemplateId,
	TemplateDefinition
> = {
	"hono-standard": {
		id: "hono-standard",
		repoUrl: "https://github.com/ugnoguchigxp/hono-standard.git",
		defaultVariant: "sqlite",
		variants: {
			sqlite: {
				name: "sqlite",
				ref: "variant/sqlite",
				description: "Hono + React/Vite baseline with SQLite.",
			},
			baseline: {
				name: "baseline",
				ref: "variant/sqlite",
				description: "Alias for the Hono SQLite baseline snapshot.",
			},
			postgres: {
				name: "postgres",
				ref: "variant/postgres",
				description: "Hono baseline configured for PostgreSQL.",
			},
			pgvector: {
				name: "pgvector",
				ref: "variant/pgvector",
				description: "Hono baseline configured for pgvector.",
			},
			rag: {
				name: "rag",
				ref: "variant/rag",
				description:
					"Hono RAG app template with PostgreSQL, pgvector, hybrid search, and agentic search.",
			},
			turso: {
				name: "turso",
				ref: "variant/turso",
				description: "Hono baseline configured for Turso/libSQL.",
			},
			cloudflare: {
				name: "cloudflare",
				ref: "variant/cloudflare",
				description: "Hono baseline configured for Cloudflare deployment.",
			},
		},
		overlays: {
			ssr: {
				name: "ssr",
				ref: "overlay/ssr",
				description: "SSR overlay snapshot.",
			},
			ssg: {
				name: "ssg",
				ref: "overlay/ssg",
				description: "SSG overlay snapshot.",
			},
		},
	},
	"python-standard": {
		id: "python-standard",
		repoUrl: "https://github.com/ugnoguchigxp/python-standard.git",
		defaultVariant: "sqlite",
		variants: {
			sqlite: {
				name: "sqlite",
				ref: "sqlite-v1.0.0",
				description: "FastAPI + React/Vite baseline with SQLite.",
			},
			baseline: {
				name: "baseline",
				ref: "sqlite-v1.0.0",
				description: "Alias for the Python SQLite baseline snapshot.",
			},
			postgres: {
				name: "postgres",
				ref: "postgres-v1.0.0",
				description: "Python baseline configured for PostgreSQL.",
			},
			pgvector: {
				name: "pgvector",
				ref: "pgvector-v1.0.0",
				description: "Python baseline configured for pgvector.",
			},
			turso: {
				name: "turso",
				ref: "turso-v1.0.0",
				description: "Python baseline configured for Turso/libSQL.",
			},
			cloudflare: {
				name: "cloudflare",
				ref: "cloudflare-v1.0.0",
				description: "Python baseline configured for Cloudflare deployment.",
			},
			"api-only": {
				name: "api-only",
				ref: "api-only-v1.0.0",
				description: "Python API-only snapshot.",
			},
		},
		overlays: {
			ssr: {
				name: "ssr",
				ref: "overlay-ssr-v1.0.0",
				description: "SSR overlay snapshot.",
			},
			ssg: {
				name: "ssg",
				ref: "overlay-ssg-v1.0.0",
				description: "SSG overlay snapshot.",
			},
			celery: {
				name: "celery",
				ref: "overlay-celery-v1.0.0",
				description: "Celery worker overlay snapshot.",
			},
			opentelemetry: {
				name: "opentelemetry",
				ref: "overlay-opentelemetry-v1.0.0",
				description: "OpenTelemetry overlay snapshot.",
			},
		},
	},
	"java-template": {
		id: "java-template",
		repoUrl: "https://github.com/ugnoguchigxp/java-template.git",
		defaultVariant: "java25-sqlite",
		variants: {
			"java8-sqlite": {
				name: "java8-sqlite",
				ref: "variant/java8-sqlite",
				description:
					"Java 8 + Spring Boot 2.7 + React/Vite baseline with SQLite.",
			},
			"java8-postgres": {
				name: "java8-postgres",
				ref: "variant/java-8-postgresql",
				description:
					"Java 8 + Spring Boot 2.7 + React/Vite baseline with PostgreSQL.",
			},
			"java25-sqlite": {
				name: "java25-sqlite",
				ref: "variant/java25-sqlite",
				description:
					"Java 25 + Spring Boot 4 + React/Vite baseline with SQLite.",
			},
			"java25-postgres": {
				name: "java25-postgres",
				ref: "variant/java25-postgres",
				description:
					"Java 25 + Spring Boot 4 + React/Vite baseline with PostgreSQL.",
			},
		},
		overlays: {},
	},
	"rust-template": {
		id: "rust-template",
		repoUrl: "https://github.com/ugnoguchigxp/rust-template.git",
		defaultVariant: "sqlite",
		variants: {
			sqlite: {
				name: "sqlite",
				ref: "variant/sqlite",
				description: "Rust + Axum + React/Vite baseline with SQLite.",
			},
			pgsql: {
				name: "pgsql",
				ref: "variant/postgresql",
				description: "Rust + Axum + React/Vite baseline with PostgreSQL.",
			},
		},
		overlays: {},
	},
};

const templateIdByStarterStack: Record<StarterStack, StandardTemplateId> = {
	hono: "hono-standard",
	python: "python-standard",
	java: "java-template",
	rust: "rust-template",
};

export function isStarterVariantForStack(stack: StarterStack, variant: string) {
	return Boolean(
		standardTemplateRegistry[templateIdByStarterStack[stack]].variants[variant],
	);
}

export function normalizeTemplateKey(value: unknown): string | null {
	if (typeof value !== "string") return null;
	if (value.trim().length === 0) return null;
	return value.trim().toLowerCase().replace(/_/g, "-");
}

export function resolveStandardTemplate(input: {
	templateId: unknown;
	variant?: unknown;
	registry?: TemplateRegistry;
}) {
	const registry = input.registry || standardTemplateRegistry;
	const templateId = normalizeTemplateKey(
		input.templateId,
	) as StandardTemplateId | null;
	if (!templateId) {
		return {
			ok: false as const,
			code: "INVALID_TEMPLATE_ID",
			message: "templateId must be a non-empty string.",
		};
	}
	const template = registry[templateId];
	if (!template) {
		return {
			ok: false as const,
			code: "UNKNOWN_TEMPLATE",
			message: `Unknown templateId: ${input.templateId}`,
		};
	}

	const variantKey =
		normalizeTemplateKey(input.variant) || template.defaultVariant;
	const variant = template.variants[variantKey];
	if (!variant) {
		return {
			ok: false as const,
			code: "UNKNOWN_TEMPLATE_VARIANT",
			message: `Unknown ${template.id} variant: ${input.variant}`,
		};
	}

	return {
		ok: true as const,
		template,
		variant,
	};
}

export function resolveStarterTemplate(input: {
	stack?: unknown;
	variant?: unknown;
	registry?: TemplateRegistry;
}) {
	const registry = input.registry || standardTemplateRegistry;
	const normalizedStackKey = normalizeTemplateKey(input.stack);
	const normalizedStack = STARTER_STACKS.find(
		(stack) => stack === normalizedStackKey,
	);
	const normalizedVariant = normalizeTemplateKey(input.variant);

	if (normalizedStackKey && !normalizedStack) {
		return {
			ok: false as const,
			code: "UNKNOWN_STARTER_STACK",
			message: `Unknown starter stack: ${input.stack}`,
		};
	}

	const candidateTemplateIds: StandardTemplateId[] = normalizedStack
		? [templateIdByStarterStack[normalizedStack]]
		: STARTER_STACKS.map((stack) => templateIdByStarterStack[stack]);

	if (normalizedVariant) {
		const matchingTemplateIds = candidateTemplateIds.filter((templateId) =>
			Boolean(registry[templateId]?.variants[normalizedVariant]),
		);
		if (matchingTemplateIds.length === 1) {
			return resolveStandardTemplate({
				templateId: matchingTemplateIds[0],
				variant: normalizedVariant,
				registry,
			});
		}
		if (matchingTemplateIds.length > 1 && !normalizedStack) {
			return resolveStandardTemplate({
				templateId: "hono-standard",
				variant: normalizedVariant,
				registry,
			});
		}
		if (normalizedStack) {
			return {
				ok: false as const,
				code: "UNKNOWN_TEMPLATE_VARIANT",
				message: `Unknown ${normalizedStack} starter variant: ${input.variant}`,
			};
		}
	}

	return resolveStandardTemplate({
		templateId: normalizedStack
			? templateIdByStarterStack[normalizedStack]
			: "hono-standard",
		variant: normalizedVariant || undefined,
		registry,
	});
}
