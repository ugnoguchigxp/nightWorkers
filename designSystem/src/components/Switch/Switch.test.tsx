import { render, screen } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Switch } from './Switch';

// No need to mock Radix UI as we are testing the migrated component using Base UI
// Mocking the cn utility
vi.mock('@/utils/cn', () => ({
  cn: (...classes: (string | undefined)[]) => classes.filter(Boolean).join(' '),
}));

// Mock the cn utility
vi.mock('@/utils/cn', () => ({
  cn: (...classes: (string | undefined)[]) => classes.filter(Boolean).join(' '),
}));

describe('Switch Component', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Basic Rendering', () => {
    it('renders correctly', () => {
      render(<Switch />);

      const switchRoot = screen.getByRole('switch');
      expect(switchRoot).toBeInTheDocument();
      // Base UI Switch might render as span with role="switch"
      expect(switchRoot).toHaveAttribute('role', 'switch');

      const switchThumb = switchRoot.querySelector('span');
      expect(switchThumb).toBeInTheDocument();
    });

    it('passes extra props to the root element', () => {
      render(<Switch id="test-switch" data-custom="value" />);

      const switchRoot = screen.getByRole('switch');
      // In Base UI, the id might be on the input or the root. Usually we care about the root for styling.
      // Actually Base UI Root receives the id by default.
      expect(switchRoot).toHaveAttribute('id');
      expect(switchRoot).toHaveAttribute('data-custom', 'value');
    });

    it('forwards ref to the root element', () => {
      const ref = React.createRef<HTMLButtonElement>();
      render(<Switch ref={ref} />);

      expect(ref.current).toBe(screen.getByRole('switch'));
    });
  });

  describe('Styling and Classes', () => {
    it('applies default classes to root', () => {
      render(<Switch />);

      const switchRoot = screen.getByRole('switch');
      expect(switchRoot).toHaveClass(
        'peer',
        'inline-flex',
        'h-[var(--ui-switch-height)]',
        'w-[var(--ui-switch-width)]',
        'shrink-0',
        'cursor-pointer',
        'items-center',
        'rounded-full',
        'border-2',
        'border-transparent',
        'transition-colors',
        'focus-visible:outline-none',
        'focus-visible:ring-2',
        'focus-visible:ring-ring',
        'focus-visible:ring-offset-2',
        'focus-visible:ring-offset-background',
        'disabled:cursor-not-allowed',
        'disabled:opacity-50',
        'data-[checked]:bg-primary'
      );
    });

    it('applies default classes to thumb', () => {
      render(<Switch />);

      const switchRoot = screen.getByRole('switch');
      const switchThumb = switchRoot.querySelector('span');
      expect(switchThumb).toHaveClass(
        'pointer-events-none',
        'block',
        'h-[var(--ui-switch-thumb-size)]',
        'w-[var(--ui-switch-thumb-size)]',
        'rounded-full',
        'bg-background',
        'shadow-lg',
        'ring-0',
        'transition-transform',
        'data-[checked]:translate-x-[var(--ui-switch-thumb-translate)]'
      );
    });

    it('merges custom className with default classes', () => {
      render(<Switch className="custom-switch-class" />);

      const switchRoot = screen.getByRole('switch');
      expect(switchRoot).toHaveClass('custom-switch-class');
      expect(switchRoot).toHaveClass('peer'); // Should still have default classes
    });
  });

  describe('States', () => {
    it('handles checked state attribute', () => {
      render(<Switch checked />);

      const switchRoot = screen.getByRole('switch');
      expect(switchRoot).toHaveAttribute('aria-checked', 'true');
    });

    it('handles disabled state', () => {
      render(<Switch disabled />);

      const switchRoot = screen.getByRole('switch');
      expect(switchRoot).toHaveAttribute('aria-disabled', 'true');
    });
  });
});
