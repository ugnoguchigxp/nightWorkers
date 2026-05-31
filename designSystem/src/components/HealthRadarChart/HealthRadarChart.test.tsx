import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { HealthRadarChart, type HealthRadarChartDatum } from './HealthRadarChart';

const createData = (): HealthRadarChartDatum[] => [
  {
    key: 'wbc',
    label: 'WBC',
    value: 5.8,
    min: 3.5,
    max: 9.5,
    averageInner: 4.8,
    averageOuter: 6.0,
  },
  {
    key: 'rbc',
    label: 'RBC',
    value: 4.2,
    min: 3.6,
    max: 5.5,
    averageInner: 4.0,
    averageOuter: 4.9,
  },
  {
    key: 'hba1c',
    label: 'HbA1c',
    value: 5.7,
    min: 4.6,
    max: 6.4,
    averageInner: 5.1,
    averageOuter: 5.7,
  },
  {
    key: 'ldl',
    label: 'LDL',
    value: 115,
    min: 60,
    max: 160,
    averageInner: 90,
    averageOuter: 120,
  },
  {
    key: 'hdl',
    label: 'HDL',
    value: 59,
    min: 30,
    max: 90,
    averageInner: 45,
    averageOuter: 65,
  },
];

const createVariantData = (count: number): HealthRadarChartDatum[] =>
  Array.from({ length: count }, (_, index) => {
    const baseValue = 40 + ((index * 7) % 45);
    return {
      key: `axis-${index + 1}`,
      label: `Axis ${index + 1}`,
      value: baseValue,
      min: 0,
      max: 100,
      averageInner: 42,
      averageOuter: 62,
    };
  });

