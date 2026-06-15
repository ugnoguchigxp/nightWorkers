import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { PreviewCard } from '../BlueprintPreviewPrimitives';
import {
  chartPreviewItems,
  compactChartLabel,
  PREVIEW_CHART_HEIGHT,
  PREVIEW_CHART_MIN_WIDTH,
} from '../previewModel';
import { chartTooltipStyle } from './helpers';
import type { SectionRendererInput } from './types';

export function renderChartSection({ componentName, props, t }: SectionRendererInput) {
  const chartItems = chartPreviewItems(props);

  return (
    <div className="grid gap-[var(--blueprint-preview-gap)]">
      <div className="min-h-52 overflow-x-auto rounded-md border border-border bg-muted p-3">
        <ResponsiveContainer
          height={PREVIEW_CHART_HEIGHT}
          minHeight={PREVIEW_CHART_HEIGHT}
          minWidth={PREVIEW_CHART_MIN_WIDTH}
          width="100%"
        >
          <ComposedChart data={chartItems} margin={{ top: 8, right: 12, bottom: 4, left: -12 }}>
            <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
            <XAxis
              axisLine={{ stroke: 'var(--border)' }}
              dataKey="label"
              interval={0}
              tick={{ fill: 'var(--muted-foreground)', fontSize: 10 }}
              tickFormatter={compactChartLabel}
              tickLine={false}
            />
            <YAxis
              axisLine={false}
              tick={{ fill: 'var(--muted-foreground)', fontSize: 10 }}
              tickLine={false}
              width={30}
            />
            <Tooltip
              cursor={{ fill: 'color-mix(in srgb, var(--primary) 10%, transparent)' }}
              contentStyle={chartTooltipStyle}
              formatter={(value) => [String(value), 'Value']}
              labelStyle={{ color: 'var(--muted-foreground)' }}
            />
            <Bar dataKey="value" fill="var(--primary)" maxBarSize={48} radius={[4, 4, 0, 0]} />
            <Line
              dataKey="value"
              dot={{ fill: 'var(--primary)', r: 3 }}
              stroke="color-mix(in srgb, var(--primary) 60%, var(--foreground))"
              strokeWidth={2}
              type="monotone"
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <div className="grid gap-2 sm:grid-cols-3">
        {chartItems.slice(0, 3).map((item, index) => (
          <PreviewCard className="bg-card p-2" key={`${item.label}-${index}`}>
            <div className="text-[11px] text-muted-foreground">{item.label}</div>
            <div className="mt-1 text-lg font-semibold text-foreground">{item.value}</div>
          </PreviewCard>
        ))}
      </div>
    </div>
  );
}
