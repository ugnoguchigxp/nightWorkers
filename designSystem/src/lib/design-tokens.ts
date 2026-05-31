export const FONT_SCALE_PRESETS = {
  small: { label: 'Small', value: '0.875rem' },
  default: { label: 'Default', value: '1rem' },
  large: { label: 'Large', value: '1.125rem' },
} as const;

export const DENSITY_PRESETS = {
  compact: { label: 'Compact', value: '0.75' },
  default: { label: 'Default', value: '1' },
  comfortable: { label: 'Comfortable', value: '1.25' },
} as const;

export const RADIUS_PRESETS = {
  sharp: { label: 'Sharp', value: '0' },
  default: { label: 'Default', value: '1' },
  rounded: { label: 'Rounded', value: '2' },
  pill: { label: 'Pill', value: '9999' },
} as const;

export const SHADOW_PRESETS = {
  none: { label: 'None', var: 'none' },
  subtle: {
    label: 'Subtle',
    var: '0 1px 3px 0 rgb(0 0 0 / 0.10), 0 1px 2px -1px rgb(0 0 0 / 0.10)',
  },
  medium: {
    label: 'Medium',
    var: '0 4px 6px -1px rgb(0 0 0 / 0.10), 0 2px 4px -2px rgb(0 0 0 / 0.10)',
  },
  strong: {
    label: 'Strong',
    var: '0 20px 25px -5px rgb(0 0 0 / 0.15), 0 8px 10px -6px rgb(0 0 0 / 0.10)',
  },
} as const;

// --- Design Sync Sync v2.1: SSoT Foundations ---

/** Pencil.dev Theme Axes */
export const THEME_AXES = {
  Mode: ['Light', 'Dark'],
  Base: ['Neutral', 'Gray', 'Stone', 'Zinc', 'Slate'],
  Accent: ['Default', 'Red', 'Rose', 'Orange', 'Green', 'Blue', 'Yellow', 'Violet'],
} as const;

export type ThemeAxes = {
  mode?: (typeof THEME_AXES.Mode)[number];
  base?: (typeof THEME_AXES.Base)[number];
  accent?: (typeof THEME_AXES.Accent)[number];
};

/**
 * 3軸すべての組み合わせを生成。
 * 開発者が明示的に定義したもの以外は、デフォルト（Blue/Neutral等）を継承。
 */
export function getAllThemePermutations() {
  const permutations: ThemeAxes[] = [];
  for (const mode of THEME_AXES.Mode) {
    for (const base of THEME_AXES.Base) {
      for (const accent of THEME_AXES.Accent) {
        permutations.push({ mode, base, accent });
      }
    }
  }
  return permutations;
}

/**
 * カラートークンのマスター定義 (HEX形式)。
 * 生成スクリプトがこれを HSL (CSS用) や HEX (Pencil用) に変換する。
 */
