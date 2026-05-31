import type { Meta, StoryObj } from '@storybook/react-vite';
import { HealthRadarChart, type HealthRadarChartDatum } from './HealthRadarChart';

const baseData: HealthRadarChartDatum[] = [
  {
    key: 'wbc',
    label: 'WBC',
    value: 6.2,
    min: 3.5,
    max: 9.5,
    averageInner: 4.8,
    averageOuter: 6.0,
  },
  {
    key: 'rbc',
    label: 'RBC',
    value: 4.7,
    min: 3.6,
    max: 5.5,
    averageInner: 4.0,
    averageOuter: 4.9,
  },
  {
    key: 'hba1c',
    label: 'HbA1c',
    value: 5.9,
    min: 4.6,
    max: 6.4,
    averageInner: 5.1,
    averageOuter: 5.7,
  },
  {
    key: 'ldl',
    label: 'LDL',
    value: 132,
    min: 60,
    max: 160,
    averageInner: 90,
    averageOuter: 120,
    labelOffset: { x: -8, y: 2 },
  },
  {
    key: 'hdl',
    label: 'HDL',
    value: 57,
    min: 30,
    max: 90,
    averageInner: 45,
    averageOuter: 65,
    labelOffset: { x: 8 },
  },
  {
    key: 'tg',
    label: 'TG',
    value: 118,
    min: 30,
    max: 200,
    averageInner: 70,
    averageOuter: 130,
    labelOffset: { y: 4 },
  },
];

const createVariantData = (count: number): HealthRadarChartDatum[] =>
  Array.from({ length: count }, (_, index) => {
    const baseValue = 38 + ((index * 9) % 48);
    return {
      key: `axis-${index + 1}`,
      label: `Axis ${index + 1}`,
      value: baseValue,
      min: 0,
      max: 100,
      averageInner: 40,
      averageOuter: 65,
    };
  });

const meta: Meta<typeof HealthRadarChart> = {
  title: 'Components/HealthRadarChart',
  component: HealthRadarChart,
  tags: ['autodocs'],
  args: {
    data: baseData,
    size: 420,
  },
  decorators: [
    (Story) => (
      <div
        style={{
          padding: '2rem',
          backgroundColor: 'hsl(var(--background))',
          maxWidth: '560px',
        }}
      >
        <Story />
      </div>
    ),
  ],
};

export default meta;
type Story = StoryObj<typeof HealthRadarChart>;

export const Default: Story = {};

export const CustomAverageBand: Story = {
  args: {
    data: baseData.map((datum) =>
      datum.key === 'hba1c'
        ? {
            ...datum,
            averageInner: 5.4,
            averageOuter: 6.2,
          }
        : datum
    ),
    colors: {
      averageBand: 'rgba(236, 72, 153, 0.2)',
      averageBandStroke: 'rgba(236, 72, 153, 0.55)',
      valueStroke: '#be185d',
      valuePoint: '#be185d',
      valueFill: 'rgba(190, 24, 93, 0.12)',
    },
    animationDurationMs: 1400,
    labelDistance: 30,
  },
};

export const HexagonVariant: Story = {
  args: {
    variant: 6,
    data: createVariantData(6),
  },
};

export const HexadecagonVariant: Story = {
  args: {
    variant: 16,
    data: createVariantData(16),
    size: 500,
    labelDistance: 20,
  },
};

export const AnimationOff: Story = {
  args: {
    data: baseData,
    animationEnabled: false,
  },
};

export const NumberLabelsAndModal: Story = {
  args: {
    data: baseData,
    showValueLabels: true,
    showAverageRangeLabels: true,
    enableExpandModal: true,
    expandedTitle: 'Health check radar chart',
  },
};
