import type React from 'react';
import { useTranslation } from 'react-i18next';
import type { ProjectDetailMetrics } from '../../../../../shared/schemas/project-detail.schema';
import {
  controlStyle,
  mutedTextStyle,
  panelStyle,
  primaryTextStyle,
  subtleTextStyle,
  tableBorderStyle,
} from './styles';

export function KpiTile({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="border p-3" style={panelStyle}>
      <div className="text-[10px] font-semibold uppercase" style={subtleTextStyle}>
        {label}
      </div>
      <div className="mt-2 truncate text-xl font-bold">{value}</div>
      <div className="mt-1 truncate text-[11px]" style={subtleTextStyle}>
        {sub}
      </div>
    </div>
  );
}

export function TokenBreakdownBand({ metrics }: { metrics: ProjectDetailMetrics }) {
  const { t } = useTranslation();
  const items = [
    {
      key: 'input',
      label: t('projectDetail.usage.input'),
      value: metrics.llmUsage.inputTokens,
    },
    {
      key: 'output',
      label: t('projectDetail.usage.output'),
      value: metrics.llmUsage.outputTokens,
    },
    {
      key: 'cached',
      label: t('projectDetail.usage.cachedInput'),
      value: metrics.llmUsage.cachedInputTokens,
    },
    {
      key: 'reasoning',
      label: t('projectDetail.usage.reasoningOutput'),
      value: metrics.llmUsage.reasoningOutputTokens,
    },
    {
      key: 'state',
      label: t('projectDetail.usage.stateCard'),
      value: metrics.llmUsage.stateCardTokens,
    },
    {
      key: 'prompt',
      label: t('projectDetail.usage.promptParts'),
      value: metrics.llmUsage.promptInputTokens,
    },
  ];

  return (
    <div
      className="grid gap-2 border p-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6"
      style={panelStyle}
    >
      {items.map((item) => (
        <div key={item.key} className="min-w-0">
          <div className="truncate text-[10px] font-semibold uppercase" style={subtleTextStyle}>
            {item.label}
          </div>
          <div className="mt-1 truncate text-sm font-bold">{item.value.toLocaleString()}</div>
        </div>
      ))}
    </div>
  );
}

export function CompactHealthTile({
  icon,
  label,
  value,
  tone,
  compact = false,
}: {
  icon: React.ReactNode;
  label: string;
  value: React.ReactNode;
  tone: 'primary' | 'warning';
  compact?: boolean;
}) {
  const accent =
    tone === 'warning'
      ? 'color-mix(in srgb, var(--nw-warning) 82%, var(--nw-text))'
      : 'var(--nw-primary)';
  return (
    <div className={`border ${compact ? 'p-2.5' : 'p-4'}`} style={panelStyle}>
      <div
        className={compact ? 'flex h-full min-w-0 flex-col items-center justify-center' : 'min-w-0'}
      >
        <div
          className={
            compact
              ? 'flex flex-col items-center gap-1 text-center text-[10px] font-semibold leading-tight'
              : 'flex items-center gap-2 text-xs font-semibold'
          }
          style={mutedTextStyle}
        >
          <span style={{ color: accent }}>{icon}</span>
          {label}
        </div>
        <div className={compact ? 'mt-1' : 'mt-2'}>
          {typeof value === 'string' ? (
            <span className="text-2xl font-bold" style={{ color: accent }}>
              {value}
            </span>
          ) : (
            value
          )}
        </div>
      </div>
    </div>
  );
}

export function CoverageBreakdown({ axes }: { axes: { labelKey: string; value: number }[] }) {
  const { t } = useTranslation();
  if (axes.length === 0) {
    return (
      <span className="text-2xl font-bold" style={{ color: 'var(--nw-muted-text)' }}>
        —
      </span>
    );
  }
  return (
    <div className="grid grid-cols-2 gap-x-3 gap-y-1.5">
      {axes.map((axis) => (
        <div
          key={axis.labelKey}
          className="flex min-w-0 items-baseline justify-between gap-1 text-[10px]"
        >
          <span className="truncate" style={subtleTextStyle}>
            {t(axis.labelKey)}
          </span>
          <span className="font-semibold">{axis.value}%</span>
        </div>
      ))}
    </div>
  );
}

export function EmptyBlock({ message }: { message: string }) {
  return (
    <div className="mt-3 flex min-h-28 items-center justify-center border border-dashed px-4 py-6 text-center text-xs">
      <span style={mutedTextStyle}>{message}</span>
    </div>
  );
}

export function EmptyTableRow({ colSpan, message }: { colSpan: number; message: string }) {
  return (
    <tr className="border-t" style={tableBorderStyle}>
      <td colSpan={colSpan} className="px-4 py-6 text-center text-xs" style={mutedTextStyle}>
        {message}
      </td>
    </tr>
  );
}

