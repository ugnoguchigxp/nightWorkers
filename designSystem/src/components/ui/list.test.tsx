import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { List, ListDivider, ListItem, ListSearchBox, ListTitle } from './list';

describe('List', () => {
  it('renders all sub-components', () => {
    render(
      <List>
        <ListTitle>Settings</ListTitle>
        <ListSearchBox>Search...</ListSearchBox>
        <ListDivider />
        <ListItem>Profile</ListItem>
        <ListItem checked>Account</ListItem>
      </List>
    );

    expect(screen.getByText('Settings')).toBeInTheDocument();
    expect(screen.getByText('Search...')).toBeInTheDocument();
    expect(screen.getByText('Profile')).toBeInTheDocument();
    expect(screen.getByText('Account')).toBeInTheDocument();
  });
});