describe('HealthRadarChart', () => {
  it('renders chart with labels and points', () => {
    const data = createData();
    render(<HealthRadarChart data={data} size={320} animate={false} />);

    expect(screen.getByTestId('health-radar-chart')).toHaveAttribute('viewBox', '0 0 320 320');

    for (const datum of data) {
      expect(screen.getByTestId(`health-radar-label-${datum.key}`)).toHaveTextContent(datum.label);
      expect(screen.getByTestId(`health-radar-point-${datum.key}`)).toBeInTheDocument();
    }
  });

  it('renders average band as donut with even-odd fill rule', () => {
    render(<HealthRadarChart data={createData()} />);

    const averageBand = screen.getByTestId('health-radar-average-band');
    expect(averageBand).toHaveAttribute('fill-rule', 'evenodd');
    expect(averageBand.getAttribute('d')).toContain('M');
    expect(averageBand.getAttribute('d')).toContain('Z');
  });

  it('supports line drawing animation controls', () => {
    const { rerender } = render(
      <HealthRadarChart data={createData()} animate animationDurationMs={1600} />
    );

    const animatedPath = screen.getByTestId('health-radar-value-path');
    expect(animatedPath).toHaveAttribute('pathLength', '1');
    expect(animatedPath).toHaveAttribute('stroke-dasharray', '1');
    expect(animatedPath).toHaveAttribute('stroke-dashoffset', '1');
    expect(screen.getByTestId('health-radar-value-animation')).toHaveAttribute('dur', '1600ms');

    rerender(<HealthRadarChart data={createData()} animate={false} />);
    expect(screen.queryByTestId('health-radar-value-animation')).toBeNull();
    expect(screen.getByTestId('health-radar-value-path')).toHaveAttribute('stroke-dashoffset', '0');
  });

  it('supports animationEnabled prop to turn animation on or off', () => {
    const { rerender } = render(<HealthRadarChart data={createData()} animationEnabled={false} />);

    expect(screen.queryByTestId('health-radar-value-animation')).toBeNull();
    expect(screen.getByTestId('health-radar-value-path')).toHaveAttribute('stroke-dashoffset', '0');

    rerender(<HealthRadarChart data={createData()} animationEnabled={true} animate={false} />);
    expect(screen.getByTestId('health-radar-value-animation')).toBeInTheDocument();
  });

  it('shows numeric labels for value and average range', () => {
    const data = createData();
    const { container } = render(
      <HealthRadarChart
        data={data}
        showValueLabels
        showAverageRangeLabels
        numberFormatter={(value, kind) => `${kind}:${value}`}
      />
    );

    expect(container.querySelectorAll('[data-testid^="health-radar-value-label-"]')).toHaveLength(
      data.length
    );
    expect(
      container.querySelectorAll('[data-testid^="health-radar-average-outer-label-"]')
    ).toHaveLength(data.length);
    expect(
      container.querySelectorAll('[data-testid^="health-radar-average-inner-label-"]')
    ).toHaveLength(data.length);
    expect(screen.getByText('value:5.8')).toBeInTheDocument();
    expect(screen.getByText('averageOuter:6')).toBeInTheDocument();
    expect(screen.getByText('averageInner:4.8')).toBeInTheDocument();
  });

  it('applies per-label position offsets', () => {
    const data = createData();
    const { rerender } = render(<HealthRadarChart data={data} animate={false} />);

    const label = screen.getByTestId('health-radar-label-ldl');
    const initialX = Number(label.getAttribute('x'));
    const initialY = Number(label.getAttribute('y'));

    const offsetData = createData().map((datum) =>
      datum.key === 'ldl'
        ? {
            ...datum,
            labelOffset: { x: 28, y: -12, radial: 12 },
          }
        : datum
    );

    rerender(<HealthRadarChart data={offsetData} animate={false} />);
    const offsetLabel = screen.getByTestId('health-radar-label-ldl');

    expect(Number(offsetLabel.getAttribute('x'))).not.toBe(initialX);
    expect(Number(offsetLabel.getAttribute('y'))).not.toBe(initialY);
  });

  it('supports variant sides from 6 to 16', () => {
    const data16 = createVariantData(16);
    const { container, rerender } = render(
      <HealthRadarChart data={data16} variant={6} animate={false} />
    );

    expect(container.querySelectorAll('[data-testid^="health-radar-point-"]')).toHaveLength(6);

    rerender(<HealthRadarChart data={data16} variant={16} animate={false} />);
    expect(container.querySelectorAll('[data-testid^="health-radar-point-"]')).toHaveLength(16);
  });

  it('uses chart theme tokens and updates opacity by theme tone', async () => {
    const { container } = render(<HealthRadarChart data={createData()} />);

    const gridPath = container.querySelector('[data-testid="health-radar-grid"] path');
    const axisLine = container.querySelector('[data-testid="health-radar-axes"] line');
    const valueFill = container.querySelector('[data-testid="health-radar-value-group"] path');

    expect(gridPath).toHaveAttribute('stroke', 'var(--color-chart-4)');
    expect(axisLine).toHaveAttribute('stroke', 'var(--color-chart-3)');
    expect(valueFill).toHaveAttribute('fill', 'var(--color-chart-2)');
    expect(gridPath).toHaveAttribute('stroke-opacity', '0.7');
    expect(axisLine).toHaveAttribute('stroke-opacity', '0.8');
    expect(valueFill).toHaveAttribute('fill-opacity', '0.28');

    act(() => {
      document.documentElement.setAttribute('data-theme', 'dark');
    });

    await waitFor(() => {
      expect(gridPath).toHaveAttribute('stroke-opacity', '0.35');
    });
    expect(axisLine).toHaveAttribute('stroke-opacity', '0.55');
    expect(valueFill).toHaveAttribute('fill-opacity', '0.2');

    act(() => {
      document.documentElement.setAttribute('data-theme', 'light');
    });
    await waitFor(() => {
      expect(gridPath).toHaveAttribute('stroke-opacity', '0.7');
    });
  });

  it('opens and closes expanded modal when enabled', () => {
    render(<HealthRadarChart data={createData()} enableExpandModal />);

    expect(screen.queryByTestId('health-radar-modal')).toBeNull();

    fireEvent.click(screen.getByTestId('health-radar-chart'));
    expect(screen.getByTestId('health-radar-modal')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Close expanded chart' }));
    expect(screen.queryByTestId('health-radar-modal')).toBeNull();
  });

  it('returns null for empty dataset', () => {
    const { container } = render(<HealthRadarChart data={[]} />);
    expect(container.firstChild).toBeNull();
  });
});
