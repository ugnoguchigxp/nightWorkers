import * as React from 'react';
import { THEME_COLORS, type ThemeName, type ThemeTone } from '@/styles/themes';
import { cn } from '@/utils/cn';

export interface HealthRadarLabelOffset {
  x?: number;
  y?: number;
  radial?: number;
}

export interface HealthRadarChartDatum {
  key: string;
  label: string;
  value: number;
  min: number;
  max: number;
  averageInner: number;
  averageOuter: number;
  labelOffset?: HealthRadarLabelOffset;
}

export interface HealthRadarChartColorScheme {
  grid: string;
  axis: string;
  averageBand: string;
  averageBandStroke: string;
  valueFill: string;
  valueStroke: string;
  valuePoint: string;
  valuePointOutline: string;
  label: string;
}

export type HealthRadarChartVariant = 'auto' | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14 | 15 | 16;

export interface HealthRadarChartProps extends Omit<React.SVGProps<SVGSVGElement>, 'children'> {
  data: HealthRadarChartDatum[];
  variant?: HealthRadarChartVariant;
  size?: number;
  padding?: number;
  gridLevels?: number;
  labelDistance?: number;
  animationEnabled?: boolean;
  animate?: boolean;
  animationDurationMs?: number;
  showValueLabels?: boolean;
  showAverageRangeLabels?: boolean;
  numberFormatter?: (
    value: number,
    kind: 'value' | 'averageInner' | 'averageOuter',
    datum: HealthRadarChartDatum
  ) => string;
  enableExpandModal?: boolean;
  expandedSize?: number;
  expandedTitle?: React.ReactNode;
  showGrid?: boolean;
  showAxes?: boolean;
  showAverageGuides?: boolean;
  pointRadius?: number;
  colors?: Partial<HealthRadarChartColorScheme>;
}

interface Point {
  x: number;
  y: number;
}

const DEFAULT_COLORS: HealthRadarChartColorScheme = {
  grid: 'var(--color-chart-4)',
  axis: 'var(--color-chart-3)',
  averageBand: 'var(--color-chart-1)',
  averageBandStroke: 'var(--color-chart-1)',
  valueFill: 'var(--color-chart-2)',
  valueStroke: 'var(--color-chart-2)',
  valuePoint: 'var(--color-chart-2)',
  valuePointOutline: 'var(--color-background)',
  label: 'var(--color-foreground)',
};

const START_ANGLE = -Math.PI / 2;
const TWO_PI = Math.PI * 2;

const clamp = (value: number, min: number, max: number): number =>
  Math.min(Math.max(value, min), max);

const normalizeValue = (value: number, min: number, max: number): number => {
  if (max <= min) return 0;
  return clamp((value - min) / (max - min), 0, 1);
};

const polarToCartesian = (center: number, angle: number, radius: number): Point => ({
  x: center + Math.cos(angle) * radius,
  y: center + Math.sin(angle) * radius,
});

const pointsToPath = (points: Point[]): string => {
  if (points.length === 0) return '';
  const first = points[0];
  if (!first) return '';
  const rest = points.slice(1);
  return `M ${first.x.toFixed(2)} ${first.y.toFixed(2)} ${rest
    .map((point) => `L ${point.x.toFixed(2)} ${point.y.toFixed(2)}`)
    .join(' ')} Z`;
};

const formatNumber = (value: number): string =>
  Number.isInteger(value) ? `${value}` : value.toFixed(1).replace(/\.0$/, '');

const resolveThemeTone = (): ThemeTone => {
  if (typeof document === 'undefined') return 'light';
  const themeName = (document.documentElement.getAttribute('data-theme') ?? 'light') as ThemeName;
  return THEME_COLORS[themeName]?.tone ?? 'light';
};

