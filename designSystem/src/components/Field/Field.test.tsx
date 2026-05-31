import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Input } from '../Input';
import { Field, FieldDescription, FieldGroup, FieldLabel } from './Field';

describe('Field Component', () => {
  it('renders label and input correctly', () => {
    render(
      <Field>
        <FieldLabel>Email</FieldLabel>
        <Input />
      </Field>
    );

    expect(screen.getByText('Email')).toBeInTheDocument();
    expect(screen.getByRole('textbox')).toBeInTheDocument();
  });

  it('renders description', () => {
    render(
      <Field>
        <FieldLabel>Email</FieldLabel>
        <Input />
        <FieldDescription>Enter email</FieldDescription>
      </Field>
    );

    expect(screen.getByText('Enter email')).toBeInTheDocument();
  });

  // Note: Error component rendering depends on validation state validation which is handled by Base UI.
  // We verify visually in Storybook.

  it('applies horizontal orientation class', () => {
    const { container } = render(
      <Field orientation="horizontal">
        <FieldLabel>Label</FieldLabel>
        <Input />
      </Field>
    );

    // Field root is the first child div
    expect(container.firstChild).toHaveClass('flex-row');
    expect(container.firstChild).toHaveClass('items-center');
  });

  it('applies vertical orientation (default) class', () => {
    const { container } = render(
      <Field>
        <FieldLabel>Label</FieldLabel>
        <Input />
      </Field>
    );

    expect(container.firstChild).toHaveClass('flex-col');
    expect(container.firstChild).not.toHaveClass('flex-row');
  });

  it('renders FieldGroup with gap', () => {
    const { container } = render(
      <FieldGroup>
        <Field>
          <FieldLabel>1</FieldLabel>
        </Field>
        <Field>
          <FieldLabel>2</FieldLabel>
        </Field>
      </FieldGroup>
    );

    expect(container.firstChild).toHaveClass('flex');
    expect(container.firstChild).toHaveClass('flex-col');
    expect(container.firstChild).toHaveClass('gap-[var(--ui-gap-base,0.5rem)]');
  });

  describe('Inline Variant', () => {
    it('applies inline variant classes', () => {
      const { container } = render(
        <Field variant="inline">
          <FieldLabel>Label</FieldLabel>
          <Input />
        </Field>
      );
      expect(container.firstChild).toHaveClass('flex-row');
      expect(container.firstChild).toHaveClass('gap-[var(--ui-gap-base,0.5rem)]');
      // Default align is baseline
      expect(container.firstChild).toHaveClass('items-baseline');
    });

    it('applies align start', () => {
      const { container } = render(
        <Field variant="inline" align="start">
          <FieldLabel>Label</FieldLabel>
          <Input />
        </Field>
      );
      expect(container.firstChild).toHaveClass('items-start');
    });

    it('applies align center', () => {
      const { container } = render(
        <Field variant="inline" align="center">
          <FieldLabel>Label</FieldLabel>
          <Input />
        </Field>
      );
      expect(container.firstChild).toHaveClass('items-center');
    });

    it('applies align endpoint (bottom)', () => {
      const { container } = render(
        <Field variant="inline" align="endpoint">
          <FieldLabel>Label</FieldLabel>
          <Input />
        </Field>
      );
      expect(container.firstChild).toHaveClass('items-end');
    });

    it('applies nowrap to label', () => {
      render(
        <Field variant="inline">
          <FieldLabel nowrap>Label</FieldLabel>
          <Input />
        </Field>
      );
      expect(screen.getByText('Label')).toHaveClass('whitespace-nowrap');
    });
  });
});
