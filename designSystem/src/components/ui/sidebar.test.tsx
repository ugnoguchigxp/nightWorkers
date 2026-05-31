import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarItem,
  SidebarSectionTitle,
} from './sidebar';

describe('Sidebar', () => {
  it('renders all parts correctly', () => {
    render(
      <Sidebar>
        <SidebarHeader>Header</SidebarHeader>
        <SidebarContent>
          <SidebarSectionTitle>Menu</SidebarSectionTitle>
          <SidebarItem>Dashboard</SidebarItem>
          <SidebarItem>Settings</SidebarItem>
        </SidebarContent>
        <SidebarFooter>Footer</SidebarFooter>
      </Sidebar>
    );

    expect(screen.getByText('Header')).toBeInTheDocument();
    expect(screen.getByText('Menu')).toBeInTheDocument();
    expect(screen.getByText('Dashboard')).toBeInTheDocument();
    expect(screen.getByText('Footer')).toBeInTheDocument();
  });
});