export const COLOR_TOKENS = {
  // Core Standard
  background: {
    base: '#f8f8f9',
    themes: [
      { mode: 'Dark', value: '#0f172a' },
      { base: 'Gray', value: '#f9fafb' },
      { mode: 'Dark', base: 'Gray', value: '#111827' },
      { base: 'Slate', value: '#f8fafc' },
      { mode: 'Dark', base: 'Slate', value: '#0f172a' },
      { base: 'Stone', value: '#fafaf9' },
      { mode: 'Dark', base: 'Stone', value: '#1c1917' },
      { base: 'Zinc', value: '#fafafa' },
      { mode: 'Dark', base: 'Zinc', value: '#18181b' },
    ],
  },
  foreground: {
    base: '#020617',
    themes: [
      { mode: 'Dark', value: '#f8fafc' },
      { base: 'Gray', value: '#030712' },
      { mode: 'Dark', base: 'Gray', value: '#f9fafb' },
    ],
  },
  card: {
    base: '#ffffff',
    themes: [{ mode: 'Dark', value: '#0f172a' }],
  },
  'card-foreground': {
    base: '#020617',
    themes: [{ mode: 'Dark', value: '#f8fafc' }],
  },
  popover: {
    base: '#ffffff',
    themes: [{ mode: 'Dark', value: '#0f172a' }],
  },
  'popover-foreground': {
    base: '#020617',
    themes: [{ mode: 'Dark', value: '#f8fafc' }],
  },
  primary: {
    base: '#007aff', // Default Accent: Blue
    themes: [
      { mode: 'Dark', value: '#3b82f6' },
      { accent: 'Red', value: '#dc2626' },
      { mode: 'Dark', accent: 'Red', value: '#ef4444' },
      { accent: 'Rose', value: '#e11d48' },
      { mode: 'Dark', accent: 'Rose', value: '#fb7185' },
      { accent: 'Orange', value: '#f97316' },
      { mode: 'Dark', accent: 'Orange', value: '#fb923c' },
      { accent: 'Green', value: '#16a34a' },
      { mode: 'Dark', accent: 'Green', value: '#22c55e' },
      { accent: 'Violet', value: '#7c3aed' },
      { mode: 'Dark', accent: 'Violet', value: '#8b5cf6' },
      { accent: 'Yellow', value: '#eab308' },
      { mode: 'Dark', accent: 'Yellow', value: '#facc15' },
    ],
  },
  'primary-foreground': {
    base: '#ffffff',
    themes: [{ mode: 'Dark', value: '#f8fafc' }],
  },
  secondary: {
    base: '#f1f5f9',
    themes: [
      { mode: 'Dark', value: '#1e293b' },
      { base: 'Stone', value: '#f5f5f4' },
      { mode: 'Dark', base: 'Stone', value: '#292524' },
    ],
  },
  'secondary-foreground': {
    base: '#0f172a',
    themes: [{ mode: 'Dark', value: '#f8fafc' }],
  },
  muted: {
    base: '#f1f5f9',
    themes: [{ mode: 'Dark', value: '#1e293b' }],
  },
  'muted-foreground': {
    base: '#64748b',
    themes: [{ mode: 'Dark', value: '#94a3b8' }],
  },
  accent: {
    base: '#f1f5f9',
    themes: [{ mode: 'Dark', value: '#1e293b' }],
  },
  'accent-foreground': {
    base: '#0f172a',
    themes: [{ mode: 'Dark', value: '#f8fafc' }],
  },
  destructive: {
    base: '#ef4444',
    themes: [{ mode: 'Dark', value: '#7f1d1d' }],
  },
  'destructive-foreground': {
    base: '#ffffff',
    themes: [{ mode: 'Dark', value: '#f8fafc' }],
  },
  border: {
    base: '#e2e8f0',
    themes: [{ mode: 'Dark', value: '#1e293b' }],
  },
  input: {
    base: '#e2e8f0',
    themes: [{ mode: 'Dark', value: '#1e293b' }],
  },
  ring: {
    base: '#007aff',
    themes: [{ mode: 'Dark', value: '#3b82f6' }],
  },
  success: {
    base: '#34c759',
    themes: [{ mode: 'Dark', value: '#22c55e' }],
  },
  'success-foreground': {
    base: '#ffffff',
    themes: [{ mode: 'Dark', value: '#f8fafc' }],
  },
  warning: {
    base: '#ff9500',
    themes: [{ mode: 'Dark', value: '#f59e0b' }],
  },
  'warning-foreground': {
    base: '#ffffff',
    themes: [{ mode: 'Dark', value: '#f8fafc' }],
  },
  info: {
    base: '#0ea5e9',
    themes: [{ mode: 'Dark', value: '#38bdf8' }],
  },
  'info-foreground': {
    base: '#ffffff',
    themes: [{ mode: 'Dark', value: '#f8fafc' }],
  },
  // --- Standard Semantic Additions ---
  white: {
    base: '#ffffff',
    themes: [],
  },
  'destructive-soft': {
    base: '#ef44441a', // 10% opacity
    themes: [{ mode: 'Dark', value: '#7f1d1d33' }],
  },
  'success-soft': {
    base: '#34c7591a',
    themes: [{ mode: 'Dark', value: '#22c55e33' }],
  },
  'warning-soft': {
    base: '#ff95001a',
    themes: [{ mode: 'Dark', value: '#f59e0b33' }],
  },
  'info-soft': {
    base: '#0ea5e91a',
    themes: [{ mode: 'Dark', value: '#38bdf833' }],
  },
  // --- Sidebar Series ---
  sidebar: {
    base: '#f8f8f9',
    themes: [{ mode: 'Dark', value: '#0f172a' }],
  },
  'sidebar-foreground': {
    base: '#020617',
    themes: [{ mode: 'Dark', value: '#f8fafc' }],
  },
  'sidebar-primary': {
    base: '#007aff',
    themes: [{ mode: 'Dark', value: '#3b82f6' }],
  },
  'sidebar-primary-foreground': {
    base: '#ffffff',
    themes: [{ mode: 'Dark', value: '#f8fafc' }],
  },
  'sidebar-accent': {
    base: '#f1f5f9',
    themes: [{ mode: 'Dark', value: '#1e293b' }],
  },
  'sidebar-accent-foreground': {
    base: '#0f172a',
    themes: [{ mode: 'Dark', value: '#f8fafc' }],
  },
  'sidebar-border': {
    base: '#e2e8f0',
    themes: [{ mode: 'Dark', value: '#1e293b' }],
  },
  'sidebar-ring': {
    base: '#007aff',
    themes: [{ mode: 'Dark', value: '#3b82f6' }],
  },
} as const;

