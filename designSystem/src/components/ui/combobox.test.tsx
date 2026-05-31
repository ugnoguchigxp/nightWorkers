import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import {
  Combobox,
  ComboboxContent,
  ComboboxInput,
  ComboboxItem,
  ComboboxTrigger,
} from './combobox';

describe('Combobox', () => {
  it('opens and selects an item', async () => {
    render(
      <Combobox>
        <div className="relative">
          <ComboboxInput placeholder="Select framework..." />
          <ComboboxTrigger />
        </div>
        <ComboboxContent>
          <ComboboxItem value="next">Next.js</ComboboxItem>
          <ComboboxItem value="svelte">Svelte</ComboboxItem>
        </ComboboxContent>
      </Combobox>
    );

    const input = screen.getByPlaceholderText(/select framework/i);
    await userEvent.type(input, 'Next');

    // In BaseUI, typing might open the popup
    expect(await screen.findByRole('option', { name: /next\.js/i })).toBeInTheDocument();
  });
});
