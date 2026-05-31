import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const pencilDir = path.resolve(scriptDir, '..');
const designSystemDir = path.resolve(pencilDir, '..');
const componentsDir = path.join(designSystemDir, 'src', 'components', 'ui');
const penPath = path.join(pencilDir, 'designSystem.pen');
const outPath = path.join(pencilDir, 'generatedVariants.ts');

const pen = JSON.parse(fs.readFileSync(penPath, 'utf8'));

/** @type {Set<string>} */
const names = new Set();

function walk(node) {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    for (const child of node) walk(child);
    return;
  }

  if (typeof node.name === 'string' && node.name.trim()) {
    names.add(node.name.trim());
  }

  for (const value of Object.values(node)) {
    walk(value);
  }
}

walk(pen);

/** @type {Map<string, Set<string>>} */
const grouped = new Map();
const namingWarnings = [];

for (const name of names) {
  const slashIndex = name.indexOf('/');
  if (slashIndex <= 0 || slashIndex === name.length - 1) continue;

  const component = name.slice(0, slashIndex).trim();
  const variant = name.slice(slashIndex + 1).trim();
  if (!component || !variant) continue;

  // Validation: PascalCase with no spaces
  if (component.includes(' ')) {
    namingWarnings.push(
      `"${name}": Component name part should not contain spaces. Use PascalCase.`
    );
  }

  if (component[0] !== component[0].toUpperCase()) continue;

  if (!grouped.has(component)) {
    grouped.set(component, new Set());
  }
  grouped.get(component).add(variant);
}

const index = Object.fromEntries(
  [...grouped.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([component, variants]) => [component, [...variants].sort((a, b) => a.localeCompare(b))])
);

// --- Component Parity Check ---

/** @param {string} str */
function pascalToKebab(str) {
  return str
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/([A-Z])([A-Z][a-z])/g, '$1-$2')
    .toLowerCase();
}

const penComponents = Object.keys(index);
const codeFiles = fs
  .readdirSync(componentsDir)
  .filter((f) => f.endsWith('.tsx') && !f.endsWith('.test.tsx'));
const codeComponents = codeFiles.map((f) => f.replace('.tsx', ''));

const missingInCode = [];
for (const pc of penComponents) {
  const kebab = pascalToKebab(pc);
  // Special handling for "BreadcrumbItem" -> "breadcrumb" etc if needed
  const variants = [kebab, kebab.replace(/-item$/, ''), kebab.replace(/-group$/, '')];
  if (!variants.some((v) => codeComponents.includes(v))) {
    missingInCode.push(pc);
  }
}

const missingInPen = [];
for (const cc of codeComponents) {
  // Simplistic reverse mapping: kebabs are documented if their Pascal equivalent exists
  const isDocumented = penComponents.some((pc) => {
    const pk = pascalToKebab(pc);
    return pk === cc || pk.replace(/-item$/, '') === cc || pk.replace(/-group$/, '') === cc;
  });
  if (!isDocumented) {
    missingInPen.push(cc);
  }
}

// --- Output ---

const totalVariants = Object.values(index).reduce((sum, variants) => sum + variants.length, 0);
const file = `/* eslint-disable */
/**
 * AUTO-GENERATED FILE.
 * Source: ./designSystem.pen
 * Run: pnpm -C designSystem pencil:variants
 */

export type PenVariantIndex = Record<string, string[]>;

export const penVariantIndex: PenVariantIndex = ${JSON.stringify(index, null, 2)};

export const penVariantMeta = {
  sourceVersion: ${JSON.stringify(String(pen.version ?? 'unknown'))},
  totalComponents: ${Object.keys(index).length},
  totalVariants: ${totalVariants}
} as const;
`;

fs.writeFileSync(outPath, file, 'utf8');

console.log(`\x1b[32m✅ Generated: ${path.relative(process.cwd(), outPath)}\x1b[0m`);
console.log(`Components: ${Object.keys(index).length}, Variants: ${totalVariants}`);

if (namingWarnings.length > 0) {
  console.log('\n\x1b[33m⚠️  Naming Warnings:\x1b[0m');
  for (const w of namingWarnings) {
    console.log(`  - ${w}`);
  }
}

if (missingInCode.length > 0) {
  console.log('\n\x1b[33m⚠️  Missing in Code (.pen components not implemented):\x1b[0m');
  for (const c of missingInCode) {
    console.log(`  - ${c} (expected ${pascalToKebab(c)}.tsx)`);
  }
}

if (missingInPen.length > 0) {
  console.log('\n\x1b[31m❌ Missing in Pencil (Components not documented in .pen):\x1b[0m');
  for (const c of missingInPen) {
    console.log(`  - ${c}`);
  }
}
