import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Separator } from './Separator';

// No need to mock Radix UI as we are testing the migrated component using Base UI
// Mocking the cn utility
vi.mock('@/utils/cn', () => ({
  cn: (...classes: (string | undefined)[]) => classes.filter(Boolean).join(' '),
}));

describe('Separator Component', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Basic Rendering', () => {
    it('renders separator with default props', () => {
      render(<Separator />);

      const separator = screen.getByRole('separator');
      expect(separator).toBeInTheDocument();
      expect(separator).toHaveAttribute('data-orientation', 'horizontal');
    });

    it('renders with custom className', () => {
      render(<Separator className="custom-separator" />);

      const separator = screen.getByRole('separator');
      expect(separator).toHaveClass('custom-separator');
    });

    it('renders without children', () => {
      render(<Separator />);

      const separator = screen.getByRole('separator');
      expect(separator).toBeInTheDocument();
      expect(separator).toBeEmptyDOMElement();
    });
  });

  describe('Orientation Variants', () => {
    it('renders horizontal orientation by default', () => {
      render(<Separator />);

      const separator = screen.getByRole('separator');
      expect(separator).toHaveAttribute('data-orientation', 'horizontal');
      expect(separator).toHaveClass('h-[1px]', 'w-full');
    });

    it('renders horizontal orientation explicitly', () => {
      render(<Separator orientation="horizontal" />);

      const separator = screen.getByRole('separator');
      expect(separator).toHaveAttribute('data-orientation', 'horizontal');
      expect(separator).toHaveClass('h-[1px]', 'w-full');
    });

    it('renders vertical orientation', () => {
      render(<Separator orientation="vertical" />);

      const separator = screen.getByRole('separator');
      expect(separator).toHaveAttribute('data-orientation', 'vertical');
      expect(separator).toHaveClass('h-full', 'w-[1px]');
    });
  });

  describe('Decorative Property', () => {
    it('renders as non-decorative (standard separator) since decorative is not a direct prop in Base UI v1 Separator', () => {
      render(<Separator />);

      const separator = screen.getByRole('separator');
      expect(separator).toHaveAttribute('role', 'separator');
    });
  });

  describe('Default Classes', () => {
    it('applies default styling classes', () => {
      render(<Separator />);

      const separator = screen.getByRole('separator');
      expect(separator).toHaveClass('shrink-0', 'bg-border');
    });

    it('combines default classes with custom classes', () => {
      render(<Separator className="custom-class another-class" />);

      const separator = screen.getByRole('separator');
      expect(separator).toHaveClass('shrink-0', 'bg-border', 'custom-class', 'another-class');
    });

    it('combines orientation classes with custom classes', () => {
      render(<Separator orientation="vertical" className="custom-vertical" />);

      const separator = screen.getByRole('separator');
      expect(separator).toHaveClass(
        'shrink-0',
        'bg-border',
        'h-full',
        'w-[1px]',
        'custom-vertical'
      );
    });
  });

  describe('Props Handling', () => {
    it('passes through data attributes', () => {
      render(<Separator data-custom="test" />);

      const separator = screen.getByRole('separator');
      expect(separator).toHaveAttribute('data-custom', 'test');
    });

    it('passes through style prop', () => {
      render(<Separator style={{ margin: '10px', padding: '5px' }} />);

      const separator = screen.getByRole('separator');
      expect(separator).toHaveStyle({ margin: '10px', padding: '5px' });
    });

    it('passes through aria attributes', () => {
      render(<Separator aria-label="Separator" />);

      const separator = screen.getByRole('separator');
      expect(separator).toHaveAttribute('aria-label', 'Separator');
    });
  });

  describe('Forward Ref', () => {
    it('forwards ref correctly', () => {
      const ref = { current: null as HTMLDivElement | null };

      render(<Separator ref={ref} />);

      expect(ref.current).toBe(screen.getByRole('separator'));
    });

    it('works with null ref', () => {
      expect(() => {
        render(<Separator ref={null} />);
      }).not.toThrow();
    });
  });

  describe('Accessibility', () => {
    it('has proper role for separator', () => {
      render(<Separator />);

      const separator = screen.getByRole('separator');
      expect(separator).toHaveAttribute('role', 'separator');
    });

    it('has proper aria-orientation', () => {
      render(<Separator orientation="vertical" />);

      const separator = screen.getByRole('separator');
      expect(separator).toHaveAttribute('aria-orientation', 'vertical');
    });
  });

  describe('Component Structure', () => {
    it('renders as div element', () => {
      render(<Separator />);

      const separator = screen.getByRole('separator');
      expect(separator.tagName).toBe('DIV');
    });

    it('has correct dimensions for horizontal', () => {
      render(<Separator orientation="horizontal" />);

      const separator = screen.getByRole('separator');
      expect(separator).toHaveClass('h-[1px]', 'w-full');
    });

    it('has correct dimensions for vertical', () => {
      render(<Separator orientation="vertical" />);

      const separator = screen.getByRole('separator');
      expect(separator).toHaveClass('h-full', 'w-[1px]');
    });
  });

  describe('Edge Cases', () => {
    it('handles empty string className', () => {
      render(<Separator className="" />);

      const separator = screen.getByRole('separator');
      expect(separator).toHaveClass('shrink-0', 'bg-border');
    });

    it('handles undefined className', () => {
      render(<Separator className={undefined} />);

      const separator = screen.getByRole('separator');
      expect(separator).toHaveClass('shrink-0', 'bg-border');
    });

    it('handles all props combinations', () => {
      render(<Separator orientation="vertical" className="test-class" data-test="value" />);

      const separator = screen.getByRole('separator');
      expect(separator).toHaveAttribute('data-orientation', 'vertical');
      expect(separator).toHaveAttribute('data-test', 'value');
      expect(separator).toHaveClass('test-class');
    });
  });

  describe('Component Behavior', () => {
    it('handles prop changes', () => {
      const { rerender } = render(<Separator orientation="horizontal" />);

      let separator = screen.getByRole('separator');
      expect(separator).toHaveAttribute('data-orientation', 'horizontal');
      expect(separator).toHaveClass('h-[1px]', 'w-full');

      rerender(<Separator orientation="vertical" />);

      separator = screen.getByRole('separator');
      expect(separator).toHaveAttribute('data-orientation', 'vertical');
      expect(separator).toHaveClass('h-full', 'w-[1px]');
    });

    it('maintains default classes during re-renders', () => {
      const { rerender } = render(<Separator />);

      let separator = screen.getByRole('separator');
      expect(separator).toHaveClass('shrink-0', 'bg-border');

      rerender(<Separator className="new-class" />);

      separator = screen.getByRole('separator');
      expect(separator).toHaveClass('shrink-0', 'bg-border', 'new-class');
    });
  });

  describe('Export', () => {
    it('exports Separator component correctly', () => {
      expect(Separator).toBeDefined();
      expect(typeof Separator).toBe('object'); // forwardRef component is an object
    });
  });

  describe('Styling Variations', () => {
    it('applies custom styling correctly', () => {
      render(<Separator className="bg-red-500 h-2" />);

      const separator = screen.getByRole('separator');
      expect(separator).toHaveClass('bg-red-500', 'h-2');
      expect(separator).toHaveClass('shrink-0'); // should still have default
    });

    it('handles responsive classes', () => {
      render(<Separator className="md:h-2 lg:h-3" />);

      const separator = screen.getByRole('separator');
      expect(separator).toHaveClass('md:h-2', 'lg:h-3');
    });

    it('handles conditional classes', () => {
      const isHidden = false;
      render(<Separator className={isHidden ? 'hidden' : ''} />);

      const separator = screen.getByRole('separator');
      expect(separator).not.toHaveClass('hidden');
    });
  });
});
