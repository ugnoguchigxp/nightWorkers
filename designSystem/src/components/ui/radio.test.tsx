import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Radio } from './radio';
import { RadioGroup } from './radio-group';

describe('Radio', () => {
  it('renders correctly', () => {
    render(<Radio value="test" aria-label="radio-test" />);
    const radio = screen.getByRole('radio');
    expect(radio).toBeInTheDocument();
  });

  it('applies checked state via Group', () => {
    render(
      <RadioGroup value="checked">
        <Radio value="checked" aria-label="radio-checked" />
      </RadioGroup>
    );
    const radio = screen.getByRole('radio');
    expect(radio).toHaveAttribute('data-checked');
  });
});