/**
 * テーマ定義と生成情報のマッピング。
 */
export const THEME_DEFINITIONS = {
  light: { label: 'Light', className: 'theme-light', axes: { mode: 'Light' } },
  dark: { label: 'Dark', className: 'theme-dark', axes: { mode: 'Dark' } },
  'tokyo-night': {
    label: 'Tokyo Night',
    className: 'theme-tokyo-night',
    axes: { mode: 'Dark' },
    overrides: {
      background: '#1a1b26',
      card: '#1a1b26',
      border: '#24283b',
      primary: '#7aa2f7',
    },
  },
} as const;

export const COLOR_THEME_PRESETS = THEME_DEFINITIONS;

export type FontScaleKey = keyof typeof FONT_SCALE_PRESETS;
export type DensityKey = keyof typeof DENSITY_PRESETS;
export type RadiusKey = keyof typeof RADIUS_PRESETS;
export type ShadowKey = keyof typeof SHADOW_PRESETS;
export type ColorThemeKey = keyof typeof COLOR_THEME_PRESETS;

export const DESIGN_TOKEN_DEFAULTS = {
  colorTheme: 'light',
  fontScale: 'default',
  density: 'default',
  radius: 'default',
  shadow: 'subtle',
} as const satisfies {
  colorTheme: ColorThemeKey;
  fontScale: FontScaleKey;
  density: DensityKey;
  radius: RadiusKey;
  shadow: ShadowKey;
};

function getRootElement(root?: HTMLElement | null) {
  if (root) {
    return root;
  }
  if (typeof document !== 'undefined') {
    return document.documentElement;
  }
  return null;
}

export function applyDensityAndScaleTokens(
  options: {
    fontScale: FontScaleKey;
    density: DensityKey;
    radius: RadiusKey;
    shadow: ShadowKey;
  },
  root?: HTMLElement | null
) {
  const rootElement = getRootElement(root);
  if (!rootElement) {
    return;
  }
  rootElement.style.setProperty('--font-size-base', FONT_SCALE_PRESETS[options.fontScale].value);
  rootElement.style.setProperty('--spacing-unit', DENSITY_PRESETS[options.density].value);
  rootElement.style.setProperty('--radius-factor', RADIUS_PRESETS[options.radius].value);
  rootElement.style.setProperty('--shadow-md', SHADOW_PRESETS[options.shadow].var);
}

export function applyColorTheme(theme: ColorThemeKey, root?: HTMLElement | null) {
  const rootElement = getRootElement(root);
  if (!rootElement) {
    return;
  }
  for (const className of rootElement.classList) {
    if (className.startsWith('theme-')) {
      rootElement.classList.remove(className);
    }
  }
  rootElement.classList.add(COLOR_THEME_PRESETS[theme].className);
}