const HealthRadarChart = React.forwardRef<SVGSVGElement, HealthRadarChartProps>(
  (
    {
      data,
      variant = 'auto',
      size = 360,
      padding = 56,
      gridLevels = 4,
      labelDistance = 24,
      animationEnabled,
      animate = true,
      animationDurationMs = 900,
      showValueLabels = false,
      showAverageRangeLabels = false,
      numberFormatter,
      enableExpandModal = false,
      expandedSize,
      expandedTitle = 'Expanded health radar chart',
      showGrid = true,
      showAxes = true,
      showAverageGuides = true,
      pointRadius = 4,
      colors,
      className,
      'aria-label': ariaLabel = 'Health radar chart',
      onClick,
      onKeyDown,
      style,
      ...props
    },
    ref
  ) => {
    const [isExpanded, setIsExpanded] = React.useState(false);
    const [themeTone, setThemeTone] = React.useState<ThemeTone>(resolveThemeTone);

    React.useEffect(() => {
      if (typeof document === 'undefined') return;
      const root = document.documentElement;
      const observer = new MutationObserver((mutations) => {
        for (const mutation of mutations) {
          if (mutation.type === 'attributes' && mutation.attributeName === 'data-theme') {
            setThemeTone(resolveThemeTone());
            break;
          }
        }
      });
      observer.observe(root, {
        attributes: true,
        attributeFilter: ['data-theme'],
      });
      return () => observer.disconnect();
    }, []);

    if (data.length === 0) return null;

    const requestedAxisCount = variant === 'auto' ? data.length : variant;
    const chartData = data.slice(0, requestedAxisCount);
    if (chartData.length < 3) return null;

    const colorPalette = { ...DEFAULT_COLORS, ...colors };
    const center = size / 2;
    const chartRadius = Math.max(size / 2 - padding, 0);
    const axisCount = chartData.length;
    const safeGridLevels = Math.max(1, gridLevels);
    const shouldAnimate = animationEnabled ?? animate;
    const modalChartSize = expandedSize ?? Math.min(Math.max(size + 180, 520), 920);
    const isLightTone = themeTone === 'light';
    const styleOpacity = isLightTone
      ? {
          grid: 0.7,
          axis: 0.8,
          averageFill: 0.34,
          averageStroke: 0.9,
          valueFill: 0.28,
          label: 0.95,
        }
      : {
          grid: 0.35,
          axis: 0.55,
          averageFill: 0.22,
          averageStroke: 0.7,
          valueFill: 0.2,
          label: 0.8,
        };

    const angleForIndex = (index: number) => START_ANGLE + (TWO_PI * index) / axisCount;

    const pointAt = (index: number, normalizedValue: number): Point => {
      const angle = angleForIndex(index);
      return polarToCartesian(center, angle, chartRadius * normalizedValue);
    };
    const offsetFromCenter = (point: Point, distance: number): Point => {
      const dx = point.x - center;
      const dy = point.y - center;
      const magnitude = Math.hypot(dx, dy) || 1;
      return {
        x: point.x + (dx / magnitude) * distance,
        y: point.y + (dy / magnitude) * distance,
      };
    };
    const formatLabel = (
      value: number,
      kind: 'value' | 'averageInner' | 'averageOuter',
      datum: HealthRadarChartDatum
    ) => (numberFormatter ? numberFormatter(value, kind, datum) : formatNumber(value));

    const valuePoints = chartData.map((datum, index) =>
      pointAt(index, normalizeValue(datum.value, datum.min, datum.max))
    );
    const averageOuterPoints = chartData.map((datum, index) =>
      pointAt(index, normalizeValue(datum.averageOuter, datum.min, datum.max))
    );
    const averageInnerPoints = chartData.map((datum, index) =>
      pointAt(index, normalizeValue(datum.averageInner, datum.min, datum.max))
    );

    const valuePath = pointsToPath(valuePoints);
    const averageBandPath = `${pointsToPath(averageOuterPoints)} ${pointsToPath(
      [...averageInnerPoints].reverse()
    )}`.trim();

    const axisEndpoints = chartData.map((_, index) => pointAt(index, 1));
    const gridPaths = Array.from({ length: safeGridLevels }, (_, levelIndex) =>
      pointsToPath(
        chartData.map((_, axisIndex) => pointAt(axisIndex, (levelIndex + 1) / safeGridLevels))
      )
    );
    const chartStyle = enableExpandModal ? { cursor: 'zoom-in', ...style } : style;
    const handleChartClick = (event: React.MouseEvent<SVGSVGElement>) => {
      onClick?.(event);
      if (!event.defaultPrevented && enableExpandModal) {
        setIsExpanded(true);
      }
    };
    const handleChartKeyDown = (event: React.KeyboardEvent<SVGSVGElement>) => {
      onKeyDown?.(event);
      if (event.defaultPrevented || !enableExpandModal) return;
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        setIsExpanded(true);
      }
    };

    return (
      <>
        <svg
          ref={ref}
          data-testid="health-radar-chart"
          role="img"
          aria-label={ariaLabel}
          viewBox={`0 0 ${size} ${size}`}
          width={size}
          height={size}
          className={cn('h-auto w-full', className)}
          tabIndex={enableExpandModal ? 0 : undefined}
          onClick={handleChartClick}
          onKeyDown={handleChartKeyDown}
          style={chartStyle}
          {...props}
        >
          {showGrid && (
            <g data-testid="health-radar-grid">
              {gridPaths.map((path, index) => (
                <path
                  key={`grid-${index + 1}`}
                  d={path}
                  fill="none"
                  stroke={colorPalette.grid}
                  strokeOpacity={styleOpacity.grid}
                  strokeWidth={1}
                />
              ))}
            </g>
          )}

          {showAxes && (
            <g data-testid="health-radar-axes">
              {axisEndpoints.map((point, index) => (
                <line
                  key={`axis-${chartData[index]?.key ?? index}`}
                  x1={center}
                  y1={center}
                  x2={point.x}
                  y2={point.y}
                  stroke={colorPalette.axis}
                  strokeOpacity={styleOpacity.axis}
                  strokeWidth={1}
                />
              ))}
            </g>
          )}

          <g data-testid="health-radar-average-group">
            <path
              data-testid="health-radar-average-band"
              d={averageBandPath}
              fill={colorPalette.averageBand}
              fillOpacity={styleOpacity.averageFill}
              fillRule="evenodd"
            />
            {showAverageGuides && (
              <>
                <path
                  d={pointsToPath(averageOuterPoints)}
                  fill="none"
                  stroke={colorPalette.averageBandStroke}
                  strokeOpacity={styleOpacity.averageStroke}
                  strokeWidth={1.5}
                  strokeLinejoin="round"
                />
                <path
                  d={pointsToPath(averageInnerPoints)}
                  fill="none"
                  stroke={colorPalette.averageBandStroke}
                  strokeOpacity={styleOpacity.averageStroke}
                  strokeWidth={1.5}
                  strokeLinejoin="round"
                />
              </>
            )}
          </g>

          <g data-testid="health-radar-value-group">
            <path
              d={valuePath}
              fill={colorPalette.valueFill}
              fillOpacity={styleOpacity.valueFill}
              stroke="none"
            />
            <path
              data-testid="health-radar-value-path"
              d={valuePath}
              fill="none"
              stroke={colorPalette.valueStroke}
              strokeWidth={2.5}
              strokeLinejoin="round"
              strokeLinecap="round"
              pathLength={1}
              strokeDasharray={1}
              strokeDashoffset={shouldAnimate ? 1 : 0}
            >
              {shouldAnimate && (
                <animate
                  data-testid="health-radar-value-animation"
                  attributeName="stroke-dashoffset"
                  from="1"
                  to="0"
                  dur={`${animationDurationMs}ms`}
                  fill="freeze"
                />
              )}
            </path>

            {valuePoints.map((point, index) => (
              <circle
                key={`point-${chartData[index]?.key ?? index}`}
                data-testid={`health-radar-point-${chartData[index]?.key ?? index}`}
                cx={point.x}
                cy={point.y}
                r={pointRadius}
                fill={colorPalette.valuePoint}
                stroke={colorPalette.valuePointOutline}
                strokeWidth={2}
              />
            ))}

            {showValueLabels &&
              chartData.map((datum, index) => {
                const point = valuePoints[index];
                if (!point) return null;
                const labelPoint = offsetFromCenter(point, 14);
                return (
                  <text
                    key={`value-label-${datum.key}`}
                    data-testid={`health-radar-value-label-${datum.key}`}
                    x={labelPoint.x}
                    y={labelPoint.y}
                    textAnchor="middle"
                    dominantBaseline="middle"
                    fill={colorPalette.valueStroke}
                    fontSize={11}
                    fontWeight={600}
                  >
                    {formatLabel(datum.value, 'value', datum)}
                  </text>
                );
              })}

            {showAverageRangeLabels &&
              chartData.map((datum, index) => {
                const outerPoint = averageOuterPoints[index];
                const innerPoint = averageInnerPoints[index];
                if (!outerPoint || !innerPoint) return null;
                const outer = offsetFromCenter(outerPoint, 8);
                const inner = offsetFromCenter(innerPoint, -8);
                return (
                  <g key={`average-label-${datum.key}`}>
                    <text
                      data-testid={`health-radar-average-outer-label-${datum.key}`}
                      x={outer.x}
                      y={outer.y}
                      textAnchor="middle"
                      dominantBaseline="middle"
                      fill={colorPalette.averageBandStroke}
                      fontSize={10}
                    >
                      {formatLabel(datum.averageOuter, 'averageOuter', datum)}
                    </text>
                    <text
                      data-testid={`health-radar-average-inner-label-${datum.key}`}
                      x={inner.x}
                      y={inner.y}
                      textAnchor="middle"
                      dominantBaseline="middle"
                      fill={colorPalette.averageBandStroke}
                      fontSize={10}
                    >
                      {formatLabel(datum.averageInner, 'averageInner', datum)}
                    </text>
                  </g>
                );
              })}
          </g>

          <g data-testid="health-radar-label-group">
            {chartData.map((datum, index) => {
              const angle = angleForIndex(index);
              const extraOffset = datum.labelOffset ?? {};
              const labelPoint = polarToCartesian(
                center,
                angle,
                chartRadius + labelDistance + (extraOffset.radial ?? 0)
              );
              const labelX = labelPoint.x + (extraOffset.x ?? 0);
              const labelY = labelPoint.y + (extraOffset.y ?? 0);
              const cosine = Math.cos(angle);
              const textAnchor = cosine > 0.3 ? 'start' : cosine < -0.3 ? 'end' : 'middle';

              return (
                <text
                  key={`label-${datum.key}`}
                  data-testid={`health-radar-label-${datum.key}`}
                  x={labelX}
                  y={labelY}
                  textAnchor={textAnchor}
                  dominantBaseline="middle"
                  fill={colorPalette.label}
                  fillOpacity={styleOpacity.label}
                  fontSize={13}
                >
                  {datum.label}
                </text>
              );
            })}
          </g>
        </svg>

        {enableExpandModal && isExpanded && (
          <div
            data-testid="health-radar-modal"
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          >
            <button
              type="button"
              aria-label="Close expanded chart overlay"
              className="absolute inset-0"
              onClick={() => setIsExpanded(false)}
            />
            <div className="relative w-full max-w-[95vw] rounded-lg bg-background p-4 text-foreground shadow-xl">
              <div className="mb-3 flex items-center justify-between gap-4">
                <div className="text-sm font-semibold">{expandedTitle}</div>
                <button
                  type="button"
                  aria-label="Close expanded chart"
                  className="rounded border border-border px-3 py-1 text-sm"
                  onClick={() => setIsExpanded(false)}
                >
                  Close
                </button>
              </div>
              <div className="mx-auto max-w-[95vw]">
                <HealthRadarChart
                  data={data}
                  variant={variant}
                  size={modalChartSize}
                  padding={padding}
                  gridLevels={gridLevels}
                  labelDistance={labelDistance}
                  animationEnabled={animationEnabled}
                  animate={animate}
                  animationDurationMs={animationDurationMs}
                  showValueLabels={showValueLabels}
                  showAverageRangeLabels={showAverageRangeLabels}
                  numberFormatter={numberFormatter}
                  showGrid={showGrid}
                  showAxes={showAxes}
                  showAverageGuides={showAverageGuides}
                  pointRadius={pointRadius}
                  colors={colors}
                  enableExpandModal={false}
                  aria-label={`${ariaLabel} expanded`}
                />
              </div>
            </div>
          </div>
        )}
      </>
    );
  }
);

HealthRadarChart.displayName = 'HealthRadarChart';

export { HealthRadarChart };
