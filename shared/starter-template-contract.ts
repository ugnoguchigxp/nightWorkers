export const STARTER_STACKS = ["hono", "python", "java", "rust"] as const;
export type StarterStack = (typeof STARTER_STACKS)[number];

export const STARTER_VARIANTS_BY_STACK = {
	hono: [
		"sqlite",
		"baseline",
		"postgres",
		"pgvector",
		"rag",
		"turso",
		"cloudflare",
	],
	python: [
		"sqlite",
		"baseline",
		"postgres",
		"pgvector",
		"turso",
		"cloudflare",
		"api-only",
	],
	java: ["java8-sqlite", "java8-postgres", "java25-sqlite", "java25-postgres"],
	rust: ["sqlite", "pgsql"],
} as const satisfies Record<StarterStack, readonly string[]>;

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

export const STARTER_OVERLAYS_BY_STACK = {
	hono: ["ssr", "ssg"],
	python: ["ssr", "ssg", "celery", "opentelemetry"],
	java: [],
	rust: [],
} as const satisfies Record<StarterStack, readonly string[]>;

export const STARTER_OVERLAYS = [
	"ssr",
	"ssg",
	"celery",
	"opentelemetry",
] as const;

export function isStarterVariantForStack(stack: StarterStack, variant: string) {
	return (STARTER_VARIANTS_BY_STACK[stack] as readonly string[]).includes(
		variant,
	);
}

export function isStarterOverlayForStack(stack: StarterStack, overlay: string) {
	return (STARTER_OVERLAYS_BY_STACK[stack] as readonly string[]).includes(
		overlay,
	);
}

export const STARTER_VARIANT_GUIDANCE = [
	`Hono: ${STARTER_VARIANTS_BY_STACK.hono.join("/")}`,
	`Python: ${STARTER_VARIANTS_BY_STACK.python.join("/")}`,
	`Java: ${STARTER_VARIANTS_BY_STACK.java.join("/")}`,
	`Rust: ${STARTER_VARIANTS_BY_STACK.rust.join("/")}`,
].join(". ");
