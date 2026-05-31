import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { Switch } from './switch';

describe('Switch', () => {
  it('renders and toggles correctly', async () => {
    render(<Switch aria-label="Toggle switch" />);

    const sw = screen.getByRole('switch', { name: /toggle switch/i });
    expect(sw).toBeInTheDocument();
    expect(sw).not.toHaveAttribute('data-checked');

    await userEvent.click(sw);
    expect(sw).toHaveAttribute('data-checked');
  });

  it('is disabled when the disabled prop is true', () => {
    render(<Switch disabled aria-label="Disabled switch" />);
    const sw = screen.getByRole('switch', { name: /disabled switch/i });
    expect(sw).toHaveAttribute('data-disabled');
  });

  it('applies custom className', () => {
    render(<Switch className="custom-class" aria-label="Custom switch" />);
    const sw = screen.getByRole('switch', { name: /custom switch/i });
    expect(sw).toHaveClass('custom-class');
  });
});
