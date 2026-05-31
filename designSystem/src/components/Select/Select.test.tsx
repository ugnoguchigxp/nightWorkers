import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from '@/components/Select/Select';

// Mock ResizeObserver
beforeEach(() => {
  global.ResizeObserver = class ResizeObserver {
    observe = vi.fn();
    unobserve = vi.fn();
    disconnect = vi.fn();
  };
});

describe('Select Component', () => {
  const user = userEvent.setup();

  const renderSelect = (triggerProps = {}, contentProps = {}, itemProps = {}) => {
    return render(
      <Select>
        <SelectTrigger aria-label="Food" {...triggerProps}>
          <SelectValue placeholder="Select a food" />
        </SelectTrigger>
        <SelectContent {...contentProps}>
          <SelectGroup>
            <SelectLabel>Fruits</SelectLabel>
            <SelectItem value="apple" {...itemProps}>
              Apple
            </SelectItem>
            <SelectItem value="banana">Banana</SelectItem>
            <SelectSeparator />
            <SelectItem value="orange">Orange</SelectItem>
          </SelectGroup>
        </SelectContent>
      </Select>
    );
  };

  it('renders correctly', () => {
    renderSelect();
    expect(screen.getByRole('combobox')).toBeInTheDocument();
    expect(screen.getByText('Select a food')).toBeInTheDocument();
  });

  describe('Interactions', () => {
    it('opens content when clicked', async () => {
      renderSelect();
      const trigger = screen.getByRole('combobox');

      await user.click(trigger);

      const content = await screen.findByRole('listbox');
      expect(content).toBeInTheDocument();
      expect(screen.getByText('Apple')).toBeInTheDocument();
    });

    it('selects an item and updates value', async () => {
      renderSelect();
      const trigger = screen.getByRole('combobox');

      await user.click(trigger);
      const appleItem = await screen.findByRole('option', { name: 'Apple' });
      await user.click(appleItem);

      expect(screen.getByText('Apple')).toBeInTheDocument();
    });
  });

  describe('Trigger Variants', () => {
    it('renders default variant', () => {
      render(
        <Select>
          <SelectTrigger>Trigger</SelectTrigger>
          <SelectContent>
            <SelectItem value="1">1</SelectItem>
          </SelectContent>
        </Select>
      );
      const trigger = screen.getByRole('combobox');
      expect(trigger).toHaveClass('bg-background');
      expect(trigger).toHaveClass('border-input');
    });

    it('renders outline variant', () => {
      render(
        <Select>
          <SelectTrigger variant="outline">Trigger</SelectTrigger>
          <SelectContent>
            <SelectItem value="1">1</SelectItem>
          </SelectContent>
        </Select>
      );
      const trigger = screen.getByRole('combobox');
      expect(trigger).toHaveClass('bg-transparent');
    });

    it('renders ghost variant', () => {
      render(
        <Select>
          <SelectTrigger variant="ghost">Trigger</SelectTrigger>
          <SelectContent>
            <SelectItem value="1">1</SelectItem>
          </SelectContent>
        </Select>
      );
      const trigger = screen.getByRole('combobox');
      expect(trigger).toHaveClass('bg-transparent');
      expect(trigger).toHaveClass('border-transparent');
    });
  });

  describe('Trigger Sizes', () => {
    it('renders sm size', () => {
      render(
        <Select defaultValue="apple">
          <SelectTrigger size="sm" />
          <SelectContent>
            <SelectItem value="apple">Apple</SelectItem>
          </SelectContent>
        </Select>
      );
      expect(screen.getByRole('combobox')).toHaveClass('min-h-8');
    });

    it('renders md size (default)', () => {
      render(
        <Select>
          <SelectTrigger>Trigger</SelectTrigger>
          <SelectContent>
            <SelectItem value="1">1</SelectItem>
          </SelectContent>
        </Select>
      );
      expect(screen.getByRole('combobox')).toHaveClass('h-ui');
    });

    it('renders lg size', () => {
      render(
        <Select>
          <SelectTrigger size="lg">Trigger</SelectTrigger>
          <SelectContent>
            <SelectItem value="1">1</SelectItem>
          </SelectContent>
        </Select>
      );
      expect(screen.getByRole('combobox')).toHaveClass('h-12');
    });
  });

  describe('Item Variants', () => {
    it('renders with check indicator (default but check prop explicit)', async () => {
      renderSelect();
      const trigger = screen.getByRole('combobox');
      await user.click(trigger);
      const item = await screen.findByRole('option', { name: 'Apple' });
      expect(item.querySelector('span.flex.h-4.w-4')).toBeInTheDocument();
    });

    it('renders different sizes', async () => {
      renderSelect({}, {}, { size: 'lg' });
      const trigger = screen.getByRole('combobox');
      await user.click(trigger);
      const item = await screen.findByRole('option', { name: 'Apple' });
      expect(item).toHaveClass('min-h-12');
    });
  });

  describe('Content Props', () => {
    it('renders content', async () => {
      renderSelect();
      const trigger = screen.getByRole('combobox');
      await user.click(trigger);
      const content = await screen.findByRole('listbox');
      expect(content).toBeInTheDocument();
    });

    it('applies alignItemWithTrigger width styling', async () => {
      renderSelect({}, { alignItemWithTrigger: true });
      await user.click(screen.getByRole('combobox'));
      const content = await screen.findByRole('listbox');
      expect(content).toHaveClass('w-[var(--anchor-width)]');
      expect(content).toHaveClass('max-w-[var(--anchor-width)]');
    });

    it('applies scrollable styling by default', async () => {
      renderSelect(); // default scrollable=true
      await user.click(screen.getByRole('combobox'));
      const content = await screen.findByRole('listbox');
      const innerDiv = content.querySelector('div');
      expect(innerDiv).toHaveClass('max-h-[var(--radix-select-content-available-height,16rem)]');
      expect(innerDiv).toHaveClass('overflow-y-auto');
      expect(innerDiv).toHaveClass('[scrollbar-gutter:stable]');
      expect(innerDiv).toHaveClass('scrollbar-thin');
    });

    it('removes scrollable styling when false', async () => {
      renderSelect({}, { scrollable: false });
      await user.click(screen.getByRole('combobox'));
      const content = await screen.findByRole('listbox');
      const innerDiv = content.querySelector('div');
      expect(innerDiv).not.toHaveClass('overflow-y-auto');
    });
  });

  describe('Additional Components', () => {
    it('renders label and separator', async () => {
      renderSelect();
      await user.click(screen.getByRole('combobox'));
      expect(await screen.findByText('Fruits')).toHaveClass('font-semibold');
    });
  });

  describe('Props and Refs', () => {
    it('forwards refs to Trigger', () => {
      const ref = React.createRef<HTMLButtonElement>();
      render(
        <Select>
          <SelectTrigger ref={ref}>Trigger</SelectTrigger>
          <SelectContent>
            <SelectItem value="1">1</SelectItem>
          </SelectContent>
        </Select>
      );
      expect(ref.current).toBeInstanceOf(HTMLButtonElement);
    });

    it('applies custom className to Trigger', () => {
      render(
        <Select>
          <SelectTrigger className="custom-trigger">Trigger</SelectTrigger>
          <SelectContent>
            <SelectItem value="1">1</SelectItem>
          </SelectContent>
        </Select>
      );
      expect(screen.getByRole('combobox')).toHaveClass('custom-trigger');
    });

    it('passes disabled prop to Trigger', () => {
      render(
        <Select>
          <SelectTrigger disabled>Trigger</SelectTrigger>
          <SelectContent>
            <SelectItem value="1">1</SelectItem>
          </SelectContent>
        </Select>
      );
      expect(screen.getByRole('combobox')).toBeDisabled();
    });

    it('applies custom className to Item', async () => {
      renderSelect({}, {}, { className: 'custom-item' });
      await user.click(screen.getByRole('combobox'));
      const item = await screen.findByRole('option', { name: 'Apple' });
      expect(item).toHaveClass('custom-item');
    });

    it('applies custom className to Label', async () => {
      render(
        <Select>
          <SelectTrigger>Trigger</SelectTrigger>
          <SelectContent>
            <SelectGroup>
              <SelectLabel className="custom-label">Label</SelectLabel>
              <SelectItem value="1">1</SelectItem>
            </SelectGroup>
          </SelectContent>
        </Select>
      );
      await user.click(screen.getByRole('combobox'));
      expect(await screen.findByText('Label')).toHaveClass('custom-label');
    });

    it('applies custom className to Separator', async () => {
      render(
        <Select>
          <SelectTrigger>Trigger</SelectTrigger>
          <SelectContent>
            <SelectGroup>
              <SelectItem value="1">1</SelectItem>
              <SelectSeparator className="custom-separator" data-testid="sep" />
              <SelectItem value="2">2</SelectItem>
            </SelectGroup>
          </SelectContent>
        </Select>
      );
      await user.click(screen.getByRole('combobox'));
      // Adding testId to separator in implementation might be needed if role is missing,
      // but Separator usually has role="separator".
      // Let's check logic: SelectSeparator passes ...props.
      // We can use a testid if we modify the test render above or rely on class.
      // But we can't easily find a separator by role if it's presentation?
      // Radix separator has `role="separator"` usually.
      // Let's assume passed props work, we can add data-testid to the component render in test.
      await screen.findByTestId('sep');
      expect(screen.getByTestId('sep')).toHaveClass('custom-separator');
    });
  });
});
