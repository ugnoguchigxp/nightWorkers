import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ProgressBar } from './ProgressBar';

describe('ProgressBar', () => {
  it('renders with default props', () => {
    render(<ProgressBar value={50} />);
    const progress = screen.getByRole('progressbar');
    expect(progress).toBeInTheDocument();
    expect(progress).toHaveAttribute('aria-valuenow', '50');
    // Default height uses CSS variable
    expect(progress).toHaveClass('h-[var(--ui-progress-height)]');
  });

  it('renders with label and subLabel', () => {
    render(<ProgressBar value={50} label="Progress" subLabel="Halfway" />);
    expect(screen.getByText('Progress')).toBeInTheDocument();
    expect(screen.getByText('Halfway')).toBeInTheDocument();
  });

  it('clamps value between 0 and 100', () => {
    const { rerender } = render(<ProgressBar value={150} />);

    // Find the indicator - it's inside the track
    const progress = screen.getByRole('progressbar');
    const indicator =
      progress.querySelector('div[style*="width"]') ||
      progress.querySelector('[role="presentation"]') ||
      progress.firstElementChild?.firstElementChild;

    // 150 clamped to 100 -> width 100%
    expect(indicator).toHaveStyle({ width: '100%' });

    rerender(<ProgressBar value={-20} />);
    // -20 clamped to 0 -> width 0%
    expect(indicator).toHaveStyle({ width: '0%' });
  });

  it('applies custom color', () => {
    render(<ProgressBar value={50} color="bg-purple-500" />);
    const indicator = screen.getByRole('progressbar').querySelector('.bg-purple-500');
    expect(indicator).toBeInTheDocument();
  });

  it('applies status-based colors', () => {
    const { rerender, container } = render(<ProgressBar value={50} status="paused" />);
    // Finding the indicator using the color class
    let indicator = container.querySelector('.bg-yellow-500');
    expect(indicator).toBeInTheDocument();

    rerender(<ProgressBar value={50} status="error" />);
    indicator = container.querySelector('.bg-red-800');
    expect(indicator).toBeInTheDocument();
  });

  it('interpolates color for normal status', () => {
    const { container } = render(<ProgressBar value={50} status="normal" />);
    const indicator = container.querySelector("div[style*='background-color']") as HTMLElement;
    // 50% is Blue: rgb(37, 99, 235)
    expect(indicator.style.backgroundColor).toContain('rgb(37, 99, 235)');
  });

  it('renders striped and animated by default', () => {
    const { container } = render(<ProgressBar value={50} />);
    const indicator = container.querySelector('.animate-progress-stripes');
    expect(indicator).toBeInTheDocument();
  });

  it('disables animation and stripes', () => {
    const { container } = render(<ProgressBar value={50} striped={false} animated={false} />);
    const indicator = container.querySelector('.animate-progress-stripes');
    expect(indicator).not.toBeInTheDocument();
  });

  it('shows percentage inside bar for sufficient height', () => {
    render(<ProgressBar value={50} height="h-6" />);
    // PercentFormat displays 50%
    expect(screen.getByText('50%')).toBeInTheDocument();
  });

  it('does not show percentage for small height', () => {
    render(<ProgressBar value={50} height="h-2" />);
    expect(screen.queryByText('50%')).not.toBeInTheDocument();
  });
});
