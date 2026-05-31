import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { RadioGroup, RadioGroupItem } from './radio-group';

describe('RadioGroup', () => {
  it('renders and selects items', async () => {
    render(
      <RadioGroup defaultValue="option-1">
        <div className="flex items-center space-x-2">
          <RadioGroupItem value="option-1" id="option-1" />
          <label htmlFor="option-1">Option 1</label>
        </div>
        <div className="flex items-center space-x-2">
          <RadioGroupItem value="option-2" id="option-2" />
          <label htmlFor="option-2">Option 2</label>
        </div>
      </RadioGroup>
    );

    const radio1 = screen.getByRole('radio', { name: /option 1/i });
    const radio2 = screen.getByRole('radio', { name: /option 2/i });

    expect(radio1).toHaveAttribute('data-checked');
    expect(radio2).not.toHaveAttribute('data-checked');

    await userEvent.click(radio2);
    expect(radio2).toHaveAttribute('data-checked');
    expect(radio1).not.toHaveAttribute('data-checked');
  });
});
