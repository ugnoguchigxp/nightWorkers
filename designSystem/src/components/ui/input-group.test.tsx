import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Input } from './input';
import { InputGroup, InputGroupLabel } from './input-group';

describe('InputGroup', () => {
  it('renders correctly', () => {
    render(
      <InputGroup>
        <InputGroupLabel htmlFor="email">Email</InputGroupLabel>
        <Input id="email" placeholder="Email" />
      </InputGroup>
    );

    expect(screen.getByText('Email')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Email')).toBeInTheDocument();
  });
});
