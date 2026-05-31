import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getAdapterForVersion } from '../pencil/adapters/index.js';
import {
  COLOR_TOKENS,
  getAllThemePermutations,
  THEME_AXES,
  THEME_DEFINITIONS,
  type ThemeAxes,
} from '../src/lib/design-tokens.js';

interface Token {
  base: string;
  themes?: Array<{
    mode?: string;
    base?: string;
    accent?: string;
    value: string;
  }>;
}

interface ScoredValue {
  value: string;
  score: number;
}

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const designSystemDir = path.resolve(scriptDir, '..');
const cssPath = path.join(designSystemDir, 'src', 'styles.css');
const penPath = path.join(designSystemDir, 'pencil', 'designSystem.pen');

// --- Utilities ---

function hexToHsl(hex: string): string {
  let r = 0,
    g = 0,
    b = 0;
  hex = hex.replace('#', '');
  if (hex.length === 3) {
    r = parseInt(hex[0] + hex[0], 16);
    g = parseInt(hex[1] + hex[1], 16);
    b = parseInt(hex[2] + hex[2], 16);
  } else {
    r = parseInt(hex.substring(0, 2), 16);
    g = parseInt(hex.substring(2, 4), 16);
    b = parseInt(hex.substring(4, 6), 16);
  }

  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b),
    min = Math.min(r, g, b);
  let h = 0,
    s = 0,
    l = (max + min) / 2;

  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r:
        h = (g - b) / d + (g < b ? 6 : 0);
        break;
      case g:
        h = (b - r) / d + 2;
        break;
      case b:
        h = (r - g) / d + 4;
        break;
    }
    h /= 6;
  }

  return `${Math.round(h * 360)} ${Math.round(s * 100)}% ${Math.round(l * 100)}%`;
}

function normalizeHexForPen(hex: string): string {
  hex = hex.replace('#', '').toLowerCase();
  if (hex.length === 3) hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2];
  if (hex.length === 6) hex += 'ff';
  return `#${hex}`;
}

/**
 * 与えられた軸の組合せに最適なトークン値を検索。
 * 特徴が一致する度が最も高いものを選択。
 */
function resolveTokenValue(token: Token, axes: ThemeAxes): string {
  if (!token.themes) return token.base;

  // 全テーマ設定をスコア付け (一致する軸の数)
  const scored = token.themes.map((t) => {
    let score = 0;
    if (t.mode && t.mode === axes.mode) score += 10;
    if (t.base && t.base === axes.base) score += 5;
    if (t.accent && t.accent === axes.accent) score += 5;

    // 矛盾がある場合は除外 (-1)
    if (t.mode && t.mode !== axes.mode) score = -1;
    if (t.base && t.base !== axes.base) score = -1;
    if (t.accent && t.accent !== axes.accent) score = -1;

    return { value: t.value, score };
  });

  const best = scored.reduce((prev, curr) => (curr.score > prev.score ? curr : prev), {
    value: token.base,
    score: 0,
  } as ScoredValue);
  return best.value;
}

// --- CSS Generation ---

function generateCss() {
  let cssContent = `/* === AUTO-GENERATED: DO NOT EDIT BELOW === */
/* Source: design-tokens.ts / Run: pnpm generate-tokens */\n\n`;

  // 1. Static Themes (Explicitly defined in THEME_DEFINITIONS like tokyo-night)
  for (const [themeKey, theme] of Object.entries(THEME_DEFINITIONS)) {
    const selector =
      themeKey === 'light'
        ? ':root, html.theme-light'
        : themeKey === 'dark'
          ? 'html.theme-dark, .dark'
          : `html.${theme.className}`;

    cssContent += `@layer base {\n  ${selector} {\n`;
    for (const [tokenName, token] of Object.entries(COLOR_TOKENS)) {
      let value = resolveTokenValue(token as Token, theme.axes);
      if ('overrides' in theme && theme.overrides && tokenName in theme.overrides) {
        value = (theme.overrides as Record<string, string>)[tokenName];
      }
      cssContent += `    --${tokenName}: ${hexToHsl(value)};\n`;
    }
    cssContent += '  }\n}\n\n';
  }

  // 2. Dynamic Matrix Themes (All combinations of Mode x Base x Accent)
  const allPerms = getAllThemePermutations();
  for (const axes of allPerms) {
    // skip base/neutral/default if it matches light/dark exactly (too many redundant classes)
    const isBase = axes.base === 'Neutral' && axes.accent === 'Default';
    if (isBase) continue;

    const className = `theme-${axes.mode?.toLowerCase()}-${axes.base?.toLowerCase()}-${axes.accent?.toLowerCase()}`;

    cssContent += `@layer base {\n  html.${className} {\n`;
    for (const [tokenName, token] of Object.entries(COLOR_TOKENS)) {
      const value = resolveTokenValue(token as Token, axes);
      // Only output if it differs from the mode's basic value?
      // Actually simpler to just output all for now, but filter redundant themes.
      cssContent += `    --${tokenName}: ${hexToHsl(value)};\n`;
    }
    cssContent += '  }\n}\n\n';
  }

  cssContent += '/* === END AUTO-GENERATED === */';

  const existingCss = fs.readFileSync(cssPath, 'utf8');
  const startMarker = '/* === AUTO-GENERATED: DO NOT EDIT BELOW === */';
  const endMarker = '/* === END AUTO-GENERATED === */';

  let newCss = '';
  if (existingCss.includes(startMarker) && existingCss.includes(endMarker)) {
    newCss = existingCss.replace(
      new RegExp(
        `${startMarker.replace(/\*/g, '\\*')}[\\s\\S]*?${endMarker.replace(/\*/g, '\\*')}`
      ),
      cssContent
    );
  } else {
    newCss = `${existingCss}\n\n${cssContent}`;
  }

  fs.writeFileSync(cssPath, newCss, 'utf8');
  console.log('✅ Generated CSS with 3-axis theme matrix: src/styles.css');
}

// --- Pencil Generation (Refactored to Stage 3 Adapter) ---

function generatePen() {
  if (!fs.existsSync(penPath)) {
    console.warn('⚠️ designSystem.pen not found. Skipping Pencil sync.');
    return;
  }

  const rawPen = JSON.parse(fs.readFileSync(penPath, 'utf8'));
  const adapter = getAdapterForVersion(rawPen.version || '2.9');

  const normalizedVariables: Record<string, any> = {};
  for (const [tokenName, tokenRaw] of Object.entries(COLOR_TOKENS)) {
    const token = tokenRaw as Token;
    const valueEntries = [];
    valueEntries.push({ value: normalizeHexForPen(token.base) });

    if (token.themes) {
      for (const t of token.themes) {
        const theme: any = {};
        if (t.mode) theme.Mode = t.mode;
        if (t.base) theme.Base = t.base;
        if (t.accent) theme.Accent = t.accent;
        valueEntries.push({ value: normalizeHexForPen(t.value), theme });
      }
    }

    normalizedVariables[tokenName] = {
      type: 'color',
      value: valueEntries.length === 1 ? valueEntries[0].value : valueEntries,
    };
  }

  const updatedPen = adapter.updateVariablesAndThemes(
    rawPen,
    normalizedVariables,
    THEME_AXES as any
  );

  fs.writeFileSync(penPath, JSON.stringify(updatedPen, null, 2), 'utf8');
  console.log(`✅ Patched Pencil via ${adapter.supportedVersion} adapter: pencil/designSystem.pen`);
}

// --- Execution ---

try {
  generateCss();
  generatePen();
} catch (err) {
  console.error('❌ Token generation failed:', err);
  process.exit(1);
}