export function IconActionButton({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className="inline-flex h-7 w-7 shrink-0 items-center justify-center border"
      style={controlStyle}
    >
      {children}
    </button>
  );
}

export function SectionHeading({
  icon,
  title,
  description,
  aside,
}: {
  icon: React.ReactNode;
  title: string;
  description?: string;
  aside?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-2">
      <div>
        <h2 className="flex items-center gap-2 text-base font-bold">
          <span style={primaryTextStyle}>{icon}</span>
          {title}
        </h2>
        {description ? (
          <p className="mt-1 text-xs" style={mutedTextStyle}>
            {description}
          </p>
        ) : null}
      </div>
      {aside ? <div className="min-w-0 max-w-full">{aside}</div> : null}
    </div>
  );
}

export function SectionLabel({ icon, title }: { icon: React.ReactNode; title: string }) {
  return (
    <h3 className="flex items-center gap-2 text-sm font-bold">
      <span style={primaryTextStyle}>{icon}</span>
      {title}
    </h3>
  );
}

export function JestStatusLabel({ status }: { status: string }) {
  const failed = status === 'FAIL' || status === 'failed';
  const tone = failed ? 'var(--nw-danger)' : 'var(--nw-success)';
  return (
    <span
      className="inline-flex h-6 items-center border px-2 font-mono text-[11px] font-bold"
      style={{
        background: `color-mix(in srgb, ${tone} 12%, var(--nw-panel))`,
        borderColor: `color-mix(in srgb, ${tone} 42%, var(--nw-border))`,
        borderRadius: 'var(--nw-control-radius)',
        color: tone,
      }}
    >
      {failed ? 'FAIL' : 'PASS'}
    </span>
  );
}

const tokenSizeLabelKeys: Record<string, string> = {
  huge: 'projectDetail.tokenSize.huge',
  big: 'projectDetail.tokenSize.big',
  medium: 'projectDetail.tokenSize.medium',
  small: 'projectDetail.tokenSize.small',
  tiny: 'projectDetail.tokenSize.tiny',
};

const complexityLabelKeys: Record<string, string> = {
  very_complex: 'projectDetail.complexity.veryComplex',
  complex: 'projectDetail.complexity.complex',
  moderate: 'projectDetail.complexity.moderate',
  simple: 'projectDetail.complexity.simple',
  trivial: 'projectDetail.complexity.trivial',
};

export function SizeChip({ value }: { value: string }) {
  const { t } = useTranslation();
  const labelKey = tokenSizeLabelKeys[value];
  const tone =
    value === 'huge' || value === 'big'
      ? 'var(--nw-warning)'
      : value === 'medium'
        ? 'var(--nw-warning)'
        : value === 'small' || value === 'tiny'
          ? 'var(--nw-success)'
          : 'var(--nw-muted-text)';
  return (
    <span
      className="inline-flex h-6 items-center border px-2 text-[11px] font-semibold"
      style={{
        background: `color-mix(in srgb, ${tone} 12%, var(--nw-panel))`,
        borderColor: `color-mix(in srgb, ${tone} 42%, var(--nw-border))`,
        borderRadius: 'var(--nw-control-radius)',
        color: tone,
      }}
    >
      {labelKey ? t(labelKey) : value}
    </span>
  );
}

export function ComplexityChip({ value }: { value: string }) {
  const { t } = useTranslation();
  const labelKey = complexityLabelKeys[value];
  const tone =
    value === 'very_complex' || value === 'complex'
      ? 'var(--nw-warning)'
      : value === 'moderate'
        ? 'var(--nw-primary)'
        : value === 'simple' || value === 'trivial'
          ? 'var(--nw-success)'
          : 'var(--nw-muted-text)';
  return (
    <span
      className="inline-flex h-6 items-center border px-2 text-[11px] font-semibold"
      style={{
        background: `color-mix(in srgb, ${tone} 12%, var(--nw-panel))`,
        borderColor: `color-mix(in srgb, ${tone} 42%, var(--nw-border))`,
        borderRadius: 'var(--nw-control-radius)',
        color: tone,
      }}
    >
      {labelKey ? t(labelKey) : value}
    </span>
  );
}

export function ActiveChip({ active }: { active: boolean }) {
  const { t } = useTranslation();
  const tone = active ? 'var(--nw-success)' : 'var(--nw-muted-text)';
  return (
    <span
      className="inline-flex h-6 items-center border px-2 text-[11px] font-semibold"
      style={{
        background: `color-mix(in srgb, ${tone} 12%, var(--nw-panel))`,
        borderColor: `color-mix(in srgb, ${tone} 42%, var(--nw-border))`,
        borderRadius: 'var(--nw-control-radius)',
        color: tone,
      }}
    >
      {active ? t('projectDetail.status.active') : t('projectDetail.status.inactive')}
    </span>
  );
}

export function formatCompactTokens(tokens: number) {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`;
  return `${Math.round(tokens / 1_000)}K`;
}
