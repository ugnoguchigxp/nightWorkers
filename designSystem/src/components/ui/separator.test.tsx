import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Separator } from './separator';

describe('Separator', () => {
  it('renders correctly with default horizontal orientation', () => {
    const { container } = render(<Separator />);
    const separator = container.firstChild as HTMLElement;
    expect(separator).toBeInTheDocument();
    expect(separator).toHaveClass('bg-border');
    expect(separator).toHaveClass('h-[1px]');
    expect(separator).toHaveClass('w-full');
  });

  it('renders with vertical orientation', () => {
    const { container } = render(<Separator orientation="vertical" />);
    const separator = container.firstChild as HTMLElement;
    expect(separator).toHaveClass('h-full');
    expect(separator).toHaveClass('w-[1px]');
  });

  it('applies custom className', () => {
    const { container } = render(<Separator className="custom-class" />);
    const separator = container.firstChild as HTMLElement;
    expect(separator).toHaveClass('custom-class');
  });

  it('renders with different variants', () => {
    const { container: strong } = render(<Separator variant="strong" />);
    expect(strong.firstChild).toHaveClass('bg-foreground/30');

    const { container: accent } = render(<Separator variant="accent" />);
    expect(accent.firstChild).toHaveClass('bg-primary/40');
  });

  it('renders with different thickness', () => {
    const { container: thick } = render(<Separator thickness="2" />);
    expect(thick.firstChild).toHaveClass('h-[2px]');
  });

  it('renders with gradient style', () => {
    const { container } = render(<Separator gradient />);
    expect(container.firstChild).toHaveClass('bg-gradient-to-r');
    expect(container.firstChild).toHaveClass('from-transparent');
    expect(container.firstChild).toHaveClass('via-border');
    expect(container.firstChild).toHaveClass('to-transparent');
  });
});
